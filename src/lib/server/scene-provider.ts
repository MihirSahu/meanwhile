import type { EvidencePassage } from "../evidence-schema";
import type { SourceCheck } from "./source-retrieval";
import type { z } from "zod";
import type { CompletionReserve, BudgetSnapshot } from "./scene-budget";

export type EvidenceSource = { id: string; title: string; url: string };
export type ResearchBundle = {
  text: string;
  sources: EvidenceSource[];
  passages?: EvidencePassage[];
  sourceChecks?: SourceCheck[];
};
export type GenerationRequest<T> = {
  stage:
    | "intent"
    | "checklist"
    | "checklist_review"
    | "event_plan"
    | "event_review"
    | "focus"
    | "opening"
    | "batch"
    | "repair"
    | "review"
    | "evidence_review";
  schema: z.ZodType<T>;
  instructions: string;
  input: string;
  maxOutputTokens: number;
  signal: AbortSignal;
};
export type ModelUsage = {
  budget?: BudgetSnapshot;
  countedInputTokens?: number;
  stage: string;
  responseId: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  toolCalls: number;
  searchCalls: number;
  elapsedMs: number;
};

/** A provider implements inference and retrieval; it never owns playback state. */
export interface SceneProvider {
  readonly cacheIdentity: string;
  rereadEvidence?(topics: string[], signal: AbortSignal, research?: ResearchBundle): Promise<ResearchBundle | null>;
  research(
    prompt: string,
    signal: AbortSignal,
    options?: { recoveryTopics?: string[] },
  ): Promise<ResearchBundle>;
  reserveCompletion?(reserve: CompletionReserve): void;
  generate<T>(request: GenerationRequest<T>): Promise<T>;
}
