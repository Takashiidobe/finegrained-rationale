import type { ExplainResult } from "./backend";
import { formatRationale, type RationaleReference, type RationaleComponents } from "./references";

export function isRationaleFile(filePath: string): boolean {
  return /(?:^|[\\/])\.rationale[\\/].*[\\/](?:commit|selection)-[^\\/]+\.md$/i.test(filePath);
}

function unescapeMarkdown(value: string): string {
  return value.replace(/\\([\\`*_{}\[\]<>#|&])/g, "$1");
}

export function parseSavedRationale(markdown: string, rationaleFile: string): ExplainResult {
  const text = markdown.replace(/\r\n/g, "\n");
  const frontmatter = text.match(/^---\n([\s\S]*?)\n---(?:\n|$)/);
  if (!frontmatter) throw new Error("This file does not contain saved rationale metadata.");
  const metadata: Record<string, string> = {};
  for (const line of frontmatter[1].split("\n")) {
    const match = line.match(/^([\w_]+):\s*(.*)$/);
    if (!match) continue;
    try { metadata[match[1]] = String(JSON.parse(match[2])); }
    catch { metadata[match[1]] = match[2]; }
  }
  const body = text.slice(frontmatter[0].length);
  const components: RationaleComponents = { GOAL: "", NEED: "", ALTERNATIVES: "" };
  const references: RationaleReference[] = [];
  const sections = [...body.matchAll(/^## (GOAL|NEED|ALTERNATIVE|ALTERNATIVES|References)\s*\n([\s\S]*?)(?=^## |$(?![\s\S]))/gm)];
  if (!metadata.repository || !sections.some(section => section[1] !== "References")) {
    throw new Error("This file does not contain saved rationale sections.");
  }
  for (const section of sections) {
    if (section[1] === "References") continue;
    const key = section[1] === "ALTERNATIVE" ? "ALTERNATIVES" : section[1] as keyof RationaleComponents;
    components[key] = section[2].replace(/^ARGUS \w+ evidence:.*$/gm, "").trim();
  }
  for (const match of body.matchAll(/^\[\^(\d+)\]: \[([^\n]*)\]\(<?(https:\/\/[^\s>]+)>?\) — “([^\n]*)”\s*$/gm)) {
    const [, id, source, url, sentence] = match;
    const labels = Object.entries(components).filter(([, value]) => value.includes(`[^${id}]`)).map(([key]) => key);
    for (const evidence of body.matchAll(/^ARGUS (GOAL|NEED|ALTERNATIVES) evidence:(.*)$/gm)) {
      if (evidence[2].includes(`[^${id}]`) && !labels.includes(evidence[1])) labels.push(evidence[1]);
    }
    references.push({ id, sentenceId: id, source: unescapeMarkdown(source).replace(/ #\d+$/, ""), url, sentence: unescapeMarkdown(sentence), labels });
  }
  const rationale = formatRationale({ components, references });
  const sourceCommits = [...body.matchAll(/^- \[[^\]]+\]\((https:\/\/github\.com\/[^/]+\/[^/]+\/commit\/([a-f\d]+))\) — (\d+) selected lines$/gm)]
    .map(([, url, sha, lines]) => ({ url, sha, lines: Number(lines) }));
  return {
    commitUrl: metadata.commit || "", commitSha: metadata.commit_sha || "", repository: metadata.repository,
    components: rationale.components, references: rationale.references, evidence: rationale.evidence,
    rationaleFile, artifacts: "",
    ...(metadata.file ? {
      title: `Selected code: ${metadata.file}:${metadata.start_line}-${metadata.end_line}`,
      sourceCommits,
      selection: { file: metadata.file, startLine: Number(metadata.start_line), endLine: Number(metadata.end_line) },
    } : {}),
  };
}
