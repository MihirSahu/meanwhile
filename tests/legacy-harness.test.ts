import assert from "node:assert/strict";
import test from "node:test";
import OpenAI from "openai";
import { zodTextFormat } from "openai/helpers/zod";
import { z } from "zod";
import { OpenAISceneProvider } from "../src/lib/server/openai-provider";
import {
  readSceneConfig,
  SceneServiceError,
} from "../src/lib/server/scene-config";
import {
  generateScene,
  generatedBatchSchema,
  openingSchema,
  resolutionSchema,
} from "../src/lib/server/legacy-scene-harness";
import { ResearchCache } from "../src/lib/server/research-cache";
import type {
  ModelUsage,
  ResearchBundle,
  SceneProvider,
} from "../src/lib/server/scene-provider";
import { checklistReviewSchema } from "../src/lib/server/checklist-review";
import { storyChecklistSchema } from "../src/lib/server/story-checklist";
import { evidenceReviewSchema } from "../src/lib/server/evidence-gate";
import { historicalChecklistFixture } from "./fixtures/checklist-regressions";
import type { SourceReader } from "../src/lib/server/source-retrieval";
import { historicalClarification } from "../src/lib/server/historical-intent";
import { SceneBuffer } from "../src/lib/playback";
import {
  fixtureDocument,
  fixturePassage,
  fixtureClaim,
  batchOutput,
  evidenceUrl,
  fixtureForRequest,
  resolution,
  responseFixture,
} from "./fixtures/live-scene";

const signal = () => new AbortController().signal;
const config = (extra: Record<string, string | undefined> = {}) =>
  readSceneConfig({
    SCENE_PROVIDER: "openai",
    OPENAI_API_KEY: "fixture-key",
    ...extra,
  });
const research: ResearchBundle = {
  text: "A sourced historical evidence brief.",
  sources: [{ id: "s1", title: "Fixture evidence", url: evidenceUrl }],
  passages: [fixturePassage],
};

function fixtureProvider(
  options: {
    model?: string;
    document?: typeof fixtureDocument;
    sourceReader?: SourceReader;
    countInput?: (body: Record<string, any>) => number;
    respond?: (
      body: Record<string, any>,
      index: number,
      init: RequestInit,
    ) => unknown | Promise<unknown>;
  } = {},
) {
  const bodies: Record<string, any>[] = [],
    usage: ModelUsage[] = [];
  const settings = config(options.model ? { SCENE_MODEL: options.model } : {});
  const client = new OpenAI({
    apiKey: "fixture-key",
    maxRetries: 0,
    fetch: async (_url, init) => {
      if (String(_url).includes("/responses/input_tokens"))
        return Response.json({
          object: "response.input_tokens",
          input_tokens:
            options.countInput?.(JSON.parse(init!.body as string)) ?? 100,
        });
      const body = JSON.parse(init!.body as string);
      bodies.push(body);
      const result = options.respond
        ? await options.respond(body, bodies.length, init!)
        : fixtureForRequest(body);
      return Response.json(result);
    },
  });
  return {
    provider: new OpenAISceneProvider(
      settings,
      (event) => usage.push(event),
      client,
      options.sourceReader ?? (async () => options.document ?? fixtureDocument),
    ),
    bodies,
    usage,
  };
}

test("provider selection keeps auto/upstream/demo compatibility and Terra defaults", () => {
  assert.equal(readSceneConfig({}).provider, "demo");
  assert.equal(
    readSceneConfig({ OPENAI_API_KEY: "fixture" }).provider,
    "openai",
  );
  assert.equal(
    readSceneConfig({
      OPENAI_API_KEY: "fixture",
      SCENE_STREAM_URL: "https://example.org/scene",
    }).provider,
    "upstream",
  );
  assert.equal(config().model, "gpt-6.1-terra");
  assert.equal(config().effort, "low");
  assert.equal(config({ SCENE_PROVIDER: "demo" }).provider, "demo");
  assert.throws(
    () => readSceneConfig({ SCENE_PROVIDER: "openai" }),
    SceneServiceError,
  );
  for (const extra of [
    { SCENE_REASONING_EFFORT: "invalid" },
    { SCENE_MAX_TOOL_CALLS: "200" },
    { SCENE_MODEL: "bad\nmodel" },
    { SCENE_TIMEOUT_MS: "NaN" },
  ])
    assert.throws(() => config(extra), SceneServiceError);
});

