import * as vscode from "vscode";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { ensureSupportedCli } from "./cli";
import { getGitHubCommitUrl, isCommitHash, parseGitHubRemote } from "./commitInput";
import type { CliProvider } from "./cliVersion";
import type { LlmConfiguration } from "./configuration";
import { summarizeFailure } from "./failure";
import { ensureUv } from "./uv";
import { formatRationale, type NumberedReference, type RationaleComponent, type RationaleSummary } from "./references";

const PYTHON_VERSION = "3.14";

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
  title?: string;
  sourceCommits?: Array<{ sha: string; url: string; lines: number }>;
  selection?: { file: string; startLine: number; endLine: number };
  references?: NumberedReference[];
  evidence?: Partial<Record<RationaleComponent, number[]>>;
}

interface SelectionInput { filePath: string; startLine: number; endLine: number; code: string }

function buildLlmEnvironment(llm: LlmConfiguration, githubToken?: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env, ARGUS_LLM_MODE: llm.mode, ARGUS_LLM_PROVIDER: llm.provider };
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
  return env;
}

export class BackendClient implements vscode.Disposable {
  private readonly storageDir: string;
  private readonly runtimeDir: string;
  private readonly envDir: string;
  private readonly python: string;
  private readonly pythonRoot: string;
  private readonly extensionPath: string;
  private readonly extensionMode: vscode.ExtensionMode;
  readonly setupLogPath: string;
  private setup: Promise<void> | undefined;

  dispose(): void {}

  constructor(
    context: vscode.ExtensionContext,
    private readonly output: vscode.LogOutputChannel,
  ) {
    this.storageDir = context.globalStorageUri.fsPath;
    this.runtimeDir = path.join(this.storageDir, "runtime");
    this.envDir = path.join(this.storageDir, "env");
    this.setupLogPath = path.join(this.storageDir, "logs", "setup.log");
    this.extensionPath = context.extensionPath;
    this.extensionMode = context.extensionMode;
    this.pythonRoot = path.join(context.extensionPath, "python");
    this.python = process.platform === "win32"
      ? path.join(this.envDir, "Scripts", "python.exe")
      : path.join(this.envDir, "bin", "python");
  }

  install(): Promise<void> {
    if (!this.setup) {
      this.setup = this.installRuntime().catch((error) => {
        this.setup = undefined;
        throw error;
      });
    }
    return this.setup;
  }

  async repair(): Promise<void> {
    await this.setup?.catch(() => undefined);
    this.setup = undefined;
    await fs.rm(this.envDir, { recursive: true, force: true });
    return this.install();
  }

  async selfTest(llm: LlmConfiguration): Promise<void> {
    if (llm.mode === "cli") await ensureSupportedCli(llm.provider as CliProvider);
    await this.install();
    await this.runScript("cli_selftest.py", ["--model", llm.model], buildLlmEnvironment(llm));
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

  async resolveCommitUrl(input: string): Promise<string> {
    const commitUrl = getGitHubCommitUrl(input);
    if (commitUrl) return commitUrl;
    if (!isCommitHash(input)) throw new Error("Enter a commit hash (7–40 hexadecimal characters) or a GitHub commit URL.");
    const repoRoot = await this.getWorkspaceRepoRoot(this.extensionPath, this.extensionMode);
    let remote: string;
    try {
      remote = await this.capture("git", ["-C", repoRoot, "config", "--get", "remote.origin.url"]);
    } catch {
      throw new Error("The repository has no origin remote. Add a GitHub origin or enter a GitHub commit URL.");
    }
    const github = parseGitHubRemote(remote);
    if (!github) throw new Error("The repository origin must be a GitHub remote. Enter a GitHub commit URL instead.");
    return `https://github.com/${github.owner}/${github.repo}/commit/${input.trim().toLowerCase()}`;
  }

  private async installRuntime(): Promise<void> {
    await fs.mkdir(this.runtimeDir, { recursive: true });
    await fs.mkdir(path.dirname(this.setupLogPath), { recursive: true });
    await fs.rm(path.join(this.storageDir, "venv"), { recursive: true, force: true });
    const transcript: string[] = [`Rationale backend setup ${new Date().toISOString()}\n`];
    const firstRun = !(await fs.access(this.python).then(() => true, () => false));
    const setUp = async (progress?: vscode.Progress<{ message?: string }>): Promise<void> => {
      const configuredUv = vscode.workspace.getConfiguration("rationale").get<string>("uvPath", "");
      progress?.report({ message: "Downloading uv" });
      const uv = configuredUv || await ensureUv(this.storageDir, (line) => this.log(line, transcript));
      progress?.report({ message: `Installing Python ${PYTHON_VERSION} and dependencies` });
      await this.syncEnvironment(uv, transcript);
      try {
        await this.run(this.python, ["-c", "import anthropic, openai, requests"], process.env, undefined, transcript);
      } catch {
        this.log("Backend environment is incomplete; rebuilding it.", transcript);
        await fs.rm(this.envDir, { recursive: true, force: true });
        await this.syncEnvironment(uv, transcript);
        await this.run(this.python, ["-c", "import anthropic, openai, requests"], process.env, undefined, transcript);
      }
    };
    try {
      if (firstRun) {
        await vscode.window.withProgress(
          { location: vscode.ProgressLocation.Notification, title: "Setting up Rationale backend…", cancellable: false },
          setUp,
        );
      } else {
        await setUp();
      }
      transcript.push("Setup succeeded.\n");
    } catch (error) {
      transcript.push(`Setup failed: ${(error as Error).message}\n`);
      this.output.error(`Backend setup failed: ${(error as Error).message}`);
      throw error;
    } finally {
      await fs.writeFile(this.setupLogPath, transcript.join(""), "utf8").catch(() => undefined);
    }
  }

  private syncEnvironment(uv: string, transcript: string[]): Promise<void> {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      UV_PROJECT_ENVIRONMENT: this.envDir,
      UV_PYTHON_INSTALL_DIR: path.join(this.storageDir, "python"),
      UV_CACHE_DIR: path.join(this.storageDir, "uv-cache"),
      UV_NO_PROGRESS: "1",
    };
    const args = ["sync", "--frozen", "--no-dev", "--project", this.pythonRoot, "--python", PYTHON_VERSION, "--managed-python"];
    return this.run(uv, args, env, undefined, transcript);
  }

