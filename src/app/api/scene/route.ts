import { setTimeout as delay } from "node:timers/promises";
import { z } from "zod";
import { makeDemo } from "@/lib/demo";
import { SceneBuffer } from "@/lib/playback";
import { SceneStreamDecoder } from "@/lib/scene-stream";
import {
  readSceneConfig,
  SceneServiceError,
  type SceneConfig,
} from "@/lib/server/scene-config";
import { OpenAISceneProvider } from "@/lib/server/openai-provider";
import { generateScene } from "@/lib/server/scene-harness";
import { rangeContains } from "@/lib/historical-time";
import {
  discoveryContextSchema,
  discoveryPrompt,
  validateDiscovery,
} from "@/lib/discovery";
import type { ModelUsage } from "@/lib/server/scene-provider";
import {
  protocolVersion,
  sceneInstructions,
  sceneMessageJsonSchema,
} from "@/lib/scene-protocol";
import {
  assetCatalog,
  messageSchema,
  type SceneMessage,
} from "@/lib/scene-schema";

export const runtime = "nodejs";
export const maxDuration = 240;
const requestSchema = z.object({
  prompt: z.string().trim().min(3).max(500),
  demo: z.boolean().default(false),
  discovery: discoveryContextSchema.optional(),
});

export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success)
    return Response.json(
      { error: "Enter a historical event or journey (3–500 characters)." },
      { status: 400 },
    );
  const { demo, discovery } = parsed.data;
  const prompt = discovery ? discoveryPrompt(discovery) : parsed.data.prompt;
  let config: SceneConfig;
  try {
    config = readSceneConfig(demo ? { SCENE_PROVIDER: "demo" } : process.env);
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof SceneServiceError
            ? error.message
            : "The story service is unavailable.",
      },
      { status: 503 },
    );
  }
  const endpoint = config.endpoint;
  if (discovery && config.provider === "demo")
    return Response.json(
      {
        error:
          "Meanwhile discovery needs a connected live story service. Your curated story is still available.",
      },
      { status: 503 },
    );
  let demoMessages: SceneMessage[] | null = null;
  if (config.provider === "demo") {
    try {
      demoMessages = makeDemo(prompt);
    } catch (error) {
      return Response.json(
        {
          error:
            error instanceof Error
              ? error.message
              : "This demo is unavailable.",
        },
        { status: 422 },
      );
    }
  }
  const abort = new AbortController();
  const deadline = AbortSignal.timeout(
    config.provider === "openai" ? config.timeoutMs : 55_000,
  );
  const signal = AbortSignal.any([abort.signal, deadline]);
  const forwardAbort = () => abort.abort();
  request.signal.addEventListener("abort", forwardAbort, { once: true });
  if (request.signal.aborted) abort.abort();
  let cancelled = false;
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const buffer = new SceneBuffer();
      const started = performance.now();
      const usage: ModelUsage[] = [];
      let cacheHit = false,
        firstFocusMs: number | null = null,
        firstBatchMs: number | null = null,
        outcome = "complete";
      const send = (raw: unknown) => {
        signal.throwIfAborted();
        const message = messageSchema.parse(raw);
        if (discovery && message.type === "focus") {
          if (message.mode !== "live" || !message.yearRange)
            throw new SceneServiceError(
              "discovery",
              "The service did not return a sourced event in the requested historical period.",
            );
          try {
            validateDiscovery(discovery, {
              title: message.title,
              center: message.center,
              yearRange: message.yearRange,
            });
          } catch {
            throw new SceneServiceError(
              "discovery",
              "The discovered story did not match the requested place or period. Your earlier story is still available.",
            );
          }
          message.discoveryFrom = {
            title: discovery.originTitle,
            period: discovery.periodLabel,
          };
        }
        if (
          discovery &&
          message.type === "batch" &&
          message.actions.some(
            (action) =>
              action.type === "chapter" &&
              (!action.yearRange ||
                !rangeContains(discovery.yearRange, action.yearRange)),
          )
        )
          throw new SceneServiceError(
            "discovery",
            "The discovered chapter did not match the requested historical period. Your earlier story is still available.",
          );
        buffer.ingest(message);
        if (message.type === "focus")
          firstFocusMs = Math.round(performance.now() - started);
        if (message.type === "batch" && firstBatchMs === null)
          firstBatchMs = Math.round(performance.now() - started);
        controller.enqueue(encoder.encode(JSON.stringify(message) + "\n"));
      };
      try {
        if (demoMessages) {
          for (const message of demoMessages) {
            await delay(message.type === "focus" ? 80 : 260, undefined, {
              signal,
            });
            send(message);
          }
        } else if (config.provider === "openai") {
          const provider = new OpenAISceneProvider(config, (event) =>
            usage.push(event),
          );
          for await (const message of generateScene(prompt, provider, signal, {
            cacheTtlSeconds: config.cacheTtlSeconds,
            discovery,
            onCache: (hit) => {
              cacheHit = hit;
            },
          }))
            send(message);
        } else {
          const response = await fetch(endpoint!, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/x-ndjson",
              ...(config.token
                ? { Authorization: `Bearer ${config.token}` }
                : {}),
            },
            body: JSON.stringify({
              prompt,
              protocolVersion,
              assets: assetCatalog,
              instructions: sceneInstructions,
              messageSchema: sceneMessageJsonSchema,
              ...(discovery ? { discovery } : {}),
            }),
            signal,
            cache: "no-store",
          });
          if (!response.ok || !response.body)
            throw new Error("The scene provider could not start a stream.");
          const reader = response.body.getReader();
          const decoder = new SceneStreamDecoder();
          try {
            while (true) {
              const { done, value } = await reader.read();
              for (const raw of decoder.push(value, done)) send(raw);
              if (done) break;
            }
          } finally {
            await reader.cancel().catch(() => {});
            reader.releaseLock();
          }
        }
        if (!buffer.complete)
          throw new Error("The scene stream ended before its final batch.");
      } catch (error) {
        outcome = abort.signal.aborted
          ? "cancelled"
          : deadline.aborted
            ? "timeout"
            : error instanceof SceneServiceError
              ? error.code
              : "invalid";
        if (!abort.signal.aborted)
          controller.enqueue(
            encoder.encode(
              JSON.stringify({
                type: "error",
                message: deadline.aborted
                  ? "Research took too long. You can replay any available chapters or try a narrower event."
                  : error instanceof SceneServiceError
                    ? error.message
                    : demoMessages && error instanceof Error
                      ? error.message
                      : "The scene stream was interrupted or contained invalid actions. Please try again.",
              }) + "\n",
            ),
          );
      } finally {
        request.signal.removeEventListener("abort", forwardAbort);
        if (config.provider === "openai" && config.logUsage)
          console.info(
            "meanwhile.scene",
            JSON.stringify({
              provider: config.provider,
              model: config.model,
              effort: config.effort,
              outcome,
              cacheHit,
              elapsedMs: Math.round(performance.now() - started),
              firstFocusMs,
              firstBatchMs,
              readyThrough: buffer.readyThrough,
              usage,
            }),
          );
        if (!cancelled) controller.close();
      }
    },
    cancel() {
      cancelled = true;
      abort.abort();
      request.signal.removeEventListener("abort", forwardAbort);
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}
