import { z } from "zod";
const httpUrl = z
  .string()
  .url()
  .regex(/^https?:\/\//);
export const referenceSetSchema = z.object({
  version: z.literal(1),
  description: z.string(),
  stories: z
    .array(
      z.object({
        caseId: z.string(),
        title: z.string(),
        yearRange: z.tuple([z.number().int(), z.number().int()]),
        facts: z
          .array(
            z.object({
              id: z.string(),
              statement: z.string(),
              sourceUrl: httpUrl,
              anchor: z.string().min(1).max(200),
              normalizedOffset: z.number().int().nonnegative().nullable(),
              required: z.boolean(),
            }),
          )
          .min(3),
        guards: z.array(z.string()),
        review: z.object({
          status: z.literal("agent-source-checked"),
          checkedAt: z.string(),
          method: z.string(),
          sourceAccess: z.string(),
          documentHash: z.string().nullable(),
          humanReview: z.literal("pending"),
        }),
      }),
    )
    .length(5),
});
export type ReferenceStory = z.infer<
  typeof referenceSetSchema
>["stories"][number];
export const referenceCheckSchema = z
  .object({
    id: z.string(),
    status: z.enum([
      "addressed",
      "not_required",
      "missing",
      "contradicted",
      "uncertain",
    ]),
    reason: z.string().max(300),
  })
  .strict();
export type ReferenceCheck = z.infer<typeof referenceCheckSchema>;
export function checkReferenceCoverage(
  reference: ReferenceStory | null,
  checks: ReferenceCheck[],
) {
  const expected = reference
    ? [
        ...reference.facts.map((f) => f.id),
        ...reference.guards.map((_, i) => `guard-${i + 1}`),
      ]
    : [];
  if (
    new Set(checks.map((c) => c.id)).size !== checks.length ||
    checks.length !== expected.length ||
    expected.some((id) => !checks.some((c) => c.id === id))
  )
    return ["Reference checks must cover every fact and guard exactly once."];
  return checks.flatMap((check) => {
    const fact = reference?.facts.find((f) => f.id === check.id);
    return ["missing", "contradicted", "uncertain"].includes(check.status) ||
      (fact?.required && check.status !== "addressed")
      ? [`${check.id}: ${check.reason}`]
      : [];
  });
}
