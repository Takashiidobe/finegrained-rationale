import * as vscode from "vscode";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import type { LlmConfiguration } from "./configuration";

export interface ExplainResult {
  commitUrl: string;
  commitSha: string;
  repository: string;
  components: {
    GOAL: string;
    NEED: string;
    ALTERNATIVES: string;
  };
  rationaleFile: string;
  artifacts: string;
}

export class BackendClient implements vscode.Disposable {
  private readonly runtimeDir: string;
  private readonly python: string;
  private readonly pythonRoot: string;
  private readonly extensionPath: string;
  private readonly extensionMode: vscode.ExtensionMode;
  private setup: Promise<void> | undefined;

  dispose(): void {}

  constructor(
    context: vscode.ExtensionContext,
    private readonly output: vscode.OutputChannel,
  ) {
    this.runtimeDir = path.join(context.globalStorageUri.fsPath, "runtime");
    this.extensionPath = context.extensionPath;
    this.extensionMode = context.extensionMode;
    this.pythonRoot = path.join(context.extensionPath, "python");
    const venv = path.join(context.globalStorageUri.fsPath, "venv");
    this.python = process.platform === "win32"
      ? path.join(venv, "Scripts", "python.exe")
      : path.join(venv, "bin", "python");
  }

  async install(): Promise<void> {
    if (!this.setup) this.setup = this.installRuntime();
    return this.setup;
  }

  async findExistingRationale(commitUrl: string): Promise<string | undefined> {
    const url = new URL(commitUrl);
    const [, owner, repo, , sha] = url.pathname.split("/");
    const repoRoot = await this.getWorkspaceRepoRoot(this.extensionPath, this.extensionMode);
    const file = path.join(repoRoot, ".rationale", owner, repo, `commit-${sha.slice(0, 12)}.md`);
    try {
      await fs.access(file);
      return file;
    } catch {
      return undefined;
    }
  }

