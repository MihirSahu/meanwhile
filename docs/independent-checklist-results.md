# Independent checklist evaluation — 2026-10-31 UTC

The final five reference cases were evaluated using `independent-checklist-v3`, `gpt-6.1-terra` / `low`, cold application research caches, two workers and the unchanged request/token/repair limits. Reference facts remain withheld from generation. Independent audit calls use separately retrieved evidence and the same configured model; human review remains pending.

## Pilot and correction

The first five-case pilot (`independent-checklist-v1`) completed no stories: two clarifications and three validation failures. It exposed an overly strict ban on additional requirements and a misread checklist premise about a railway party's subdued mood versus its reception. All pilot outcomes are retained separately. The revised harness permits additional sourced requirements while preserving the frozen essential subset and adds source review before freezing. It therefore adds two preparation calls, rather than the pilot's one.

The first revised five-case attempt encountered provider errors in all five cases before any opening; its recorded usage estimate was $0.022. A separate source diagnostic subsequently succeeded. A new serial five-case run records safe provider stage/status/code metadata and remains separate from the failed attempt. No failure is reclassified into a pass.

The serial revision (`independent-checklist-v2`) completed no stories: four validation failures and one clarification. Source review caught unsupported temporal relations and missing route evidence. It also exposed a coverage mismatch: the UI displays focus title/period/location, but the checker excluded that text and rejected a story for not repeating Belgium in narration. A war outline also reached its character limit mid-sentence. The final revision credits only those actually visible header fields and clarifies brevity and repair instructions for uncommitted summaries. All prior samples remain separate.

## Targeted reviewer checks

Four real-model calls against the final `independent-checklist-v3` reviewer used synthetic passage fixtures to test two known wording failures and corrected controls. With the request scoped to the concepts actually supplied by those fixtures, the reviewer rejected Apollo's generic return without Pacific splashdown/recovery and the railway ending that placed continuation after death, while accepting both corrected controls. Temporal results explicitly marked the bad sequences `revise` and the corrected sequences `consistent`. That is 4/4 expected decisions against supplied fixture evidence, not historical accuracy certification.

An earlier replay rejected Apollo's corrected control because its prompt also requested preparations, which the fixture did not establish. The railway control passed. This 3/4 result is retained separately; the later replay corrects the test's request scope rather than adding unsupported facts. The synthetic facts and action construction live in `tests/fixtures/checklist-regressions.ts`; the scoped Apollo request was “Show Apollo 11's mission purpose, crew and Earth return.”

## Measurements

The final five-case cohort completed **2/5 stories**. Independent audits accepted **0**, rated **1 needs_review**, and **1 fail**. Beagle stopped on validation before publication; Apollo clarified because the fetched passages lacked July preparation details; railway stopped on the unchanged generation budget while preserving **24 playable seconds**. No final railway audit was run.

Both completed stories passed production rendered-coverage and temporal-relation checks. Their independent historical findings show that source interpretation and checklist selection remain fallible. The gate for a full 20-case evaluation was not met, so no full run was started.

Median checklist preparation time was **29.1s** across all five attempts, including extraction/source review and any preparation repairs. Preparation cost was an estimated **$0.130** total (**$0.026 per attempt**, mean), already included in the **$0.677** workload total. Workload cost includes failed attempts and the two independent audits. Cost per audit-accepted story is undefined because none was accepted.

Among the two completed stories only, first-playable p50 was **83.4s** and p95 **102.6s** (nearest-rank percentiles). Railway's first playable batch arrived at **117.8s**, but its incomplete run is excluded from those completion-only percentiles. These are small, unpaired measurements; they do not establish an accuracy or latency improvement.

Checklist source review assessed **5** proposals and rejected **1**. Scene evidence review assessed **11** proposals and rejected **3**. Traces record **6** rejected candidates across source/structure/scene checks. Repaired proposals and rejected ones remain distinct.

