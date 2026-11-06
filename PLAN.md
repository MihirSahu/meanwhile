# Meanwhile — implementation plan

## Product

A Next.js web app for exploring history through a playful, interactive 3D globe. The initial interface is just the globe and a text input. A user asks about one or more events, and miniature animated scenes appear where they happened.

The prompt starts the experience. The live model prepares sourced atomic event records after an independently reviewed checklist. The server compiles those records into timed actions using prepared scene templates and reviews the full rendered story before publishing focus and three batches. The browser stores the action set and plays it at a steady speed independent of inference. Curated demos and the upstream adapter retain the same browser protocol.

Working title: **Meanwhile**. Preserve the original idea of discovering simultaneous history: the “Meanwhile…” action reveals what was happening elsewhere at the same historical time.

## Agreed technology

- **Next.js App Router and TypeScript** for the application and server streaming endpoint.
- **Three.js and React Three Fiber** for the globe, scene objects, interaction, and rendering.
- **GSAP** for camera travel, appearances, and timed movement/choreography.
- **Three.js AnimationMixer** for reusable character animation clips such as walking and gesturing.
- **Zod** for validating incoming scene messages.
- A small, application-owned **event log and playback clock** for buffering, pause, replay, and fast-forward.
- Start with CSS for interface motion. Add Motion only if the interface later needs it; do not add multiple overlapping animation libraries by default.

## Inference approach

Selected provider: **OpenAI**, starting with **GPT-6.1 Terra** (`gpt-6.1-terra`). The live implementation uses a lightweight application-owned TypeScript harness and the official provider SDK. A server credential has been configured locally, and a real Terra smoke test completed successfully. Curated demonstrations and the existing optional upstream adapter remain available.

The scene protocol remains independent of the provider. The harness handles source retrieval, citation metadata, event resolution, fetched passage receipts, claim-level evidence review, bounded repairs and progressive batches while committed scenes play.

Model ID (`SCENE_MODEL`) and reasoning effort (`SCENE_REASONING_EFFORT`) are server configuration, separate from the browser and scene/playback logic. Tests verify that changing only configuration sends all SDK requests to a replacement model and preserves the scene contract. Compatible model changes still need quality and capability checks. Switching providers requires a `SceneProvider` implementation for that provider's authentication, research, structured outputs and usage reporting, or an upstream NDJSON service.

`SCENE_PROVIDER=auto` prefers an optional `SCENE_STREAM_URL`, then OpenAI when `OPENAI_API_KEY` exists, then explicitly labeled curated demonstrations. Explicit `openai`, `upstream`, and `demo` modes are available. `SCENE_STREAM_TOKEN` optionally authenticates upstream requests. Demo buttons always use curated stories; unsupported demo prompts produce a clear explanation. Configuration, limits and verification are documented in `docs/live-inference.md`.

## User experience

1. Show an interactable globe and prompt input; allow rotation and zoom.
2. Accept a historical event, journey, or comparison. Resolve ambiguity and make the selected event/period visible.
3. Receive a compact focus message: title, period, location, center or bounds, and camera framing.
4. Begin camera travel immediately after a valid focus message arrives. First-response latency remains an inference/research constraint.
5. Populate the scene progressively with reusable people, armies, buildings, vehicles, and props.
6. Play movements, combat illustrations, and text bubbles on a regular playback clock.
7. Reveal discreet date, pause, speed, replay, and buffered-progress controls after a scene starts.
8. Enable fast-forward only within the available, committed portion of the timeline. Pause the story clock at the buffer boundary while ambient motion can continue.
9. Allow selecting an important figure or object to inspect context and sources.
10. A new prompt cancels the previous stream and resets its scene safely.

## Scene protocol and playback rules

- Transport: newline-delimited JSON (NDJSON), parsed independently of network chunk boundaries.
- `focus`: event metadata, geographic framing, sources, and whether the stream is a demo or live.
- `batch`: a sequential batch number, timed actions, and a `readyThrough` playback boundary.
- Actions: `spawn`, `move`, `attack`, `speech`, `chapter`, and `despawn`.
- `done`: final duration, matching the last committed boundary.
- `error`: a safe, readable failure message.
- Every action and entity has a stable ID. References must resolve; actions must use known asset IDs and valid coordinates.
- Commit complete batches. Never rewrite actions that have already become playable.
- The current scaffold requires actions, including their durations, to fit inside their batch's committed interval. Cross-batch continuous actions would need an explicit protocol extension.
- Model output describes goals, paths, timing, and relationships. The rendering engine calculates intermediate positions and poses; the model does not emit frames.
- Historical dates and animation seconds are separate. A campaign lasting months may play over seconds, with the historical date always visible.
- Keep authoritative scene state outside animation callbacks. Entity existence, narrative state, and movement must be recoverable on replay or seeking.
- Fast-forward changes the application clock once. Animation systems follow that clock so speed is not multiplied twice.
- Mark a batch playable only when its data and required assets are ready. Current procedural assets have no asynchronous model downloads; future GLB assets will require an explicit readiness check.

