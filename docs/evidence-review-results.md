# Evidence binding and review calibration — 2026-11-05

The `evidence-review-v1` cohort completed **2/5** stories. Separate model-assisted audits accepted **0**, marked **1** for review and failed **1**. Incomplete attempts were not independently audited. These are historical quality measurements, separate from passing compiler and protocol tests.

Runs used `gpt-6.1-terra` / `low`, cold application research caches and two workers. Reference facts were withheld from generation. The audit retrieves separate evidence but uses the same configured model; independent human historical review remains pending. This is a fresh, unpaired cohort and is not pooled with earlier results.

## Measurements

| Case | Generation | Published duration | Model calls | Multi-claim events in approved plan | Separate audit |
| --- | --- | ---: | ---: | ---: | --- |
| sino-japanese-war | validation | 0s | 4 | 0 | not run |
| waterloo | complete | 100s | 9 | 1 | fail |
| beagle-voyage | validation | 0s | 4 | 0 | not run |
| railway-1830 | complete | 80s | 9 | 5 | needs_review |
| apollo-earth | validation | 0s | 11 | 0 | not run |

Estimated total cost including failures and audits was **$0.595**. Checklist preparation/review cost **$0.204**, and targeted lookup cost **$0.027**, both included in that total. **1/1** recovery attempts added receipts. There were **0** budget stops. The cohort recorded **5** compiled-scene review attempts and **3** rejections; approved plans contain **6** events selecting multiple claims.

First-play timings among complete stories: waterloo 119.4s, railway-1830 95.7s. Whole-scene review finishes before publication. Failed attempts are excluded from completion-only latency. Cost per independently accepted story is undefined because no story was accepted.

## Findings

- **War:** checklist preparation omitted the actors category, then source review rejected an incomplete claim link for the opposing powers. It stopped before event planning.
- **Waterloo:** a 100-second scene used a multi-claim event. Its independent audit failed on the implied timing of Plancenoit fighting and a focus centered near Ligny. It also requested qualifications for the commanders' meeting location and casualty totals. The pre-publication review had corrected a different unsupported causal statement and before/after relation, but missed these remaining problems.
- **Beagle:** checklist preparation omitted the actors category, then failed to qualify conflicting departure dates in its supplied passages. It stopped before event planning.
- **Railway:** an 80-second scene used five multi-claim events and passed compiler containment checks. Pre-publication review required the exclusive-steam context, urgency of the rescue trip and qualification of the return/death ordering. The separate audit still requested qualification of Wellington's destination and the completeness of the medical-attendant count. It was marked needs_review, not accepted.
- **Apollo:** after targeted evidence recovery, event review rejected an Earth coordinate/city marker for a lunar event, missing final-training wording and missing contamination-protection context. No scene was published.

These are saved model/reviewer findings, not human certification. The coding agent inspected the committed scenes and rejection/audit traces. The new review inputs did not establish a general accuracy improvement. The larger twenty-case evaluation is deferred because the existing gate requires at least four completions, three independently accepted stories and no failed audits.

## Implementation and verification

The [implementation](evidence-review.md) allows complementary evidence from multiple frozen claims, assigns exact citation unions, rejects unsupported date gaps and supplies structural validation receipts to the reviewer. No arbitrary review rejection is suppressed by matching reason text. Historical sequence, uncertainty, atomicity, locations and essential coverage remain model judgments.

All **133 tests**, TypeScript, the production build and the offline five-story/15-fact reference validator passed. Replays cover saved Apollo recovery evidence and Railway's full-year headings, plus a Waterloo disputed-location fixture using an explicitly synthetic disagreement passage and mocked reviewer veto. The mock tests verify evidence transport, citation ownership and publication gates; they do not measure model historical accuracy. A month-precision regression covers February and April windows. No browser UI changed or browser test run is claimed.

[The durable snapshot](../evals/results/2026-11-05-evidence-review.json) retains the report, full source receipts, model usage, reservations, rejected candidates, server validation receipts and independent audits. Raw local files are under ignored `artifacts/evaluations/evidence-review-reference-5-2026-11-05/` with `report.json`, `report.html`, `summary.html` and per-case traces/NDJSON. Earlier event compiler cohorts are preserved in [their original results](event-compiler-results.md).

Costs use the saved 2026-10-30 rate card, not a new pricing quote, and exclude unreported charges, separate metadata-service charges, cache-write surcharges, taxes and hosting. Input-count request latency is included. Development has used these reference failures, so this is not an unseen generalization benchmark.