test("Terra emits focus and batches progressively through the production SDK contract", async () => {
  const { provider, bodies, usage } = fixtureProvider();
  const iterator = generateScene("Silk Road", provider, signal(), {
    startupStrategy: "staged",
    cache: new ResearchCache(),
  });
  const first = await iterator.next();
  assert.equal(first.value.type, "focus");
  assert.equal(bodies.length, 5);
  const buffer = new SceneBuffer();
  buffer.ingest(first.value);
  for await (const message of iterator) buffer.ingest(message);
  assert.ok(buffer.complete);
  assert.equal(buffer.readyThrough, 36);
  assert.equal(bodies.length, 11);
  assert.ok(
    bodies.every(
      (body) =>
        body.model === "gpt-6.1-terra" &&
        body.reasoning.effort === "low" &&
        body.store === false,
    ),
  );
  assert.equal(bodies[0].tool_choice, "required");
  assert.equal(bodies[0].max_tool_calls, 2);
  assert.deepEqual(bodies[0].include, ["web_search_call.action.sources"]);
  assert.equal(usage.length, 11);
  assert.equal(usage[0].searchCalls, 1);
  assert.equal(usage[0].cachedInputTokens, 20);
  assert.equal(buffer.focus?.sources[0].url, evidenceUrl);
  assert.ok(
    buffer.actions
      .filter((action) => action.type === "chapter")
      .every((action) => action.sourceIds?.includes("s1")),
  );
});

test("a compatible model is switched entirely by configuration", async () => {
  const { provider, bodies } = fixtureProvider({ model: "gpt-6-luna" });
  for await (const _message of generateScene("Silk Road", provider, signal(), {
    startupStrategy: "staged",
    cache: new ResearchCache(),
  })) {
    /* consume */
  }
  assert.equal(bodies.length, 11);
  assert.ok(bodies.every((body) => body.model === "gpt-6-luna"));
});

test("model-facing JSON schemas have required object fields and strict roots", () => {
  const inspect = (value: any) => {
    if (!value || typeof value !== "object") return;
    if (value.type === "object") {
      assert.equal(value.additionalProperties, false);
      assert.deepEqual(
        [...value.required].sort(),
        Object.keys(value.properties).sort(),
      );
    }
    for (const child of Object.values(value)) {
      if (Array.isArray(child)) child.forEach(inspect);
      else inspect(child);
    }
  };
  for (const schema of [
    storyChecklistSchema,
    checklistReviewSchema,
    evidenceReviewSchema,
    resolutionSchema,
    generatedBatchSchema,
    openingSchema,
  ]) {
    const json = zodTextFormat(schema, "fixture").schema;
    assert.equal(json.type, "object");
    inspect(json);
  }
});

test("evidence cache is bounded, expires and never leaks mutable state", () => {
  let now = 0;
  const cache = new ResearchCache(2, () => now);
  cache.set("one", research, 10);
  cache.get("one")!.sources[0].title = "Changed";
  assert.equal(cache.get("one")!.sources[0].title, "Fixture evidence");
  cache.set("two", research, 10);
  cache.set("three", research, 10);
  assert.equal(cache.get("one"), null);
  now = 10_000;
  assert.equal(cache.get("three"), null);
});

test("repeated prompts reuse research, while model changes isolate the cache", async () => {
  const cache = new ResearchCache();
  for (const [model, expected] of [
    ["gpt-6.1-terra", 11],
    ["gpt-6.1-terra", 10],
    ["gpt-6-luna", 11],
  ] as const) {
    const { provider, bodies } = fixtureProvider({ model });
    for await (const _message of generateScene(
      "Silk Road",
      provider,
      signal(),
      { cache, startupStrategy: "staged" },
    )) {
      /* consume */
    }
    assert.equal(bodies.length, expected);
  }
});

test("uncited research and model-written URLs cannot enter the source registry", async () => {
  const { provider } = fixtureProvider({
    respond: () => responseFixture(`Made-up reference: ${evidenceUrl}`, false),
  });
  await assert.rejects(
    provider.research("Silk Road", signal()),
    /No research sources/,
  );
  const uncited = fixtureProvider({
    respond: () => {
      const value = responseFixture("Research with no citations", true);
      (value.output.at(-1) as any).content[0].annotations = [];
      return value;
    },
  });
  await assert.rejects(
    uncited.provider.research("Silk Road", signal()),
    /citable sources/,
  );
});

test("unknown source references and invalid timelines receive one atomic repair", async () => {
  let badBatch = true;
  const { provider, bodies } = fixtureProvider({
    respond: (body) => {
      if (
        !body.tools &&
        body.text.format.name !== "meanwhile_evidence_review" &&
        body.text.format.schema.properties.actions &&
        badBatch
      ) {
        badBatch = false;
        const invalid = batchOutput(0);
        invalid.actions[0].at = -1;
        return responseFixture(JSON.stringify(invalid));
      }
      return fixtureForRequest(body);
    },
  });
  const messages = [];
  for await (const message of generateScene("Silk Road", provider, signal(), {
    startupStrategy: "staged",
    cache: new ResearchCache(),
  }))
    messages.push(message);
  assert.equal(bodies.length, 12);
  assert.equal(
    messages.filter((message) => message.type === "batch").length,
    3,
  );
  assert.ok(
    bodies.some((body) => body.text?.format.name === "meanwhile_repair"),
  );
});

