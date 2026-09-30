import * as vscode from "vscode";
import { spawn } from "node:child_process";
import { checkCliVersion, CLI_NAMES, CLI_UPDATE_COMMANDS, type CliProvider } from "./cliVersion";

const CLI_COMMANDS: Record<CliProvider, string> = { codex: "codex", "claude-code": "claude" };

export class CliUpdateRequiredError extends Error {
  constructor(message: string, readonly provider: CliProvider) {
    super(message);
  }
}

export function runCommand(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr?.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => code === 0 ? resolve(stdout) : reject(new Error(stderr.trim() || `${command} exited with code ${code}`)));
  });
}

export async function ensureSupportedCli(provider: CliProvider): Promise<string> {
  let output: string;
  try {
    output = await runCommand(CLI_COMMANDS[provider], ["--version"]);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`${CLI_NAMES[provider]} was not found on PATH. Install it and sign in, then try again.`);
    }
    throw error;
  }
  const check = checkCliVersion(provider, output);
  if (!check.ok) throw new CliUpdateRequiredError(check.message, provider);
  return check.version;
}

export async function offerCliUpdate(error: CliUpdateRequiredError): Promise<void> {
  const choice = await vscode.window.showErrorMessage(`Rationale: ${error.message}`, "Update in terminal");
  if (choice !== "Update in terminal") return;
  const terminal = vscode.window.createTerminal(`Update ${CLI_NAMES[error.provider]}`);
  terminal.show();
  terminal.sendText(CLI_UPDATE_COMMANDS[error.provider]);
}
