# Scene reliability and browser readiness — 2026-11-05

The `scene-reliability-v1` reference cohort completed **3/5** stories. Separate model-assisted audits **passed 1**, marked **1** for review and **failed 1**. Source review still stops some requests, and historical accuracy remains below the existing release/evaluation gate. Passing software checks is separate from historical acceptance.

All **138 unit tests**, **13 browser tests**, TypeScript, the production build and the offline five-story/15-fact validator passed. The managed browser test server was stopped afterward; application ports 3000 and 3100 had no listeners. No dev server was left running. `AGENTS.md` records the user's server lifecycle preference.

## Live measurements

The cohort used `gpt-6.1-terra` / `low`, cold application research caches and two workers. Reference facts were withheld from generation. Independent audits use separate retrieval and the same configured model; human historical review remains pending. This is a fresh, unpaired cohort, with differing sources/model output from earlier attempts; no causal accuracy or latency gain is established.

| Case | Generation | Published duration | Model calls | Separate audit |
| --- | --- | ---: | ---: | --- |
| sino-japanese-war | complete | 114s | 7 | fail |
| waterloo | complete | 93s | 5 | pass |
| beagle-voyage | complete | 52s | 7 | needs_review |
| railway-1830 | validation | 0s | 5 | not run |
| apollo-earth | clarification | 0s | 5 | not run |

First playable times among complete scenes: sino-japanese-war 97.5s, waterloo 57.2s, beagle-voyage 67.0s. The whole scene is compiled and reviewed before first publication. Incomplete attempts are excluded from completion-only latency. Estimated total cost including failures and independent audits was **$0.598**. Checklist preparation/review cost **$0.122** and recovery cost **$0.026** are already included. **1/1** targeted lookups supplied new receipts. There were **0** budget stops.

The cohort recorded **5** compiled-scene review attempts and **2** rejections. There were no missing-actors-category validation rejections in this cohort: the default response schema now requires that slot. A slot's presence does not establish the historical adequacy of its wording or claim links. The normal resolved path remains five model calls, with optional recovery/repairs reflected above.

## Findings and remaining work

- **Waterloo:** completed a 93-second scene in five model calls. Its independent audit passed the date, coalition context, sequence and defeat; it found no issues. The source reviewer accepted the selected main-site focus and schematic staging. This is model-assisted acceptance, not human certification.
- **War:** completed a 114-second scene. Independent review rejected the definite Taiwan endpoint/participant framing and a claimed Liaodong handover date, and requested qualifications for other campaign dates and losses. These overstatements survived pre-publication review; structured preparation and visible qualifiers have not eliminated source interpretation errors.
- **Beagle:** completed a 52-second scene. Pre-publication review corrected a regional Galápagos event anchored as though the entire stay occurred on San Cristóbal. The separate audit still requested the alternative departure dates and their sources, and Admiralty context required by the reference. It was marked needs_review, not accepted.
- **Railway:** stopped during checklist source review. Review requested Huskisson's transport to Eccles and its participant, then Wellington's return and qualification of conflicting water-stop locations. Core categories were present; missing essential scope/source interpretation remained. No scene published.
- **Apollo:** a targeted lookup added evidence, but the source review still requested recovery participants/means and clarification of Collins's location if retaining that claim. It clarified before event planning. The new non-Earth template was therefore not exercised by this live case; its transport/display is covered by unit and browser tests with explicitly synthetic facts.

The coding agent read the committed narratives and rejection/audit traces. The full twenty-case run remains deferred: the gate requires four completions, three independently accepted stories and zero failed audits. Source sufficiency, coverage, inferred historical order and cross-source interpretation still need work and independent human review. The implementation does not claim that these limits are solved.

## Implemented and verified

[The implementation](scene-reliability.md) adds required context/actor/outcome slots with server-owned requirement IDs/kinds; explicit main-event focus selection and derived location/coordinates; visible named relation notes; required source qualifications for contested claims; and text-only non-Earth captions without map markers. Qualifications on mapped events appear immediately in their caption and retain separate reading time. No model verdict is suppressed by matching its reason text.

Compiler regressions cover canonical checklist normalization, wrong focus indices, choosing a main location after background context, named overlap notes with both claims' citations, contested qualifications and entity lifetime, and non-Earth captions with heading restoration. The added end-to-end test seeks into/out of a compiled synthetic lunar fact, checks its visible caption and absence of a lunar marker control, and confirms replay transport. Existing browser checks cover desktop/mobile playback, labels, WebGL fallback, replacement, citations, cancellation and discovery. Playwright used its own temporary loopback server with demo credentials and shut it down after the suite.

[The durable snapshot](../evals/results/2026-11-05-scene-reliability.json) retains the complete report, source receipts, usage/reservations, rejected candidates, source/event reviews, presentation usage, independent audits and server lifecycle check. Full local files are under ignored `artifacts/evaluations/scene-reliability-reference-5-2026-11-05/`: `report.json`, `report.html`, `summary.html`, `server-lifecycle.json` and per-case traces/NDJSON. Earlier results remain preserved in [evidence review results](evidence-review-results.md).

Costs use the saved 2026-10-30 rate card, not a new quote, and exclude unreported charges, separate metadata-service charges, cache-write surcharges, taxes and hosting. Input-count HTTP request latency is included. These reference failures have informed development and are not an unseen generalization benchmark.
