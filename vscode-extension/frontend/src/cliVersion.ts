export type CliProvider = "codex" | "claude-code";

export const MIN_CLI_VERSIONS: Record<CliProvider, string> = {
  codex: "0.159.2",
  "claude-code": "2.1.285",
};

export const CLI_NAMES: Record<CliProvider, string> = {
  codex: "Codex CLI",
  "claude-code": "Claude Code CLI",
};

export const CLI_UPDATE_COMMANDS: Record<CliProvider, string> = {
  codex: "npm install -g @openai/codex@latest",
  "claude-code": "claude update",
};

export type CliVersionCheck = { ok: true; version: string } | { ok: false; message: string };

function parseVersion(text: string): number[] | undefined {
  const match = text.match(/(\d+)\.(\d+)\.(\d+)/);
  return match ? match.slice(1).map(Number) : undefined;
}

function isAtLeast(version: number[], minimum: number[]): boolean {
  for (let index = 0; index < minimum.length; index++) {
    if (version[index] !== minimum[index]) return version[index] > minimum[index];
  }
  return true;
}

export function checkCliVersion(provider: CliProvider, versionOutput: string): CliVersionCheck {
  const name = CLI_NAMES[provider];
  const minimum = MIN_CLI_VERSIONS[provider];
  const update = `Update it with \`${CLI_UPDATE_COMMANDS[provider]}\` and try again.`;
  const version = parseVersion(versionOutput);
  if (!version) return { ok: false, message: `Could not read the ${name} version from "${versionOutput.trim()}". Rationale needs ${minimum} or newer. ${update}` };
  const found = version.join(".");
  if (!isAtLeast(version, parseVersion(minimum)!)) {
    return { ok: false, message: `${name} ${found} is older than ${minimum}, the oldest version Rationale supports. ${update}` };
  }
  return { ok: true, version: found };
}
