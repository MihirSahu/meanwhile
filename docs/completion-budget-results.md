# Completion budget evaluation — 2026-10-31 UTC

The five reference stories use `gpt-6.1-terra` / `low`, cold application research caches and two workers. The reference facts remain withheld from generation and enter only the independent audits. Those audits use separate retrieval and calls to the same configured model; they are not human certification.

## Cohorts

The first `completion-budget-v1` run exposed a relation whose citation list omitted part of an event claim's already-fetched evidence. The final `completion-budget-v2` revision completes those citation sets before source review and allows ordering established by explicit non-overlapping dates. All first-run outcomes remain separate from the final run.

## Measurements

The final five-case cohort completed **1/5 stories**; its independent audit **failed**. Four cases stopped on validation. There were **no request/token budget stops**. No accuracy improvement is established, and the gate for a full 20-case evaluation was not met.

The railway retained **24 playable seconds**. It made **16 model calls**, including **two final evidence-review attempts**, and stopped because the ending failed claim-linked coverage. The final review was not prevented by the old 12-call ceiling. Its final usage was **113,326 input tokens** and **10,844 output tokens**, with zero mandatory calls left reserved. This demonstrates that review capacity remained available; it does not establish that the ending was correct.

Three targeted lookups supplied new fetched receipts, each before freezing. They added evidence for the war's outcome/ordering, Apollo preparations and the railway procession's continuation. Each case used at most one lookup. New receipts do not imply a passed source check or historical audit.

Estimated final workload cost was **$0.639**, including failed attempts and the completed story's independent audit. Checklist extraction/source review cost **$0.207** and targeted research cost **$0.066**, both already included in that total. Preparation p50 was **46.4s** across all five attempts; lookup time during preparation is included. These are direct stage measurements, not a causal estimate of added overall latency.

The one completed story became playable at **110.3s**. Railway became playable at **105.4s** but was incomplete and excluded from completion-only latency statistics. Cost per independently accepted story is undefined because none was accepted.

| Case | Outcome | Playable | Model calls | Recovery | Independent audit |
| --- | --- | ---: | ---: | --- | --- |
| sino-japanese-war | complete | 36s | 12 | recovered | fail |
| waterloo | validation | 0s | 5 | not needed/requested | not run |
| beagle-voyage | validation | 0s | 7 | not needed/requested | not run |
| railway-1830 | validation | 24s | 16 | recovered | not run |
| apollo-earth | validation | 0s | 6 | recovered | not run |

## Remaining findings

- **War:** new receipts supported the overall outcome and a disputed proposed ordering. The generated story still overstated Taiwan resistance as fighting between Japan and China until November and gave an unqualified Pyongyang fall date. Independent review distinguishes the participants, October/November endpoints, and the attack versus occupation. A sourced checklist can still freeze an overstatement.
- **Waterloo:** source review rejected before/after relations between composite claims that overlap: collapse, retreat, pursuit and a commanders' meeting cannot be treated as wholly sequential bundles. The bounded repair did not produce a supported checklist, so no story was published.
- **Beagle:** the pipeline caught a missing actor category, a later-period claim under an early heading, and then a route requirement credited without a rendered route. No opening committed.
- **Apollo:** recovery fetched prelaunch evidence, but subsequent checklist validation still omitted the actor category and failed essential-scope review. The lookup worked; the revised checklist did not pass.
- **Railway:** targeted evidence clarified the procession's continuation. Source review rejected treating a planned reception as an accomplished event. Two chapters then committed; both final attempts failed the mapping from requirement r6 to claim-linked rendered actions. The ending remained unpublished despite available review capacity.

These failures remain in the data. No failed or partial attempt is replaced by a favorable pilot, and no new 20-case run was started. The coding agent read the final committed story and rejected/partial traces; this was not independent human historical review.

## Verification and artifacts

All **113 automated tests**, TypeScript, the production build and the offline five-story/15-fact reference validator passed. Tests include completing two generation/review repairs in thirteen model calls and asserting the exact remaining-call reserve at every stage. No browser UI changed.

The [durable snapshot](../evals/results/2026-10-31-completion-budget.json) retains pilot and final cohorts, usage snapshots, reservations, recovery topics/results, source reviews, rejected candidates' reasons and independent audits. Full local receipts and candidate/scene traces are under ignored `artifacts/evaluations/completion-budget-reference-5/` and `artifacts/evaluations/completion-budget-v2-reference-5/`. The final interactive report is `report.html`; the compact chart is `summary.html` in the latter directory.

The pilot completed one independently accepted Waterloo story, with two clarifications and two validation stops. It made two recovery lookups with new receipts and cost an estimated **$0.542**. These unpaired pilot results are not pooled with the final run. Both cohorts total a recorded estimate of **$1.181**, subject to the cost exclusions below.


## Limits

The work ceilings are now aligned with the extra preparation steps, while reservations protect remaining required reviews. They cannot make unsupported text accurate, prevent every model error, or guarantee completion before timeout. Source recovery is bounded and may not find the missing evidence. A compact checklist can still misjudge what is essential.

Results are unpaired small samples with fresh source retrievals. Development used failures in these reference stories, so they are not an unseen generalization benchmark. Model costs are estimated from the saved rate card and exclude unreported provider usage, cache-write surcharges, taxes, hosting and any separate metadata-service charges. Input counts are additional HTTP requests and their time is included in model-stage elapsed measurements.
