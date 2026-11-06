import { z } from "zod";
import { claimIdsSchema, type EvidenceClaim } from "../evidence-schema";
import type { SceneAction, SceneFocus } from "../scene-schema";
import type { TemporalRelation, TemporalCheck } from "./story-checklist";
export const storyRequirementSchema = z
  .object({
    id: z.string().regex(/^r[1-9][0-9]?$/),
    kind: z.enum(["context", "actors", "outcome", "request", "caveat"]),
    description: z.string().min(1).max(300),
    claimIds: claimIdsSchema.min(1),
    chapter: z.number().int().min(0).max(2),
  })
  .strict();
export type StoryRequirement = z.infer<typeof storyRequirementSchema>;
export const coverageCheckSchema = z
  .object({
    id: z.string(),
    status: z.enum(["covered", "pending"]),
    actionIds: z.array(z.string()).max(16),
    reason: z.string().max(300),
  })
  .strict();
export type CoverageCheck = z.infer<typeof coverageCheckSchema>;
export type RenderedFocusFact = {
  id: string;
  text: string;
  claimIds: string[];
};
/** These three fields are visibly rendered by Experience's story card. */
export function renderedFocusFacts(
  focus: SceneFocus,
  claimIds: string[],
): RenderedFocusFact[] {
  return (["title", "period", "location"] as const).map((field) => ({
    id: `@focus:${field}`,
    text: focus[field],
    claimIds: [...claimIds],
  }));
}
export type CoverageContext = {
  requirements: StoryRequirement[];
  covered: CoverageCheck[];
  chapter: number;
  final: boolean;
  committedActions: SceneAction[];
  relations?: TemporalRelation[];
  ordered?: TemporalCheck[];
  renderedFocus?: RenderedFocusFact[];
};
export function checkStoryRequirements(
  requirements: StoryRequirement[],
  claims: EvidenceClaim[],
) {
  if (new Set(requirements.map((r) => r.id)).size !== requirements.length)
    throw new Error("Story requirement IDs must be unique.");
  for (const kind of ["context", "actors", "outcome"]) {
    const entries = requirements.filter((r) => r.kind === kind);
    if (!entries.length)
      throw new Error(`The story plan needs a sourced ${kind} requirement.`);
    if (kind !== "outcome" && !entries.some((r) => r.chapter === 0))
      throw new Error(
        "Introductory context and principal actors must be introduced in chapter zero; later details may have later deadlines.",
      );
  }
  for (const r of requirements)
    if (
      new Set(r.claimIds).size !== r.claimIds.length ||
      r.claimIds.some((id) => !claims.some((c) => c.id === id))
    )
      throw new Error(
        `Requirement ${r.id} must reference distinct known claims.`,
      );
}
export function checkStoryCoverage(
  checks: CoverageCheck[],
  actions: SceneAction[],
  context: CoverageContext,
) {
  const { requirements, covered, chapter, final, committedActions } = context;
  if (
    new Set(checks.map((c) => c.id)).size !== checks.length ||
    checks.length !== requirements.length ||
    requirements.some((r) => !checks.some((c) => c.id === r.id))
  )
    throw new Error(
      "Review coverage must include every story requirement exactly once.",
    );
  const rendered = [...committedActions, ...actions];
  const headers = context.renderedFocus ?? [];
  for (const r of requirements) {
    const check = checks.find((c) => c.id === r.id)!,
      old = covered.find((c) => c.id === r.id && c.status === "covered");
    if (
      old &&
      (check.status !== "covered" ||
        old.actionIds.some((id) => !check.actionIds.includes(id)))
    )
      throw new Error(`Preserve committed coverage for requirement ${r.id}.`);
    if (check.status === "pending") {
      if (check.actionIds.length)
        throw new Error("Pending requirements cannot claim rendered evidence.");
      if (final || r.chapter <= chapter)
        throw new Error(
          `Story requirement ${r.id} (${r.description}) is missing from rendered content. ${check.reason}`,
        );
      continue;
    }
    if (
      !check.actionIds.length ||
      new Set(check.actionIds).size !== check.actionIds.length
    )
      throw new Error(
        `Requirement ${r.id} needs distinct rendered action IDs.`,
      );
    for (const id of check.actionIds) {
      const header = headers.find(
        (h) =>
          h.id === id &&
          ["@focus:title", "@focus:period", "@focus:location"].includes(id),
      );
      if (
        header?.text &&
        header.claimIds.some((claimId) => r.claimIds.includes(claimId))
      )
        continue;
      const action = rendered.find((a) => a.id === id);
      if (
        !action ||
        (action.type === "speech" && action.kind !== "narration") ||
        !(
          ["chapter", "speech", "spawn", "move", "attack"] as string[]
        ).includes(action.type) ||
        !action.claimIds?.some((claimId) => r.claimIds.includes(claimId))
      )
        throw new Error(
          `Requirement ${r.id} must be covered by rendered, claim-linked actions; plans do not count.`,
        );
    }
    const matches = check.actionIds.map((id) =>
      rendered.find((a) => a.id === id),
    );
    if (
      r.kind !== "request" &&
      !check.actionIds.some((id) =>
        headers.some(
          (h) =>
            h.id === id &&
            h.text &&
            h.claimIds.some((claimId) => r.claimIds.includes(claimId)),
        ),
      ) &&
      !matches.some(
        (a) =>
          a &&
          (a.type === "chapter" ||
            a.type === "spawn" ||
            (a.type === "speech" && a.kind === "narration")),
      )
    )
      throw new Error(
        `Requirement ${r.id} needs explicit rendered text, not an implied movement or attack.`,
      );
  }
}
