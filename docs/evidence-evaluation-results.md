# Evidence reliability evaluation — 2026-10-30 (Chicago)

This reran the 20 existing historical prompts with `gpt-6.1-terra` / `low`, cold application research caches, production passage/claim gates, and five reference stories in the independent audit. The run started on 2026-10-31 UTC. Three case workers ran; no staged or warm repetitions were used. The older latency run used different conditions and a different review rubric, so these are not paired accuracy or latency comparisons.

## Outcomes

- 10/20 full 36-second scenes completed.
- 6/20 asked for clarification, including all four intentionally ambiguous prompts. Two broader prompts could not be responsibly resolved from the available evidence.
- 3/20 stopped on validation; 1/20 stopped because usable source pages could not be retrieved. One rejected continuation preserved 12 playable seconds.
- Independent post-generation audits: 4/10 accepted, 3 needing review and 3 failing. These are same-model, separately retrieved audits, not human accuracy certification. Overall acceptance was 4/20 attempts.
- 36 pre-commit proposals were reviewed; 5 were rejected before publication, including drafts that were subsequently repaired. Other structural failures can stop before semantic review.

Among completed scenes, median first-playable time was **31.0s**, p95 **51.7s**. Rejected/clarification requests are excluded from those latency percentiles but included in workload costs.

Estimated cost across all 20 attempts and independent audits: **$1.285**. Estimated cold-workload cost per audit-accepted story: **$0.321**. These figures include source-gate model calls, failed attempts and search actions; they exclude preliminary smoke iterations, cache-write surcharges, tax, hosting and unreported failed-provider usage. The saved rate card is an estimate, not a bill.

| Case | Outcome | Playable duration | Gate reviews / rejects | Independent audit |
| --- | --- | ---: | ---: | --- |
| silk-road | clarification | 0s | 0 / 0 | not reviewed |
| beagle-voyage | validation | 12s | 3 / 2 | not reviewed |
| sino-japanese-war | complete | 36s | 3 / 0 | fail |
| waterloo | complete | 36s | 3 / 0 | fail |
| indian-ocean | validation | 0s | 2 / 2 | not reviewed |
| apollo-earth | complete | 36s | 3 / 0 | needs_review |
| industrial-comparison | clarification | 0s | 0 / 0 | not reviewed |
| railway-1830 | complete | 36s | 3 / 0 | needs_review |
| silk-road-premise | complete | 36s | 3 / 0 | pass |
| shimonoseki | complete | 36s | 3 / 0 | needs_review |
| haitian-revolution | evidence | 0s | 0 / 0 | not reviewed |
| meiji | complete | 36s | 3 / 0 | fail |
| french-revolution | complete | 36s | 3 / 0 | pass |
| bronze-age-uncertainty | validation | 0s | 0 / 0 | not reviewed |
| ambiguous-civil-war | clarification | 0s | 0 / 0 | not reviewed |
| ambiguous-revolution | clarification | 0s | 0 / 0 | not reviewed |
| ambiguous-battle | clarification | 0s | 0 / 0 | not reviewed |
| ambiguous-time-place | clarification | 0s | 0 / 0 | not reviewed |
| mansa-musa | complete | 36s | 3 / 0 | pass |
| waterloo-quote | complete | 36s | 4 / 1 | pass |

## Five-story checks

The coding agent read the five committed reference outputs and compared their rendered text with the source-checked anchors. See [review notes](../evals/reference-review-notes.json) and [the 15-fact reference set](../evals/reference-stories.json). Human review remains pending.

| Reference case | Outcome | Independent audit | Reference coverage |
| --- | --- | --- | --- |
| beagle-voyage | validation | incomplete; no final audit | 0 addressed / 0 checks |
| sino-japanese-war | complete | fail | 3 addressed / 5 checks |
| waterloo | complete | fail | 3 addressed / 5 checks |
| apollo-earth | complete | needs_review | 5 addressed / 5 checks |
| railway-1830 | complete | needs_review | 3 addressed / 5 checks |

The war scene omitted Korean political context and did not qualify its treaty ending with continued fighting over Taiwan. Waterloo omitted named opposing leadership and an explicit outcome. The Beagle scene stopped after the opening; a proposed continuation placed 1836 events under an 1834–1835 chapter and never reached playback. The railway and Apollo scenes cover their reference anchors but need broader chronology/presentation checks. The agent additionally noted an Apollo return narration appearing while a launch-date heading was still visible. This illustrates that a favorable gate verdict can still miss presentation ambiguities.

These findings are retained as failures and follow-up work, not reclassified into passes. The reference set is withheld from generation and enters only the independent evaluation review. Optional background facts need not be narrated.

## Artifacts and reproduction

[The durable result snapshot](../evals/results/2026-10-30-claim-evidence.json) includes all attempts, outcomes, usage, gate counts/rejection reasons and reference coverage. Full local passages, candidates, NDJSON and interactive reports are under ignored `artifacts/evaluations/claim-evidence-20/`. The source-access refresh is saved locally at `artifacts/reference-refresh.json`; four reference pages were readable directly with all anchors found, while the Science Museum collection page was unavailable to the direct reader and had been checked through the research tool.

`npm run eval:live -- --cold-only --baseline-limit 0 --concurrency 3` repeats the paid evaluation. `npm run eval:references` validates the reference set offline; `npm run eval:references -- --refresh` rechecks source access and anchor presence without model calls. See [evidence reliability](evidence-reliability.md) for implementation details and limits.

Verification for this milestone: 76 automated tests, 12 browser checks, TypeScript and production build passed. Browser checks include showing supporting passages and citation links alongside generated story text, plus existing playback, cancellation, mobile and discovery behavior.
