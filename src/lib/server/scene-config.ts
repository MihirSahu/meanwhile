import { z } from "zod";

export class SceneServiceError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly details?: {
      status?: number;
      providerCode?: string;
      requestId?: string;
      stage?: string;
    },
  ) {
    super(message);
  }
}

const settings = z.object({
  provider: z.enum(["auto", "demo", "upstream", "openai"]).default("auto"),
  model: z
    .string()
    .regex(/^[a-zA-Z0-9._:-]{1,100}$/)
    .default("gpt-6.1-terra"),
  effort: z
    .enum(["none", "low", "medium", "high", "xhigh", "max"])
    .default("low"),
  timeoutMs: z.coerce.number().int().min(1000).max(230_000).default(180_000),
  maxToolCalls: z.coerce.number().int().min(1).max(4).default(2),
  cacheTtlSeconds: z.coerce.number().int().min(0).max(3600).default(900),
  logUsage: z.enum(["true", "false"]).default("false"),
});

export function readSceneConfig(
  env: Readonly<Record<string, string | undefined>> = process.env,
) {
  const optional = (value: string | undefined) => value?.trim() || undefined;
  const parsed = settings.safeParse({
    provider: optional(env.SCENE_PROVIDER),
    model: optional(env.SCENE_MODEL),
    effort: optional(env.SCENE_REASONING_EFFORT),
    timeoutMs: optional(env.SCENE_TIMEOUT_MS),
    maxToolCalls: optional(env.SCENE_MAX_TOOL_CALLS),
    cacheTtlSeconds: optional(env.SCENE_RESEARCH_CACHE_TTL_SECONDS),
    logUsage: optional(env.SCENE_LOG_USAGE),
  });
  if (!parsed.success)
    throw new SceneServiceError(
      "configuration",
      "The story service configuration needs attention. Please try again later.",
    );
  const endpoint = optional(env.SCENE_STREAM_URL);
  const apiKey = optional(env.OPENAI_API_KEY);
  const provider =
    parsed.data.provider === "auto"
      ? endpoint
        ? "upstream"
        : apiKey
          ? "openai"
          : "demo"
      : parsed.data.provider;
  if (provider === "openai" && !apiKey)
    throw new SceneServiceError(
      "credentials",
      "Live stories are not configured yet. You can still choose a curated story.",
    );
  if (
    provider === "upstream" &&
    (!endpoint || !/^https?:\/\//i.test(endpoint) || !URL.canParse(endpoint))
  )
    throw new SceneServiceError(
      "configuration",
      "The connected story service is not configured correctly.",
    );
  return {
    ...parsed.data,
    provider,
    endpoint,
    apiKey,
    token: optional(env.SCENE_STREAM_TOKEN),
    logUsage: parsed.data.logUsage === "true",
  };
}

export type SceneConfig = ReturnType<typeof readSceneConfig>;
