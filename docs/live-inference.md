# Live inference

Meanwhile's live harness uses the official OpenAI Node SDK and Responses API, with `gpt-6.1-terra` and `low` reasoning effort by default. The browser receives the same validated NDJSON used by curated demos and upstream services. Model selection never enters scene rendering or playback code.

## Configure the server

Set these in the server environment or the ignored `.env.local` file. See [.env.example](../.env.example) for all settings. Restart the application after changing them.

| Setting                            | Default         | Behavior                                                                                                          |
| ---------------------------------- | --------------- | ----------------------------------------------------------------------------------------------------------------- |
| `SCENE_PROVIDER`                   | `auto`          | `auto`, `demo`, `openai`, or `upstream`. Auto prefers an upstream URL, then OpenAI when a key exists, then demos. |
| `OPENAI_API_KEY`                   | unset           | Server-only OpenAI credential. Required for explicit OpenAI mode.                                                 |
| `SCENE_MODEL`                      | `gpt-6.1-terra` | Exact model ID used for research, checklist, event planning/review, and any repair.                                         |
| `SCENE_REASONING_EFFORT`           | `low`           | `none`, `low`, `medium`, `high`, `xhigh`, or `max`; the selected model must support the chosen value.             |
| `SCENE_TIMEOUT_MS`                 | `180000`        | Overall OpenAI request deadline, including all stages; range 1,000–230,000 ms.                                    |
| `SCENE_MAX_TOOL_CALLS`             | `2`             | Maximum built-in tool calls during the research response; range 1–4.                                              |
| `SCENE_RESEARCH_CACHE_TTL_SECONDS` | `900`           | Research-cache lifetime, up to 3,600 seconds; `0` disables reads and writes.                                      |
| `SCENE_LOG_USAGE`                  | `false`         | Emit a JSON server log with model, effort, outcome, timings, response IDs, token usage and tool-call counts.      |
| `SCENE_STREAM_URL`                 | unset           | Existing upstream NDJSON service; retains precedence in auto mode.                                                |
| `SCENE_STREAM_TOKEN`               | unset           | Optional server-only upstream bearer token.                                                                       |

For example, to select the direct integration explicitly:

```dotenv
SCENE_PROVIDER=openai
SCENE_MODEL=gpt-6.1-terra
SCENE_REASONING_EFFORT=low
```

Supply `OPENAI_API_KEY` through the environment's credential mechanism. Never use a `NEXT_PUBLIC_` variable for credentials. Demo buttons always request curated stories, including when a provider is unavailable or misconfigured. Explicit OpenAI mode without credentials returns a readable HTTP 503. It does not silently select a demonstration or another model.

## Harness behavior

The provider boundary is [SceneProvider](../src/lib/server/scene-provider.ts). [OpenAISceneProvider](../src/lib/server/openai-provider.ts) implements retrieval and typed generation. [generateScene](../src/lib/server/scene-harness.ts) owns the application workflow and committed event log.

A conservative local check clarifies context-free requests such as “that battle” or “there at that time” before retrieval. Named events, explicit dates and requests to choose an example continue to research; the model handles other ambiguity.

1. Hosted search discovers cited URLs and additional actual search-result candidates, bounded to eight registered pages; the server fetches verbatim passages with offsets, timestamps and document hashes. Search summaries are not claim evidence.
2. Extraction requires context, actors and outcome slots; the server assigns canonical requirement IDs/kinds, then independent source review checks them before freezing. The default path leaves claim-level temporal relations empty; relations are established after composite claims have been split into event records. Initial excerpts balance origins, leadership, developments and outcomes. Up to two focused document rereads and two targeted searches for distinct gaps may fill missing evidence; a fresh provider can refetch registered cached-source URLs when needed. Lookup questions remain explicit coverage guidance on extraction/review restarts. Source-reviewed research, including recovery receipts, is cached.
3. A strict event-plan call supplies 3–18 occurrences/states, each selecting a minimal set of frozen claims by array indices and providing a date interval, location, participants, statement and template. It also supplies the story scope separately from the selected mapped camera anchor, qualifications for contested claims and sourced relations that become visible named notes. A narration template supports text-only non-Earth facts without map markers. The planner cannot write low-level action IDs, timestamps, citation mappings or chapter numbers. Reusing a claim for separate occurrences is allowed.
4. The server validates dates and event relations, sorts events using calendar order and sourced before relations, assigns three balanced chronological chapters and compiles prepared markers, people, narration and despawns. Dates are displayed in narration. Timing follows text length, with each chapter at least 12 seconds; duration is no longer fixed at 36 seconds. Static templates do not invent attack or travel paths.
5. A separate review checks the entire compiled text, metadata, dates, atomicity, event relations and every frozen requirement. Reviews identify event/requirement indices, not action IDs. The server derives candidate proof links from selected claims; those links alone do not establish semantic coverage. A normal request uses five model calls: research, checklist, checklist review, event plan, event review.
6. Only an approved complete scene publishes focus, three batches and `done`. Inference and full review finish before the first playable batch; NDJSON remains the transport. A failed review exposes no partial opening. The default workflow permits two checklist repairs and two event repairs, plus one capacity replan that retains the latest semantic feedback and the unchanged checklist. Capacity problems do not trigger evidence research. Cancellation is checked before every message. The explicit staged evaluation strategy retains the previous action-writing harness with one total repair; it is never an automatic fallback.

