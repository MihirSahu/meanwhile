import assert from "node:assert/strict";
import test, { type TestContext } from "node:test";
import { POST } from "../src/app/api/scene/route";
import { makeDemo } from "../src/lib/demo";
import { fixtureForRequest, fixtureHtml, responseFixture } from "./fixtures/live-scene";
import { researchCache } from "../src/lib/server/research-cache";
import {
  sceneInstructions,
  sceneMessageJsonSchema,
} from "../src/lib/scene-protocol";

function configure(t: TestContext, environment: NodeJS.ProcessEnv) {
  const previous = process.env;
  process.env = environment;
  t.after(() => {
    process.env = previous;
  });
}

test("direct OpenAI mode streams a complete live scene through the same endpoint", async (t) => {
  configure(t, {
    ...process.env,
    SCENE_PROVIDER: "openai",
    OPENAI_API_KEY: "fixture-key",
    SCENE_RESEARCH_CACHE_TTL_SECONDS: "0",
    SCENE_LOG_USAGE: "false",
    SCENE_LOG_DEBUG: "true",
  });
  researchCache.clear();
  const diagnostics: { event: string; record: any }[] = [];
  t.mock.method(console, "debug", (event: string, details: string) => {
    diagnostics.push({ event, record: JSON.parse(details) });
  });
  const requests: Record<string, any>[] = [];
  t.mock.method(
    globalThis,
    "fetch",
    async (_url: string, init: RequestInit) => {
      if (init.method === "GET") return fixtureHtml();
      if (String(_url).includes("/responses/input_tokens"))
        return Response.json({
          object: "response.input_tokens",
          input_tokens: 100,
        });
      const body = JSON.parse(init.body as string);
      requests.push(body);
      return Response.json(fixtureForRequest(body));
    },
  );
  const response = await POST(
    request({ prompt: "Silk Road", model: "untrusted-client-model" }),
  );
  const messages = (await response.text())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.deepEqual(
    messages.map((message) => message.type),
    ["focus", "batch", "batch", "batch", "done"],
  );
  assert.equal(messages[0].mode, "live");
  assert.equal(messages[0].sources[0].id, "s1");
  assert.equal(requests.length, 5);
  assert.ok(requests.every((body) => body.model === "gpt-6.1-terra"));
  const traceId = response.headers.get("X-Meanwhile-Trace-Id");
  assert.ok(traceId);
  assert.ok(diagnostics.every(({ record }) => record.traceId === traceId));
  assert.deepEqual(diagnostics.filter(({ event }) => event.endsWith("stage.started")).map(({ record }) => record.stage), [
    "research", "checklist", "checklist_review", "event_plan", "event_review",
  ]);
  assert.ok(diagnostics.some(({ event }) => event === "meanwhile.scene.compilation.completed"));
  assert.equal(diagnostics.filter(({ event }) => event === "meanwhile.scene.stream.sent").length, 5);
  assert.equal(diagnostics.at(-1)?.record.outcome, "complete");
  assert.doesNotMatch(JSON.stringify(diagnostics), /fixture-key|Evidence brief/);
});

test("missing-source instructions stay in terminal diagnostics rather than asking the visitor to provide research", async (t) => {
  configure(t, { ...process.env, SCENE_PROVIDER: "openai", OPENAI_API_KEY: "fixture-key",
    SCENE_RESEARCH_CACHE_TTL_SECONDS: "0", SCENE_LOG_DEBUG: "false" });
  const failures: any[] = [];
  t.mock.method(console, "error", (_event: string, details: string) => failures.push(JSON.parse(details)));
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    if (init.method === "GET") return fixtureHtml();
    if (String(url).includes("/responses/input_tokens"))
      return Response.json({ object: "response.input_tokens", input_tokens: 100 });
    const body = JSON.parse(init.body as string);
    if (body.text?.format.name === "meanwhile_checklist")
      return Response.json(responseFixture(JSON.stringify({ claims: [], result: {
        status: "clarification", reason: "missing_evidence",
        question: "Could you provide sources covering the war’s origins and major military developments?",
        missingEvidence: ["Sources on the war’s origins and military developments."],
      } })));
    return Response.json(fixtureForRequest(body));
  });
  const response = await POST(request({ prompt: "World War I" }));
  const messages = (await response.text()).trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(messages.map((m) => m.type), ["error"]);
  assert.match(messages[0].message, /reliable sources/);
  assert.doesNotMatch(messages[0].message, /provide sources|military developments/);
  assert.equal(failures[0].code, "evidence");
  assert.match(failures[0].reason, /provide sources.*origins/);
});

