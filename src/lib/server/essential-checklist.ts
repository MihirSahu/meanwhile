import { z } from "zod";
import { claimSchema, maxChecklistClaims } from "../evidence-schema";
import {
  checklistRequirementSchema,
  storyChecklistSchema,
  type StoryChecklist,
} from "./story-checklist";
const entry = checklistRequirementSchema.omit({ id: true, kind: true });
/** Fixed required slots prevent a valid JSON response from omitting principal actors. */
export const essentialChecklistSchema = z
  .object({
    claims: z.array(claimSchema).max(maxChecklistClaims),
    result: z.discriminatedUnion("status", [
      z
        .object({
          status: z.literal("ready"),
          essentials: z
            .object({ context: entry, actors: entry, outcome: entry })
            .strict(),
          additional: z
            .array(checklistRequirementSchema.omit({ id: true }))
            .max(5),
        })
        .strict(),
      storyChecklistSchema.shape.result.options[1],
    ]),
  })
  .strict();
export type EssentialChecklist = z.infer<typeof essentialChecklistSchema>;
export function normalizeEssentialChecklist(
  value: EssentialChecklist,
): StoryChecklist {
  if (value.result.status !== "ready")
    return { claims: value.claims, result: value.result };
  const { essentials, additional } = value.result;
  return {
    claims: value.claims,
    result: {
      status: "ready",
      relations: [],
      requirements: [
        ...(["context", "actors", "outcome"] as const).map((kind) => ({
          kind,
          ...essentials[kind],
        })),
        ...additional,
      ].map((r, index) => ({ ...r, id: `r${index + 1}` })),
    },
  };
}
export const essentialInstructions = `Return ready with REQUIRED essentials.context, essentials.actors and essentials.outcome, each with description and claimIds. Additional requirements go in additional (at most five, no IDs). The server assigns requirement IDs and kinds for the three core slots; do not return a requirements array or claim-level relations. For ambiguity or missing evidence return the clarification variant. Each core description must be established by its attached claims collectively; link opposing powers or actors to all necessary battle/context claims. Keep claim wording directly within the attached passages: distinguish proposals, demands, criticism, enacted changes and later outcomes. Do not infer list membership or that criticism was incorporated into a draft. Separate undated aftermath from dated events instead of assigning an unsupported year. Requirements describe essential coverage, not a narrative order unless the passages establish that order. Include essential social or political context already established by the passages, without turning optional detail into a requirement. If people are unknown, name the supported organizations or communities, or clarify; never invent a person. Judge essential scope as a concise overview of the requested event and period. Identify principal actors in their event roles; do not require entire later biographies or fates. A supported broad grievance can establish context without every item in a formal platform, and a concrete immediate outcome does not require every later punishment or consequence. Omit unsupported optional detail rather than blocking the useful core story. The compiler owns schematic disclosure captions. Do not create additional requirements to name asset types or explain unavailable exact depictions for ordinary historical prompts; keep requirements about the requested history. Keep only essential scope: optional casualty totals, later meetings and minor stops should not become requirements unless explicitly requested. Compare ALL fetched passages for conflicting dates and locations before claiming exact precision. Narrow to a supported month/year or attribute conflicting accounts in the claim text and set certainty=contested; do not silently select one precise date. Missing passages are not historical disagreement. Lunar landing may be included as text-only context for an Earth-focused mission; do not require an unavailable lunar asset.`;