Checklist repairs receive the full source-review verdicts, the server-assigned requirement mapping, and earlier rejection reasons. The reviewer also receives previous candidates and verdicts, with instructions to explain corrections to earlier mistaken objections rather than silently reverse the requested wording. Prior reviews are context, never source evidence. A targeted lookup rebuilds receipt IDs and clears old review history before extraction restarts. The repair instructions distinguish an unfrozen checklist from immutable published claims, favor minimal corrections to unsupported wording and dates, and require a fresh review of the entire candidate. A third rejected checklist stops generation. These changes do not override reviewers or establish historical accuracy. The current harness is `discovery-evidence-v1`: up to eighteen compact facts let dated and undated assertions be split, recognized dates with null year bounds are rejected before freezing, and the planner receives explicit date-capable claim indices. [Timing corrections](event-compiler.md) preserve occurrence text, kind and actors. Missing dates use the same constrained correction path; an initially undated outcome may instead add a sourced after anchor. The compiler preserves the proposed sequence for overlapping/coarse dates and labels undated aftermath separately, rather than automatically placing all context first. Earlier completions are recorded in [custom-prompt verification](custom-prompt-verification.md); the later broad-topic failures, fixes and fresh/cached app checks are recorded in [world-war recovery](world-war-recovery.md).

One approved live verification on 2026-11-07 used `checklist-repair-v1` for the Hungarian Revolution of 1848–1849. It failed after three checklist reviews and published no scene. The second review required a conflicting-date caveat for Kossuth’s election, while the third rejected that caveat as unsupported. This exposed review inconsistency beyond the original prompt ambiguity. The subsequent v2 history/context changes are verified offline only; the failed live result is retained locally in `artifacts/live/evidence.json` and `summary.json`. No historical-quality improvement is claimed from that run.

See [structured event compilation](event-compiler.md) for the compiler contract and [reference results](event-compiler-results.md) for quality measurements.

See [evidence reliability](evidence-reliability.md) for receipts, pre-commit review, source-reader limits, the five-story reference set and the distinction between model and human review.

The model-facing schemas use strict object roots and required fields, separately from the more flexible browser protocol. The server owns focus mode, source URLs, batch sequence, readiness boundaries and final duration. Requests from the browser cannot override model, effort, credentials or budgets.

Live narration and chapter captions must reference source IDs. These appear as clickable numbered citations beside the text. Invented perspectives remain explicitly labeled. The default live compiler emits narration only; documented quotations require a future verbatim-evidence mechanism and are excluded from its model-facing schema. The broader scene protocol still supports sourced quotes from other adapters.

Source binding establishes provenance; it does not independently prove every historical claim. The evaluation below independently retrieves supporting pages and applies a model-assisted rubric. Human review is still needed for historical accuracy. The generator is instructed to omit unsupported details and use static markers when a source cannot establish an actual route; a schematic disclaimer does not justify a misleading sequence.

## Limits, caching and cancellation