test("failed batch repair preserves focus and stops without a fabricated done message", async () => {
  const { provider, bodies } = fixtureProvider({
    respond: (body) =>
      body.tools ||
      body.text.format.name === "meanwhile_evidence_review" ||
      body.text.format.name === "meanwhile_checklist_review" ||
      body.text.format.schema.properties.result
        ? fixtureForRequest(body)
        : responseFixture(
            JSON.stringify({
              ...batchOutput(0),
              actions: batchOutput(0).actions.map((a) =>
                a.type === "chapter" ? { ...a, claimIds: ["c99"] } : a,
              ),
            }),
          ),
  });
  const iterator = generateScene("Silk Road", provider, signal(), {
    startupStrategy: "staged",
    cache: new ResearchCache(),
  });
  assert.equal((await iterator.next()).value.type, "focus");
  await assert.rejects(iterator.next(), /did not pass its checks/);
  assert.equal(bodies.length, 7);
});

test("ambiguous events return a visible clarification without committing a scene", async () => {
  const { provider, bodies } = fixtureProvider({
    respond: (body) =>
      body.tools
        ? fixtureForRequest(body)
        : responseFixture(
            JSON.stringify({
              claims: [],
              result: {
                status: "clarification",
                question: "Which Chinese civil war and period do you mean?",
                ...(body.text?.format.name === "meanwhile_checklist"
                  ? { reason: "ambiguous", missingEvidence: [] }
                  : {}),
              },
            }),
          ),
  });
  await assert.rejects(
    generateScene("Chinese civil war", provider, signal(), {
      startupStrategy: "staged",
      cache: new ResearchCache(),
    }).next(),
    /Which Chinese civil war/,
  );
  assert.equal(bodies.length, 2);
});

test("refusals, incomplete outputs and HTTP failures expose safe errors", async () => {
  for (const status of ["incomplete", "failed"]) {
    const { provider } = fixtureProvider({
      respond: () => ({ ...responseFixture("private details"), status }),
    });
    await assert.rejects(
      provider.research("Silk Road", signal()),
      (error: Error) =>
        !error.message.includes("private details") &&
        /budget/.test(error.message),
    );
  }
  const { provider } = fixtureProvider({
    respond: () => {
      const value = responseFixture("Unused");
      value.output = [
        {
          type: "message",
          content: [{ type: "refusal", refusal: "private refusal details" }],
        },
      ] as any;
      return value;
    },
  });
  await assert.rejects(
    provider.generate({
      stage: "focus",
      schema: resolutionSchema,
      instructions: "fixture",
      input: "fixture",
      maxOutputTokens: 3000,
      signal: signal(),
    }),
    /could not be prepared/,
  );
});

test("cancellation interrupts the SDK fetch and never commits queued results", async () => {
  const controller = new AbortController();
  const { provider } = fixtureProvider({
    respond: async (_body, _index, init) =>
      new Promise((_resolve, reject) => {
        init.signal!.addEventListener(
          "abort",
          () => reject(new DOMException("Aborted", "AbortError")),
          { once: true },
        );
        queueMicrotask(() => controller.abort());
      }),
  });
  await assert.rejects(
    generateScene("Silk Road", provider, controller.signal, {
      startupStrategy: "staged",
      cache: new ResearchCache(),
    }).next(),
    { name: "AbortError" },
  );
});

test("SDK HTTP errors do not leak response details or silently change models", async () => {
  let calls = 0;
  const client = new OpenAI({
    apiKey: "fixture-key",
    maxRetries: 0,
    fetch: async () => {
      calls++;
      return Response.json(
        {
          error: {
            message: "private provider details fixture-key",
            code: "model_not_found",
            type: "invalid_request_error",
          },
        },
        { status: 404 },
      );
    },
  });
  const provider = new OpenAISceneProvider(config(), () => {}, client);
  await assert.rejects(
    provider.research("Silk Road", signal()),
    (error: SceneServiceError) =>
      error.code === "model_unavailable" &&
      error.details?.status === 404 &&
      !error.message.includes("fixture-key"),
  );
  assert.equal(calls, 1);
});

test("hard request and output-token limits prevent further billable work", async () => {
  const { provider, bodies } = fixtureProvider({
    respond: () => responseFixture(JSON.stringify({ ok: true })),
  });
  const generate = () =>
    provider.generate({
      stage: "batch",
      schema: z.object({ ok: z.boolean() }),
      instructions: "fixture",
      input: "fixture",
      maxOutputTokens: 1000,
      signal: signal(),
    });
  for (let i = 0; i < 16; i++) await generate();
  await assert.rejects(generate(), /budget/);
  assert.equal(bodies.length, 16);
  const capped = fixtureProvider({
    respond: () => {
      const value = responseFixture(JSON.stringify({ ok: true }));
      value.usage.output_tokens = 36_000;
      return value;
    },
  });
  const request = {
    stage: "batch" as const,
    schema: z.object({ ok: z.boolean() }),
    instructions: "fixture",
    input: "fixture",
    maxOutputTokens: 1000,
    signal: signal(),
  };
  await capped.provider.generate(request);
  await assert.rejects(capped.provider.generate(request), /budget/);
  assert.equal(capped.bodies.length, 1);
});

