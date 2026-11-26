import { z } from "zod";
import { OpenAISceneProvider } from "@/lib/server/openai-provider";
import { readSceneConfig, SceneServiceError } from "@/lib/server/scene-config";
import { resolveStoryIntent } from "@/lib/server/story-intent";
import { createSceneTrace, sceneErrorDetails, traceSceneProvider } from "@/lib/server/scene-log";

export const runtime = "nodejs";
export const maxDuration = 35;

const requestSchema = z.object({ prompt: z.string().trim().min(3).max(500) });

export async function POST(request: Request) {
  const trace = createSceneTrace("resolve", request);
  const headers = { "Cache-Control": "no-store", "X-Meanwhile-Trace-Id": trace.id };
  trace.debug("started");
  const parsed = requestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    trace.warn("invalid_request", { ...sceneErrorDetails(parsed.error), httpStatus: 400 });
    return Response.json(
      { error: "Enter a historical event or subject (3–500 characters)." },
      { status: 400, headers },
    );
  }
  let deadline: AbortSignal | undefined;
  let lastResponseId: string | undefined;
  try {
    const config = readSceneConfig();
    trace.debug("configured", { provider: config.provider, model: config.model, effort: config.effort });
    // Demos need no inference. An upstream service resolves its own requests.
    if (config.provider !== "openai") {
      trace.debug("completed", { outcome: "bypassed", httpStatus: 200 });
      return Response.json({ result: { status: "resolved" } }, { headers });
    }
    deadline = AbortSignal.timeout(Math.min(config.timeoutMs, 30_000));
    const signal = AbortSignal.any([
      request.signal,
      deadline,
    ]);
    const result = await resolveStoryIntent(
      parsed.data.prompt,
      traceSceneProvider(new OpenAISceneProvider(config, (usage) => {
        lastResponseId = usage.responseId;
        trace.debug("model.usage", { ...usage, durationMs: usage.elapsedMs });
        if (config.logUsage)
          console.info("meanwhile.intent", JSON.stringify({ traceId: trace.id, usage }));
      }), trace),
      signal,
    );
    trace.debug("completed", {
      outcome: result.result.status,
      options: result.result.status === "clarification" ? result.result.options.length : 0,
      httpStatus: 200,
    });
    return Response.json(result, { headers });
  } catch (error) {
    if (request.signal.aborted) {
      trace.debug("cancelled", { httpStatus: 499 });
      return Response.json(
        { error: "Story lookup stopped.", code: "cancelled", traceId: trace.id },
        { status: 499, headers },
      );
    }
    const serviceError = error instanceof SceneServiceError ? error : null;
    const timeout = deadline?.aborted || serviceError?.code === "timeout";
    const details = sceneErrorDetails(error);
    const code = timeout ? "timeout" : String(details.code);
    const upstreamStatus = serviceError?.details?.status;
    const status = timeout ? 504
      : upstreamStatus === 429 ? 429
        : upstreamStatus === 401 || upstreamStatus === 403 ||
          ["configuration", "credentials", "connection"].includes(code) ? 503
          : 502;
    trace.error("failed", {
      ...details,
      code,
      responseId: details.responseId ?? lastResponseId,
      httpStatus: status,
      ...(code === "connection" ? {
        proxyConfigured: Boolean(
          process.env.HTTP_PROXY || process.env.HTTPS_PROXY || process.env.ALL_PROXY ||
          process.env.http_proxy || process.env.https_proxy || process.env.all_proxy,
        ),
      } : {}),
    });
    const message = timeout
      ? "Looking up story options took too long. Please try again or choose a curated story."
      : code === "incomplete"
        ? "The service didn’t finish preparing story options. Please try again."
        : serviceError?.message ?? "We couldn’t look up story options right now. Please try again.";
    return Response.json(
      { error: message, code, traceId: trace.id },
      { status, headers },
    );
  }
}
