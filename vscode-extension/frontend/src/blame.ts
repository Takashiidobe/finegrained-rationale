import { execFile } from "node:child_process";
import { promisify } from "node:util";
import * as path from "node:path";

const execFileAsync = promisify(execFile);

export async function blameRange(
  file: string,
  startLine: number,
  endLine: number,
): Promise<string[]> {
  const cwd = path.dirname(file);
  const { stdout } = await execFileAsync(
    "git",
    ["blame", "--porcelain", "-L", `${startLine},${endLine}`, "--", file],
    { cwd },
  );

  const hashes = new Set<string>();
  for (const line of stdout.split("\n")) {
    const match = /^([0-9a-f]{40})\s/.exec(line);
    if (match) {
      hashes.add(match[1]);
    }
  }
  return [...hashes];
}