test("a midstream failure retains earlier committed batches without rewriting them", async () => {
  const { provider, bodies } = fixtureProvider({
    respond: (body) => {
      if (
        !body.tools &&
        body.text.format.name !== "meanwhile_evidence_review" &&
        body.text.format.schema.properties.actions &&
        JSON.parse(body.input).request.interval.start === 12
      )
        return responseFixture(
          JSON.stringify({
            ...batchOutput(1),
            actions: batchOutput(1).actions.map((a) =>
              a.type === "chapter" ? { ...a, claimIds: ["c99"] } : a,
            ),
          }),
        );
      return fixtureForRequest(body);
    },
  });
  const buffer = new SceneBuffer();
  await assert.rejects(async () => {
    for await (const message of generateScene("Silk Road", provider, signal(), {
      startupStrategy: "staged",
      cache: new ResearchCache(),
    }))
      buffer.ingest(message);
  }, /did not pass/);
  assert.equal(buffer.readyThrough, 12);
  assert.ok(!buffer.complete);
  assert.ok(buffer.actions.some((action) => action.type === "spawn"));
  assert.equal(bodies.length, 9);
});

test("combined opening commits focus and the first playable batch from one generation", async () => {
  const { provider, bodies } = fixtureProvider();
  const iterator = generateScene("Silk Road", provider, signal(), {
    cache: new ResearchCache(),
  });
  assert.equal((await iterator.next()).value.type, "focus");
  assert.equal(bodies.length, 5);
  assert.equal((await iterator.next()).value.type, "batch");
  assert.equal(bodies.length, 5);
  const rest = [];
  for await (const message of iterator) rest.push(message);
  assert.equal(rest.at(-1)?.type, "done");
  assert.equal(bodies.length, 9);
});

test("a bad combined opening is repaired before exposing its focus or actions", async () => {
  let bad = true;
  const { provider, bodies } = fixtureProvider({
    respond: (body) => {
      if (body.text?.format.schema.properties.opening && bad) {
        bad = false;
        const opening = batchOutput(0);
        opening.actions[1] = { ...opening.actions[1], asset: "train" } as any;
        return responseFixture(JSON.stringify({ ...resolution, opening }));
      }
      return fixtureForRequest(body);
    },
  });
  const iterator = generateScene("Silk Road", provider, signal(), {
    cache: new ResearchCache(),
  });
  assert.equal((await iterator.next()).value.type, "focus");
  assert.equal(bodies.length, 6);
  assert.match(
    JSON.parse(bodies[4].input).repair.issues,
    /not suitable before/,
  );
  assert.equal((await iterator.next()).value.type, "batch");
  for await (const _ of iterator) {
    /* consume */
  }
});

test("context-free historical requests clarify before any billable work", async () => {
  const { provider, bodies } = fixtureProvider();
  for (const prompt of [
    "Show that battle.",
    "What happened there at that time?",
    "Could you please tell me about the civil war",
    "Show the revolution.",
  ]) {
    await assert.rejects(
      generateScene(prompt, provider, signal()).next(),
      (error: SceneServiceError) => error.code === "clarification",
    );
  }
  assert.equal(bodies.length, 0);
});
test("intent preflight preserves named events, specific dates and requests to choose an example", () => {
  for (const prompt of [
    "Show the Battle of Hastings in 1066",
    "The French Revolution",
    "Show a famous battle",
    "Show the civil war in China",
    "What happened in Paris at that time in 1789?",
    "Show the war in 1815",
    "Tell me about journeys along the Silk Road",
  ])
    assert.equal(historicalClarification(prompt), null, prompt);
});