## Reusable assets and visual style

Use a consistent low-poly, cartoonish visual style inspired by Crossy Road and Bruno Simon's tactile miniature worlds. Assets are prepared ahead of time, never generated during playback.

The scaffold includes procedural families for infantry formations, officers, cannons, steamships, sailing ships, cities, factories, trains, trees, and mounted travelers. These are initial placeholders for a much broader library, not finished historically accurate models.

Expand variety through modular clothing, headgear, equipment, palettes, body types, architectural styles, and shared animation clips. Catalog each asset by era, region, supported actions, and relevant restrictions. Give the model a relevant shortlist rather than the entire catalog.

Use geographic anchors for placement and travel, and local coordinates for close-up scenes. Figures can be exaggerated in size for readability, with schematic routes and troop representations clearly identified. Model important people individually, with names and distinctive appearance where reliable references exist.

For larger armies, evaluate shared geometry/materials, instancing, and level of detail. Avoid per-frame React state updates for individual soldiers. Rich skeletal animation should be reserved for figures where the detail is visible.

## Historical presentation

- Source factual event summaries, dates, and locations.
- Distinguish actual quotations, narrated context, and imagined perspectives.
- Require a source for an actual quotation. Never present invented thoughts or dialogue as a documented statement.
- Label reconstructed staging, approximate positions, and compressed routes.
- Limit simultaneous text bubbles so the scene stays readable.
- Use signed historical year ranges with explicit uncertainty, separate from playback seconds. Existing ordinary upstream streams can still use display dates; discovery requires contained year ranges.

## Current state after relocation

All prototype code, installed dependencies, lockfile, scripts, and generated map data have been moved into `/home/t3/Projects/meanwhile`. The new repository retains its own Git metadata and has no commits yet.

Implemented in the local prototype:

- Next.js, React, TypeScript, and 3D dependencies configured and installed.
- Scene/action schemas, NDJSON line decoder, batch validation, and basic clock helpers.
- Server streaming endpoint, curated demo mode, optional upstream adapter, and a direct OpenAI research-and-scene harness.
- Configurable model/effort, bounded generation, process-local research caching, cancellation and optional usage logs.
- Inline narrative citations bound to source IDs from provider citation metadata; live generated quotations are excluded pending a verbatim-evidence mechanism.
- First Sino-Japanese War and Silk Road demo scripts with source links and reconstruction labels.
- Low-poly globe component, orbital camera controls, GSAP camera travel and appearances, procedural asset components, walking clips, labels, routes, and attack indicators.
- Static land geometry generated locally from Natural Earth data distributed by `world-atlas`.

The application is runnable. `Experience` owns cancelable streaming, validated commits, selection, and a playback clock independent of generation. Global styles provide desktop/mobile layouts and accessible controls. Camera travel and appearances use GSAP; geographic position and attack endpoints are derived from the event log for reliable seeking. Labels explicitly follow entity lifetime, keep a fixed screen size, and show only one active speech bubble.

TypeScript checks and production builds pass. Contract tests cover decoding, cancellation, atomic batch validation, replay, source references, SDK requests, model switching, caching, usage limits, repairs and safe errors. Browser verification covers desktop/mobile interaction, story replacement, label lifetime, WebGL fallback and generated-story citations. The opening workflow removes one generation round trip. A 20-case live evaluation and independent model-assisted source reviews record cold/warm latency, failures and estimated cost; see `docs/evaluation-results.md`. Camera framing follows committed geography, local offsets and tethers separate miniatures, and screen-space labels prioritize speakers and selections. “Meanwhile…” finds a sourced event within the current historical range in another region, preserves the old scene during research and supports Back without another API call. A real discovery smoke test found Oscar Wilde’s 1895 libel trial from the war story’s 1895 chapter, first playable at 20.8 seconds and complete at 28.9 seconds. Finished modular assets and physical-device profiling remain future work.

## Implementation milestones

