# Review fixes and follow-up review

The default harness version is `stream-review-v1`. The repository has no baseline commit, so this review examined the current implementation, with emphasis on the reported compiler and replacement-flow findings. Existing historical evaluation results remain unchanged; this work does not claim to eliminate model historical errors.

## Original findings

1. Generated relationship notes containing an earlier date could be rejected under the later event's heading. The compiler now supplies a narrowly scoped reference window for each server-generated relation note, using the other event's already validated heading. Ordinary narration, qualifiers and headers do not receive this exception. Both mapped speech notes and text-only chapter notes are covered. This does not grant arbitrary text access to the full story period.
2. Before relations allowed an earlier campaign to continue past the later event's start, then rendered `After ...`. Validation now requires a feasible end-before-start ordering, accounting for both start and end constraints on partially specified endpoints. Exact overlapping campaign intervals fail; coarse year/month precision and sourced same-day ordering remain possible. Source review is still responsible for whether that ordering is historically established.
3. Ordinary replacement requests discarded the current scene before generation succeeded. The client now waits for a validated playable batch before adoption. HTTP errors, protocol errors, truncated/failing focus-only streams and cancellation preserve the existing scene. Back history and visited titles reset only when an ordinary replacement actually adopts. Successful replacement resets the new playback clock as before.

## Follow-up findings fixed

- Superseding a paused discovery with another request could strand the old scene in its temporary paused state. Pause ownership is restored before the replacement snapshots playback; stale requests cannot restore or overwrite a newer request's state.
- The sourced year-union check treated the nonexistent year zero as a gap between 1 BCE and 1 CE. Historical adjacency now skips zero, while genuine unsupported gaps remain rejected.
- Crossing-era labels now explicitly mark the CE endpoint. The date parser reads explicit era markers per mention instead of applying a single BCE sign to an entire mixed-era sentence.
- Coarse mentions such as `in 1300` are compatible with a specific day in that year. Chapter bounds and typed event windows still require containment; disjoint narrated dates still fail. Linked endpoints of explicit narrated year ranges are checked, and measurement ranges are not treated as event years.
- Explicit era prefixes, including AD/BC before a year, are recognized by the date-validation eligibility check as well as the sign parser.

## Further temporal review

- Pairwise date checks could accept an impossible chain: a coarse-dated middle event might have to follow July 20 and precede July 10. The compiler now propagates bounds through all event start/end constraints, including before relations, overlaps and undated intermediary events. It rejects joint contradictions while preserving feasible coarse and same-day ordering. Relation input order does not affect the result.
- Bare year ranges such as `1300–1301: the campaign continued` could bypass narration checks. Both endpoints are now checked in statements, titles and qualifications, including word separators and explicit era prefixes/suffixes. Quantity ranges remain measurements; calendar dates and compact day ranges keep their existing interpretation.
- The follow-up review reproduced additional parser gaps. Explicit eras now take precedence over quantity-word guards, short BCE/CE years retain their precision, and recognized invalid calendar dates fail instead of falling back to a whole year. Short CE years are marked explicitly in generated event labels to distinguish month/year from month/day.
- Precise BCE-to-CE headings used a whole-year fallback even after endpoint era parsing was available. They now preserve the actual day/month bounds, so narration outside those bounds is rejected.

The harness version changed to keep future evaluation resumes separate from earlier compiler behavior. No paid inference was needed for these regressions.

## Additional stream and compact-range review

- Compact day ranges without a repeated year could have just one endpoint checked, allowing `July 16–24` under a July 16 heading or `16–24 July` under July 24. Both endpoints now inherit the shared year/era or active year. Word separators (`to`, `through`, `until`) and short BCE years receive the same checks. Named month ranges also check both endpoints instead of overlooking a month that omits its year.
- The NDJSON decoder parsed every line in a network chunk before returning any of them. Malformed JSON or an oversized trailing record could therefore discard an earlier valid batch, depending on network chunking. It now yields records progressively. A shared byte decoder also preserves earlier records when a later record contains invalid UTF-8. The client and upstream adapter use this same decoder; record limits, split UTF-8, CRLF and unterminated final records remain covered.
- Cancellation still prevents queued commits, and takes precedence over malformed queued data. Regressions exercise single-chunk and fragmented responses, confirming that valid batches remain playable and invalid records never commit.

## Verification

- 164 unit/contract tests pass, including the offline reproductions and additional chain, overlap, range, calendar, era, stream-chunking and cancellation regressions.
- All 20 managed Playwright browser tests pass again with the updated shared stream decoder. Those cover failed ordinary replacements (HTTP, protocol, focus-plus-error and truncated-focus), pending cancellation, successful subsequent replacement, superseded discovery pause ownership and retained Back history.
- TypeScript, the production build and the offline five-story/15-fact reference validator pass.
- Only Playwright's managed test server was started for the latest round, and it shut down after the suite. No application or test server remains listening on ports 3000 or 3100.

The final review rechecked reference-window ownership, joint interval feasibility, calendar parser boundaries and precision, incremental JSON/UTF-8 decoding, record limits, adoption timing, history preservation, cancellation and stale-request guards. No further actionable findings remained in the reviewed code. Tests establish these software behaviors; they are not a historical-accuracy certification. No paid model evaluation was rerun for these deterministic fixes.