test("failed evidence review cannot expose focus even after structural validation", async () => {
  const { provider, bodies } = fixtureProvider({
    respond: (body) => {
      if (body.text?.format.name === "meanwhile_evidence_review") {
        const value = fixtureForRequest(body);
        const review = JSON.parse((value.output.at(-1) as any).content[0].text);
        review.chronology = {
          verdict: "revise",
          reason: "The sequence is unsupported.",
        };
        return responseFixture(JSON.stringify(review));
      }
      return fixtureForRequest(body);
    },
  });
  const iterator = generateScene("Silk Road", provider, signal(), {
    cache: new ResearchCache(),
  });
  await assert.rejects(iterator.next(), /did not pass/);
  assert.equal(bodies.length, 7);
});
test("an evidence rejection after the opening preserves the committed interval", async () => {
  const { provider } = fixtureProvider({
    respond: (body) => {
      if (
        body.text?.format.name === "meanwhile_evidence_review" &&
        JSON.parse(body.input).actions.some((a: any) => a.at === 12)
      ) {
        const value = fixtureForRequest(body);
        const review = JSON.parse((value.output.at(-1) as any).content[0].text);
        review.scope = {
          verdict: "revise",
          reason: "Unsupported new details.",
        };
        return responseFixture(JSON.stringify(review));
      }
      return fixtureForRequest(body);
    },
  });
  const buffer = new SceneBuffer();
  await assert.rejects(async () => {
    for await (const message of generateScene("Silk Road", provider, signal(), {
      cache: new ResearchCache(),
    }))
      buffer.ingest(message);
  }, /did not pass/);
  assert.equal(buffer.readyThrough, 12);
  assert.equal(buffer.complete, false);
  assert.equal(buffer.evidenceClaims.length, 1);
});
test("cancellation during evidence review never commits an opening", async () => {
  const controller = new AbortController();
  const { provider } = fixtureProvider({
    respond: (body) => {
      if (body.text?.format.name === "meanwhile_evidence_review")
        controller.abort();
      return fixtureForRequest(body);
    },
  });
  await assert.rejects(
    generateScene("Silk Road", provider, controller.signal, {
      cache: new ResearchCache(),
    }).next(),
    { name: "AbortError" },
  );
});

test("the final batch cannot complete a story with an uncovered outcome", async () => {
  const { provider } = fixtureProvider({
    respond: (body) => {
      if (
        body.text?.format.name === "meanwhile_evidence_review" &&
        JSON.parse(body.input).story.final
      ) {
        const value = fixtureForRequest(body);
        const review = JSON.parse((value.output.at(-1) as any).content[0].text);
        review.coverage = review.coverage.map((c: any) =>
          c.id === "r3"
            ? {
                ...c,
                status: "pending",
                actionIds: [],
                reason: "The ending is absent.",
              }
            : c,
        );
        return responseFixture(JSON.stringify(review));
      }
      return fixtureForRequest(body);
    },
  });
  const buffer = new SceneBuffer();
  await assert.rejects(async () => {
    for await (const message of generateScene("Silk Road", provider, signal(), {
      cache: new ResearchCache(),
    }))
      buffer.ingest(message);
  }, /did not pass/);
  assert.equal(buffer.readyThrough, 24);
  assert.equal(buffer.complete, false);
  assert.equal(
    buffer.actions.some((a) => a.id.startsWith("b2_")),
    false,
  );
});
test("a plan without principal actors is rejected before focus is published", async () => {
  const { provider } = fixtureProvider({
    respond: (body) => {
      if (body.text?.format.schema.properties.opening) {
        const broken = structuredClone(resolution);
        broken.result.requirements = broken.result.requirements.filter(
          (r) => r.kind !== "actors",
        );
        return responseFixture(
          JSON.stringify({ ...broken, opening: batchOutput(0) }),
        );
      }
      return fixtureForRequest(body);
    },
  });
  await assert.rejects(
    generateScene("Silk Road", provider, signal(), {
      cache: new ResearchCache(),
    }).next(),
    /did not pass/,
  );
});

test("independent checklist sees only prompt, fetched passages and capabilities before any scene plan", async () => {
  const { provider, bodies } = fixtureProvider();
  const iterator = generateScene("Silk Road", provider, signal(), {
    cache: new ResearchCache(),
    onChecklist: (record) => {
      if (record.result.status === "ready")
        record.result.requirements[0].description = "Observer mutation";
    },
  });
  assert.equal((await iterator.next()).value.type, "focus");
  assert.deepEqual(
    bodies.slice(0, 5).map((b) => b.text?.format.name ?? "research"),
    [
      "research",
      "meanwhile_checklist",
      "meanwhile_checklist_review",
      "meanwhile_opening",
      "meanwhile_evidence_review",
    ],
  );
  const extraction = JSON.parse(bodies[1].input).request;
  assert.deepEqual(Object.keys(extraction).sort(), [
    "discovery",
    "prompt",
    "renderingCapabilities",
    "research",
  ]);
  assert.equal(extraction.research.text, undefined);
  assert.equal(extraction.checklist, undefined);
  assert.ok(extraction.research.passages.length);
  assert.notEqual(
    JSON.parse(bodies[3].input).request.checklist.requirements[0].description,
    "Observer mutation",
  );
  await iterator.return(undefined);
});

test("Apollo planner cannot remove the independent Hornet recovery requirement", async () => {
  const story = historicalChecklistFixture("apollo");
  const { provider, bodies } = fixtureProvider({
    document: story.document,
    respond: (body) => {
      if (body.text?.format.schema.properties.opening)
        return responseFixture(
          JSON.stringify({
            ...story.planned,
            result: {
              ...story.planned.result,
              requirements: story.planned.result.requirements.filter(
                (r) => r.id !== "r4",
              ),
            },
            opening: story.batch(0),
          }),
        );
      return story.respond(body);
    },
  });
  await assert.rejects(
    generateScene(
      "Apollo 11 Earth preparations and return",
      provider,
      signal(),
      { cache: new ResearchCache() },
    ).next(),
    /did not pass/,
  );
  assert.equal(
    bodies.filter((b) => b.text?.format.name === "meanwhile_checklist").length,
    1,
  );
  assert.equal(
    bodies.filter((b) => b.text?.format.name === "meanwhile_evidence_review")
      .length,
    0,
  );
});

