const BACKEND_ERROR_PREFIX = "ARGUS_ERROR ";

export function summarizeFailure(stderr: string, code: number | null): string {
  const lines = stderr.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (const line of [...lines].reverse()) {
    if (!line.startsWith(BACKEND_ERROR_PREFIX)) continue;
    try {
      const message = (JSON.parse(line.slice(BACKEND_ERROR_PREFIX.length)) as { message?: unknown }).message;
      if (typeof message === "string" && message) return message;
    } catch {}
  }
  const errorStart = lines.findLastIndex((line) => line.startsWith("error:"));
  const summary = errorStart >= 0 ? lines.slice(errorStart).join(" ") : lines.at(-1);
  if (!summary) return `Process exited with code ${code}.`;
  return summary.length > 600 ? `${summary.slice(0, 600)}…` : summary;
}
