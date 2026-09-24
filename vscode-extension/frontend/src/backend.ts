import * as vscode from "vscode";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import type { LlmConfiguration } from "./configuration";

export interface ExplainResult {
  markdown: string;
  artifacts?: unknown;
}

export class BackendClient implements vscode.Disposable {
  private readonly runtimeDir: string;
  private readonly python: string;
  private readonly pythonRoot: string;
  private setup: Promise<void> | undefined;

  dispose(): void {}

  constructor(
    context: vscode.ExtensionContext,
    private readonly output: vscode.OutputChannel,
  ) {
    this.runtimeDir = path.join(context.globalStorageUri.fsPath, "runtime");
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
    await this.install();
    const outputRoot = path.join(this.runtimeDir, "results");
    const baseArgs = ["--commit-url", commitUrl, "--output-root", outputRoot];
    const model = llm.model;
    const runs = String(vscode.workspace.getConfiguration("rationale").get("runs", 3));
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
    const summaryPath = path.join(resultDir, "rationale_summary.txt");
    const markdown = await fs.readFile(summaryPath, "utf8");
    return { markdown, artifacts: resultDir };
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
