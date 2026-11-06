# Structured event compiler evaluation — 2026-10-31 UTC

The final `event-compiler-v2` cohort completed **1/5 stories**. Independent audits accepted **0**, marked **1** for review and failed **0**. Incomplete stories were not independently audited. The implementation passes its contract tests; these measurements do not establish historical accuracy or a general quality improvement.

All runs used the configured `gpt-6.1-terra` / `low`, cold application research caches and two workers. The five agent-source-checked references (15 facts) were withheld from generation and supplied only to the separate audits. Audits use separate retrieval and the same model, not human certification.

## Latest live measurements (v2)

| Case | Outcome | Published duration | Generation calls | Approved event records | Independent audit |
| --- | --- | ---: | ---: | ---: | --- |
| sino-japanese-war | validation | 0s | 9 | — | not run |
| waterloo | complete | 86s | 7 | 9 | needs_review |
| beagle-voyage | clarification | 0s | 5 | — | not run |
| railway-1830 | validation | 0s | 11 | — | not run |
| apollo-earth | validation | 0s | 7 | — | not run |

Estimated final workload cost, including failures and independent audits, was **$0.525**. Checklist extraction/review cost **$0.125** and targeted research cost **$0.044**, both already included in that total. Checklist preparation p50 was **29.1s** across the five attempts. **2/2** targeted lookups supplied new receipts. There were **0** budget stops.

First playable timings for completed scenes: waterloo 86.3s. These include whole-scene compilation and review before publication; batches transport the approved scene rather than continuing model inference during playback. Incomplete attempts have no first-play latency in completion statistics. Cost per independently accepted story is undefined because no story was accepted.

The final cohort recorded **7** compiled-scene review attempts, **6** rejected, and **12** rejected proposals across preparation and event planning. Source recovery and passing structural checks do not imply a historically accepted story.

## Remaining findings

- **War:** review rejected unsupported ordering for an undated naval battle, a joint-country declaration marker and incomplete army identification. No scene published.
- **Waterloo:** the main date, opposing forces, Prussian role and Napoleon's defeat passed the reference checks. Independent retrieval found a conflicting account of the commanders' meeting location, so the audit requires a caveat.
- **Beagle:** the single fallback lookup found readable receipts, but checklist review still lacked evidence for the Australia-to-Falmouth sequence. It clarified without planning a scene.
- **Railway:** preparation rejected treating a planned reception as a completed one. Event review caught corrupted participant roles, an unsupported accident location, omitted water-stop context and an ordering issue. It also wrongly objected that a full-year heading could not contain a narrated day; this is a model-review false positive, not a failed server date-bound check. The repair then failed the compiler's requirement for an event date on a railway template, despite the selected claim establishing 1830. No scene published.
- **Apollo:** review rejected recovery/quarantine bundled under an early chapter, and then locations not supported by the selected claims. No scene published.

These are recorded reviewer findings, not independent human conclusions. The coding agent inspected the published scene and rejection/audit traces. The larger 20-case run remains deferred: the gate requires at least four completions, three independent acceptances and no failed audits.

## Preserved first cohort

`event-compiler-v1` completed **0/5**, with one clarification and four validation stops; no scene was independently audited. It cost an estimated **$0.520**. Waterloo's repair asked for ten records against the original nine-record limit. Beagle bundled locations and lacked qualified chronology. Railway's event reviewer twice cited passages outside the event's selected claim. War and Apollo also stopped on checklist/source requirements.

The final revision allows up to fifteen records (a maximum-density regression verifies protocol limits), explains context anchors and overlapping intervals, and places each event's own frozen claim beside its exact rendered text in review input. It allows 6,000 output tokens for an event plan. The default path uses five model calls without recovery/repairs; individual runs above include any optional work. These are fresh, unpaired attempts with differing research and model output. No causal gain is inferred from the before/after outcomes, and neither cohort is pooled with earlier milestones. Both cohorts together cost an estimated **$1.044**.

## Post-evaluation compiler correction

The current `event-compiler-v2.1` allows an undated context/caveat to use the railway template when its own frozen claim's earliest year is at least 1800. It still rejects missing era evidence or ranges beginning before 1800, and does not invent a public event date. A synthetic railway regression covers all three cases. This small correction was verified by tests, typecheck and build; the live v2 cohort above was **not rerun after it**. Its failures and costs remain unchanged, and no live historical-quality gain is claimed for the correction.

## Verification and artifacts

All **127 tests**, TypeScript, the production build and the offline reference validator passed. The retained legacy harness tests preserve its old generation and repair behavior; new tests exercise the default compiler and endpoint. No browser UI changed and no new browser run is claimed.

The [durable snapshot](../evals/results/2026-10-31-event-compiler.json) retains both reports, usage, reservations, rejected candidates, event reviews, actual fetched passages and independent audits. Full local traces and NDJSON are under ignored `artifacts/evaluations/event-compiler-reference-5/` and `artifacts/evaluations/event-compiler-v2-reference-5/`. Each has `report.json` and `report.html`; the final compact chart is `summary.html`.

See [the implementation contract](event-compiler.md). Source interpretation, semantic coverage and atomicity remain model judgments. Input counting adds HTTP requests and its latency is included in model stages. Costs use the saved rate card and exclude unreported charges, metadata-service charges, cache-write surcharges, taxes and hosting. Human historical review remains pending.