  private async installRuntime(): Promise<void> {
    const config = vscode.workspace.getConfiguration("rationale");
    const configuredPython = config.get<string>("pythonPath", "");
    const bootstrapPython = configuredPython || (process.platform === "win32" ? "python" : "python3");
    await fs.mkdir(this.runtimeDir, { recursive: true });
    try {
      await fs.access(this.python);
    } catch {
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: "Setting up Rationale backend…", cancellable: false },
        async (progress) => {
          progress.report({ message: "Creating Python environment" });
          await this.run(bootstrapPython, ["-m", "venv", path.dirname(path.dirname(this.python))]);
          await this.installDependencies(progress);
        },
      );
      return;
    }
    await this.installDependencies();
  }

  private async installDependencies(progress?: vscode.Progress<{ message?: string }>): Promise<void> {
    const requirementsPath = path.join(this.pythonRoot, "requirements.txt");
    const requirements = await fs.readFile(requirementsPath);
    const fingerprint = createHash("sha256").update(requirements).digest("hex");
    const marker = path.join(path.dirname(path.dirname(this.python)), ".rationale-deps-installed");
    try {
      if ((await fs.readFile(marker, "utf8")) === fingerprint) return;
    } catch {}
    progress?.report({ message: "Installing backend dependencies" });
    await this.run(this.python, ["-m", "pip", "install", "-r", requirementsPath]);
    await fs.writeFile(marker, fingerprint);
  }

  async explainCommit(commitUrl: string, llm: LlmConfiguration, githubToken?: string): Promise<ExplainResult> {
    const repoRoot = await this.getWorkspaceRepoRoot(this.extensionPath, this.extensionMode);
    await this.install();
    const outputRoot = path.join(this.runtimeDir, "results");
    const baseArgs = ["--commit-url", commitUrl, "--output-root", outputRoot];
    const model = llm.model;
    const runs = String(Math.max(1, Math.floor(vscode.workspace.getConfiguration("rationale").get<number>("runs", 1))));
    const env: NodeJS.ProcessEnv = { ...process.env, ARGUS_LLM_MODE: llm.mode, ARGUS_LLM_PROVIDER: llm.provider, ARGUS_SPACY_MODEL: "en_core_web_sm" };
    if (llm.apiKey) env.ARGUS_LLM_API_KEY = llm.apiKey;
    if (llm.mode === "api" && llm.provider === "openai" && llm.apiKey) {
      env.OPENAI_API_KEY = llm.apiKey;
      env.OPENAI_TOKEN = llm.apiKey;
    }
    if (llm.mode === "cli") {
      delete env.OPENAI_API_KEY;
      delete env.OPENAI_TOKEN;
      delete env.CODEX_API_KEY;
      delete env.ANTHROPIC_API_KEY;
      delete env.ANTHROPIC_AUTH_TOKEN;
      delete env.ANTHROPIC_BASE_URL;
      delete env.OPENAI_BASE_URL;
    }
    if (githubToken) env.GITHUB_TOKEN = githubToken;
    const scripts = ["artifact_retrieval.py", "rationale_sentence_identifier.py", "rationale_generation.py"];
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "Generating rationale…", cancellable: false },
      async (progress) => {
        for (const [index, script] of scripts.entries()) {
          progress.report({ message: ["Retrieving GitHub artifacts", "Identifying rationale sentences", "Generating rationale summary"][index] });
          const stageArgs = script === "artifact_retrieval.py"
            ? baseArgs
            : [...baseArgs, "--model", model, ...(script === "rationale_sentence_identifier.py" ? ["--runs", runs] : [])];
          await this.run(this.python, [path.join(this.pythonRoot, "scripts", "ARGUS", script), ...stageArgs], env, this.pythonRoot);
        }
      },
    );
    const url = new URL(commitUrl);
    const [, owner, repo, , sha] = url.pathname.split("/");
    const resultDir = path.join(outputRoot, `${owner}__${repo}__${sha.slice(0, 12)}`);
    const summaryPath = path.join(resultDir, "rationale_summary.json");
    const summary = JSON.parse(await fs.readFile(summaryPath, "utf8")) as {
      components?: Record<string, string>;
    };
    const components = {
      GOAL: summary.components?.GOAL || "",
      NEED: summary.components?.NEED || "",
      ALTERNATIVES: summary.components?.ALTERNATIVES || "",
    };
    const repository = `${owner}/${repo}`;
    const rationaleDir = path.join(repoRoot, ".rationale");
    const rationaleFile = path.join(rationaleDir, owner, repo, `commit-${sha.slice(0, 12)}.md`);
    await fs.mkdir(path.dirname(rationaleFile), { recursive: true });
    const quote = (value: string): string => JSON.stringify(value);
    const markdown = [
      "---",
      `commit: ${quote(commitUrl)}`,
      `commit_sha: ${quote(sha)}`,
      `repository: ${quote(repository)}`,
      `provider: ${quote(llm.provider)}`,
      `model: ${quote(model)}`,
      `runs: ${runs}`,
      `generated_at: ${quote(new Date().toISOString())}`,
      "---",
      "",
      `# Rationale for ${repository}@${sha.slice(0, 12)}`,
      "",
      "## GOAL",
      "",
      components.GOAL || "Not identified.",
      "",
      "## NEED",
      "",
      components.NEED || "Not identified.",
      "",
      "## ALTERNATIVE",
      "",
      components.ALTERNATIVES || "Not identified.",
      "",
    ].join("\n");
    await fs.writeFile(rationaleFile, markdown, "utf8");
    this.output.appendLine(`Saved rationale to ${rationaleFile}`);
    return { commitUrl, commitSha: sha, repository, components, rationaleFile, artifacts: resultDir };
  }

  private async getWorkspaceRepoRoot(extensionPath: string, extensionMode: vscode.ExtensionMode): Promise<string> {
    const workspaces = vscode.workspace.workspaceFolders || [];
    const candidates = workspaces.map((workspace) => workspace.uri.fsPath);
    if (extensionMode === vscode.ExtensionMode.Development) candidates.push(extensionPath);
    for (const candidate of candidates) {
      try {
        const root = (await this.capture("git", ["-C", candidate, "rev-parse", "--show-toplevel"])).trim();
        if (root) return root;
      } catch {}
    }
    if (!workspaces.length && extensionMode !== vscode.ExtensionMode.Development) {
      throw new Error("Open a Git repository folder in VS Code before generating rationale.");
    }
    throw new Error("Could not find the root of the open Git repository.");
  }

  private capture(command: string, args: string[]): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      child.stdout?.on("data", (data) => { stdout += data.toString(); });
      child.stderr?.on("data", (data) => { stderr += data.toString(); });
      child.on("error", reject);
      child.on("close", (code) => code === 0 ? resolve(stdout) : reject(new Error(stderr.trim() || `${command} exited with code ${code}`)));
    });
  }

  private run(command: string, args: string[], env = process.env, cwd?: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.output.appendLine(`$ ${command} ${args.join(" ")}`);
      const child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
      child.stdout?.on("data", (data) => this.output.append(data.toString()));
      child.stderr?.on("data", (data) => this.output.append(data.toString()));
      child.on("error", reject);
      child.on("close", (code) => code === 0 ? resolve() : reject(new Error(`Backend process exited with code ${code}. See the Rationale output channel.`)));
    });
  }
}