### 1. Complete the playable local prototype

- [x] Build `src/components/experience.tsx` to own prompts, streams, scene state, cancellation, selection, and playback controls.
- [x] Add `src/app/globals.css` with a minimal responsive interface, readable labels, and accessible controls.
- [x] Parse NDJSON incrementally, handle UTF-8/chunk boundaries, and reject stale responses after cancellation.
- [x] Start playback at the first useful batch; keep buffering after the model finishes.
- [x] Implement pause, replay, speed changes, buffer-boundary handling, and progress display.
- [x] Verify GSAP lifecycle cleanup, replay/rewind state, and visibility of labels before spawn and after despawn.
- [x] Review movement and attack positioning, camera behavior, and overlapping text bubbles.
- [x] Provide clear loading, unsupported-prompt, interrupted-stream, and WebGL-unavailable states.

### 2. Verify the streaming and rendering contract

- [x] Add meaningful tests for chunked decoding, invalid IDs, missing entities, batch order, committed timing, cancellation, and buffer exhaustion.
- [x] Verify atomic rejection of invalid batches and duplicate messages.
- [x] Test replay and fast-forward after generation completes, plus playback catching an incomplete stream.
- [x] Run TypeScript checks and a production build; fix dependency or API compatibility issues.
- [x] Check desktop and mobile interaction, reduced-motion preferences, and basic keyboard accessibility.
- [x] Verify that both demonstration stories use the same engine without event-specific rendering code.

### 3. Connect live inference

OpenAI and `gpt-6.1-terra` are selected for the first live implementation. Keep model selection configurable and preserve the curated demos and existing upstream adapter.

- [x] Select a provider or harness with the user: OpenAI GPT-6.1 Terra with a lightweight custom TypeScript harness.
- [x] Document the exact protocol and generate a constrained model instruction/schema from the asset registry. See `docs/scene-protocol.md` and `src/lib/scene-protocol.ts`.
- [x] Implement the selected server-side provider adapter; preserve the same browser-facing protocol.
- [x] Configure model ID and reasoning effort on the server; verify a compatible model can be switched without changing scene or playback code.
- [x] Handle incomplete JSON, unsupported assets, invalid timelines, timeouts, and disconnects without exposing provider secrets.
- [x] Add sourced event resolution and a visible ambiguity correction mechanism.
- [x] Add a varied 20-case evaluation with source review, cold/warm and paired startup latency, outcome counts, usage and cost reporting. See `docs/live-inference.md` and `docs/evaluation-results.md`.
- [x] Combine resolution and opening validation, preserve explicit citation-to-source mappings, and enforce chapter dates and prototype asset eras.
- [x] Improve scene framing, miniature spacing, and collision-aware labels.

### 4. Expand assets and discovery

- [ ] Replace placeholder families with a consistent, prebuilt modular asset library.
- [ ] Add richer characters, gestures, uniforms, landmarks, and controlled scene transitions.
- [ ] Measure army rendering costs and introduce instancing/LOD where necessary.
- [x] Add sourced “Meanwhile…” discovery within the current chapter range, with geographic separation and local Back history.
- [ ] Add synchronized multi-event scenes sharing a historical clock.
- [ ] Consider scene caching, saved sessions, and shareable links after the core experience works.

## First prototype acceptance criteria

A user can open the globe, select a supported story, watch the camera arrive and assets appear during streaming, see timed movement and contextual bubbles, pause and replay, and fast-forward through available actions. Generation may finish well before playback. Changing prompts never mixes old and new events. Demonstrations are clearly labeled; a live provider is never implied when none is connected.

Publishing, GitHub creation, and paid services require separate user instructions.

## Factual reliability milestone

- [x] Fetch citable source pages and retain verbatim passage receipts, access results and document hashes.
- [x] Bind narration, chapter text and metadata to a claim ledger; derive source links from those mappings.
- [x] Review new claims, wording, chronology and scope before each atomic commit; preserve published claims and playable intervals.
- [x] Add five agent-source-checked reference stories with 15 facts and coverage guards; keep human review explicitly pending.
- [x] Extend live evaluations with gate traces, reference coverage and a cold-only reliability run.
- [ ] Obtain independent human historical review of the reference stories and representative generated scenes.

The review uses the configured model in a separate call and is not historical truth certification. See `docs/evidence-reliability.md` for limitations and `docs/evidence-evaluation-results.md` for this milestone's measurements.

## Story completeness milestone