for (const environment of ["development", "production"] as const)
  test(`rejected stories retain development diagnostics without publishing unverified output (${environment})`, async (t) => {
    configure(t, {
      ...process.env,
      NODE_ENV: environment,
      SCENE_PROVIDER: "openai",
      OPENAI_API_KEY: "fixture-key",
      SCENE_RESEARCH_CACHE_TTL_SECONDS: "0",
      SCENE_LOG_USAGE: "false",
    });
    researchCache.clear();
    const warnings: unknown[][] = [];
    t.mock.method(console, "warn", (...args: unknown[]) => warnings.push(args));
    t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
      if (init.method === "GET") return fixtureHtml();
      if (String(url).includes("/responses/input_tokens"))
        return Response.json({
          object: "response.input_tokens",
          input_tokens: 100,
        });
      const body = JSON.parse(init.body as string);
      const response = fixtureForRequest(body);
      if (body.text?.format.name === "meanwhile_event_plan") {
        const content = (response.output.at(-1) as any).content[0];
        const plan = JSON.parse(content.text);
        plan.result.events[0].claimIndices = [999];
        content.text = JSON.stringify(plan);
      }
      return Response.json(response);
    });
    const response = await POST(request({ prompt: "Silk Road" }));
    const messages = (await response.text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.equal(messages.length, 1);
    assert.equal(messages[0].type, "error");
    assert.match(messages[0].message, /try again or choose a curated story/);
    assert.doesNotMatch(JSON.stringify(messages), /claimIndices|fixture-key|999/);
    const rejections = warnings.filter(
      ([name]) => name === "meanwhile.scene.rejected",
    );
    assert.equal(rejections.length, environment === "development" ? 2 : 0);
    for (const [, details] of rejections) {
      const record = JSON.parse(details as string);
      assert.ok(record.traceId);
      assert.ok(record.attempt === 1 || record.attempt === 2);
      assert.ok(!("candidate" in record));
      assert.equal(record.stage, "event_plan");
      assert.match(record.reason, /claim/i);
    }
  });

test("explicit OpenAI without credentials fails clearly, while demo buttons still work", async (t) => {
  configure(t, {
    ...process.env,
    SCENE_PROVIDER: "openai",
    OPENAI_API_KEY: "",
    SCENE_MODEL: "bad model",
  });
  const failed = await POST(request({ prompt: "Silk Road" }));
  assert.equal(failed.status, 503);
  const demo = await POST(request({ prompt: "Silk Road", demo: true }));
  const reader = demo.body!.getReader();
  const first = await reader.read();
  assert.match(new TextDecoder().decode(first.value), /"mode":"demo"/);
  await reader.cancel();
});