test("Apollo ending cannot commit when independent Pacific splashdown coverage is missing", async () => {
  const story = historicalChecklistFixture("apollo");
  const { provider } = fixtureProvider({
    document: story.document,
    respond: (body) => {
      const response = story.respond(body);
      if (
        body.text?.format.name === "meanwhile_evidence_review" &&
        JSON.parse(body.input).story.final
      ) {
        const review = JSON.parse(
          (response.output.at(-1) as any).content[0].text,
        );
        review.coverage = review.coverage.map((r: any) =>
          r.id === "r3"
            ? {
                ...r,
                status: "pending",
                actionIds: [],
                reason: "Generic return omits the Pacific splashdown.",
              }
            : r,
        );
        return responseFixture(JSON.stringify(review));
      }
      return response;
    },
  });
  const buffer = new SceneBuffer();
  await assert.rejects(async () => {
    for await (const m of generateScene(
      "Apollo 11 Earth preparations and return",
      provider,
      signal(),
      { cache: new ResearchCache() },
    ))
      buffer.ingest(m);
  }, /did not pass/);
  assert.equal(buffer.readyThrough, 24);
  assert.equal(buffer.complete, false);
  assert.equal(
    buffer.actions.some((a) => a.id.startsWith("b2_")),
    false,
  );
});

test("railway same-day sequence rejection preserves earlier chapters despite positive fact and coverage verdicts", async () => {
  const story = historicalChecklistFixture("railway");
  const { provider } = fixtureProvider({
    document: story.document,
    respond: (body) => {
      const response = story.respond(body);
      if (
        body.text?.format.name === "meanwhile_evidence_review" &&
        JSON.parse(body.input).story.final
      ) {
        const review = JSON.parse(
          (response.output.at(-1) as any).content[0].text,
        );
        review.order[0] = {
          ...review.order[0],
          status: "revise",
          reason:
            "The caption puts Huskisson's death before the party continued; it happened later that day.",
        };
        return responseFixture(JSON.stringify(review));
      }
      return response;
    },
  });
  const buffer = new SceneBuffer();
  await assert.rejects(async () => {
    for await (const m of generateScene(
      "Liverpool and Manchester Railway opening 1830",
      provider,
      signal(),
      { cache: new ResearchCache() },
    ))
      buffer.ingest(m);
  }, /did not pass/);
  assert.equal(buffer.readyThrough, 24);
  assert.equal(buffer.complete, false);
  assert.equal(buffer.evidenceClaims.length, 3);
});

test("cancellation during independent extraction prevents all scene planning", async () => {
  const controller = new AbortController();
  const { provider, bodies } = fixtureProvider({
    respond: (body) => {
      if (body.text?.format.name === "meanwhile_checklist") controller.abort();
      return fixtureForRequest(body);
    },
  });
  await assert.rejects(
    generateScene("Silk Road", provider, controller.signal, {
      cache: new ResearchCache(),
    }).next(),
    { name: "AbortError" },
  );
  assert.equal(bodies.length, 2);
});

test("a rejected checklist is repaired from source evidence before any scene plan exists", async () => {
  const story = historicalChecklistFixture("railway");
  let extractions = 0,
    reviews = 0;
  const { provider, bodies } = fixtureProvider({
    document: story.document,
    respond: (body) => {
      if (
        body.text?.format.name === "meanwhile_checklist" &&
        extractions++ === 0
      ) {
        const bad = structuredClone(story.checklist);
        bad.result.requirements[2].description = "Show a subdued reception.";
        return responseFixture(JSON.stringify(bad));
      }
      if (
        body.text?.format.name === "meanwhile_checklist_review" &&
        reviews++ === 0
      ) {
        const response = fixtureForRequest(body);
        const review = JSON.parse(
          (response.output.at(-1) as any).content[0].text,
        );
        review.requirements[2] = {
          ...review.requirements[2],
          verdict: "revise",
          reason: "The passages do not establish a subdued reception.",
        };
        return responseFixture(JSON.stringify(review));
      }
      return story.respond(body);
    },
  });
  const buffer = new SceneBuffer();
  for await (const m of generateScene(
    "Liverpool and Manchester Railway opening",
    provider,
    signal(),
    { cache: new ResearchCache() },
  ))
    buffer.ingest(m);
  assert.ok(buffer.complete);
  assert.equal(bodies.length, 11);
  assert.deepEqual(
    bodies.slice(0, 6).map((b) => b.text?.format.name ?? "research"),
    [
      "research",
      "meanwhile_checklist",
      "meanwhile_checklist_review",
      "meanwhile_checklist",
      "meanwhile_checklist_review",
      "meanwhile_opening",
    ],
  );
  assert.equal(JSON.parse(bodies[3].input).request.checklist, undefined);
  assert.ok(
    !JSON.stringify(JSON.parse(bodies[5].input).request.checklist).includes(
      "subdued reception",
    ),
  );
});

