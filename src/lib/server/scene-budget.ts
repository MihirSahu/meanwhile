import { SceneServiceError } from "./scene-config";

export const sceneBudgetLimits = {
  calls: 16,
  inputTokens: 288_000,
  outputTokens: 36_000,
} as const;
export const stageAllowances = {
  research: { inputTokens: 32_000, outputTokens: 3000 },
  research_recovery: { inputTokens: 32_000, outputTokens: 3000 },
  checklist: { inputTokens: 24_000, outputTokens: 3200 },
  checklist_review: { inputTokens: 24_000, outputTokens: 2000 },
  event_plan: { inputTokens: 24_000, outputTokens: 6000 },
  event_review: { inputTokens: 24_000, outputTokens: 3000 },
  focus: { inputTokens: 24_000, outputTokens: 3000 },
  opening: { inputTokens: 24_000, outputTokens: 5000 },
  batch: { inputTokens: 24_000, outputTokens: 3500 },
  evidence_review: { inputTokens: 24_000, outputTokens: 3000 },
  review: { inputTokens: 48_000, outputTokens: 2500 },
} as const;
export type BudgetStage = keyof typeof stageAllowances;
export type CompletionReserve = {
  calls: number;
  inputTokens: number;
  outputTokens: number;
};
export const noReserve: CompletionReserve = {
  calls: 0,
  inputTokens: 0,
  outputTokens: 0,
};
export function reserveFor(stages: readonly BudgetStage[]): CompletionReserve {
  return stages.reduce(
    (r, s) => ({
      calls: r.calls + 1,
      inputTokens: r.inputTokens + stageAllowances[s].inputTokens,
      outputTokens: r.outputTokens + stageAllowances[s].outputTokens,
    }),
    { ...noReserve },
  );
}
export type BudgetSnapshot = {
  used: CompletionReserve;
  reserved: CompletionReserve;
  limits: CompletionReserve;
};

/** Mandatory future calls keep their full input/output allowances; optional work uses only the remainder. */
export class SceneRequestBudget {
  private used: CompletionReserve = { ...noReserve };
  private reserved: CompletionReserve = { ...noReserve };
  constructor(private readonly limits: CompletionReserve = sceneBudgetLimits) {}
  reserve(value: CompletionReserve) {
    if (Object.values(value).some((n) => !Number.isSafeInteger(n) || n < 0))
      throw new Error("Invalid completion reserve.");
    this.reserved = { ...value };
  }
  snapshot(): BudgetSnapshot {
    return {
      used: { ...this.used },
      reserved: { ...this.reserved },
      limits: { ...this.limits },
    };
  }
  private fits(input: number, output: number, calls = 1) {
    if (
      this.used.calls + calls + this.reserved.calls > this.limits.calls ||
      this.used.inputTokens + input + this.reserved.inputTokens >
        this.limits.inputTokens ||
      this.used.outputTokens + output + this.reserved.outputTokens >
        this.limits.outputTokens
    )
      throw new SceneServiceError(
        "budget",
        "This story cannot fit more work while preserving its remaining generation and review budget.",
      );
  }
  checkCapacity(output: number) {
    this.fits(0, output);
  }
  admit(stage: string, countedInput: number, output: number) {
    if (!Number.isSafeInteger(countedInput) || countedInput < 0)
      throw new SceneServiceError(
        "budget",
        "The story request size could not be verified.",
      );
    const allowance = stage.startsWith("research")
      ? stageAllowances.research.inputTokens
      : stage === "review"
        ? stageAllowances.review.inputTokens
        : 24_000;
    if (countedInput > allowance)
      throw new SceneServiceError(
        "budget",
        "This story request is too large for its remaining generation budget.",
      );
    this.fits(stage.startsWith("research") ? allowance : countedInput, output);
    this.used.calls++;
  }
  record(input: number, output: number) {
    this.used.inputTokens += input;
    this.used.outputTokens += output;
    this.fits(0, 0, 0);
  }
}
