import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { POST } from "../src/app/api/resolve/route";
import { OpenAISceneProvider } from "../src/lib/server/openai-provider";
import type { GenerationRequest } from "../src/lib/server/scene-provider";
import { storyIntentSchema } from "../src/lib/story-intent";
import { hungarianClarification as clarification } from "./fixtures/story-intent";
import { responseFixture } from "./fixtures/live-scene";
import { SceneServiceError } from "../src/lib/server/scene-config";

function configure(t: TestContext, extra: Partial<NodeJS.ProcessEnv> = {}) {
  const previous = process.env;
  process.env = {
    ...previous,
    SCENE_PROVIDER: "openai",
    OPENAI_API_KEY: "fixture-key",
    ...extra,
  };
  t.after(() => { process.env = previous; });
  t.mock.method(globalThis, "fetch", () => {
    throw new Error("Intent tests must not use the network.");
  });
  const errors: unknown[][] = [];
  t.mock.method(console, "error", (...args: unknown[]) => { errors.push(args); });
  t.mock.method(console, "debug", () => {});
  t.mock.method(console, "warn", () => {});
  return errors;
}

function request(body: unknown, signal?: AbortSignal) {
  return new Request("http://localhost/api/resolve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
}

test("ambiguous prompts return selectable identities before any research or generation", async (t) => {
  configure(t);
  const calls: string[] = [];
  t.mock.method(OpenAISceneProvider.prototype, "research", () => {
    throw new Error("Do not research a story before the visitor chooses.");
  });
  t.mock.method(OpenAISceneProvider.prototype, "generate", async (input: GenerationRequest<unknown>) => {
    calls.push(input.stage);
    assert.deepEqual(JSON.parse(input.input), { prompt: "The hungarian revolution" });
    assert.equal(input.maxOutputTokens, 1600);
    return clarification;
  });
  const response = await POST(request({ prompt: "The hungarian revolution" }));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "no-store");
  assert.deepEqual(await response.json(), clarification);
  assert.deepEqual(calls, ["intent"]);
});

test("a clear prompt needs no invented precision or model rewrite", async (t) => {
  configure(t);
  t.mock.method(OpenAISceneProvider.prototype, "generate", async (input: GenerationRequest<unknown>) => {
    assert.deepEqual(JSON.parse(input.input), { prompt: "Apollo 11" });
    return { result: { status: "resolved" } };
  });
  const response = await POST(request({ prompt: "Apollo 11" }));
  assert.deepEqual(await response.json(), { result: { status: "resolved" } });
});

test("the real provider sends a bounded structured intent request without research tools", async (t) => {
  configure(t);
  let calls = 0;
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    calls++;
    if (String(url).includes("/responses/input_tokens"))
      return Response.json({ object: "response.input_tokens", input_tokens: 100 });
    const body = JSON.parse(init.body as string);
    assert.equal(body.text.format.name, "meanwhile_intent");
    assert.equal(body.max_output_tokens, 1600);
    assert.equal(body.tools, undefined);
    assert.equal(body.store, false);
    return Response.json(responseFixture(JSON.stringify(clarification)));
  });
  const response = await POST(request({ prompt: "The hungarian revolution" }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), clarification);
  assert.equal(calls, 2); // Input-token admission and one inference request.
});

test("demo and upstream modes do not require an OpenAI intent call", async (t) => {
  configure(t);
  t.mock.method(OpenAISceneProvider.prototype, "generate", () => {
    throw new Error("No inference should run for this provider.");
  });
  for (const provider of ["demo", "upstream"]) {
    process.env.SCENE_PROVIDER = provider;
    process.env.SCENE_STREAM_URL = "https://example.test/scene";
    const response = await POST(request({ prompt: "The Silk Road" }));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { result: { status: "resolved" } });
  }
});

test("malformed prompts are rejected without inference", async (t) => {
  configure(t);
  t.mock.method(OpenAISceneProvider.prototype, "generate", () => {
    throw new Error("Invalid requests must not reach the provider.");
  });
  for (const body of [null, {}, { prompt: "ab" }, { prompt: "x".repeat(501) }])
    assert.equal((await POST(request(body))).status, 400);
});

test("duplicate and malformed choices cannot become selectable options", async (t) => {
  configure(t);
  let output: unknown = {
    result: { ...clarification.result, options: [clarification.result.options[0], clarification.result.options[0]] },
  };
  t.mock.method(OpenAISceneProvider.prototype, "generate", async () => output);
  let response = await POST(request({ prompt: "A revolution" }));
  assert.equal(response.status, 502);
  assert.match((await response.json()).error, /distinct story options/);
  output = { result: { status: "clarification", question: "Choose", options: [] } };
  response = await POST(request({ prompt: "A revolution" }));
  assert.equal(response.status, 502);
  assert.doesNotMatch(await response.text(), /ZodError|fixture-key|issues/);
});

test("cancelled resolution never returns choices or continues to research", async (t) => {
  configure(t);
  const generate = t.mock.method(OpenAISceneProvider.prototype, "generate", async () => {
    throw new Error("Do not invoke inference for cancelled requests.");
  });
  const controller = new AbortController();
  controller.abort();
  const response = await POST(request({ prompt: "A revolution" }, controller.signal));
  assert.equal(response.status, 499);
  assert.equal((await response.json()).result, undefined);
  assert.equal(generate.mock.callCount(), 0);
});

