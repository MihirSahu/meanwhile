import { randomUUID } from "node:crypto";
import { z } from "zod";
import { SceneServiceError } from "./scene-config";
import type { GenerationRequest, SceneProvider, ResearchBundle } from "./scene-provider";

type Fields = Record<string, unknown>;
export type SceneTrace = ReturnType<typeof createSceneTrace>;

export function sceneErrorDetails(error: unknown): Fields {
  if (error instanceof SceneServiceError)
    return { code: error.code, ...error.details };
  if (error instanceof z.ZodError)
    return {
      code: "invalid_output",
      issues: error.issues.slice(0, 10).map(({ code, path }) => ({ code, path })),
    };
  if (error instanceof SyntaxError) return { code: "invalid_json" };
  if (error instanceof Error && error.name === "TimeoutError")
    return { code: "timeout" };
  if (error instanceof Error && error.name === "AbortError")
    return { code: "cancelled" };
  return {
    code: "unexpected",
    errorType: error instanceof Error ? error.name : typeof error,
    ...(error instanceof Error ? {
      stackFrames: error.stack?.split("\n").filter((line) => /^\s+at /.test(line)).slice(0, 6),
    } : {}),
  };
}

export function createSceneTrace(flow: "resolve" | "scene", request: Request) {
  const supplied = request.headers.get("X-Meanwhile-Trace-Id");
  const id = supplied && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(supplied)
    ? supplied : randomUUID();
  const started = performance.now();
  const enabled = process.env.SCENE_LOG_DEBUG === "true" ||
    (process.env.SCENE_LOG_DEBUG !== "false" && process.env.NODE_ENV === "development");
  const secrets = [process.env.OPENAI_API_KEY, process.env.SCENE_STREAM_TOKEN]
    .filter((value): value is string => Boolean(value && value.length >= 4));
  const secretKeys = /^(?:api_?key|authorization|cookie|token|access_?token|refresh_?token|password|secret|OPENAI_API_KEY|SCENE_STREAM_TOKEN)$/i;
  function clean(value: unknown, depth = 0): unknown {
    if (depth > 6) return "[omitted]";
    if (typeof value === "string") {
      let safe = value;
      for (const secret of secrets) safe = safe.split(secret).join("[REDACTED]");
      return safe.replace(/\bsk-[A-Za-z0-9_-]{10,}/g, "[REDACTED]").slice(0, 3000);
    }
    if (Array.isArray(value)) return value.slice(0, 20).map((item) => clean(item, depth + 1));
    if (value && typeof value === "object")
      return Object.fromEntries(Object.entries(value).slice(0, 40).map(([key, item]) => [
        key, secretKeys.test(key) ? "[REDACTED]" : clean(item, depth + 1),
      ]));
    return value;
  }
  function emit(level: "debug" | "warn" | "error", event: string, fields: Fields = {}) {
    if (level !== "error" && !enabled) return;
    const record = {
      ...clean(fields) as Fields,
      traceId: id,
      flow,
      level,
      elapsedMs: Math.round(performance.now() - started),
    };
    console[level](`meanwhile.${flow}.${event}`, JSON.stringify(record));
  }
  return {
    id,
    debug: (event: string, fields?: Fields) => emit("debug", event, fields),
    warn: (event: string, fields?: Fields) => emit("warn", event, fields),
    error: (event: string, fields?: Fields) => emit("error", event, fields),
  };
}

/** Observe boundaries without logging prompts, model output or source passages. */
export function traceSceneProvider(provider: SceneProvider, trace: SceneTrace): SceneProvider {
  const attempts = new Map<string, number>();
  async function timed<T>(stage: string, run: () => Promise<T>, summarize?: (value: T) => Fields) {
    const attempt = (attempts.get(stage) ?? 0) + 1;
    attempts.set(stage, attempt);
    const started = performance.now();
    trace.debug("stage.started", { stage, attempt });
    try {
      const value = await run();
      trace.debug("stage.completed", {
        stage, attempt, durationMs: Math.round(performance.now() - started), ...summarize?.(value),
      });
      return value;
    } catch (error) {
      const details = sceneErrorDetails(error);
      trace.warn("stage.failed", {
        ...details, stage, phase: details.stage, attempt,
        durationMs: Math.round(performance.now() - started),
      });
      throw error;
    }
  }
  return {
    cacheIdentity: provider.cacheIdentity,
    ...(provider.rereadEvidence ? {
      rereadEvidence: (topics: string[], signal: AbortSignal, research?: ResearchBundle) => timed(
        "research_reread", () => provider.rereadEvidence!(topics, signal, research),
        (bundle) => ({ passages: bundle?.passages?.length ?? 0 }),
      ),
    } : {}),
    reserveCompletion: (value) => provider.reserveCompletion?.(value),
    research: (prompt, signal, options) => timed(
      options?.recoveryTopics?.length ? "research_recovery" : "research",
      () => provider.research(prompt, signal, options),
      (bundle) => ({
        sources: bundle.sources.length,
        passages: bundle.passages?.length ?? 0,
        sourceChecks: bundle.sourceChecks?.map(({ sourceId, status }) => ({ sourceId, status })),
      }),
    ),
    generate: <T>(request: GenerationRequest<T>) => timed(request.stage, () => provider.generate(request)),
  };
}