test("failed date repairs log compilation bounds, rejection attempts and the final failure under one trace", async (t) => {
  configure(t, {
    ...process.env, SCENE_PROVIDER: "openai", OPENAI_API_KEY: "fixture-key",
    SCENE_LOG_DEBUG: "true", SCENE_LOG_USAGE: "false", SCENE_RESEARCH_CACHE_TTL_SECONDS: "0",
  });
  const logs: { event: string; record: any }[] = [];
  for (const level of ["debug", "warn", "error"] as const)
    t.mock.method(console, level, (event: string, details: string) => {
      logs.push({ event, record: JSON.parse(details) });
    });
  t.mock.method(globalThis, "fetch", async (url: string, init: RequestInit) => {
    if (init.method === "GET") return fixtureHtml();
    if (String(url).includes("/responses/input_tokens"))
      return Response.json({ object: "response.input_tokens", input_tokens: 100 });
    const body = JSON.parse(init.body as string);
    if (body.text?.format.name === "meanwhile_repair")
      return Response.json(responseFixture(JSON.stringify({
        result: { status: "corrected", date: null, claimIndices: [0] },
      })));
    const output = fixtureForRequest(body);
    if (body.text?.format.name === "meanwhile_event_plan") {
      const content = (output.output.at(-1) as any).content[0];
      const plan = JSON.parse(content.text);
      plan.result.events[0].date.start.year = 1400;
      plan.result.events[0].date.end.year = 1400;
      content.text = JSON.stringify(plan);
    }
    return Response.json(output);
  });
  const response = await POST(request({ prompt: "Synthetic date repair failure" }));
  const messages = (await response.text()).trim().split("\n").map((line) => JSON.parse(line));
  assert.deepEqual(messages.map((message) => message.type), ["error"]);
  const compilation = logs.find(({ event }) => event === "meanwhile.scene.compilation.failed")!.record;
  assert.equal(compilation.eventIndex, 0);
  assert.equal(compilation.requestedDate.start.year, 1400);
  assert.equal(compilation.selectedClaims[0].id, "c1");
  assert.deepEqual(logs.filter(({ event }) => event === "meanwhile.scene.rejected").map(({ record }) => record.attempt), [1, 2]);
  const failure = logs.find(({ event }) => event === "meanwhile.scene.failed")!.record;
  assert.equal(failure.code, "validation");
  assert.equal(failure.lastRejection.attempt, 2);
  assert.ok(logs.every(({ record }) => record.traceId === response.headers.get("X-Meanwhile-Trace-Id")));
  assert.doesNotMatch(JSON.stringify(logs), /fixture-key/);
});

test("clarification from the live harness remains visible and contains no fabricated focus", async (t) => {
  configure(t, {
    ...process.env,
    SCENE_PROVIDER: "openai",
    OPENAI_API_KEY: "fixture-key",
    SCENE_RESEARCH_CACHE_TTL_SECONDS: "0",
  });
  t.mock.method(
    globalThis,
    "fetch",
    async (_url: string, init: RequestInit) => {
      if (init.method === "GET") return fixtureHtml();
      if (String(_url).includes("/responses/input_tokens"))
        return Response.json({
          object: "response.input_tokens",
          input_tokens: 100,
        });
      const body = JSON.parse(init.body as string);
      const response = fixtureForRequest(body);
      if (!body.tools)
        (response.output.at(-1) as any).content[0].text = JSON.stringify({
          ...(body.text?.format.schema.properties.opening
            ? { opening: null }
            : {}),
          claims: [],
          result: {
            status: "clarification",
            question: "Which event and period do you mean?",
            ...(body.text?.format.name === "meanwhile_checklist"
              ? { reason: "ambiguous", missingEvidence: [] }
              : {}),
          },
        });
      return Response.json(response);
    },
  );
  const response = await POST(request({ prompt: "An ambiguous event" }));
  const message = JSON.parse((await response.text()).trim());
  assert.equal(message.type, "error");
  assert.match(message.message, /Which event and period/);
});

