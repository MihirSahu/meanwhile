import { z } from "zod";
import { historicalRangeSchema } from "./historical-time";
export const claimIdSchema = z.string().regex(/^c[1-9][0-9]?$/);
export const maxChecklistClaims = 18;
export const passageIdSchema = z.string().regex(/^p[1-9][0-9]?$/);
export const claimIdsSchema = z.array(claimIdSchema).max(maxChecklistClaims);
export const claimSchema = z
  .object({
    id: claimIdSchema,
    text: z.string().min(1).max(500),
    passageIds: z.array(passageIdSchema).min(1).max(6),
    yearRange: historicalRangeSchema.nullable(),
    certainty: z.enum(["established", "approximate", "contested"]),
  })
  .strict();
export const passageSchema = z.object({
  id: passageIdSchema,
  sourceId: z.string().regex(/^s[1-8]$/),
  text: z.string().min(30).max(1200),
  documentHash: z.string().regex(/^[a-f0-9]{64}$/),
  start: z.number().int().nonnegative(),
  end: z.number().int().positive(),
  retrievedAt: z.string().datetime(),
});
export const focusEvidenceSchema = z.object({
  method: z.literal("passage-review-v1"),
  passages: z.array(passageSchema).min(1).max(40),
  claims: z.array(claimSchema).min(1).max(36),
});
export const batchEvidenceSchema = z.object({
  method: z.literal("passage-review-v1"),
  claims: z.array(claimSchema).max(12),
});
export type EvidenceClaim = z.infer<typeof claimSchema>;
export type EvidencePassage = z.infer<typeof passageSchema>;

export function checkedClaimLedger(
  existing: EvidenceClaim[],
  incoming: EvidenceClaim[],
  passages: EvidencePassage[],
  sourceIds: string[],
) {
  if (
    new Set(passages.map((p) => p.id)).size !== passages.length ||
    passages.some(
      (p) =>
        !sourceIds.includes(p.sourceId) || p.end - p.start !== p.text.length,
    )
  )
    throw new Error(
      "Evidence passages need unique IDs, registered sources and exact text offsets.",
    );
  const ledger = [...existing];
  for (const input of incoming) {
    const claim = claimSchema.parse(input),
      old = ledger.find((c) => c.id === claim.id);
    if (old) {
      if (JSON.stringify(old) !== JSON.stringify(claim))
        throw new Error("Committed claims cannot be changed.");
      continue;
    }
    if (
      new Set(claim.passageIds).size !== claim.passageIds.length ||
      claim.passageIds.some((id) => !passages.some((p) => p.id === id))
    )
      throw new Error(`Claim ${claim.id} needs valid fetched passage IDs.`);
    ledger.push(claim);
  }
  if (ledger.length > 36)
    throw new Error("Keep the story within 36 evidence claims.");
  return ledger;
}