test("scene planning cannot redefine a frozen claim before publication", async () => {
  const { provider } = fixtureProvider({
    respond: (body) => {
      if (body.text?.format.schema.properties.opening)
        return responseFixture(
          JSON.stringify({
            ...resolution,
            claims: [
              { ...fixtureClaim, text: "A changed historical assertion." },
            ],
            opening: batchOutput(0),
          }),
        );
      return fixtureForRequest(body);
    },
  });
  await assert.rejects(
    generateScene("Silk Road", provider, signal(), {
      cache: new ResearchCache(),
    }).next(),
    /did not pass/,
  );
});

test("an incomplete uncommitted chapter summary can be repaired without changing the frozen checklist", async () => {
  let bad = true;
  const { provider, bodies } = fixtureProvider({
    respond: (body) => {
      if (body.text?.format.schema.properties.opening && bad) {
        bad = false;
        const broken = structuredClone(resolution);
        broken.result.chapters[2].summary = "An incomplete f";
        return responseFixture(
          JSON.stringify({ ...broken, opening: batchOutput(0) }),
        );
      }
      const response = fixtureForRequest(body);
      if (
        body.text?.format.name === "meanwhile_evidence_review" &&
        JSON.parse(body.input).chapterOutlines.chapters[2].summary ===
          "An incomplete f"
      ) {
        const review = JSON.parse(
          (response.output.at(-1) as any).content[0].text,
        );
        review.metadata = {
          verdict: "revise",
          reason: "Complete the unfinished chapter summary.",
        };
        return responseFixture(JSON.stringify(review));
      }
      if (body.text?.format.name === "meanwhile_repair")
        assert.match(
          JSON.parse(body.input).repair.instruction,
          /chapter outlines, summaries/,
        );
      return response;
    },
  });
  const buffer = new SceneBuffer();
  for await (const message of generateScene("Silk Road", provider, signal(), {
    cache: new ResearchCache(),
  }))
    buffer.ingest(message);
  assert.ok(buffer.complete);
  assert.equal(bodies.length, 11);
});

test("one targeted lookup fills an evidence gap before a fresh checklist freezes", async () => {
  let first = true,
    reads = 0;
  const recoveries: any[] = [];
  const { provider, bodies } = fixtureProvider({
    sourceReader: async () => {
      reads++;
      return reads === 1
        ? fixtureDocument
        : {
            ...fixtureDocument,
            text:
              fixtureDocument.text +
              " Additional essential preparation evidence from a targeted lookup.",
            documentHash: "b".repeat(64),
          };
    },
    respond: (body) => {
      if (body.text?.format.name === "meanwhile_checklist" && first) {
        first = false;
        return responseFixture(
          JSON.stringify({
            claims: [],
            result: {
              status: "clarification",
              reason: "missing_evidence",
              missingEvidence: ["Which preparations preceded this event?"],
              question: "The passages omit preparations.",
            },
          }),
        );
      }
      return fixtureForRequest(body);
    },
  });
  const buffer = new SceneBuffer();
  for await (const m of generateScene("Silk Road", provider, signal(), {
    cache: new ResearchCache(),
    onRecovery: (r) => recoveries.push(r),
  }))
    buffer.ingest(m);
  assert.ok(buffer.complete);
  assert.equal(bodies.filter((b) => b.tools).length, 2);
  assert.equal(
    bodies.find((b) => b.tools && b.max_tool_calls === 1)!.max_tool_calls,
    1,
  );
  assert.equal(
    bodies.filter((b) => b.text?.format.name === "meanwhile_checklist").length,
    2,
  );
  assert.equal(bodies.length, 11);
  assert.equal(recoveries[0].outcome, "recovered");
  assert.equal(
    buffer.focus!.evidence!.passages[0].documentHash,
    "b".repeat(64),
  );
});
test("missing evidence after the single recovery clarifies without looping or publishing", async () => {
  let reads = 0;
  const { provider, bodies } = fixtureProvider({
    sourceReader: async () => ({
      ...fixtureDocument,
      documentHash: (++reads === 1 ? "a" : "b").repeat(64),
    }),
    respond: (body) =>
      body.text?.format.name === "meanwhile_checklist"
        ? responseFixture(
            JSON.stringify({
              claims: [],
              result: {
                status: "clarification",
                reason: "missing_evidence",
                missingEvidence: ["What is the actual event order?"],
                question: "Essential event order is absent from the excerpts.",
              },
            }),
          )
        : fixtureForRequest(body),
  });
  await assert.rejects(
    generateScene("Silk Road", provider, signal(), {
      cache: new ResearchCache(),
    }).next(),
    /Essential event order/,
  );
  assert.equal(bodies.filter((b) => b.tools).length, 2);
  assert.equal(bodies.length, 4);
});
test("missing-evidence source review can recover before freezing instead of consuming a scene repair", async () => {
  let reviews = 0,
    reads = 0;
  const { provider, bodies } = fixtureProvider({
    sourceReader: async () => ({
      ...fixtureDocument,
      documentHash: (++reads === 1 ? "a" : "b").repeat(64),
    }),
    respond: (body) => {
      const response = fixtureForRequest(body);
      if (
        body.text?.format.name === "meanwhile_checklist_review" &&
        reviews++ === 0
      ) {
        const review = JSON.parse(
          (response.output.at(-1) as any).content[0].text,
        );
        review.scope = {
          verdict: "revise",
          reason: "Essential context evidence is absent.",
        };
        review.missingEvidence = ["What sourced purpose explains this event?"];
        return responseFixture(JSON.stringify(review));
      }
      return response;
    },
  });
  const buffer = new SceneBuffer();
  for await (const m of generateScene("Silk Road", provider, signal(), {
    cache: new ResearchCache(),
  }))
    buffer.ingest(m);
  assert.ok(buffer.complete);
  assert.equal(bodies.filter((b) => b.tools).length, 2);
  assert.equal(bodies.length, 12);
});
test("exact token counting rejects an oversized request before a billable generation", async () => {
  const { provider, bodies } = fixtureProvider({ countInput: () => 24001 });
  await assert.rejects(
    provider.generate({
      stage: "batch",
      schema: z.object({ ok: z.boolean() }),
      input: "fixture",
      instructions: "fixture",
      maxOutputTokens: 1000,
      signal: signal(),
    }),
    /too large/,
  );
  assert.equal(bodies.length, 0);
});

