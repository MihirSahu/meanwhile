import type { ResearchBundle } from "./scene-provider";
import { sourceUrl } from "./source-retrieval";

export class MissingEvidenceError extends Error {
  constructor(
    public readonly topics: string[],
    message = "Essential evidence is missing from the fetched passages.",
  ) {
    super(message);
  }
}
export type EvidenceRecoveryRecord = {
  topics: string[];
  outcome: "recovered" | "no_evidence" | "budget" | "failed";
  beforePassages: number;
  afterPassages: number;
  elapsedMs: number;
  errorCode?: string;
};

/** Rebuild IDs before freezing any claims, retaining original context and fresh targeted receipts. */
export function mergeRecoveryResearch(
  original: ResearchBundle,
  additional: ResearchBundle,
): ResearchBundle {
  const key = (url: string) => sourceUrl(url).toString();
  const readable = (bundle: ResearchBundle) =>
    bundle.sources.filter((s) =>
      bundle.passages?.some((p) => p.sourceId === s.id),
    );
  const fresh = readable(additional).slice(0, 3),
    old = readable(original);
  if (!fresh.length) return structuredClone(original);
  const selected: { url: string; title: string }[] = [];
  const push = (s: { url: string; title: string }) => {
    if (selected.length < 8 && !selected.some((v) => key(v.url) === key(s.url)))
      selected.push(s);
  };
  old.slice(0, 5).forEach(push);
  fresh.forEach(push);
  old.forEach(push);
  const sources = selected.map((s, i) => ({ ...s, id: `s${i + 1}` }));
  const passages: NonNullable<ResearchBundle["passages"]> = [],
    sourceChecks: NonNullable<ResearchBundle["sourceChecks"]> = [];
  for (const s of sources) {
    const candidates = [additional, original].flatMap((bundle) =>
      bundle.sources
        .filter((v) => key(v.url) === key(s.url))
        .flatMap(
          (v) => bundle.passages?.filter((p) => p.sourceId === v.id) ?? [],
        ),
    );
    const seen = new Set<string>();
    let count = 0;
    for (const p of candidates) {
      const identity = `${p.documentHash}:${p.start}:${p.end}:${p.text}`;
      if (seen.has(identity)) continue;
      seen.add(identity);
      passages.push({ ...p, id: `p${passages.length + 1}`, sourceId: s.id });
      if (++count === 5) break;
    }
    const check = [additional, original].flatMap((bundle) =>
      bundle.sources
        .filter((v) => key(v.url) === key(s.url))
        .flatMap(
          (v) =>
            bundle.sourceChecks?.filter(
              (c) => c.sourceId === v.id && c.status === "readable",
            ) ?? [],
        ),
    )[0];
    if (check) sourceChecks.push({ ...check, sourceId: s.id });
  }
  return {
    text: "Source receipts rebuilt after a targeted lookup; summary is not evidence.",
    sources,
    passages,
    sourceChecks,
  };
}
