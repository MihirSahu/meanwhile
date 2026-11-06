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
  type EventPlan,
} from "./event-plan";
import { compileEventPlan, type CompiledStory } from "./event-compiler";
import { reviewCompiledEvents, type EventReviewRecord } from "./event-review";
import { generateScene as generateLegacyScene } from "./legacy-scene-harness";
import { SceneServiceError } from "./scene-config";
import { reserveFor } from "./scene-budget";

export const harnessVersion = "stream-review-v1";
export type StartupStrategy = "opening" | "staged";
export type { RejectionRecord } from "./scene-preparation";
export type HarnessOptions = PreparationOptions & {
  onEventPlan?: (plan: EventPlan, elapsedMs: number) => void;
  onEventPlanTiming?: (elapsedMs: number) => void;
  onEventReview?: (record: EventReviewRecord) => void;
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
  const { research, prepared, validated, generationEvidence } =
    await prepareSceneEvidence(
      prompt,
      provider,
      signal,
      options,
      ["event_plan", "event_review"],
      true,
    );
  let compiled: CompiledStory | undefined;
  const started = performance.now();
  const plan = await validated(
    eventPlanSchema,
    "event_plan",
    eventPlanInstructions + eventSafeguards,
    {
      prompt,
      checklist: prepared,
      research: generationEvidence(),
      discovery: options.discovery ?? null,
    },
    async (value) => {
      if (value.result.status === "clarification") return;
      const candidate = compileEventPlan(
        value.result,
        prepared,
        research,
        options.discovery,
      );
      provider.reserveCompletion?.(reserveFor([]));
      await reviewCompiledEvents(
        provider,
        signal,
        {
          prompt,
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
  if (plan.result.status === "clarification")
    throw new SceneServiceError("clarification", plan.result.question);
  if (!compiled)
    throw new Error(
      "An approved compiled story is required before publication.",
    );
  for (const message of compiled.messages) {
    signal.throwIfAborted();
    yield message;
  }
}
