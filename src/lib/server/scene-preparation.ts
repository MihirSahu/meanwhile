import {
  essentialChecklistSchema,
  normalizeEssentialChecklist,
  essentialInstructions,
  type EssentialChecklist,
} from "./essential-checklist";
import { z } from "zod";
import { assetCatalog } from "../scene-schema";
import { passageSchema } from "../evidence-schema";
import type { DiscoveryContext } from "../discovery";
import { reserveFor, stageAllowances, type BudgetStage } from "./scene-budget";
import {
  MissingEvidenceError,
  mergeRecoveryResearch,
  type EvidenceRecoveryRecord,
} from "./evidence-recovery";
import {
  storyChecklistSchema,
  checklistInstructions,
  checkStoryChecklist,
  type StoryChecklist,
} from "./story-checklist";
import {
  reviewStoryChecklist,
  type ChecklistReviewRecord,
} from "./checklist-review";
import type { GateRecord } from "./evidence-gate";
import { historicalClarification } from "./historical-intent";
import { ResearchCache, researchCache } from "./research-cache";
import { SceneServiceError } from "./scene-config";
import type { ResearchBundle, SceneProvider } from "./scene-provider";
const sourceRef = z.string().regex(/^s[1-8]$/);
export const evidenceSchema = z.object({
  text: z.string().min(1).max(24000),
  passages: z.array(passageSchema).min(1).max(40),
  sourceChecks: z
    .array(
      z.object({
        sourceId: z.string(),
        status: z.enum(["readable", "unavailable"]),
        reason: z.string().nullable(),
        finalUrl: z.string().nullable(),
        documentHash: z.string().nullable(),
        retrievedAt: z.string(),
      }),
    )
    .optional(),
  sources: z
    .array(
      z.object({
        id: sourceRef,
        title: z.string().min(1).max(120),
        url: z
          .string()
          .url()
          .regex(/^https?:\/\//i),
      }),
    )
    .min(1)
    .max(8),
});
export type RejectionRecord = {
  stage: string;
  reason: string;
  candidate: unknown;
};
export type PreparationOptions = {
  cache?: ResearchCache;
  cacheTtlSeconds?: number;
  onCache?: (hit: boolean) => void;
  onResearch?: (research: ResearchBundle) => void;
  onGate?: (record: GateRecord) => void;
  onRejected?: (record: RejectionRecord) => void;
  onChecklist?: (checklist: StoryChecklist, elapsedMs: number) => void;
  onChecklistTiming?: (elapsedMs: number) => void;
  onChecklistReview?: (record: ChecklistReviewRecord) => void;
  onRecovery?: (record: EvidenceRecoveryRecord) => void;
  startupStrategy?: "opening" | "staged";
  discovery?: DiscoveryContext;
};

export async function prepareSceneEvidence(
  prompt: string,
  provider: SceneProvider,
  signal: AbortSignal,
  options: PreparationOptions,
  sceneSteps: BudgetStage[],
  atomicEvents = false,
) {
  signal.throwIfAborted();
  const clarification = historicalClarification(prompt);
  if (clarification)
    throw new SceneServiceError("clarification", clarification);
  const reserve = (stages: BudgetStage[]) =>
    provider.reserveCompletion?.(reserveFor(stages));
  let research: ResearchBundle | undefined;
  let recoveryUsed = false;
  async function recover(topics: string[]) {
    if (recoveryUsed) return false;
    recoveryUsed = true;
    const started = performance.now(),
      before = research?.passages?.length ?? 0;
    let outcome: EvidenceRecoveryRecord["outcome"] = "failed",
      errorCode: string | undefined;
    try {
      reserve(["checklist", "checklist_review", ...sceneSteps]);
      const additional = evidenceSchema.parse(
        await provider.research(prompt, signal, { recoveryTopics: topics }),
      );
      signal.throwIfAborted();
      const original = research;
      const merged = original
        ? mergeRecoveryResearch(original, additional)
        : additional;
      const novel = merged.passages?.some(
        (p) =>
          !original?.passages?.some(
            (old) =>
              old.documentHash === p.documentHash &&
              old.start === p.start &&
              old.end === p.end &&
              old.text === p.text,
          ),
      );
      if (!novel) {
        outcome = "no_evidence";
        return false;
      }
      research = evidenceSchema.parse(merged);
      options.onResearch?.(structuredClone(research));
      outcome = "recovered";
      return true;
    } catch (error) {
      signal.throwIfAborted();
      errorCode =
        error instanceof SceneServiceError ? error.code : "recovery_failed";
      if (errorCode === "budget") {
        outcome = "budget";
        return false;
      }
      if (errorCode === "evidence") {
        outcome = "no_evidence";
        return false;
      }
      throw error;
    } finally {
      options.onRecovery?.({
        topics: [...topics],
        outcome,
        beforePassages: before,
        afterPassages: research?.passages?.length ?? before,
        elapsedMs: Math.round(performance.now() - started),
        ...(errorCode ? { errorCode } : {}),
      });
    }
  }
  const cache = options.cache ?? researchCache;
  const cacheKey = `${provider.cacheIdentity}:${prompt.trim().replace(/\s+/g, " ")}`;
  signal.throwIfAborted();
  const cached =
    (options.cacheTtlSeconds ?? 900) > 0 ? cache.get(cacheKey) : null;
  options.onCache?.(Boolean(cached));
  reserve(["checklist", "checklist_review", ...sceneSteps]);
  try {
    research = evidenceSchema.parse(
      cached ?? (await provider.research(prompt, signal)),
    );
  } catch (error) {
    if (
      !(error instanceof SceneServiceError) ||
      error.code !== "evidence" ||
      !(await recover([
        "Find readable primary or institutional evidence for the requested context, essential dates and concrete outcome.",
      ]))
    )
      throw error;
  }
  if (!research)
    throw new SceneServiceError(
      "evidence",
      "The requested story could not be sourced.",
    );
  signal.throwIfAborted();
  if (
    new Set(research.sources.map((source) => source.id)).size !==
    research.sources.length
  )
    throw new SceneServiceError(
      "evidence",
      "The story research did not provide a usable source registry.",
    );
  if (!cached && !recoveryUsed)
    cache.set(cacheKey, research, options.cacheTtlSeconds ?? 900);
  options.onResearch?.(structuredClone(research));
  const generationEvidence = () => ({
    passages: research!.passages,
    sources: research!.sources.filter((source) =>
      research!.passages!.some((p) => p.sourceId === source.id),
    ),
    sourceChecks: research!.sourceChecks,
  });
  let repairsLeft = options.startupStrategy === "staged" ? 1 : 2;
  async function validated<T>(
    schema: z.ZodType<T>,
    stage: "checklist" | "focus" | "opening" | "batch" | "event_plan",
    instructions: string,
    input: unknown,
    validate: (value: T) => void | Promise<void>,
    remaining: BudgetStage[] = [],
  ): Promise<T> {
    let feedback: unknown = null;
    let stageRepairs = 0;
    while (true) {
      signal.throwIfAborted();
      let candidate: T | undefined;
      try {
        reserve(remaining);
        candidate = await provider.generate({
          stage: feedback && stage !== "checklist" ? "repair" : stage,
          schema,
          instructions,
          input: JSON.stringify({ request: input, repair: feedback }),
          maxOutputTokens: stageAllowances[stage].outputTokens,
          signal,
        });
        signal.throwIfAborted();
        await validate(candidate);
        return candidate;
      } catch (error) {
        signal.throwIfAborted();
        if (error instanceof SceneServiceError) throw error;
        const issues =
          error instanceof z.ZodError
            ? error.issues.map((issue) => ({
                path: issue.path,
                code: issue.code,
                message: issue.message,
              }))
            : error instanceof SyntaxError
              ? "Return valid JSON matching the schema."
              : error instanceof Error
                ? error.message
                : "The scene failed validation.";
        options.onRejected?.({
          stage,
          reason: typeof issues === "string" ? issues : JSON.stringify(issues),
          candidate: candidate ?? null,
        });
        if (error instanceof MissingEvidenceError) throw error;
        if (stageRepairs++ >= 1 || repairsLeft-- <= 0)
          throw new SceneServiceError(
            "validation",
            atomicEvents
              ? "The generated story did not pass its checks. Try a more specific prompt."
              : "The generated story did not pass its checks. Any available chapters can still be played. Try a more specific prompt.",
          );
        feedback = {
          issues,
          rejectedCandidate: candidate ?? null,
          instruction:
            "Correct only uncommitted output. Uncommitted chapter outlines, summaries, captions and narration may all be rewritten, shortened or split into complete sentences. For evidence failures, narrow or remove rejected new claims and rewrite dependent text. When a frozen checklist is supplied, its claims, requirements and temporal relations cannot be changed or weakened: clarify if they cannot be supported. Do not merely append passage IDs to unsupported wording. Never change historical dates to fit constraints or alter committed actions/claims. Ask a clarification when evidence cannot support the request.",
        };
      }
    }
  }
  const checklistStarted = performance.now();
  async function prepareChecklist(): Promise<StoryChecklist> {
    while (true) {
      try {
        const raw = await validated<StoryChecklist | EssentialChecklist>(
          atomicEvents ? essentialChecklistSchema : storyChecklistSchema,
          "checklist",
          `${
            atomicEvents
              ? checklistInstructions
                  .split("\n")
                  .filter(
                    (line) =>
                      !line.startsWith("Return ready with") &&
                      !line.startsWith("Extract up to 6"),
                  )
                  .join("\n") +
                "\n" +
                essentialInstructions
              : checklistInstructions
          }${atomicEvents ? "\nThis request uses an atomic-event compiler. Do not return claim-level relations; event-level relations will be reviewed after facts are split into atomic event records. Do not force whole composite claims into a before/after order. Preserve required scope and all essential sourced facts." : ""}`,
          {
            prompt,
            research: generationEvidence(),
            renderingCapabilities: assetCatalog.map((a) => ({
              id: a.id,
              description: a.description,
            })),
            discovery: options.discovery ?? null,
          },
          async (candidate) => {
            const value = atomicEvents
              ? normalizeEssentialChecklist(candidate as EssentialChecklist)
              : (candidate as StoryChecklist);
            checkStoryChecklist(value, research!);
            if (
              atomicEvents &&
              value.result.status === "ready" &&
              value.result.relations.length
            )
              throw new Error(
                "Leave claim-level relations empty; split occurrences into event records before relating them.",
              );
            if (value.result.status === "ready") {
              reserve(sceneSteps);
              await reviewStoryChecklist(
                provider,
                signal,
                { prompt, research: research!, candidate: value },
                options.onChecklistReview,
              );
            }
          },
          ["checklist_review", ...sceneSteps],
        );
        return atomicEvents
          ? normalizeEssentialChecklist(raw as EssentialChecklist)
          : (raw as StoryChecklist);
      } catch (error) {
        if (!(error instanceof MissingEvidenceError)) throw error;
        if (!(await recover(error.topics)))
          throw new SceneServiceError("clarification", error.message);
      }
    }
  }
  const prepared = await prepareChecklist().finally(() =>
    options.onChecklistTiming?.(
      Math.round(performance.now() - checklistStarted),
    ),
  );
  options.onChecklist?.(
    structuredClone(prepared),
    Math.round(performance.now() - checklistStarted),
  );
  if (prepared.result.status === "clarification")
    throw new SceneServiceError("clarification", prepared.result.question);
  return { research: research!, prepared, validated, generationEvidence };
}
