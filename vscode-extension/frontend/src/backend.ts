import * as vscode from "vscode";
import { ChildProcess, spawn } from "node:child_process";
import { findFreePort } from "./port";

export interface ExplainResult {
  markdown: string;
  artifacts?: unknown;
}

export interface SearchHit {
  title: string;
  path: string;
  score: number;
  snippet: string;
}

const READY_TIMEOUT_MS = 15_000;
const READY_POLL_INTERVAL_MS = 200;

export class BackendClient implements vscode.Disposable {
  private process: ChildProcess | undefined;
  private port: number | undefined;
  private ready: Promise<void> | undefined;

  constructor(private readonly output: vscode.OutputChannel) {}

  async start(): Promise<void> {
    const config = vscode.workspace.getConfiguration("rationale");
    const command = config.get<string>("backend.command", "rationale-backend");
    const configuredPort = config.get<number>("backend.port", 0);

    this.port = configuredPort === 0 ? await findFreePort() : configuredPort;

    const proc = spawn(command, ["--port", String(this.port)], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.process = proc;
    proc.stdout?.on("data", (chunk) => this.output.append(chunk.toString()));
    proc.stderr?.on("data", (chunk) => this.output.append(chunk.toString()));

    this.ready = new Promise<void>((resolve, reject) => {
      proc.on("error", (err) => {
        reject(new Error(`Failed to start rationale backend (${command}): ${err.message}`));
      });
      proc.on("exit", (code) => {
        if (this.process === proc) {
          this.process = undefined;
        }
        reject(new Error(`Rationale backend exited early (code ${code}) before becoming ready.`));
      });
      this.pollUntilReady(this.port!).then(resolve, reject);
    });

    this.ready.catch((err) => this.output.appendLine(String(err.message ?? err)));

    return this.ready;
  }

  private async pollUntilReady(port: number): Promise<void> {
    const deadline = Date.now() + READY_TIMEOUT_MS;
    while (Date.now() < deadline) {
      try {
        const response = await fetch(`http://127.0.0.1:${port}/health`);
        if (response.ok) {
          return;
        }
      } catch {
      }
      await new Promise((resolve) => setTimeout(resolve, READY_POLL_INTERVAL_MS));
    }
    throw new Error("Timed out waiting for rationale backend to become ready.");
  }

  dispose(): void {
    this.process?.kill();
  }

  private get baseUrl(): string {
    return `http://127.0.0.1:${this.port}`;
  }

  async explainCommit(commitHash: string): Promise<ExplainResult> {
    return this.postJson<ExplainResult>("/explain/commit", { commitHash });
  }

  async explainSpan(file: string, commitHashes: string[]): Promise<ExplainResult> {
    return this.postJson<ExplainResult>("/explain/span", { file, commitHashes });
  }

  async search(query: string): Promise<SearchHit[]> {
    return this.postJson<SearchHit[]>("/search", { query });
  }

  private async postJson<T>(pathname: string, body: unknown): Promise<T> {
    if (!this.ready) {
      throw new Error("Rationale backend has not been started.");
    }
    await this.ready;

    const response = await fetch(`${this.baseUrl}${pathname}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`Rationale backend request to ${pathname} failed: ${response.status} ${await response.text()}`);
    }
    return (await response.json()) as T;
  }
}
