# Completion capacity and targeted evidence recovery

The direct Terra harness now reserves capacity for required work before permitting repairs or source recovery. A normal cold scene still uses nine model calls. The ceiling is 16 model calls, 288,000 observed input tokens and 36,000 output tokens, including reasoning. Model and effort remain server configuration.

## Admission and reservations

Before each generation the provider uses the official input-count endpoint with the configured model, instructions, input, schema and tool definitions. It admits the model call only if current work plus all remaining mandatory stages fit the ceilings. Count failure stops the request; no heuristic count or model substitution is used.

The harness updates reservations for each stage. A proposed chapter retains its own review and all later generation/review pairs. A retry must leave those same future stages intact. This prevents an optional repair from using the last call needed to review an ending. The regression reproduces the railway's earlier workload and allows the thirteenth final review; another SDK test completes two generation/review repairs in thirteen calls with every intermediate reserve checked.

Future generation requests reserve 24,000 input tokens each and their full output allowances. Current input is counted exactly. Research allocates 32,000 input tokens because hosted search results can increase observed usage after counting; actual reported usage is checked before further content can publish. Independent post-generation audit requests have a separate 48,000 input-token allowance. These are work-admission limits rather than a dollar spending guarantee; unreported provider usage and external tool growth cannot be measured before they occur.

| Stage | Output allowance |
| --- | ---: |
| Research or targeted research | 3,000 |
| Checklist extraction | 3,200 |
| Checklist source review | 2,000 |
| Combined plan/opening | 5,000 |
| Continuation | 3,500 |
| Evidence review | 3,000 |

The existing 180-second default timeout and bounded repair allowance remain. SDK transport retries remain disabled. Count requests are additional HTTP metadata requests; model-call limits count content-generating requests. Successful usage records retain counted input, observed usage, used capacity and outstanding reservations. Counts, generations and source reads can still fail or time out; completion is not guaranteed.

## One targeted lookup

Before the checklist freezes, extraction can return structured `missing_evidence` questions. Source review can also identify missing essential facts or ordering evidence. Ambiguous requests and inherently unsupported scope do not trigger research recovery. An initial failure to retrieve readable evidence can use the same single recovery allowance.

The harness permits at most one targeted lookup for the whole story. It sends the original request and up to three precise questions to the same provider, with one hosted-search tool call. Admission reserves a rebuilt checklist/source review and all required scene work first. If that work cannot fit, the lookup is skipped without generating another research response. Provider failures are not converted into historical uncertainty.

The server fetches and verifies actual source pages using the existing public-address, redirect, byte and timeout protections. It retains original context alongside up to three targeted sources, with a total of at most eight sources and forty passages. Receipts retain their text, hashes, offsets and retrieval times; source/passage IDs are reassigned before any claim freezes. New targeted receipts take priority within a shared source's five-passage allowance. No research summary becomes evidence. The original research cache is not mutated with targeted results.

A fresh independent checklist is extracted and source-reviewed from those receipts. If evidence remains missing, the app clarifies rather than silently reducing the request or looping. No recovery occurs after publication. Recovery traces retain topics, outcome, timing and passage counts; its model cost is reported separately and already included in the total. Checklist preparation time includes lookups made during preparation; an initial unreadable-source fallback occurs before that timer and has its own recovery timing.

## Compact, grounded stories

Checklists contain at most eight claims and eight essential requirements. Optional clauses, minor stops and incidental later journeys should not crowd out the required context and ending. Scene writers retain every frozen essential requirement and can add necessary sourced ones.

Temporal relations receive the complete cited basis of both event claims before source review and freezing. This avoids a relation omitting a passage that already establishes part of a composite event. Only validated fetched IDs are added, within the bounded relation citation list. Non-overlapping sourced dates can establish order without a separate literal “before” sentence; same-day wording still requires evidence and semantic review.

Instructions distinguish limited excerpts from genuine historical uncertainty. Missing evidence can justify recovery, omission of unsupported precision or clarification. It does not justify telling the user that historians cannot establish an order. A dispute or approximation must itself be sourced.

## Verification and reproduction

Tests cover reserved calls/input/output, exact-count rejection before generation, the earlier railway workload, two reviewed repairs completing with the final review reserved, receipt reindexing, one successful recovery, exhausted recovery, recovery requested by source review and skipping recovery when completion would not fit. Existing playback/source/SDK checks continue to apply.

```sh
npm run typecheck
npm test
npm run build
npm run eval:references
# Paid five-case evaluation:
npm run eval:live -- --case sino-japanese-war,waterloo,beagle-voyage,railway-1830,apollo-earth --cold-only --baseline-limit 0 --concurrency 2
```

See [the results](completion-budget-results.md). The broader 20-case evaluation remains gated on at least four reference completions, three independently accepted stories and no failed audits. Human historical review remains pending. Input admission follows [official OpenAI token-counting guidance](https://developers.openai.com/api/docs/guides/token-counting).
