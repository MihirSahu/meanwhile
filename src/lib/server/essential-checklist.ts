import { z } from "zod";
import { claimSchema } from "../evidence-schema";
import {
  checklistRequirementSchema,
  storyChecklistSchema,
  type StoryChecklist,
} from "./story-checklist";
const entry = checklistRequirementSchema.omit({ id: true, kind: true });
/** Fixed required slots prevent a valid JSON response from omitting principal actors. */
export const essentialChecklistSchema = z
  .object({
    claims: z.array(claimSchema).max(8),
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
export const essentialInstructions = `Return ready with REQUIRED essentials.context, essentials.actors and essentials.outcome, each with description and claimIds. Additional requirements go in additional (at most five, no IDs). The server assigns requirement IDs and kinds for the three core slots; do not return a requirements array or claim-level relations. For ambiguity or missing evidence return the clarification variant. Each core description must be established by its attached claims collectively; link opposing powers or actors to all necessary battle/context claims. If people are unknown, name the supported organizations or communities, or clarify; never invent a person. Keep only essential scope: optional casualty totals, later meetings and minor stops should not become requirements unless explicitly requested. Compare ALL fetched passages for conflicting dates and locations before claiming exact precision. Narrow to a supported month/year or attribute conflicting accounts in the claim text and set certainty=contested; do not silently select one precise date. Missing passages are not historical disagreement. Lunar landing may be included as text-only context for an Earth-focused mission; do not require an unavailable lunar asset.`;