test("recovery is skipped before search when it would consume reserved completion calls", async () => {
  const recoveries: any[] = [];
  const { provider, bodies } = fixtureProvider({
    respond: (body) => {
      if (body.text?.format.schema.properties.ok)
        return responseFixture(JSON.stringify({ ok: true }));
      if (body.text?.format.name === "meanwhile_checklist")
        return responseFixture(
          JSON.stringify({
            claims: [],
            result: {
              status: "clarification",
              reason: "missing_evidence",
              missingEvidence: ["What is the event outcome?"],
              question: "The event outcome is missing from the excerpts.",
            },
          }),
        );
      return fixtureForRequest(body);
    },
  });
  for (let i = 0; i < 7; i++)
    await provider.generate({
      stage: "batch",
      schema: z.object({ ok: z.boolean() }),
      input: "fixture",
      instructions: "fixture",
      maxOutputTokens: 1000,
      signal: signal(),
    });
  await assert.rejects(
    generateScene("Silk Road", provider, signal(), {
      cache: new ResearchCache(),
      onRecovery: (r) => recoveries.push(r),
    }).next(),
    /outcome is missing/,
  );
  assert.equal(recoveries[0].outcome, "budget");
  assert.equal(bodies.filter((b) => b.tools).length, 1);
});

test("two generation/review repairs still leave the final review reserved and complete in thirteen calls", async () => {
  let openingRejected = false,
    middleRejected = false;
  const { provider, bodies, usage } = fixtureProvider({
    respond: (body) => {
      const response = fixtureForRequest(body);
      if (body.text?.format.name === "meanwhile_evidence_review") {
        const input = JSON.parse(body.input),
          review = JSON.parse((response.output.at(-1) as any).content[0].text);
        if (input.story.chapter === 0 && !openingRejected) {
          openingRejected = true;
          review.metadata = {
            verdict: "revise",
            reason: "Correct the uncommitted outline.",
          };
          return responseFixture(JSON.stringify(review));
        }
        if (input.story.chapter === 1 && !middleRejected) {
          middleRejected = true;
          review.scope = {
            verdict: "revise",
            reason: "Correct the uncommitted narration.",
          };
          return responseFixture(JSON.stringify(review));
        }
      }
      return response;
    },
  });
  const buffer = new SceneBuffer();
  for await (const m of generateScene("Silk Road", provider, signal(), {
    cache: new ResearchCache(),
  }))
    buffer.ingest(m);
  assert.ok(buffer.complete);
  assert.equal(bodies.length, 13);
  assert.deepEqual(
    usage.map((u) => u.budget!.reserved.calls),
    [8, 7, 6, 5, 4, 5, 4, 3, 2, 3, 2, 1, 0],
  );
  assert.ok(
    usage.every((u) => u.budget!.used.calls + u.budget!.reserved.calls <= 16),
  );
});