for (const phase of ["token_count:intent", "intent"]) {
  test(`resolver failures log the connection cause and SDK phase (${phase})`, async (t) => {
    const logs = configure(t);
    let calls = 0;
    t.mock.method(globalThis, "fetch", async (url: string) => {
      calls++;
      if (phase === "intent" && String(url).includes("/responses/input_tokens"))
        return Response.json({ object: "response.input_tokens", input_tokens: 100 });
      const cause = Object.assign(new Error("private connection details"), { code: "UND_ERR_CONNECT_TIMEOUT" });
      throw new TypeError("private provider body", { cause });
    });
    const response = await POST(request({ prompt: "A revolution" }));
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.code, "connection");
    const failed = logs.find(([event]) => event === "meanwhile.resolve.failed")!;
    const details = JSON.parse(failed[1] as string);
    assert.equal(details.stage, phase);
    assert.equal(details.connectionCode, "UND_ERR_CONNECT_TIMEOUT");
    assert.equal(details.traceId, response.headers.get("X-Meanwhile-Trace-Id"));
    assert.equal(body.traceId, details.traceId);
    assert.equal(calls, phase === "intent" ? 2 : 1);
    assert.doesNotMatch(JSON.stringify(logs), /private provider body|private connection details|fixture-key/);
  });
}

test("resolver rate-limit logs retain the upstream status, code and request ID without provider bodies", async (t) => {
  const logs = configure(t);
  t.mock.method(globalThis, "fetch", async () => Response.json({
    error: { code: "rate_limit_exceeded", message: "private provider body" },
  }, { status: 429, headers: { "x-request-id": "req_fixture" } }));
  const response = await POST(request({ prompt: "A revolution" }));
  assert.equal(response.status, 429);
  const details = JSON.parse(logs.find(([event]) => event === "meanwhile.resolve.failed")![1] as string);
  assert.equal(details.status, 429);
  assert.equal(details.providerCode, "rate_limit_exceeded");
  assert.equal(details.requestId, "req_fixture");
  assert.doesNotMatch(JSON.stringify(logs), /private provider body|fixture-key/);
});

test("incomplete resolver output reports its reason and response ID even with usage logging disabled", async (t) => {
  const logs = configure(t, { SCENE_LOG_USAGE: "false" });
  t.mock.method(globalThis, "fetch", async (url: string) => {
    if (String(url).includes("/responses/input_tokens"))
      return Response.json({ object: "response.input_tokens", input_tokens: 100 });
    return Response.json({
      ...responseFixture("private truncated output"),
      id: "resp_truncated",
      status: "incomplete",
      incomplete_details: { reason: "max_output_tokens" },
    });
  });
  const response = await POST(request({ prompt: "A revolution" }));
  assert.equal(response.status, 502);
  const details = JSON.parse(logs.find(([event]) => event === "meanwhile.resolve.failed")![1] as string);
  assert.equal(details.code, "incomplete");
  assert.equal(details.stage, "intent");
  assert.equal(details.providerCode, "max_output_tokens");
  assert.equal(details.responseId, "resp_truncated");
  assert.doesNotMatch(JSON.stringify(logs), /private truncated output/);
});

test("a resolver timeout is distinguished from an invalid response", async (t) => {
  const logs = configure(t);
  t.mock.method(OpenAISceneProvider.prototype, "generate", async () => {
    throw new SceneServiceError("timeout", "Safe timeout.", { stage: "intent" });
  });
  const response = await POST(request({ prompt: "A revolution" }));
  assert.equal(response.status, 504);
  assert.equal((await response.json()).code, "timeout");
  const details = JSON.parse(logs.find(([event]) => event === "meanwhile.resolve.failed")![1] as string);
  assert.equal(details.httpStatus, 504);
  assert.equal(details.stage, "intent");
});

test("invalid resolver JSON retains the completed response ID without logging the raw output", async (t) => {
  const logs = configure(t, { SCENE_LOG_DEBUG: "false", SCENE_LOG_USAGE: "false" });
  t.mock.method(globalThis, "fetch", async (url: string) => {
    if (String(url).includes("/responses/input_tokens"))
      return Response.json({ object: "response.input_tokens", input_tokens: 100 });
    return Response.json({ ...responseFixture("private invalid JSON output"), id: "resp_invalid_json" });
  });
  const response = await POST(request({ prompt: "A revolution" }));
  assert.equal(response.status, 502);
  const details = JSON.parse(logs.find(([event]) => event === "meanwhile.resolve.failed")![1] as string);
  assert.equal(details.code, "invalid_json");
  assert.equal(details.responseId, "resp_invalid_json");
  assert.doesNotMatch(JSON.stringify(logs), /private invalid JSON output/);
});

test("intent choice counts are bounded and options are renderable", () => {
  assert.ok(storyIntentSchema.safeParse(clarification).success);
  assert.equal(storyIntentSchema.safeParse({
    result: { ...clarification.result, options: Array(5).fill(clarification.result.options[0]) },
  }).success, false);
});
