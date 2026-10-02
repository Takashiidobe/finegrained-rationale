export const RATIONALE_COMPONENTS = ["GOAL", "NEED", "ALTERNATIVES"] as const;
export type RationaleComponent = typeof RATIONALE_COMPONENTS[number];
export type RationaleComponents = Record<RationaleComponent, string>;

export interface RationaleReference {
  id: string;
  sentenceId: string;
  source: string;
  url: string;
  sentence: string;
  labels: string[];
}

export interface NumberedReference extends RationaleReference {
  number: number;
}

export interface RationaleSummary {
  components?: Partial<RationaleComponents>;
  references?: RationaleReference[];
}

function escapeMarkdown(value: string): string {
  return value.replace(/\s+/g, " ").trim().replace(/[\\`*_{}\[\]<>#|&]/g, "\\$&");
}

export function referenceLabel(source: string): string {
  const label = source.toLowerCase().replace(/_/g, " ");
  return label.charAt(0).toUpperCase() + label.slice(1);
}

function validReference(reference: RationaleReference): boolean {
  try {
    const url = new URL(reference.url);
    return url.protocol === "https:" && url.hostname === "github.com" && !url.username && !url.password
      && /^[\w-]+$/.test(reference.id) && /^[\w-]+$/.test(reference.sentenceId)
      && typeof reference.source === "string" && typeof reference.sentence === "string" && Boolean(reference.sentence.trim()) && Array.isArray(reference.labels);
  } catch {
    return false;
  }
}

export function formatRationale(summary: RationaleSummary): {
  components: RationaleComponents;
  references: NumberedReference[];
  evidence: Partial<Record<RationaleComponent, number[]>>;
  markdown: string;
} {
  const available = (summary.references || []).filter(validReference);
  const byId = new Map(available.map(reference => [reference.id, reference]));
  const numbered = new Map<string, NumberedReference>();
  const components = { GOAL: "", NEED: "", ALTERNATIVES: "" };
  const evidence: Partial<Record<RationaleComponent, number[]>> = {};
  const sections: string[] = [];
  const useReference = (reference: RationaleReference): number => {
    const key = JSON.stringify([reference.url, reference.source, reference.sentence]);
    let existing = numbered.get(key);
    if (!existing) {
      existing = { ...reference, number: numbered.size + 1 };
      numbered.set(key, existing);
    }
    return existing.number;
  };
  for (const label of RATIONALE_COMPONENTS) {
    let cited = false;
    components[label] = (summary.components?.[label] || "").replace(/\[\^([^\]\r\n]+)\]/g, (_, id: string) => {
      const reference = byId.get(id);
      if (!reference || !reference.labels.includes(label)) return "";
      cited = true;
      return `[^${useReference(reference)}]`;
    }).trim();
    sections.push(`## ${label === "ALTERNATIVES" ? "ALTERNATIVE" : label}`, "", components[label] || "Not identified.", "");
    if (components[label] && !cited) {
      const numbers = [...new Set(available.filter(reference => reference.labels.includes(label)).map(useReference))];
      if (numbers.length) {
        evidence[label] = numbers;
        sections.push(`ARGUS ${label} evidence: ${numbers.map(number => `[^${number}]`).join(" ")}`, "");
      }
    }
  }
  const references = [...numbered.values()];
  if (references.length) {
    sections.push("## References", "");
    for (const reference of references) {
      const url = new URL(reference.url).toString().replace(/</g, "%3C").replace(/>/g, "%3E");
      sections.push(`[^${reference.number}]: [${escapeMarkdown(referenceLabel(reference.source))}](<${url}>) — ARGUS sentence \`${reference.sentenceId}\`: “${escapeMarkdown(reference.sentence)}”`, "");
    }
  }
  return { components, references, evidence, markdown: sections.join("\n") };
}