function request(body: unknown, signal?: AbortSignal) {
  return new Request("http://localhost/api/scene", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
}

test("invalid requests are rejected before opening a stream", async () => {
  for (const body of [
    null,
    {},
    { prompt: "ab" },
    { prompt: "x".repeat(501) },
  ]) {
    const response = await POST(request(body));
    assert.equal(response.status, 400);
  }
});

test("the provider boundary forwards the generated schema and validates its output", async (t) => {
  configure(t, {
    ...process.env,
    SCENE_STREAM_URL: "https://example.test/scene",
    SCENE_STREAM_TOKEN: "fixture-token",
  });
  const messages = makeDemo("Trade along the Silk Road").map((message) =>
    message.type === "focus"
      ? {
          ...message,
          mode: "live",
          internalNote: "never forward unknown fields",
        }
      : message,
  );
  let providerBody: Record<string, unknown> | undefined;
  t.mock.method(
    globalThis,
    "fetch",
    async (_url: string, init: RequestInit) => {
      providerBody = JSON.parse(init.body as string);
      assert.equal(
        (init.headers as Record<string, string>).Authorization,
        "Bearer fixture-token",
      );
      return new Response(
        messages.map((message) => JSON.stringify(message)).join("\n"),
      );
    },
  );
  const response = await POST(request({ prompt: "Silk Road" }));
  assert.match(response.headers.get("Content-Type")!, /ndjson/);
  const output = (await response.text())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(output[0].mode, "live");
  assert.equal(output.at(-1).type, "done");
  assert.ok(!("internalNote" in output[0]));
  assert.equal(providerBody?.protocolVersion, 1);
  assert.equal(providerBody?.instructions, sceneInstructions);
  assert.deepEqual(providerBody?.messageSchema, sceneMessageJsonSchema);
  assert.ok(Array.isArray(providerBody?.assets));
});

test("invalid upstream batches never pass through and provider details stay private", async (t) => {
  configure(t, {
    ...process.env,
    SCENE_STREAM_URL: "https://example.test/scene",
  });
  const messages = makeDemo("Trade along the Silk Road");
  t.mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(
        [
          messages[0],
          {
            type: "batch",
            seq: 9,
            readyThrough: 10,
            actions: [
              {
                type: "chapter",
                id: "invalid",
                at: 0,
                title: "Invalid",
                date: "Now",
                caption: "Invalid",
              },
            ],
          },
        ]
          .map((message) => JSON.stringify(message))
          .join("\n"),
      ),
  );
  const response = await POST(request({ prompt: "Silk Road" }));
  const output = (await response.text())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.deepEqual(
    output.map((message) => message.type),
    ["focus", "error"],
  );
  assert.match(output[1].message, /interrupted or contained invalid actions/);
});

test("upstream disconnects and fetch failures produce safe protocol errors", async (t) => {
  configure(t, {
    ...process.env,
    SCENE_STREAM_URL: "https://example.test/scene",
  });
  const upstream = t.mock.method(
    globalThis,
    "fetch",
    async () => new Response(JSON.stringify(makeDemo("Silk Road")[0]) + "\n"),
  );
  let response = await POST(request({ prompt: "Silk Road" }));
  assert.match(await response.text(), /"type":"error"/);
  upstream.mock.mockImplementation(async () => {
    throw new Error("private provider response");
  });
  response = await POST(request({ prompt: "Silk Road" }));
  const output = await response.text();
  assert.match(output, /"type":"error"/);
  assert.ok(!output.includes("private provider response"));
});

test("upstream parsing forwards valid batches before malformed records in the same chunk", async (t) => {
  configure(t, {
    ...process.env,
    SCENE_PROVIDER: "upstream",
    SCENE_STREAM_URL: "https://example.test/scene",
  });
  const messages = makeDemo("Silk Road").slice(0, 2);
  const prefix = new TextEncoder().encode(
    messages.map((m) => JSON.stringify(m)).join("\n") + "\n",
  );
  for (const suffix of [
    new TextEncoder().encode("{broken}\n"),
    new TextEncoder().encode("x".repeat(256_001)),
    new Uint8Array([0xff, 10]),
  ]) {
    const bytes = new Uint8Array(prefix.length + suffix.length);
    bytes.set(prefix);
    bytes.set(suffix, prefix.length);
    t.mock.method(globalThis, "fetch", async () => new Response(bytes));
    const result = await POST(request({ prompt: "Silk Road" }));
    const output = (await result.text())
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line));
    assert.deepEqual(
      output.map((m) => m.type),
      ["focus", "batch", "error"],
    );
    assert.equal(
      output[1].readyThrough,
      messages[1].type === "batch" ? messages[1].readyThrough : 0,
    );
  }
});

test("unsupported demos fail explicitly even when a live provider is configured", async (t) => {
  configure(t, {
    ...process.env,
    SCENE_STREAM_URL: "https://example.test/scene",
  });
  const provider = t.mock.method(globalThis, "fetch", async () => {
    throw new Error("should not be called");
  });
  const response = await POST(request({ prompt: "Ancient Egypt", demo: true }));
  assert.equal(response.status, 422);
  assert.equal(provider.mock.callCount(), 0);
});

test("no configured provider rejects unsupported prompts instead of implying live inference", async (t) => {
  configure(t, { ...process.env, SCENE_STREAM_URL: "" });
  const response = await POST(request({ prompt: "Ancient Egypt" }));
  assert.equal(response.status, 422);
  assert.match((await response.json()).error, /demo includes/);
});

