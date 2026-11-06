# Story completeness and timeline consistency

The direct OpenAI harness uses sourced requirements for the story as well as its individual facts. These are now extracted before scene planning by the [independent checklist step](independent-checklist.md); the scene planner assigns deadlines and can add requirements while preserving that essential subset. The model remains `gpt-6.1-terra` with configurable effort. Existing demos and upstream streams retain their protocol.

## Requirements and actual coverage

A resolved plan includes requirements with an ID, category, description, supporting claim IDs and a chapter deadline (0–2). Context, principal actors and an explicit outcome or unresolved state are mandatory categories. User requests such as comparisons or illustrative journeys and qualifications needed to avoid a misleading ending become additional requirements. At least one introductory context requirement and one principal-actor requirement are due in chapter 0; additional context and later participants can have later deadlines. The planner must name relevant people or organizations when supported, rather than silently omit them.

The separate evidence review reports every requirement as covered or pending. Covered requirements must cite real chapter, narration, figure-label or route action IDs whose claim mappings intersect the requirement's supporting claims. The reviewer also checks that the rendered wording conveys the concept: attaching a claim ID alone is insufficient. Planned outlines and an unused claim ledger never count as rendered content.

Requirements scheduled for later chapters may remain pending during an intermediate review. The generator receives the full approved plan, the current chapter, already rendered coverage and remaining requirements, so it can leave a voyage's return in the ending instead of pulling it into the middle chapter. Ordered, date-labeled markers can express a compressed illustrative route when actual travel legs are unsupported; the presentation must explain that distinction.

The last batch is reviewed against the committed story plus its proposed ending. Every requirement must then be covered. A missing outcome or other required concept triggers a repair of the uncommitted ending. If repair fails, earlier chapters remain playable and no `done` message is emitted. Requirements and claims cannot be rewritten after approval to make an incomplete story appear complete.

Coverage checks reuse the existing review calls. Independent checklist extraction and source review add two preparation calls before scene planning; a normal scene now uses nine model requests. There is no additional final audit call in the production path. Existing request, token, timeout and bounded repair limits still apply. Independent evaluation audits remain separate from production gating.

## Dates and chapter headings

Deterministic checks now compare common English month/day/year labels, month spans, year ranges and BCE years. The chapter's displayed historical window must fit the approved outline. Explicitly dated narration or labels must fit the heading currently visible, including when both dates are in the same year. Dated claims from a different historical period cannot be moved into a narrower chapter just because they are already sourced.

For example, a July 24 return narration cannot appear while the heading says July 16. It must be deferred to its planned chapter or preceded by an appropriate heading change within the approved outline window. A supported 1836 return claim cannot appear under an 1834–1835 heading. The engine never changes historical dates to fit a playback interval; playback seconds remain separate.

The parser is conservative, not a general historical calendar system. It recognizes common English date forms and falls back to typed year ranges for uncertain or unsupported labels. It compares source date labels without converting Julian/Gregorian calendars or time zones. Measurements such as troop counts are excluded from year recognition. Semantic review still handles ambiguous wording and sequencing, so these checks do not certify every date or historical interpretation.

## Verification and traces

Regression tests cover missing plan categories, fake action coverage, dropped committed coverage, pending future requirements, final-batch rejection, Apollo's stale heading and the Beagle return-period mismatch. Rejections preserve the action log and evidence ledger atomically.

Evaluation traces retain story requirements, coverage decisions and accepted/rejected candidates. New `rejections` records also capture structural and date errors that stop a proposal before semantic review. Source passages and credentials are not printed in progress output. The harness version is `completion-budget-v2`, and the provider's research-cache namespace is new, so old evaluation results cannot be resumed into this run.

```sh
# Paid reference cases, using the existing source-checked reference set:
npm run eval:live -- --case sino-japanese-war,waterloo,beagle-voyage,railway-1830,apollo-earth --cold-only --baseline-limit 0 --concurrency 3
# Paid full evaluation:
npm run eval:live -- --cold-only --baseline-limit 0 --concurrency 3
```

The reference set is withheld from generation and used by the independent evaluation review. Passing coverage is still a model judgment about relevance and meaning, backed by structural checks rather than human historical certification. False positives, false negatives, source-access failures and incomplete evidence remain possible. See [the evaluation results](story-completeness-results.md) for measured outcomes and unresolved findings.
