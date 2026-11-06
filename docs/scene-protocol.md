# Meanwhile scene protocol (v1)

The app uses the same scene engine for demonstrations, direct OpenAI inference and upstream services. The direct harness defaults to OpenAI `gpt-6.1-terra`, with server-configurable model ID and reasoning effort. See [live inference](live-inference.md) for setup and work limits. To connect an existing upstream service, set `SCENE_STREAM_URL` and optionally `SCENE_STREAM_TOKEN`, then restart Next.js. Never put credentials in a `NEXT_PUBLIC_` variable.

## Request and transport

The browser sends `POST /api/scene` with `{ "prompt": "…", "demo": false }`. Prompts must contain 3–500 characters. A demo button passes `demo: true`, which always selects a curated demonstration. In `SCENE_PROVIDER=auto` mode the server prefers an upstream URL, then OpenAI when a key exists, then demos. Explicit modes are also supported. Unsupported demo prompts return HTTP 422; invalid requests return HTTP 400. Misconfigured explicit providers return HTTP 503. Model selection and credentials are controlled only by the server.

In upstream mode the server forwards a JSON POST to `SCENE_STREAM_URL` with `prompt`, `protocolVersion: 1`, `assets`, `instructions`, and `messageSchema`. It requests `application/x-ndjson` and optionally sends `Authorization: Bearer <SCENE_STREAM_TOKEN>`. The generated instruction and JSON Schema live in [scene-protocol.ts](../src/lib/scene-protocol.ts) and derive from the application schema and asset catalog. Upstream services own their inference, research and retries. The direct OpenAI harness uses provider-specific strict schemas internally, then converts validated results into this same browser-facing protocol.

Responses use `Content-Type: application/x-ndjson; charset=utf-8`, one complete JSON message per line, no Markdown or enclosing array. Newline and UTF-8 character boundaries need not align with network chunks. A final unterminated record is accepted. Blank lines and CRLF are accepted. Individual lines are limited to 256,000 JavaScript string characters. Disable proxy buffering. A stalled upstream is canceled after 55 seconds, including body reading; deployment execution limits must accommodate this.

Both server and browser validate every message and atomically commit complete batches. Invalid or interrupted responses become a safe `error` message without provider details. OpenAI clarification questions are also sent as readable `error` messages so the user can refine the prompt. Disconnects and replacement prompts cancel active inference and prevent stale commits. Previously committed chapters remain playable after a midstream failure or Stop. Direct OpenAI inference has a configurable 180-second default deadline within the route's 240-second execution allowance.

## Messages

The exact machine contract is exported as `sceneMessageJsonSchema`. The TypeScript/Zod source of truth is [scene-schema.ts](../src/lib/scene-schema.ts).

`focus` must arrive first and may appear only once:

```json
{
  "type": "focus",
  "title": "Trade along the Silk Road",
  "period": "c. 1300",
  "location": "Across Eurasia",
  "center": { "lat": 36, "lon": 77 },
  "distance": 5.4,
  "sources": [
    {
      "title": "UNESCO · About the Silk Roads",
      "url": "https://en.unesco.org/silkroad/about-silk-roads"
    }
  ],
  "mode": "demo"
}
```

`mode` is `demo` or `live`. Live adapters must identify generated stories as `live`; the app displays the mode visibly. `distance` is 2.7–7 globe units. Sources require 1–8 HTTP(S) links, optionally with unique stable `id` fields. Chapters and speech can include `sourceIds` referring to those IDs; unknown references are rejected. The UI renders these as clickable inline citations. The direct OpenAI harness requires source IDs for every chapter and factual narration. Coordinates use latitude −85…85 and longitude −180…180. Camera travel begins on focus; the default direct harness compiles and reviews the whole story before emitting focus and three batches. Batch transport does not imply incremental model inference. Camera framing expands to include committed anchors and paths, while manual camera interaction suppresses automatic reframing until Home/Recenter.

`batch` commits actions and extends the playable interval:

```json
{
  "type": "batch",
  "seq": 0,
  "readyThrough": 10,
  "actions": [
    {
      "type": "chapter",
      "id": "opening",
      "at": 0,
      "date": "c. 1300",
      "title": "A connected world",
      "caption": "A representative, reconstructed journey along a wider trading network."
    },
    {
      "type": "spawn",
      "id": "merchant-spawn",
      "at": 0,
      "entityId": "merchant",
      "asset": "horse",
      "position": { "lat": 34.3, "lon": 108.9 },
      "palette": "clay",
      "label": "A traveling merchant",
      "scale": 1.5
    },
    {
      "type": "speech",
      "id": "merchant-context",
      "at": 1,
      "entityId": "merchant",
      "text": "Goods often passed between many traders.",
      "kind": "narration",
      "duration": 5
    }
  ]
}
```

`seq` starts at zero and increases by exactly one. `readyThrough` strictly increases. Every action starts in `[previous readyThrough, readyThrough)` and finishes at or before `readyThrough`. Batches contain 1–100 actions. A scene is limited to 500 actions, 80 unique entities, and 600 seconds. Duplicate batches or action IDs are errors, not idempotent replays. An invalid batch leaves the committed log, sequence, and boundary unchanged. Actions are sorted by `at`; actions at equal times retain their input order, so spawn must precede a reference at that timestamp.

`done` ends generation, not playback:

```json
{ "type": "done", "duration": 10 }
```

