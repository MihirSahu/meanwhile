# Evidence binding and review calibration

This preceding milestone introduced `evidence-review-v1`; the current default is documented in [scene reliability](scene-reliability.md). The harness uses a minimal set of frozen claims for each atomic event. `claimIndices` replaces the singular `claimIndex` in the internal strict plan schema. The browser protocol is unchanged.

Each selection must be nonempty, unique and refer to an existing frozen claim. Locations, dates, participants and statements may draw complementary evidence from the selected claims and their own fetched passages. Combining claims does not permit combining distinct occurrences, inventing locations or suppressing disputed interpretations. No new claim can be added after freezing.

The compiler derives the union of claim IDs, actual passage source IDs and chapter citations. Requirement-to-event candidates use claim intersection; semantic coverage must still pass review. Reviews receive the original event index and all selected source claims. Returned passage IDs must belong to that event's selected evidence basis. Unsupported extra passages still fail server validation.

Dated events must fit a covered union of their selected claims' historical year intervals. The compiler does not fill gaps between intervals. It validates actual event windows against the visible chapter window, including month precision, and checks explicit dates in narration/labels using the existing conservative parser. Undated context with known claims entirely outside the chapter period fails. Railway markers retain the 1800 visual-era restriction, including when an undated context relies on frozen claim years.

After the entire scene passes `SceneBuffer`, compilation produces a `structuralValidation` receipt: protocol and citation validity, and each event's heading, chapter window, typed event window and containment result. Review input includes these server facts. The prompt distinguishes numeric containment/ID validity from historical correctness: a heading of 1830 contains 15 September 1830, while whether that date or an implied before/after relationship is supported remains a source-review question. This is prompt calibration, not a guarantee that the model never returns a false positive. The application does not erase or reinterpret arbitrary model rejections based on their wording.

Model review continues to veto unsupported facts, omitted essential scope, composite occurrences, misleading markers and unjustified certainty. Disagreement established by supplied passages must remain qualified in actual visible wording. Independent audit still uses separate retrieval and the configured model; it is not human certification. The normal resolved path remains five model calls, with existing bounded repairs, recovery, cancellation and budget reservations.

## Saved failure regressions

`tests/fixtures/event-failures.json` retains the original plans, frozen checklists, research and reviews from the earlier Railway, Apollo and Waterloo attempts. It is test-only input, not production generation evidence.

- Apollo's saved recovery event selects the splashdown/location claim and the frogmen/recovery claim together. Tests check exact action/citation unions, combined review evidence and rejection of unrelated passage IDs.
- Railway's saved plan compiles under full-year headings with explicit numeric containment receipts. Mocked semantic review still rejects its corrupted roles. A future narration date remains a hard server failure.
- Waterloo's saved independent audit flagged a disputed meeting location. The regression adds an explicitly synthetic disagreement receipt to exercise qualification and the review veto. It checks rejection of unqualified wording and retention of revised attribution in rendered narration. It does not claim that a mocked reviewer verifies history or that the original frozen evidence already contained the dispute.

Additional tests cover empty/duplicate/unknown indices, unsupported date gaps, future claims hidden as undated context and month-precision windows. The legacy staged harness retains its previous per-claim temporal checks. The implementation passes 133 automated tests, TypeScript, production build and offline reference validation. Current measurements are recorded separately in [results](evidence-review-results.md); earlier cohorts are preserved.
