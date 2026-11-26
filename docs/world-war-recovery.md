# Broad-topic research and repair — 2026-11-07

The reported World War I failure asked the visitor to supply sources for the war's origins and major developments. That was an internal research gap, not an ambiguous prompt requiring more specificity. The investigation reproduced failures in retrieval, cached-source rereading and event repair. Earlier five-topic completions remain documented in [custom-prompt verification](custom-prompt-verification.md); they did not establish general reliability.

## Changes

- Initial fetched excerpts reserve space for origins, leadership, developments and outcomes, reducing the chance that one phase fills every excerpt slot. Targeted recovery searches only the missing facts. Evidence still consists of actual fetched text with document hashes, offsets and retrieval times.
- A new provider using the research cache can reread registered source pages, refetching them through the existing safe reader when document text is absent. Cold rereads reuse document text. A missing-coverage finding evicts the weak cache entry. Only subsequently source-reviewed preparation is cached.
- The atomic workflow permits two rereads and two searches for distinct gaps, within the original sixteen-call, 288k input-token, 36k output-token and configured deadline limits. Repeated identical search questions cannot loop. Exhausted research returns a service error; the research question stays in terminal diagnostics rather than asking visitors to do the research.
- The fact ledger permits eighteen compact facts, allowing separate temporal support without dropping a theater or outcome. The event limit increases from fifteen to eighteen: a full reviewed war overview could require eighteen atomic developments, while the old planner was repeatedly asked to compress the same fifteen slots. Six events per balanced chapter leave room for all actors, notes and twelve relations under the hundred-action batch cap. Eight essential requirements, eight sources, forty passages and the global token/call/deadline limits remain in force.
- Checklist repairs and event repairs have separate two-correction allowances. Indexed edits can remove optional records to make room for necessary splits, then remap focus and relations. Event/context reclassification is allowed where appropriate; outcomes cannot become introductory context and dated occurrences cannot lose their dates.
- A planner's capacity problem triggers one internal replan with the same frozen evidence and latest semantic review. It does not initiate research or consume a factual repair. Subsequent semantic corrections retain earlier objections to reduce regressions. Every resulting complete scene is still reviewed before publication; no rejection is suppressed to force completion.
- Story scope is separate from the mapped camera anchor, so a global story can say “Worldwide” while initially showing a supported main location.
- Planning and constrained date repair distinguish a campaign's onset from its whole duration. A frozen assertion that an offensive began in 1942 can date that onset; attaching the campaign's 1943 ending to it previously caused an unnecessary evidence rebuild. The repair must preserve the actual assertion and cannot date a completed outcome only by its beginning.

## Live observations

These requests used the configured `gpt-6.1-terra` model at low effort and produced generated scenes, without curated fallbacks. The resolver ran separately from scene generation.

| World War I app request | Scene preparation | Scene calls | Playback | Result |
| --- | ---: | ---: | ---: | --- |
| Fresh research | 80.9 s | 7 | 137 s | Complete |
| Cached research after separate repair budgets | 54.6 s | 4 | 142 s | Complete |
| Repeated cached research with the expanded ledger | 98.5 s | 8 | 174 s | Complete |

The UI showed World War I with `mode: live`, three batches and no alert for the successful requests. An intermediate cached attempt failed before the repair allowances were separated. At the user’s request, the saved fetched sources, generated streams, replay script and test logs were subsequently deleted. The timings here are historical observations; the underlying test artifacts are no longer available.

These UI checks preceded the final increase from fifteen to eighteen event records. The latest capacity change is covered by full-size compiler/repair regressions and the production browser suite; its live result is recorded separately below.

World War II also completed in the `ww2-phase-budget` smoke run: 122.6 seconds, nine scene calls. Other World War II attempts failed as the implementation evolved, including capacity treated as evidence, lost semantic feedback, truncated model wording and chronology objections. Those failures were recorded separately and were not counted as passes; their artifacts were subsequently deleted at the user’s request. These are debugging observations across changing code, not a fixed-cohort success-rate benchmark.

The first eighteen-record cold run (`ww2-eighteen-records`) failed after 171.8 seconds and twelve calls. A Guadalcanal-onset claim bounded to 1942 was planned as the full 1942–43 campaign. Date repair unnecessarily requested more evidence; the rebuilt checklist then failed source review. The larger record limit alone did not resolve that path.

After the onset-specific instruction change, `ww2-onset-replay` completed in 87.6 seconds with six new model calls and 141 seconds of playback. Checklist extraction, source review, planning and complete-scene review ran again against the saved real fetched receipts; the complete scene passed `SceneBuffer` validation. This verifies a saved-source replay, separately from fresh research or an app UI request. The latest code has not yet demonstrated repeatable fresh-research World War II completion. Model variability and broad-topic reliability remain limitations. The source and replay artifacts, including `verification.json`, were subsequently deleted at the user’s request.

## Limits and reproduction

World War I completing fresh and cached requests demonstrates that the reported flow can work. It does not guarantee completion for every broad prompt or certify history. Model-generated text and model reviews remain variable. Separate source and event reviews use the same configured model; independent human historical review and the broader twenty-case acceptance cohort were not rerun.

Offline regressions cover balanced receipt selection, warm-cache rereading, evidence retention, safe public errors with internal diagnostics, distinct recovery limits, phase repair budgets, capacity feedback retention, optional-removal index mapping and complete-scene rejection before publication.

```sh
sfw pnpm test
sfw pnpm typecheck
sfw pnpm build
sfw pnpm eval:references
sfw pnpm test:browser
# Intentional paid check, using a distinct directory:
sfw pnpm test:live --out artifacts/evaluations/my-unique-run "World War I"
```

The browser suite uses a managed test server with `reuseExistingServer=false`. Test servers and the owned preview tab must be closed after verification. The source-reading, compilation and retry contracts are detailed in [event compilation](event-compiler.md) and [completion capacity](completion-budget.md).

Final offline checks passed: 246 unit tests, 23 managed production browser tests, TypeScript, the production build and the five-story/fifteen-fact reference validator (no network requests). The temporary app server on port 3102 and managed browser server on 3100 were stopped, the owned preview tab was closed, and ports 3000/3100/3102 had no listeners. The user's earlier port-3000 process was not stopped by this investigation.