for (const cancelBody of [false, true]) {
  test(
    `server cancellation aborts upstream and closes ${cancelBody ? "a canceled body" : "an aborted request"}`,
    { timeout: 2_000 },
    async (t) => {
      configure(t, {
        ...process.env,
        SCENE_STREAM_URL: "https://example.test/scene",
      });
      let upstreamSignal: AbortSignal | undefined;
      t.mock.method(
        globalThis,
        "fetch",
        async (_url: string, init: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            upstreamSignal = init.signal as AbortSignal;
            const abort = () =>
              reject(new DOMException("Aborted", "AbortError"));
            if (upstreamSignal.aborted) abort();
            else
              upstreamSignal.addEventListener("abort", abort, { once: true });
          }),
      );
      const controller = new AbortController();
      const response = await POST(
        request({ prompt: "Silk Road" }, controller.signal),
      );
      if (cancelBody) await response.body!.cancel();
      else {
        controller.abort();
        assert.equal(await response.text(), "");
      }
      assert.ok(upstreamSignal?.aborted);
    },
  );
}

test("Meanwhile constrains live inference to another place in the supplied period", async (t) => {
  configure(t, {
    ...process.env,
    SCENE_PROVIDER: "openai",
    OPENAI_API_KEY: "fixture-key",
    SCENE_RESEARCH_CACHE_TTL_SECONDS: "0",
    SCENE_LOG_DEBUG: "true",
  });
  const bodies: any[] = [];
  const discoveryChecks: any[] = [];
  t.mock.method(console, "debug", (event: string, details: string) => {
    if (event === "meanwhile.scene.discovery.validated") discoveryChecks.push(JSON.parse(details));
  });
  t.mock.method(
    globalThis,
    "fetch",
    async (_url: string, init: RequestInit) => {
      if (init.method === "GET") return fixtureHtml();
      if (String(_url).includes("/responses/input_tokens"))
        return Response.json({
          object: "response.input_tokens",
          input_tokens: 100,
        });
      const body = JSON.parse(init.body as string);
      bodies.push(body);
      return Response.json(fixtureForRequest(body));
    },
  );
  const discovery = {
    originTitle: "Another story",
    originCenter: { lat: 10, lon: -70 },
    periodLabel: "c. 1300",
    yearRange: { startYear: 1275, endYear: 1325, approximate: true },
    excludedTitles: ["Another story"],
  };
  const response = await POST(
    request({ prompt: "Ignore the period", discovery }),
  );
  const output = (await response.text())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.equal(output.at(-1).type, "done");
  assert.equal(output[0].discoveryFrom.title, discovery.originTitle);
  assert.ok(bodies[0].input.includes("strictly within years 1275 to 1325"));
  const preparation = bodies.filter((body) => ["meanwhile_checklist", "meanwhile_checklist_review"].includes(body.text?.format?.name));
  assert.equal(preparation.length, 2);
  for (const body of preparation) assert.doesNotMatch(body.input, /angular degrees|originCenter|latitude|longitude/);
  assert.equal(discoveryChecks.length, 1);
  assert.ok(discoveryChecks[0].angularDistanceDegrees >= 20);
  assert.equal(discoveryChecks[0].minimumAngularDistanceDegrees, 20);
  const invalid = await POST(
    request({
      prompt: "Meanwhile",
      discovery: {
        ...discovery,
        yearRange: { startYear: 1895, endYear: 1895, approximate: false },
      },
    }),
  );
  const messages = (await invalid.text())
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  assert.deepEqual(
    messages.map((message) => message.type),
    ["error"],
  );
});

test("Meanwhile in demo-only mode fails without replacing the current story", async (t) => {
  configure(t, { ...process.env, SCENE_PROVIDER: "demo" });
  const response = await POST(
    request({
      prompt: "Meanwhile",
      discovery: {
        originTitle: "Origin",
        originCenter: { lat: 10, lon: 100 },
        periodLabel: "1895",
        yearRange: { startYear: 1895, endYear: 1895, approximate: false },
        excludedTitles: [],
      },
    }),
  );
  assert.equal(response.status, 503);
  assert.match((await response.json()).error, /live story service/);
});