The duration must exactly match a nonzero committed boundary. Further messages are rejected. EOF without `done` is an interrupted stream. Playback continues after generation finishes, and supports replay and seeking over the complete retained log.

`error` terminates processing with a readable explanation:

```json
{ "type": "error", "message": "Please specify the war and historical period." }
```

## Actions

All actions require an `id` and playback-second `at`. IDs contain 1–64 ASCII letters, digits, underscores, or hyphens. Actions with a `duration` require 0.1–120 seconds. Historical dates are independent of playback seconds. Focus and chapters may include `yearRange: { startYear, endYear, approximate }`; years are signed integers (negative means BCE), have no year zero and must be ordered. Direct generation supplies these ranges.

| Type      | Additional fields                                                     | Behavior                                                                                                                                                        |
| --------- | --------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `spawn`   | `entityId`, `asset`, `position`, `palette`, `label`, optional `scale` | Creates an entity once; scale defaults to 1 and ranges from 0.5 to 2.                                                                                           |
| `move`    | `entityId`, `path`, `duration`                                        | 2–16 geographic points, equal duration per segment, shortest longitude interpolation. Persists at its final position.                                           |
| `attack`  | `entityId`, `targetId`, `duration`                                    | Schematic effect between the current positions of two available entities.                                                                                       |
| `speech`  | `entityId`, `text`, `kind`, optional `sourceUrl`, `duration`          | Narration, imagined perspective (`reconstruction`), or documented quotation (`quote`). Quotations require a source URL. Only the latest active bubble is shown. |
| `chapter` | `date`, `title`, `caption`                                            | Changes narrative context and the historical date; persists until the next chapter.                                                                             |
| `despawn` | `entityId`                                                            | Removes an entity at `at`; replay restores it before that time.                                                                                                 |

Entities must be spawned before use, cannot respawn, and cannot be referenced after despawn. Movement cannot overlap for the same entity. A despawn cannot interrupt a movement, speech, or attack involving that entity, including as the attack target. Cross-batch continuous actions are not supported by v1.

Prepared assets are `infantry`, `officer`, `cannon`, `steamship`, `sailship`, `city`, `factory`, `train`, `tree`, and `horse`. Palettes are `clay`, `indigo`, `sage`, and `gold`. These are procedural placeholders; clients need no asynchronous asset downloads before marking a batch playable. A future GLB registry must add an explicit asset-readiness barrier.

## Playback and interaction

The event log and application clock own scene state. GSAP controls camera travel and appearances, while geographic movement is recovered directly from the log. Three.js AnimationMixer samples walking clips from the same application time. Pause, 0.5×/1×/2×/4× speed, replay, and seeking change this clock once. Playback clamps at the committed boundary and resumes automatically when more data arrives unless paused. Background-tab frame gaps are capped to prevent large jumps.

Rotation and zoom work with pointer/touch and focused-globe keyboard controls: arrow keys rotate, `+`/`−` zoom, and Home recenters. Reduced motion disables automatic globe rotation, camera travel animation, appearance overshoot, and walking poses; essential story movement remains controlled by the pause and seek controls. Objects may be selected in the scene or via the keyboard-accessible list under “Context, objects & sources.”

## Meanwhile discovery

A request may include `discovery: { originTitle, originCenter, periodLabel, yearRange, excludedTitles }`. The server builds the actual prompt and forwards this context to upstream services. A discovered live focus needs a year range wholly contained by the requested period, a different title, and a center at least 20 angular degrees from the origin. Every discovered chapter must include a contained `yearRange`. The server attaches `discoveryFrom: { title, period }` to focus for display. Demo-only discovery returns HTTP 503.

The browser pauses and retains the old story until valid focus arrives. Failures before focus preserve that story. Back restores a bounded local history without generating again. Historical range metadata is optional on ordinary v1 streams, preserving upstream compatibility; the conservative fallback recognizes explicit dates in existing demonstrations.

## Presentation and further work

Models retain true geographic pins; small local presentation offsets and tethers reduce miniature overlap. Routes use original coordinates. Screen-space labels are packed within the visible stage, with the current speaker and selected object first; crowded labels may be hidden, while every visible entity remains accessible through the object list.

The 20-case evaluation covers source support, chronology, ambiguity and cold/warm startup. Model-assisted review cannot certify historical correctness. Conversational ambiguity follow-ups, verbatim quote evidence, finished modular assets, shared multi-event clocks and persistent saved sessions remain later milestones. Compatible model changes preserve this protocol; another provider requires an adapter.

## Optional evidence metadata

Existing v1 demos/upstream streams remain valid. Direct OpenAI focus includes `evidence: { method: "passage-review-v1", passages, claims }`. A passage has `id`, `sourceId`, `text`, `documentHash`, `start`, `end`, and `retrievedAt`; offsets address normalized source text and must match the saved text length. A claim has `id`, `text`, `passageIds`, nullable `yearRange` and `certainty` (`established`, `approximate`, `contested`).

Actions may include `claimIds`. With evidence present, factual chapters/narration require these and their source IDs must exactly match the supporting passages. Batches may include `evidence: { method: "passage-review-v1", claims }` to add reviewed claims atomically with actions. IDs and references must resolve; a committed claim cannot change. Invalid evidence leaves both the action log and claim ledger unchanged. Focus holds the passage registry for the whole story.

Evidence receipts are provenance metadata. Structural validation does not establish whether a passage supports a claim. The direct harness performs separate model review before emitting each interval; an upstream adapter owns that responsibility for its own output. See [evidence reliability](evidence-reliability.md).