The direct provider allows at most 16 model calls, 288,000 observed cumulative input tokens and 36,000 cumulative output tokens including reasoning. Before generation it counts input with the official endpoint and reserves full input/output/call allowances for remaining mandatory stages; optional repairs or evidence recovery must fit outside those reservations. The default workflow allows two checklist repairs, two event repairs and one capacity replan within these overall limits; the staged evaluation baseline allows one shared repair. Each model call has its own smaller output cap. Generation requests are limited to 24,000 counted input tokens; research reserves 32,000 input tokens because hosted tool results arrive after counting. An independently audited scene can use a larger 48,000-token review request. Counter failure stops the request; there is no character-based fallback. Counting requests are separate HTTP requests and do not generate scene content. SDK transport retries are disabled. Hosted search has the configured tool-call cap. These are work limits rather than a dollar-denominated spending limit.

Research briefs, fetched passages and source-access checks are cached in memory for at most 32 entries, with LRU eviction and expiry. Cache identity includes the provider, credential fingerprint, model, effort, tool-call budget and normalized prompt. Only source-reviewed preparation is cached. A missing-coverage finding evicts the weak entry; successfully recovered preparation can replace it. Failed, canceled and in-flight research is not cached or shared. Entries are process-local, so deployments with multiple workers may research the same question separately. Generated scenes themselves are not cached; replay uses the browser's retained event log.

A replacement prompt, Stop, disconnect or deadline aborts the active SDK request and prevents stale commits. The default compiles and reviews before focus, so model failures publish no partial story. Interruptions during transport preserve any committed batch. Provider response bodies and credentials are never sent to the browser. Exhausted source recovery produces a service error; its specific research question remains in terminal diagnostics rather than asking visitors for sources. The upstream adapter retains its 55-second timeout; OpenAI uses the configured longer deadline. The Next.js route allows up to 240 seconds, subject to the deployment platform's own limits.

## Switching models or providers

Set `SCENE_MODEL` and a compatible `SCENE_REASONING_EFFORT`, restart the server, and run the checks below. There is no automatic model substitution on failure. A compatible OpenAI model needs no rendering or protocol changes. Tests demonstrate that changing only server configuration sends all SDK requests to the replacement model while producing the same valid scene contract.

Another provider needs a `SceneProvider` implementation and provider selection wiring, or can implement the existing upstream NDJSON endpoint. It must supply research provenance, typed output, cancellation and usage reporting while preserving the browser protocol. Quality, tool availability, effort settings, token accounting and latency still need verification for each model.

## Verification

```sh
npm test
npm run typecheck
npm run build
npm run test:browser
```

These checks use mocked model responses and do not invoke paid inference. Browser tests explicitly select demo mode and mock their generated-story fixture. Contract tests use the real SDK with an injected HTTP transport, including configuration-only model switching, strict schemas, source references, retries, cancellation, usage limits, safe errors, caching and partial-stream recovery.

For an intentional paid smoke test using the configured model and credential:

```sh
sfw pnpm test:live
# Or pass a specific historical prompt:
sfw pnpm test:live "Trade along the Silk Road around 1300"
```

The live test bypasses the research cache and saves committed NDJSON and timings/usage under the ignored `artifacts/live/` directory. It does not print credentials, raw provider errors or research text.

## Historical discovery

Discovery research selects an event using the period, excluded titles and geographic separation. Checklist extraction and historical source review receive a separate history-only task, without the original center or angular-distance requirement. Sources still need to establish the event's geographic setting; an honest country/region context anchor does not establish an unsupported exact venue.

The server calculates separation from the mapped coordinates and enforces the twenty-degree minimum, period bounds and excluded titles. Its validation receipt goes to whole-scene review, and `meanwhile.scene.discovery.validated` logs the computed separation. Neither source review nor recovery should ask a historical page to prove coordinate arithmetic. The receipt certifies the calculation, while source review must still reject an invented or unrelated mapped place.

The story card offers **Meanwhile…** when the current chapter has a usable historical range. Discovery currently works at year granularity; its UI names the enforced year range rather than implying month/day precision. The browser sends `discovery` with the origin title/center, current chapter period and signed year range, and recently visited titles. The server constructs the discovery prompt itself. A returned event must fit wholly within that range, differ from recent titles, and have a center at least 20 angular degrees away. Approximate dates retain an explicit range; old demos use a conservative display-date fallback, and undated scenes offer no discovery action.

