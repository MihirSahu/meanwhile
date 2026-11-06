import { readFile, mkdir, writeFile } from "node:fs/promises";
import { referenceSetSchema } from "../src/lib/server/reference-stories";
import { readSourceDocument } from "../src/lib/server/source-retrieval";
async function main() {
  const references = referenceSetSchema.parse(
    JSON.parse(await readFile("evals/reference-stories.json", "utf8")),
  );
  if (new Set(references.stories.map((s) => s.caseId)).size !== 5)
    throw new Error("Reference story IDs must be unique.");
  const cases = JSON.parse(await readFile("evals/history-cases.json", "utf8"));
  for (const story of references.stories) {
    if (!cases.some((c: { id: string }) => c.id === story.caseId))
      throw new Error("A reference story is not in the evaluation suite.");
    if (new Set(story.facts.map((f) => f.id)).size !== story.facts.length)
      throw new Error("Reference fact IDs must be unique.");
  }
  if (!process.argv.includes("--refresh")) {
    console.info(
      JSON.stringify({
        stories: 5,
        facts: references.stories.reduce((n, s) => n + s.facts.length, 0),
        status: "agent-source-checked",
        humanReview: "pending",
        networkRequests: 0,
      }),
    );
    return;
  }
  const results = await Promise.all(
    references.stories.map(async (story) => {
      try {
        const document = await readSourceDocument(
          story.facts[0].sourceUrl,
          AbortSignal.timeout(12000),
        );
        return {
          caseId: story.caseId,
          status: "readable",
          documentHash: document.documentHash,
          retrievedAt: document.retrievedAt,
          anchors: story.facts.map((f) => ({
            id: f.id,
            found: document.text.includes(f.anchor),
          })),
        };
      } catch {
        return {
          caseId: story.caseId,
          status: "unavailable",
          documentHash: null,
          retrievedAt: new Date().toISOString(),
          anchors: [],
        };
      }
    }),
  );
  await mkdir("artifacts", { recursive: true });
  await writeFile(
    "artifacts/reference-refresh.json",
    JSON.stringify(
      {
        results,
        caveat:
          "Anchor presence is a retrieval check, not a semantic or human historical review.",
      },
      null,
      2,
    ),
  );
  console.info(JSON.stringify(results));
}
void main().catch(() => {
  console.error("Reference validation failed.");
  process.exitCode = 1;
});
