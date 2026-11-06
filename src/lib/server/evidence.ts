import type { Response } from "openai/resources/responses/responses";
import type { EvidenceSource, ResearchBundle } from "./scene-provider";
import { SceneServiceError } from "./scene-config";

/** Preserve text, and bind each provider citation span to the IDs we send later. */
export function citedResearch(
  response: Pick<Response, "output">,
): ResearchBundle {
  const sources: EvidenceSource[] = [],
    known = new Map<string, string>(),
    paragraphs: string[] = [];
  for (const item of response.output) {
    if (item.type !== "message") continue;
    for (const content of item.content) {
      if (content.type !== "output_text") continue;
      const inserts = new Map<number, Set<string>>();
      for (const citation of content.annotations ?? []) {
        if (
          citation.type !== "url_citation" ||
          !/^https?:\/\//i.test(citation.url) ||
          !URL.canParse(citation.url)
        )
          continue;
        let id = known.get(citation.url);
        if (!id && sources.length < 8) {
          id = `s${sources.length + 1}`;
          known.set(citation.url, id);
          const title = citation.title?.replace(/\s+/g, " ").trim();
          sources.push({
            id,
            title: (title || new URL(citation.url).hostname).slice(0, 120),
            url: citation.url,
          });
        }
        if (!id) continue;
        const at = Math.min(
          content.text.length,
          Math.max(0, citation.end_index),
        );
        const ids = inserts.get(at) ?? new Set<string>();
        ids.add(id);
        inserts.set(at, ids);
      }
      let text = content.text;
      for (const [at, ids] of [...inserts].sort((a, b) => b[0] - a[0]))
        text = text.slice(0, at) + ` [${[...ids].join("][")}]` + text.slice(at);
      paragraphs.push(text.replace(/cite[^]*/g, ""));
    }
  }
  if (!sources.length)
    throw new SceneServiceError(
      "evidence",
      "The research did not return citable sources. Try a more specific historical event.",
    );
  return { text: paragraphs.join("\n").slice(0, 24000), sources };
}