The current story pauses and stays visible during research. A valid new focus adopts the discovered scene. Back restores the retained event log, prompt, playback position and pause state without inference; up to six earlier scenes are retained locally. A failed or canceled search before focus preserves the original scene. Discovery needs a live provider; it never substitutes an unrelated demo. Upstream discovery responses must supply `yearRange` on focus and every chapter.

Run one intentional live discovery check:

```sh
sfw pnpm test:live --meanwhile
```

It uses the curated war story's 1895 chapter as origin and saves artifacts under ignored `artifacts/live-meanwhile/`.

## Repeatable evaluation

[The 20-case suite](../evals/history-cases.json) covers wars, trade, exploration, industry, revolutions, BCE uncertainty, quotation requests, comparisons, a false premise and four ambiguous prompts. Reference URLs are review leads, not mandatory citations. Automated expectations check outcome, historical range and the committed scene contract.

```sh
# Inspect configuration, cases and rate card without inference:
sfw pnpm eval:live --dry-run
# Small paid pilot:
sfw pnpm eval:live --limit 1 --baseline-limit 1 --concurrency 1
# Full paid evaluation:
sfw pnpm eval:live
```

By default each case gets a cold and warm application-research-cache run of the default strategy (the `opening` CLI alias). Five cases also get paired runs of the previous staged strategy, alternating order. Two case workers run concurrently. Complete cold default scenes receive a separate retrieval and source/chronology/coverage/uncertainty/staging review. A pass requires deterministic checks, supported claims, a passing rubric and at least one original source also cited by independent retrieval. Inaccessible pages and missing reviews are reported honestly. This is model-assisted assessment, not human certification.

The report saves per-run NDJSON, research/passages, usage, accepted/rejected gate candidates, reference coverage and independent review evidence and an interactive HTML summary under ignored `artifacts/evaluations/<timestamp>/`. It reports p50/p95 focus/playable times, outcome counts, cached-token usage, generation/review cost estimates, and cost per reviewed accepted cold story including failed cold attempts. Warm outputs are contract-checked but are not independently source-reviewed. Provider prompt caching can occur even on a cold application-cache run. Paired samples are small and results are directional.

`--resume` continues an existing `--out` report with the same case list/model/effort/rate card and skips saved attempts. A missing warm cache can be restored from its saved cold research for this benchmark; production caching never reads evaluation artifacts. Interrupted requests may have charges missing from saved usage.

`--cold-only` runs each case once without the warm attempt. Five source-checked reference stories now enter the independent review; all retain pending human review. `--resume` also requires the same harness version, reference digest and cold-only setting, preventing accidental reuse of older results.

`--case id,id`, `--limit`, `--baseline-limit`, `--concurrency` (1–3), `--out`, `--no-review` and `--max-usd` control a run. The default $8 estimate threshold stops scheduling and aborts in-flight work when reported usage crosses it. It is a soft threshold, not an exact billing cap: in-flight or failed requests can incur unreported charges. SDK request/token/time limits still apply. Terra standard estimates use $1/M input, $0.05/M cached input, $5/M output, and $0.01/search call, checked 2026-10-30; cache-write surcharges, taxes and hosting are excluded. Other models require all four explicit rate variables: `EVAL_INPUT_USD_PER_MTOK`, `EVAL_CACHED_INPUT_USD_PER_MTOK`, `EVAL_OUTPUT_USD_PER_MTOK`, `EVAL_SEARCH_USD_PER_CALL`.

See [evaluation results](evaluation-results.md) for the saved measurements and known issues from this implementation.

## Official references

- [API pricing and search charges](https://developers.openai.com/api/docs/pricing)
- [GPT-6.1 Terra capabilities](https://developers.openai.com/api/docs/models/gpt-6.1-terra)
- [Responses API web search and citation metadata](https://developers.openai.com/api/docs/guides/tools-web-search)
- [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs)

See [story completeness](story-completeness.md) for chapter deadlines and date-heading checks, and [the latest results](story-completeness-results.md) for this milestone.

The latest [independent checklist milestone](independent-checklist.md) adds two preparation calls and separate cost/latency traces. See [its measured results](independent-checklist-results.md).

The [completion-budget and evidence-recovery milestone](completion-budget.md) established reserved completion capacity and one targeted lookup. The subsequent [custom-prompt fixes](custom-prompt-verification.md) add focused document rereading and late evidence recovery before publication. [Measured results](completion-budget-results.md) retain source failures and independent audits.
