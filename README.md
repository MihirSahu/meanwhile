# Meanwhile

A Next.js prototype for prompt-driven historical scenes on an interactive 3D globe.

Stack: React Three Fiber, Three.js, GSAP, Three.js AnimationMixer, and Zod.

## Status

The prototype includes an interactive globe, two curated stories, a live OpenAI research-and-scene harness, progressive NDJSON streaming, cancelable prompts, inline source citations, object inspection, historical “Meanwhile…” discovery with Back, and pause/speed/seek/replay controls. Camera framing follows scene geography, nearby miniatures are spaced with anchor tethers, and labels prioritize the current speaker and selected objects. The interface supports mobile layouts, keyboard globe controls, reduced motion, and a text/playback fallback when WebGL is unavailable. See [PLAN.md](PLAN.md) for remaining asset-library and product milestones.

## Development commands

Use Node.js 20.18.1 or later (verified here with Node 24.22.1). Dependencies and the generated globe data were moved with the source. For a fresh checkout:

```sh
npm ci
```

Start the application:

```sh
npm run dev
```

Available checks:

```sh
npm run typecheck
npm run build
```

Run the streaming, playback, and API contract tests:

```sh
npm test
```

Browser checks use a production build and launch their own local server on port 3100:

```sh
npx playwright install chromium
npm run build
npm run test:browser
```

They cover desktop and mobile playback, reduced motion, prompt replacement, interrupted streams, object inspection, label visibility on rewind, and WebGL fallback. Screenshots and failure traces are written to the ignored `test-results/` directory. Software WebGL is enabled for headless Chromium; real-device performance still needs measurement.

To regenerate `public/globe-land.json`:

```sh
npm run generate:globe
```

The coastline geometry comes from Natural Earth via the ISC-licensed `world-atlas` package. It is bundled locally and requires no mapping API.

## Scene generation

With no provider configured, `/api/scene` streams explicitly labeled curated demonstrations for the First Sino-Japanese War and the Silk Road. Demo buttons always use those stories, including when live inference is configured. All scenes use schematic positions and routes.

An optional `SCENE_STREAM_URL` can connect an upstream NDJSON scene service, authenticated with `SCENE_STREAM_TOKEN` if needed. See `.env.example` and [the scene protocol](docs/scene-protocol.md). The adapter forwards a JSON Schema and constrained instructions generated from the scene schema and asset registry.

The live integration uses OpenAI `gpt-6.1-terra` through the official SDK and a small custom TypeScript harness. Configure server-only `OPENAI_API_KEY`, `SCENE_MODEL`, and `SCENE_REASONING_EFFORT` in the environment or ignored `.env.local`, then restart. Changing a compatible model requires configuration and verification; the globe and playback code stay the same. `SCENE_PROVIDER=auto` prefers an upstream URL, then OpenAI when a key exists, then demos; use `SCENE_PROVIDER=openai` to select OpenAI explicitly.

The harness researches sources and independently extracts and reviews a frozen checklist. A structured event plan selects those claims; a server compiler assigns dates, citations, action IDs, chapter placement and readable timing. A separate review checks the whole compiled story before the server streams a focus and three scene batches. A normal request uses five model calls; no partial opening publishes before that review. It has bounded repairs, cancellation, evidence caching and optional usage logs. Supporting passages are available beside the story context. See [.env.example](.env.example), [live inference](docs/live-inference.md), and [the scene protocol](docs/scene-protocol.md) for configuration, limits, model switching, and source handling.

`npm run test:live` runs an intentional paid smoke test with the configured model, saves its committed scene and usage to ignored `artifacts/live/`, and bypasses research caching. Ordinary unit/browser checks use mocked model responses and never require an API key.

`npm run eval:live -- --dry-run` inspects the 20-case evaluation without API calls. `npm run eval:live` runs the paid cold/warm and paired-startup benchmark with source review and an HTML report. See [live inference](docs/live-inference.md) and [evaluation results](docs/evaluation-results.md). `npm run test:live -- --meanwhile` checks discovery using a real provider.

The five-story, 15-fact [reference set](evals/reference-stories.json) is agent source-checked with human review pending. `npm run eval:references` validates it offline. See [evidence reliability](docs/evidence-reliability.md) for claim mappings, pre-commit review, retrieval limits and human-review requirements.

Story plans now carry sourced context, actor and outcome requirements. Reviews track actual rendered coverage, require all concepts before completion, and check narration dates against the visible chapter heading. See [story completeness](docs/story-completeness.md) and [its evaluation results](docs/story-completeness-results.md).

The [independent checklist](docs/independent-checklist.md) prevents the scene planner from removing essential sourced concepts and adds explicit temporal-order review, including same-day sequences. [Results](docs/independent-checklist-results.md) record the five reference cases and the added preparation cost and latency.

[Completion reservations and evidence recovery](docs/completion-budget.md) protect the ending’s generation/review capacity and allow one targeted source lookup before the checklist freezes. [Results](docs/completion-budget-results.md) record completion, recovery, historical audits and cost under the revised limits.

[Structured event compilation](docs/event-compiler.md) moves scene bookkeeping to the server and reviews actual rendered text against frozen requirements. The retained staged harness is an explicit evaluation baseline. [Reference results](docs/event-compiler-results.md) keep completion, source audits and historical limitations separate.

[Evidence binding and review calibration](docs/evidence-review.md) lets an event combine complementary frozen claims and gives the reviewer server-verified structural facts. [Results](docs/evidence-review-results.md) retain saved-failure replays and a separate live reference cohort.

[Scene reliability and browser readiness](docs/scene-reliability.md) adds required checklist slots, explicit main-site focus, visible relationship/qualification notes and text-only non-Earth facts. See [results](docs/scene-reliability-results.md). Application servers are started only on request; test servers are stopped after verification.

[Review fixes](docs/review-fixes.md) cover scoped relationship-date references, feasible interval ordering, BCE/CE parsing and preserving the current scene until a replacement has a playable batch.