  private runScript(script: string, args: string[], env: NodeJS.ProcessEnv): Promise<void> {
    const scriptsDir = path.join(this.pythonRoot, "scripts", "ARGUS");
    return this.run(this.python, [path.join(scriptsDir, "runner.py"), path.join(scriptsDir, script), ...args], env, this.pythonRoot);
  }

  private log(line: string, transcript?: string[]): void {
    this.output.info(line);
    transcript?.push(`${line}\n`);
  }

  async explainCommit(commitUrl: string, llm: LlmConfiguration, githubToken?: string): Promise<ExplainResult> {
    const repoRoot = await this.getWorkspaceRepoRoot(this.extensionPath, this.extensionMode);
    if (llm.mode === "cli") await ensureSupportedCli(llm.provider as CliProvider);
    await this.install();
    const outputRoot = path.join(this.runtimeDir, "results");
    const baseArgs = ["--commit-url", commitUrl, "--output-root", outputRoot];
    const model = llm.model;
    const runs = String(Math.max(1, Math.floor(vscode.workspace.getConfiguration("rationale").get<number>("runs", 1))));
    const env = buildLlmEnvironment(llm, githubToken);
    const scripts = ["artifact_retrieval.py", "rationale_sentence_identifier.py", "rationale_generation.py"];
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "Generating rationale…", cancellable: false },
      async (progress) => {
        for (const [index, script] of scripts.entries()) {
          progress.report({ message: ["Retrieving GitHub artifacts", "Identifying rationale sentences", "Generating rationale summary"][index] });
          const stageArgs = script === "artifact_retrieval.py"
            ? baseArgs
            : [...baseArgs, "--model", model, ...(script === "rationale_sentence_identifier.py" ? ["--runs", runs] : [])];
          await this.runScript(script, stageArgs, env);
        }
      },
    );
    const url = new URL(commitUrl);
    const [, owner, repo, , sha] = url.pathname.split("/");
    const resultDir = path.join(outputRoot, `${owner}__${repo}__${sha.slice(0, 12)}`);
    const summaryPath = path.join(resultDir, "rationale_summary.json");
    const summary = JSON.parse(await fs.readFile(summaryPath, "utf8")) as RationaleSummary;
    const rationale = formatRationale(summary);
    const { components, references, evidence } = rationale;
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
      rationale.markdown,
    ].join("\n");
    await fs.writeFile(rationaleFile, markdown, "utf8");
    this.output.appendLine(`Saved rationale to ${rationaleFile}`);
    return { commitUrl, commitSha: sha, repository, components, references, evidence, rationaleFile, artifacts: resultDir };
  }

  async explainSelection(selection: SelectionInput, llm: LlmConfiguration, githubToken?: string): Promise<ExplainResult> {
    const filePath = path.resolve(selection.filePath);
    const repoRoot = (await this.capture("git", ["-C", path.dirname(filePath), "rev-parse", "--show-toplevel"])).trim();
    const relativeFile = path.relative(repoRoot, filePath);
    if (relativeFile.startsWith("..") || path.isAbsolute(relativeFile)) throw new Error("The selected file is outside its Git repository.");
    const blame = await this.capture("git", ["-C", repoRoot, "blame", "--line-porcelain", "-L", `${selection.startLine},${selection.endLine}`, "--", relativeFile]);
    const counts = new Map<string, number>();
    const order = new Map<string, number>();
    for (const line of blame.split(/\r?\n/)) {
      const match = line.match(/^([a-f0-9]{40}) \d+ \d+(?: \d+)?$/i);
      if (!match) continue;
      const sha = match[1];
      counts.set(sha, (counts.get(sha) || 0) + 1);
      if (!order.has(sha)) order.set(sha, order.size);
    }
    const commits = [...counts.entries()].sort((a, b) => b[1] - a[1] || (order.get(a[0])! - order.get(b[0])!)).slice(0, 3);
    if (!commits.length) throw new Error("Git did not find commit history for the selected lines.");
    const remote = (await this.capture("git", ["-C", repoRoot, "config", "--get", "remote.origin.url"])).trim();
    const github = parseGitHubRemote(remote);
    if (!github) throw new Error("The repository origin must be a GitHub URL to retrieve commit rationale.");
    if (llm.mode === "cli") await ensureSupportedCli(llm.provider as CliProvider);
    await this.install();
    const outputRoot = path.join(this.runtimeDir, "results");
    const sourceCommits = commits.map(([sha, lines]) => ({ sha, lines, url: `https://github.com/${github.owner}/${github.repo}/commit/${sha}` }));
    const model = llm.model;
    const runs = String(Math.max(1, Math.floor(vscode.workspace.getConfiguration("rationale").get<number>("runs", 1))));
    const env = buildLlmEnvironment(llm, githubToken);
    const scripts = ["artifact_retrieval.py", "rationale_sentence_identifier.py", "rationale_generation.py"];
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: "Analyzing selected code…", cancellable: false },
      async (progress) => {
        for (const [commitIndex, commit] of sourceCommits.entries()) {
          for (const [index, script] of scripts.entries()) {
            progress.report({ message: `Commit ${commitIndex + 1}/${sourceCommits.length}: ${["Retrieving GitHub artifacts", "Identifying rationale sentences", "Generating commit summary"][index]}` });
            const base = ["--commit-url", commit.url, "--output-root", outputRoot];
            const args = script === "artifact_retrieval.py" ? base : [...base, "--model", model, ...(script === "rationale_sentence_identifier.py" ? ["--runs", runs] : [])];
            await this.runScript(script, args, env);
          }
        }
      },
    );
    const inputPath = path.join(this.runtimeDir, `selection-${createHash("sha256").update(`${filePath}:${selection.startLine}:${selection.endLine}:${Date.now()}`).digest("hex").slice(0, 16)}.json`);
    const resultPath = `${inputPath}.summary.json`;
    await fs.writeFile(inputPath, JSON.stringify({
      repository: `${github.owner}/${github.repo}`, file: relativeFile,
      start_line: selection.startLine, end_line: selection.endLine, code: selection.code,
      commits: sourceCommits.map((commit) => ({ ...commit, summary_path: path.join(outputRoot, `${github.owner}__${github.repo}__${commit.sha.slice(0, 12)}`, "rationale_summary.json") })),
    }), "utf8");
    await this.runScript("selection_synthesis.py", ["--input", inputPath, "--output", resultPath, "--model", model], env);
    const summary = JSON.parse(await fs.readFile(resultPath, "utf8")) as RationaleSummary;
    const rationale = formatRationale(summary);
    const { components, references, evidence } = rationale;
    const rationaleFile = path.join(repoRoot, ".rationale", github.owner, github.repo, `selection-${createHash("sha256").update(`${relativeFile}:${selection.startLine}:${selection.endLine}`).digest("hex").slice(0, 12)}.md`);
    await fs.mkdir(path.dirname(rationaleFile), { recursive: true });
    await fs.writeFile(rationaleFile, [
      "---", `repository: ${JSON.stringify(`${github.owner}/${github.repo}`)}`, `file: ${JSON.stringify(relativeFile)}`,
      `start_line: ${selection.startLine}`, `end_line: ${selection.endLine}`, `generated_at: ${JSON.stringify(new Date().toISOString())}`, "---", "",
      `# Rationale for ${relativeFile}:${selection.startLine}-${selection.endLine}`, "",
      ...sourceCommits.map((commit) => `- [${commit.sha.slice(0, 12)}](${commit.url}) — ${commit.lines} selected lines`), "",
      rationale.markdown,
    ].join("\n"), "utf8");
    this.output.appendLine(`Saved selection rationale to ${rationaleFile}`);
    return { commitUrl: "", commitSha: "", repository: `${github.owner}/${github.repo}`, components, references, evidence, rationaleFile, artifacts: outputRoot,
      title: `Selected code: ${relativeFile}:${selection.startLine}-${selection.endLine}`, sourceCommits,
      selection: { file: relativeFile, startLine: selection.startLine, endLine: selection.endLine } };
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

  private run(command: string, args: string[], env = process.env, cwd?: string, transcript?: string[]): Promise<void> {
    return new Promise((resolve, reject) => {
      this.log(`$ ${command} ${args.join(" ")}`, transcript);
      const child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
      let stderr = "";
      const record = (data: Buffer): string => {
        const text = data.toString();
        for (const line of text.split(/\r?\n/)) if (line.trim()) this.output.info(line);
        transcript?.push(text);
        return text;
      };
      child.stdout?.on("data", record);
      child.stderr?.on("data", (data: Buffer) => { stderr = (stderr + record(data)).slice(-16384); });
      child.on("error", (error) => reject(new Error(`Could not start ${path.basename(command)}: ${error.message}`)));
      child.on("close", (code) => code === 0 ? resolve() : reject(new Error(summarizeFailure(stderr, code))));
    });
  }
}
