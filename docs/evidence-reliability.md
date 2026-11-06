# Evidence checks before playback

Direct OpenAI scenes now use `passage-review-v1`. The selected model remains `gpt-6.1-terra`; configuration still controls model and effort. Curated demos and the existing upstream adapter retain their workflows.

## What supports a claim

Hosted search discovers URLs through provider citation annotations. The server then independently downloads those URLs and extracts static HTML/plain-text content. Search summaries are retained as research traces and used to select relevant passages, but are omitted from scene-generation input and cannot support a claim.

Every selected passage has a stable ID, source ID, verbatim normalized text, character offsets, retrieval timestamp and SHA-256 of its normalized document. Claims contain an ID, factual wording, passage IDs, an optional signed historical range and an uncertainty category. Factual chapter text and narration reference these claims. The server derives citation URLs from the referenced passages, preventing the generator from assigning an unrelated source ID to otherwise supported wording.

The source reader limits redirects, document size, duration and concurrency. It validates public destinations inside socket DNS lookup and on redirects, rejects credentials/private/reserved destinations, and sends no API credentials or browser cookies. Tracking parameters are removed before fetching. Unsupported PDFs, inaccessible sites and JavaScript-only pages do not become evidence. Read failures are saved with safe reason codes. Other readable cited pages may still support the scene; if none do, generation stops with an evidence error.

Passage selection is a bounded relevance heuristic, not comprehensive research. It can miss relevant context or conflicting passages. Document hashes identify retrieved content; they do not certify its accuracy. Current content-size and retrieval limits are in `source-retrieval.ts`.

## Checks before a commit

1. Generation proposes a focus, three chapter outlines, an opening batch and a compact claim ledger using only fetched passages.
2. Deterministic checks validate IDs, passage mappings, citation derivation, displayed dates, claim/chapter ranges, prepared asset eras and the streaming contract. Each chapter stays within its planned period.
3. A separate model call reviews every new claim and every proposed action. It also tracks sourced story requirements, with pending future concepts allowed until their chapter deadline and all requirements required before the final commit. It checks wording against that claim's own passages, requested scope, uncertainty, chronology, labels and schematic routes. A favorable result is rejected if it omits or duplicates coverage, cites an unknown passage or marks any required check unsupported.
4. The server commits focus and opening together only after both kinds of checks pass. Later batches are built in a trial buffer, reviewed, then atomically committed. Rejected drafts never enter playback or its claim ledger.
5. Accepted claims are immutable. Continuations can reference them or add separately reviewed claims. Review of current text can reject new unsupported details, but it cannot rewrite committed claims, actions or approved outlines. Later review does not repeatedly re-adjudicate an unchanged approved claim.

An opening scene normally needs seven model requests: research, opening generation/review, and two continuation generation/review pairs. At most one repair is allowed per proposal, with two across the opening workflow. The optional staged evaluation baseline has one shared repair. There are hard limits of 12 model requests, 36,000 cumulative output tokens and no subsequent requests once observed input usage reaches 120,000 tokens. The overall timeout is unchanged. SDK retries remain disabled. Evidence reviews add startup latency and can reduce completion rates.

Failures after a successful batch preserve the playable portion. Cancellation during retrieval or review prevents a stale commit. Research-cache entries now include fetched passages and access checks, isolated under a new cache identity. A cached research bundle still requires new generation and review; it never bypasses the gate.

The story's context panel and object inspector offer **Supporting passages**, showing claims, quoted evidence and original source links. The wording explicitly describes automatic checking and does not present a human-verification badge.

## Five-story reference set

[`evals/reference-stories.json`](../evals/reference-stories.json) contains 15 source-checked facts across the First Sino-Japanese War, Waterloo, Darwin's Beagle voyage, the Liverpool–Manchester railway opening and Apollo 11's Earth-side events. Each fact includes a short source anchor and whether it is required for that evaluation prompt. Guards describe misleading presentations to avoid. Optional background facts need not appear in every scene.

These references were checked by the coding agent against the authoritative archive, museum, Cambridge and NASA pages. Four also have normalized offsets and document hashes from direct retrieval. The Science Museum collection page was readable through the research tool but unavailable to the direct server reader during preparation, so that distinction is recorded. All five explicitly retain `humanReview: pending`.

```sh
# Validate reference structure and case membership without network access:
npm run eval:references
# Recheck page access and whether anchors are still present; no model calls:
npm run eval:references -- --refresh
# Rerun the 20 prompts, cold only, with production gates and reference checks:
npm run eval:live -- --cold-only --baseline-limit 0 --concurrency 3
```

The reference set enters the independent evaluation review, not scene generation. That review must return coverage for every reference fact and guard; missing required concepts or contradictions prevent acceptance. The original 20-case expectations remain visible, including failures caused by conservative clarification or the benchmark's chosen date band. Full traces include source-access results and rejected/accepted gate candidates, so fewer finished scenes cannot be mistaken for uniformly better answers.

A human reviewer can open each reference URL, read its anchor in context, check the paraphrased fact and guards, then compare the generated scene's dates, wording and routes. Reference refresh only checks text access/presence; it does not perform that historical review or change the pending human status.

## Practical limits

The reviewer currently uses the same configured model as the generator in a separate call. This reduces unchecked output but can produce false positives, false negatives and correlated mistakes. A structurally complete “supported” verdict is still a model judgment. Existing source passages can themselves be incomplete, biased or contradictory. Human historical review remains necessary; these checks establish traceable evidence and enforce a review boundary, not truth certification.

Ordinary upstream NDJSON remains compatible without evidence metadata. An upstream service may supply the new optional evidence fields, in which case both server and browser validate their structural consistency; the upstream service remains responsible for its research and semantic review. These new production gate calls apply to the direct OpenAI harness.

The design follows [OpenAI's citation guidance](https://developers.openai.com/api/docs/guides/citation-formatting) on stable citable units and validating references. [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs) constrain shape; application checks and explicit review are still needed for support and meaning.

The coding agent also read the five generated reference cases after the run. [Review notes](../evals/reference-review-notes.json) distinguish missing coverage, incomplete playback, covered anchors and additional historical checks. Those notes intentionally do not promote the pending human-review status.

[Story completeness and timeline consistency](story-completeness.md) add action-based coverage, full-plan continuation input, final-story completeness checks and month/day-aware heading validation. These reuse the existing model review calls.
