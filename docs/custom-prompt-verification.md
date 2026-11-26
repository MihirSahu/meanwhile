# Custom-prompt debugging and live verification — 2026-11-07

This is the earlier `coverage-recovery-v1` debugging cohort. Subsequent World War I/II failures showed that these five completions did not establish broad-topic reliability. See [world-war recovery](world-war-recovery.md) for the current `broad-evidence-v3` behavior and fresh/cached app checks. The implementation details and test counts below describe this earlier milestone.

The `coverage-recovery-v1` workflow produced complete, reviewed live scenes for the five prompts below using the configured `gpt-6.1-terra` model with low reasoning effort. These were new generations, not curated-story fallbacks. The user explicitly authorized running the app, trying prompts and fixing failures in this session.

| Prompt | First playable scene | Playback duration | Scene model calls | Evidence trace |
| --- | ---: | ---: | ---: | --- |
| The American Revolution | 95.2 s | 110 s | 9 | `american-final` |
| The French Revolution | 77.9 s | 135 s | 7 | `french-final` |
| The Hungarian Revolution of 1848–1849 | 122.8 s | 173 s | 9 | `hungary-1848-candidates` |
| The Meiji Restoration | 86.6 s | 82 s | 7 | `meiji-candidates` |
| The Hungarian Revolution → choose 1956 in the app | 96.4 s | 137 s | 9 + 1 resolver call | `hungary-browser-success` |

The American Revolution also completed through the app UI in an earlier 77.1-second run. The ambiguous Hungarian prompt returned two choices, 1848–1849 and 1956. Selecting 1956 produced a complete scene with no error. Live browser checks covered pause, seeking to the 137-second ending and replaying back to the beginning; the replay was then paused at 0.8 seconds. All saved successful streams were independently replayed through `SceneBuffer`, checking `mode: live`, the final boundary and protocol validity. Washington's visible role was checked in the American scene.

The saved fetched sources, generated streams and related test artifacts were subsequently deleted at the user’s request. The results here are historical observations; the underlying evidence directory and `verification.json` are no longer available.

## Failures that informed the changes

Earlier attempts in this same session failed. They were recorded separately and were not counted as successful; their saved artifacts were subsequently deleted at the user’s request. Examples include an American story asking the visitor for Yorktown date evidence, Hungarian stories losing required context or relabeling later outcomes as introductory context, and French/Meiji stories containing corrupted role labels, unsupported locations or invalid repair bookkeeping. The code evolved between attempts; these observations are debugging evidence, not an unchanged-cohort success-rate benchmark.

The implemented changes address those paths:

- Research asks for an overview covering context, principal roles, dated developments and the immediate outcome. Actual search-result URLs can become additional fetched candidates, within the existing eight-page limit; snippets and model summaries still cannot support claims.
- Two focused rereads of already fetched documents can recover omitted passages without new model or network requests. Evidence merging uses the forty-receipt budget across sources, retaining earlier coverage when capacity permits instead of always replacing a source's first five excerpts.
- Lookup questions stay attached to fresh extraction and review. An unused lookup can also resolve a late planner evidence gap, rebuilding and reviewing the checklist before anything publishes. Only source-reviewed preparation is cached.
- Scope remains sufficient for a concise account. Principal actors need their event roles, without automatically requiring their complete later biographies. Unsupported optional detail can be omitted. The compiler owns schematic disclosure captions, keeping asset implementation requirements out of historical narration.
- Natural role phrases have room for complete words. Long name/role combinations receive separate timed, cited notes instead of exceeding map-label bounds. Unlocated Earth events can use text-only narration; broad national topics can use a sourced regional context anchor for focus.
- Semantic repairs use indexed edits, preserving untouched records, existing kinds and date presence. Ordinary edits retain server-owned order; splits and explicit reordering remap focus and relations on the server. Every resulting scene still passes compilation and complete-scene source review. Distinct follow-up findings can use the remaining shared repair; identical unresolved findings stop.

The sixteen-call, 288k input-token and 36k output-token limits, configured deadline, two shared repairs and disabled SDK retries remain in force. Reviews are separate calls to the same configured model. No factual rejection is suppressed to make a scene publish.

## Verification limits

Live completion demonstrates that these custom prompts can produce playable scenes. It does not guarantee every future prompt or certify historical accuracy. The broader twenty-case historical acceptance gate and independent human historical review were not rerun. Earlier reference-cohort failures remain documented separately.

Offline verification covers source provenance/retention, bounded rereading and late recovery, preserving coverage questions, complete role text, indexed edits, immutable kinds/date presence, relation/focus remapping and existing streaming/playback contracts. The final production/browser check results and server shutdown were recorded in the subsequently deleted `verification.json`.

Final checks passed: 234 offline tests, 23 managed browser tests, TypeScript, the production build and the five-story/15-fact offline reference validator. The app server and managed browser-test server were stopped; ports 3000 and 3100 had no listeners. The owned preview tab was closed.
