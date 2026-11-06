# Story completeness evaluation — 2026-10-31 UTC

The `story-coverage-v2` harness was checked with the five reference stories first, then the full 20-prompt set. All calls used `gpt-6.1-terra` / `low`, cold application research caches, three case workers and the existing bounded repairs. No warm or staged repetitions were included. The reference facts were withheld from generation and supplied only to the independent audit.

## What changed

Plans now require sourced context, principal actors and an explicit outcome, plus the user's requested concepts and necessary caveats. Each production review checks actual rendered actions against those requirements. Future requirements can remain pending until their chapter deadline; the ending cannot commit while any requirement is missing. Continuations receive the full approved plan and remaining requirements. Deterministic date checks reject explicit dates outside the visible heading, including differences within the same year.

An initial five-case pilot completed Beagle, Waterloo and Apollo, with two validation failures. Beagle reached its ending rather than stopping at 12 seconds. Apollo used separate headings for preparation, launch and recovery, addressing the prior stale launch-date heading, but still failed its independent audit for other presentation and coverage issues. Waterloo passed its independent audit. A separate war diagnostic also completed and passed; it does not replace the failed pilot attempt.

The first full-set attempt exposed an overly strict requirement rule: it rejected later treaty signatories and later battlefield context merely because they were scheduled after chapter 0, even when introductory context and actors were already due in the opening. That run was interrupted, retained separately and not included in the final cohort. The corrected rule requires an introductory context and actor requirement in the opening while allowing additional details later. The corrected harness received a new version and was evaluated from fresh caches; failed earlier attempts remain in the snapshot.

## Final measurements

- **9/20** complete 36-second stories, all with every self-planned requirement covered at final review.
- **7/20** clarifications: all four intentionally ambiguous cases, the broad comparison, Silk Road and Mansa Musa. The last two did not meet the benchmark's expected completion.
- **2/20** source-access failures (Indian Ocean and Meiji); **2/20** validation failures before publication (Haitian Revolution and Bronze Age uncertainty).
- Independent audits of completed stories: **3 accepted, 4 needing review, 2 failing**. Overall audit acceptance was **3/20 attempts**. Every completed story received an audit; none was unavailable.
- **33** pre-commit proposals reviewed, **6** rejected by semantic/coverage checks. The diagnostic trace records **8** total rejected candidates, also including structural/date checks. Repairs can result in a later accepted proposal.

Median first-playable time among completed stories was **41.6 seconds**, p95 **60.0 seconds**. Estimated full-workload cost, including failed attempts and independent audits, was **$1.543**; estimated cost per audit-accepted story was **$0.514**. No latency or accuracy improvement over the prior milestone is established by this unpaired run.

| Case | Outcome | Playable | Independent audit |
| --- | --- | ---: | --- |
| sino-japanese-war | complete | 36s | pass |
| silk-road | clarification | 0s | not reviewed |
| waterloo | complete | 36s | pass |
| beagle-voyage | complete | 36s | needs_review |
| railway-1830 | complete | 36s | fail |
| apollo-earth | complete | 36s | fail |
| indian-ocean | evidence | 0s | not reviewed |
| silk-road-premise | complete | 36s | needs_review |
| industrial-comparison | clarification | 0s | not reviewed |
| shimonoseki | complete | 36s | needs_review |
| meiji | evidence | 0s | not reviewed |
| french-revolution | complete | 36s | needs_review |
| haitian-revolution | validation | 0s | not reviewed |
| mansa-musa | clarification | 0s | not reviewed |
| bronze-age-uncertainty | validation | 0s | not reviewed |
| waterloo-quote | complete | 36s | pass |
| ambiguous-civil-war | clarification | 0s | not reviewed |
| ambiguous-revolution | clarification | 0s | not reviewed |
| ambiguous-battle | clarification | 0s | not reviewed |
| ambiguous-time-place | clarification | 0s | not reviewed |

### Five-reference checks

The fresh reference-first cohort completed the war, Waterloo and Apollo stories, all rated `needs_review`; Beagle requested clarification because retrieved passages supported only one dated stop, and railway failed source review before publication. Those outcomes are not replaced by the later full-set samples. The reference-first cohort cost an estimated $0.502. All saved cohorts, including pilots, the war diagnostic and the interrupted attempt, total an estimated $2.833; in-flight usage lost when interrupting the earlier run may be absent.

In the full cohort, all five reference stories completed: war and Waterloo passed independent audits, Beagle needed review, and railway and Apollo failed. The coding agent also read their committed text; [review notes](../evals/story-completeness-review-notes.json) keep the two cohorts separate.

- **Beagle:** the full-set sample renders the coastal survey purpose, reaches the 1836 return in its final 1835–1836 chapter and completes all 36 seconds. Independent review still questions a vague claim about Darwin recognizing patterns during later study.
- **Waterloo:** the full-set sample names Napoleon, Wellington and Blücher and states defeat, retreat and pursuit. Its audit passed with a warning that compressed wording makes Prussian arrival sound too immediately decisive.
- **War:** Korean context, July fighting, the April 17 treaty and continued fighting in Taiwan are rendered. Its audit passed with qualifications about the armistice and later territorial changes.
- **Apollo:** recovery appears under July 24, separately from the July 16 launch heading. The full-set sample nevertheless omits Pacific splashdown, Hornet's actual recovery role and the missing-spacecraft explanation. These missing concepts were absent from its plan, illustrating a false acceptance by production coverage.
- **Railway:** the ending can imply Huskisson died before the party continued to Manchester; its title also oversimplifies the arrival. The production semantic gate missed these sequencing/presentation problems.

Observed pre-publication checks caught a Haitian opening that named plantations without explaining enslaved labor, a route that skipped a documented intermediate stop, dropped committed coverage, a truncated ending caption and inconsistent date windows. Successful repairs stayed uncommitted until accepted. Haiti's repair still lacked sufficient evidence and stopped; the Bronze Age draft also stopped on date validation. These gate decisions are model/structural checks, not proof that every accepted scene is correct.


## Interpretation and limits

Production coverage and independent audits use separate calls to the same configured model. Neither is human historical certification. A planner can still omit a necessary concept, a reviewer can misjudge rendered wording, and inaccessible or thin sources can prevent a story from completing. The five-story reference set remains agent-source-checked with human review pending.

Date parsing recognizes common English labels and ISO dates, with typed-year fallback for ambiguous forms. It does not implement general historical calendar conversion or resolve timezone differences. Passing the date check establishes consistency for recognized dates, not historical correctness.

Different source retrievals, model samples and the stronger generation requirements prevent a causal accuracy comparison with earlier milestones. Latency figures apply to completed scenes only; workload costs include failed attempts and independent audits. Costs use the saved estimated rate card and exclude tax, hosting, cache-write surcharges and unreported failed-provider usage.

## Artifacts and checks

Full local research, rejected candidates, gate decisions, coverage and committed NDJSON are under ignored `artifacts/evaluations/`. Durable condensed results are saved in [the result snapshot](../evals/results/2026-10-31-story-completeness.json). Earlier pilot and interrupted-run artifacts are preserved separately. The final full report is `artifacts/evaluations/story-coverage-v2-20/report.html`; the reference-first report is `artifacts/evaluations/story-coverage-v2-reference-5/report.html`. A compact chart is saved alongside the full report as `summary.html`.

Offline verification: 88 automated tests, TypeScript and a production build passed. The five-story reference validator passed for all 15 facts without network calls. No browser UI changed in this milestone.

See [the implementation and reproduction commands](story-completeness.md).
