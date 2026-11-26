import type { SceneMessage } from "../scene-schema";
import type { SceneProvider } from "./scene-provider";
import {
  prepareSceneEvidence,
  type PreparationOptions,
} from "./scene-preparation";
import {
  eventPlanSchema,
  eventPlanInstructions,
  eventSafeguards,
  EventPlanCapacityError,
  type EventPlan,
} from "./event-plan";
import { compileEventPlan, type CompiledStory } from "./event-compiler";
import { reviewCompiledEvents, type EventReviewRecord } from "./event-review";
import { generateScene as generateLegacyScene } from "./legacy-scene-harness";
import { reserveFor } from "./scene-budget";
import { unavailableEvidence } from "./evidence-recovery";
import { SceneServiceError } from "./scene-config";

export const harnessVersion = "discovery-evidence-v1";
export type StartupStrategy = "opening" | "staged";
export type { RejectionRecord } from "./scene-preparation";
export type HarnessOptions = PreparationOptions & {
  onEventPlan?: (plan: EventPlan, elapsedMs: number) => void;
  onEventPlanTiming?: (elapsedMs: number) => void;
  onEventReview?: (record: EventReviewRecord) => void;
  onCompilation?: (record: {
    status: "started" | "completed" | "failed";
    events: number;
    durationMs?: number;
    error?: unknown;
  }) => void;
};
/** Default inference completes and reviews a whole compiled scene before any playback state is published. */
export async function* generateScene(
  prompt: string,
  provider: SceneProvider,
  signal: AbortSignal,
  options: HarnessOptions = {},
): AsyncGenerator<SceneMessage> {
  if (options.startupStrategy === "staged") {
    yield* generateLegacyScene(prompt, provider, signal, options);
    return;
  }
  const preparation =
    await prepareSceneEvidence(
      prompt,
      provider,
      signal,
      options,
      ["event_plan", "event_review"],
      true,
    );
  const { validated, generationEvidence, recoverPreparedEvidence, historicalPrompt } = preparation;
  let { research, prepared } = preparation;
  let compiled: CompiledStory | undefined;
  const started = performance.now();
  while (true) {
    const plan = await validated(
      eventPlanSchema,
      "event_plan",
      eventPlanInstructions + eventSafeguards,
      {
        prompt: historicalPrompt,
        checklist: prepared,
        datedClaimIndices: prepared.claims.flatMap((claim, index) => claim.yearRange ? [index] : []),
        undatedClaimIndices: prepared.claims.flatMap((claim, index) => claim.yearRange ? [] : [index]),
        research: generationEvidence(),
        discovery: options.discovery ?? null,
      },
      async (value) => {
        if (value.result.status === "clarification") {
          if (value.result.reason === "capacity") throw new EventPlanCapacityError();
          return;
        }
        const compileStarted = performance.now();
        options.onCompilation?.({ status: "started", events: value.result.events.length });
        let candidate: CompiledStory;
        try {
          candidate = compileEventPlan(value.result, prepared, research, options.discovery);
          options.onCompilation?.({
            status: "completed", events: value.result.events.length,
            durationMs: Math.round(performance.now() - compileStarted),
          });
        } catch (error) {
          options.onCompilation?.({
            status: "failed", events: value.result.events.length, error,
            durationMs: Math.round(performance.now() - compileStarted),
          });
          throw error;
        }
        provider.reserveCompletion?.(reserveFor([]));
        await reviewCompiledEvents(
          provider,
          signal,
          {
            prompt: historicalPrompt,
            plan: value.result,
            checklist: prepared,
            research,
            compiled: candidate,
          },
          options.onEventReview,
        );
        compiled = candidate;
      },
      ["event_review"],
    ).finally(() =>
      options.onEventPlanTiming?.(Math.round(performance.now() - started)),
    );
    options.onEventPlan?.(
      structuredClone(plan),
      Math.round(performance.now() - started),
    );
    if (plan.result.status === "clarification") {
      if (plan.result.reason !== "missing_evidence")
        throw new SceneServiceError("clarification", plan.result.question);
      const recovered = await recoverPreparedEvidence([plan.result.question]);
      if (recovered) {
        ({ research, prepared } = recovered);
        continue;
      }
      throw unavailableEvidence(plan.result.question);
    }
    if (!compiled)
      throw new Error(
        "An approved compiled story is required before publication.",
      );
    for (const message of compiled.messages) {
      signal.throwIfAborted();
      yield message;
    }
    return;
  }
}
