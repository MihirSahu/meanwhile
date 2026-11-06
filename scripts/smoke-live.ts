import type { EventPlan } from "../src/lib/server/event-plan";
import type { EventReviewRecord } from "../src/lib/server/event-review";
import {
  currentHistoricalContext,
  discoveryPrompt,
} from "../src/lib/discovery";
import { makeDemo } from "../src/lib/demo";
import { loadEnvConfig } from "@next/env";
import { mkdir, writeFile } from "node:fs/promises";
import {
  readSceneConfig,
  SceneServiceError,
} from "../src/lib/server/scene-config";
import { OpenAISceneProvider } from "../src/lib/server/openai-provider";
import { generateScene } from "../src/lib/server/scene-harness";
import { SceneBuffer } from "../src/lib/playback";
import type { GateRecord } from "../src/lib/server/evidence-gate";
import type { ResearchBundle } from "../src/lib/server/scene-provider";
import type { ModelUsage } from "../src/lib/server/scene-provider";
import type { StoryChecklist } from "../src/lib/server/story-checklist";
import type { ChecklistReviewRecord } from "../src/lib/server/checklist-review";
import type { EvidenceRecoveryRecord } from "../src/lib/server/evidence-recovery";

async function main() {
  loadEnvConfig(process.cwd());
  const config = readSceneConfig({ ...process.env, SCENE_PROVIDER: "openai" });
  const meanwhile = process.argv.includes("--meanwhile");
  const origin = new SceneBuffer();
  if (meanwhile)
    makeDemo("The First Sino-Japanese War").forEach((message) =>
      origin.ingest(message),
    );
  const discovery = meanwhile
    ? currentHistoricalContext(origin.focus!, origin.actions, 57)!
    : undefined;
  const output = meanwhile ? "artifacts/live-meanwhile" : "artifacts/live";
  const prompt = discovery
    ? discoveryPrompt(discovery)
    : process.argv.slice(2).join(" ") ||
      "The First Sino-Japanese War, 1894–1895";
  const gates: GateRecord[] = [];
  const eventReviews: EventReviewRecord[] = [];
  let eventPlan: EventPlan | null = null;
  const checklistReviews: ChecklistReviewRecord[] = [];
  const recoveries: EvidenceRecoveryRecord[] = [];
  let research: ResearchBundle | null = null;
  let checklist: StoryChecklist | null = null;
  let checklistMs: number | null = null;
  const usage: ModelUsage[] = [],
    lines: string[] = [];
  const provider = new OpenAISceneProvider(config, (event) =>
    usage.push(event),
  );
  const buffer = new SceneBuffer(),
    started = performance.now();
  let firstFocusMs: number | null = null,
    firstBatchMs: number | null = null;
  const signal = AbortSignal.timeout(config.timeoutMs);
  try {
    for await (const message of generateScene(prompt, provider, signal, {
      cacheTtlSeconds: 0,
      onChecklist: (record, elapsedMs) => {
        checklist = record;
        checklistMs = elapsedMs;
      },
      onChecklistTiming: (elapsedMs) => {
        checklistMs = elapsedMs;
      },
      onChecklistReview: (record) => {
        checklistReviews.push(record);
      },
      onRecovery: (record) => {
        recoveries.push(record);
      },
      onResearch: (bundle) => {
        research = bundle;
      },
      onGate: (record) => {
        gates.push(record);
      },
      onEventPlan: (record) => {
        eventPlan = record;
      },
      onEventReview: (record) => {
        eventReviews.push(record);
      },
      discovery,
    })) {
      buffer.ingest(message);
      lines.push(JSON.stringify(message));
      const elapsedMs = Math.round(performance.now() - started);
      if (message.type === "focus") {
        firstFocusMs = elapsedMs;
        console.info(
          JSON.stringify({
            event: "focus",
            title: message.title,
            sources: message.sources.length,
            elapsedMs,
          }),
        );
      }
      if (message.type === "batch") {
        firstBatchMs ??= elapsedMs;
        console.info(
          JSON.stringify({
            event: "batch",
            seq: message.seq,
            readyThrough: message.readyThrough,
            elapsedMs,
          }),
        );
      }
    }
    if (!buffer.complete) throw new Error("The live scene did not complete.");
  } finally {
    await mkdir(output, { recursive: true });
    await writeFile(
      `${output}/scene.ndjson`,
      lines.join("\n") + (lines.length ? "\n" : ""),
    );
    await writeFile(
      `${output}/evidence.json`,
      JSON.stringify(
        {
          research,
          recoveries,
          checklist,
          checklistReviews,
          eventPlan,
          eventReviews,
          gates,
        },
        null,
        2,
      ),
    );
    const summary = {
      model: config.model,
      effort: config.effort,
      complete: buffer.complete,
      readyThrough: buffer.readyThrough,
      firstFocusMs,
      firstBatchMs,
      checklistMs,
      elapsedMs: Math.round(performance.now() - started),
      usage,
    };
    await writeFile(
      `${output}/summary.json`,
      JSON.stringify(summary, null, 2) + "\n",
    );
    console.info(JSON.stringify(summary));
  }
}

void main().catch((error: unknown) => {
  console.error(
    JSON.stringify(
      error instanceof SceneServiceError
        ? { code: error.code, message: error.message, ...error.details }
        : {
            code: "smoke_failed",
            message:
              "The live smoke test failed. Check configuration and the saved usage summary.",
          },
    ),
  );
  process.exitCode = 1;
});