- [x] Add sourced requirements for context, principal actors, outcomes, explicit user requests and necessary caveats.
- [x] Track coverage using actual committed/proposed actions, with future requirements pending until due.
- [x] Review the full rendered story before its final batch and withhold completion on missing concepts.
- [x] Pass the full plan into continuations and prevent future-period claims from being inserted into an earlier chapter.
- [x] Compare explicit narration dates with the visible heading, including month/day differences within one year.
- [x] Complete the reference-first and full live evaluations; results are recorded in `docs/story-completeness-results.md`.

Historical coverage and source support remain model-reviewed; independent human review is still pending.

## Independent checklist milestone

- [x] Extract essential sourced requirements and important event-order relations before scene planning.
- [x] Source-review and freeze essential checklist facts and requirements; allow chapter assignment and supplemental sourced requirements.
- [x] Review essential scope, event order within captions, uncertainty and time-zone qualifications before commit.
- [x] Add Apollo missing-location/recovery and railway same-day ordering regressions, preserving earlier chapters on rejection.
- [x] Complete the five-reference evaluation and record checklist cost, latency and remaining review failures. See `docs/independent-checklist-results.md`; the broader run was deferred because the reference gate failed.

The production planner cannot read the held-out reference set. Independent model review still requires human historical review before accuracy certification.

## Completion budgets and evidence recovery

- [x] Align model-call and token ceilings with the nine-call workflow and bounded optional work.
- [x] Count input before each model request and reserve capacity for every remaining mandatory generation/review pair.
- [x] Allow one targeted lookup of essential evidence before freezing; merge actual fetched receipts with fresh IDs and rebuild the checklist.
- [x] Keep checklists compact, complete relation evidence and avoid presenting missing excerpts as historical uncertainty.
- [x] Add railway budget, recovery, cancellation/ambiguity and token-admission regressions.
- [x] Run the five reference stories and record recovery/cost; the full 20-case run remains deferred because the reference gate failed. See `docs/completion-budget-results.md`.


## Structured event compiler milestone

- [x] Split scene proposals into dated event records selected from frozen sourced claims.
- [x] Validate event intervals, receipt references, overlap and before relations; reject cycles and contradictory date order.
- [x] Compile server-owned action IDs, citation mappings, chronological chapter placement, templates and readable timing.
- [x] Review the complete compiled text and essential coverage using event/requirement indices before publishing any focus.
- [x] Keep the old harness as an explicit staged evaluation baseline and retain recovery, reservations and cancellation.
- [x] Add compiler and default-provider regressions and run the five live references. See `docs/event-compiler-results.md`.

Human historical review remains pending. Compilation guarantees structure and mappings; atomicity, source interpretation and semantic coverage still require model judgment and independent audits.


## Evidence binding and review calibration

- [x] Allow multiple supporting frozen claims per atomic event and derive exact citation unions on the server.
- [x] Validate supporting claim selections and sourced date unions without bridging gaps; retain rendered-date checks.
- [x] Supply structural validation receipts and reserve model review for historical source support, coverage, sequence and uncertainty.
- [x] Replay saved Railway and Apollo failures, and cover Waterloo's disputed location with an explicitly synthetic disagreement receipt and mocked review veto.
- [x] Run and document the current five-reference cohort before considering the existing twenty-case gate. See `docs/evidence-review-results.md`; the gate was not met.


## Scene reliability and browser readiness

- [x] Record the explicit server lifecycle preference and verify no dev server remains running.
- [x] Require context, actor and outcome slots before canonical checklist normalization/source review.
- [x] Select the requested main event for focus, deriving both its label and position from that record.
- [x] Render named relationship notes and require visible qualifications for contested claims.
- [x] Support sourced non-Earth facts as text-only captions without an Earth marker.
- [x] Add compiler and browser regressions for focus, uncertainty and text-only playback.
- [x] Complete managed browser tests, verify server shutdown, and record the five-reference cohort. See `docs/scene-reliability-results.md`; historical quality remains below the broader evaluation gate.


## Review fix loop

- [x] Fix scoped relationship date references and feasible before ordering.
- [x] Preserve scenes and history until a validated replacement batch; retain playback on failures and cancellation.
- [x] Re-review and fix pause ownership, BCE/CE adjacency/labels, and narrated date precision/ranges.
- [x] Add unit and browser regressions and repeat review until no further actionable code findings remain.
- [x] Verify managed test-server shutdown and retain historical-quality limitations separately.

See `docs/review-fixes.md` for scope and verification.