| Case | Outcome | Playable | Preparation | Prep estimate | Independent audit |
| --- | --- | ---: | ---: | ---: | --- |
| sino-japanese-war | complete | 36s | 29.1s | $0.0259 | fail |
| waterloo | complete | 36s | 18.9s | $0.0131 | needs_review |
| beagle-voyage | validation | 0s | 36.1s | $0.0317 | not run |
| railway-1830 | budget | 24s | 44.1s | $0.0494 | not run |
| apollo-earth | clarification | 0s | 4.3s | $0.0096 | not run |

### Remaining findings

- **War:** the ending correctly includes continued Taiwan fighting after the treaty, but characterizes it too simply as fighting between Japan and China until November. The audit requires distinguishing Republic of Formosa forces, former Qing troops and local militias, and qualifying the October/November endpoint. The frozen checklist and its source review did not prevent this overstatement.
- **Waterloo:** principal actors and the defeat/retreat are rendered. The audit questions the statement that the source passages leave Prussian arrival versus the Guard's collapse unordered; independent sources establish a broader sequence. A caution about limited excerpts can itself mislead when rendered as historical uncertainty.
- **Beagle:** an initial checklist omitted the actor category and was repaired. Opening generation then put an 1836 claim under an 1831–1832 heading; the repair still failed claim-linked coverage. No focus or batch was published.
- **Railway:** checklist review added missing participants/return scope, and an opening repair added the crowds along the route. After two accepted chapters, the final review could not start because the story had reached the unchanged work limits: 12 model calls and over 120,000 observed input tokens. The ending was withheld. Nine normal calls plus two full generation/review repairs can exceed this request ceiling; the implementation does not silently raise it. The live ending's chronology therefore remains unverified.
- **Apollo:** fetched passages supported launch and recovery but not the requested July preparations. It clarified rather than silently dropping that scope. The synthetic reviewer controls exercise the missing Pacific/Hornet wording, but cannot substitute for a completed live Apollo story.

The coding agent read the final committed texts and traces; [review notes](../evals/independent-checklist-review-notes.json) separate contract/reviewer behavior from historical certification.


## Interpretation

Checklist extraction is independent of scene planning but not an independent historian or a different model. A frozen checklist can still omit a necessary concept. Semantic chronology judgments can still miss ambiguous text. Source-access gaps can lead to clarification or failure. Passing production coverage and order checks does not imply passing the held-out reference audit.

Earlier cohorts are unpaired samples with different source retrievals. Development regressions target failures found in these reference stories, so this is not an unseen generalization benchmark. Checklist-stage time and cost are measured directly, while overall latency/quality differences cannot establish causality from one small run. Cost estimates use the saved rate card and exclude cache-write surcharges, taxes, hosting and unreported failed-provider usage.

Verification: 102 automated tests, TypeScript, the production build and the offline five-story/15-fact reference validator passed. No browser UI changed. See [implementation and reproduction](independent-checklist.md).

## Saved artifacts

The [durable result snapshot](../evals/results/2026-10-31-independent-checklist.json) preserves the initial pilot, service-failure attempt, serial revision, final five-case cohort and all synthetic critic replay cohorts separately, including usage, source reviews, immutable requirements and temporal decisions. Full passages, candidates and committed NDJSON are local under ignored `artifacts/evaluations/`.

The final report is `artifacts/evaluations/independent-checklist-v3-reference-5/report.html`; the compact chart is `summary.html` in that directory. Current reviewer controls are under `artifacts/evaluations/independent-checklist-critic-replay-v3/`. One successful standalone research diagnostic has no saved usage and is excluded from recorded cohort estimates. Failed-provider usage may also be unreported.

All saved cohorts in this milestone total an estimated **$1.445**, including pilots, the provider-failure attempt and all critic replays. This is a recorded estimate, not a bill, and excludes the unsaved diagnostic and any unreported provider usage.
