import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { createSceneTrace, sceneErrorDetails, traceSceneProvider } from "../src/lib/server/scene-log";
import type { SceneProvider } from "../src/lib/server/scene-provider";

function capture(t: TestContext, environment: Partial<NodeJS.ProcessEnv> = {}) {
  const previous = process.env;
  process.env = { ...previous, NODE_ENV: "development", SCENE_LOG_DEBUG: undefined, ...environment };
  t.after(() => { process.env = previous; });
  const logs: { level: string; event: string; fields: any }[] = [];
  for (const level of ["debug", "warn", "error"] as const)
    t.mock.method(console, level, (event: string, fields: string) => {
      logs.push({ level, event, fields: JSON.parse(fields) });
    });
  return logs;
}

const traceId = "00000000-0000-4000-8000-000000000001";
const request = (id = traceId) => new Request("http://localhost/api/resolve", {
  headers: { "X-Meanwhile-Trace-Id": id },
});

test("terminal traces preserve correlation and redact credentials while retaining token counts", (t) => {
  const logs = capture(t, { OPENAI_API_KEY: "fixture-openai-key", SCENE_STREAM_TOKEN: "fixture-upstream-token" });
  const trace = createSceneTrace("resolve", request());
  trace.debug("started", { stage: "intent" });
  trace.error("failed", {
    reason: "fixture-openai-key and fixture-upstream-token must be removed",
    authorization: "Bearer private authorization",
    inputTokens: 100,
    nested: { apiKey: "another private credential" },
  });
  assert.equal(logs.length, 2);
  assert.ok(logs.every(({ fields }) => fields.traceId === traceId));
  assert.ok(logs.every(({ fields }) => fields.flow === "resolve" && fields.elapsedMs >= 0));
  assert.equal(logs[1].fields.inputTokens, 100);
  assert.equal(logs[1].fields.authorization, "[REDACTED]");
  assert.doesNotMatch(JSON.stringify(logs), /fixture-openai-key|fixture-upstream-token|private authorization|another private credential/);
});

test("debug logging is enabled in development and configurable while errors always remain visible", (t) => {
  const logs = capture(t, { SCENE_LOG_DEBUG: "false" });
  let trace = createSceneTrace("scene", request());
  trace.debug("started");
  trace.warn("rejected", { reason: "A recoverable rejection." });
  trace.error("failed", { code: "validation" });
  assert.deepEqual(logs.map(({ level }) => level), ["error"]);
  process.env = { ...process.env, NODE_ENV: "production", SCENE_LOG_DEBUG: "true" };
  trace = createSceneTrace("scene", request());
  trace.debug("started");
  assert.equal(logs.at(-1)!.level, "debug");
});

test("an invalid client correlation header is replaced rather than written to terminal logs", (t) => {
  const logs = capture(t);
  const trace = createSceneTrace("resolve", request("untrusted-not-a-uuid"));
  trace.debug("started");
  assert.match(trace.id, /^[0-9a-f-]{36}$/);
  assert.doesNotMatch(JSON.stringify(logs), /untrusted-not-a-uuid/);
});

test("provider traces report research, recovery and model attempts without logging inputs or outputs", async (t) => {
  const logs = capture(t);
  const provider: SceneProvider = {
    cacheIdentity: "fixture-provider",
    async research() {
      return { text: "private evidence body", sources: [], passages: [] };
    },
    async generate<T>() { return "private model response" as T; },
  };
  const traced = traceSceneProvider(provider, createSceneTrace("scene", request()));
  const signal = new AbortController().signal;
  await traced.research("private prompt", signal);
  await traced.research("private prompt", signal, { recoveryTopics: ["private lookup"] });
  for (let i = 0; i < 2; i++)
    await traced.generate({ stage: "intent", schema: {} as never, instructions: "private instructions", input: "private prompt", maxOutputTokens: 1600, signal });
  const starts = logs.filter(({ event }) => event.endsWith("stage.started"));
  assert.deepEqual(starts.map(({ fields }) => [fields.stage, fields.attempt]), [
    ["research", 1], ["research_recovery", 1], ["intent", 1], ["intent", 2],
  ]);
  assert.doesNotMatch(JSON.stringify(logs), /private prompt|private evidence|private model|private lookup|private instructions/);
});

test("unknown and JSON parsing errors never dump exception messages or raw bodies", (t) => {
  capture(t);
  assert.deepEqual(sceneErrorDetails(new SyntaxError("private raw model response")), { code: "invalid_json" });
  const details = sceneErrorDetails(new Error("private raw provider body"));
  assert.equal(details.code, "unexpected");
  assert.equal(details.errorType, "Error");
  assert.ok(Array.isArray(details.stackFrames));
  assert.doesNotMatch(JSON.stringify(details), /private raw provider body/);
});
