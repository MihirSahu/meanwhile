# Independent source checklist and event order

The direct provider now extracts a checklist before any scene plan exists. It uses the same configured model, `gpt-6.1-terra` / `low`, in a separate structured call. The checklist call receives the request, server-fetched passages, source registry, rendering capabilities and optional discovery context. It receives neither a scene draft nor the held-out reference set. The research summary is omitted.

## Frozen requirements

A separate source-review call checks every checklist claim, requirement and relation, plus essential requested scope, before the checklist can freeze. Rejected extraction may be repaired from the same request and passages under the shared repair budget. No scene plan exists during either preparation call.

The checklist contains a compact claim ledger and essential requirements for context, principal actors, concrete outcomes, user scope and necessary qualifications. Requirements should name the essential people, places and dates supported by the passages, with distinct outcome concepts kept separate. For example, a generic return must not substitute for its essential location or the participant responsible for recovery. Presentation requirements can explain unavailable assets using the catalog; catalog facts are not historical evidence.

The scene planner copies each frozen requirement's ID, category, description and claim IDs unchanged, then assigns chapter deadlines. It may add further sourced requirements under unused IDs while preserving every frozen requirement. Server validation rejects removed, weakened, renamed or merged requirements, changed claim mappings and redefined frozen claims. Continuations retain the same checklist. Diagnostic observers receive copies so they cannot mutate it. The story card visibly renders title, period and location; coverage can cite reserved `@focus:title`, `@focus:period` and `@focus:location` IDs for those fields, together with action text when needed. No unseen plan or ledger entry is credited. Reserved IDs are outside the action-ID grammar, so actions cannot impersonate header fields.

Before publication, the existing evidence review checks checklist support and missing essential scope as well as the proposed story. Frozen claims receive claim-level review before they are published. Unsupported checklist claims cannot be rewritten by the scene writer to manufacture a pass: it must clarify or stop. A checklist can still omit something or misstate its importance; source and human review remain necessary.

## Temporal relations and rendered wording

The checklist also records up to six important before/after relations between distinct required-event claims. Each relation cites passages establishing the order itself. Merely sharing a date or appearing in adjacent paragraphs is insufficient. Relations with missing references, self-edges or cycles fail structural validation.

Every production review must address each relation. It reports source support, whether rendered wording is consistent, pending or needs revision, actual action IDs and a reason. Consistent results must point to rendered chapter, label or narration text mapped to both event claims. One action can express both events in the right order; playback timestamps alone cannot resolve wording inside a sentence. Future relations can remain pending, but all must be consistent before the ending commits. Previously accepted order coverage cannot disappear.

The reviewer is instructed to read the sequence implied within captions and sentences, including same-day events, compression and titles. It must also check uncertainty, continuing conflict and time-zone-dependent dates. Sources must establish qualifications; the model cannot invent timezone conversions. The existing deterministic date-window checks remain in place, with their conservative English/ISO parsing limits.

Rejection triggers a bounded repair of uncommitted output. After source review, frozen claims are already approved context for the scene reviews. Earlier chapters and claims remain intact; a rejected ending never produces `done`. Generation instructions leave room below string limits and explicitly permit repairs to uncommitted outlines and summaries. The hard request cap can end a heavily repaired story before it exhausts its nominal repair allowance. These are structural enforcement of model judgments, not deterministic natural-language chronology or historical truth certification.

## Cost, budgets and traces

A normal cold scene uses nine requests: research, checklist extraction, checklist source review, combined plan/opening, its evidence review, then two continuation/review pairs. This adds two preparation calls to the previous seven-request workflow. Thin-evidence clarifications can stop before source review or scene planning. Research caching does not cache checklists. Current limits are 16 model requests, 288,000 observed input tokens and 36,000 output tokens, with the existing timeout. [Completion reservations and targeted evidence recovery](completion-budget.md) now protect remaining review capacity. Checklist repairs share the existing global repair allowance; no new retry loop or transport retries are added.

Evaluation and smoke traces include the checklist and its preparation time. Evaluation runs also record estimated checklist-preparation cost separately, including extraction, source review and their repairs, already included in generation/workload totals. Preparation time is captured even when it fails; source-review decisions and candidates are retained. Review traces retain temporal decisions and rejected candidates. The harness version is `completion-budget-v2`, with a new research-cache namespace; previous harness results cannot be resumed into it.

## Verification

The current automated checks cover the SDK contract, strict schemas, provider/model configuration, source receipts, immutable requirements/claims, observer isolation, cancellation, missing final coverage, temporal references/cycles, same-day ordering rejection and preserved committed intervals. Apollo-specific regressions cover dropping the Hornet requirement and missing Pacific splashdown coverage. Railway-specific regression checks that an order rejection still blocks an ending when individual fact and coverage verdicts are positive. Historical fixture receipts are synthetic and do not certify the model's historical judgment.

```sh
npm run typecheck
npm test
npm run build
npm run eval:references
# Paid, fresh source retrieval and independent audits:
npm run eval:live -- --case sino-japanese-war,waterloo,beagle-voyage,railway-1830,apollo-earth --cold-only --baseline-limit 0 --concurrency 3
```

For this milestone, broaden to the 20-case paid evaluation only if the five-reference run completes at least four stories, independently accepts at least three, and has no failed audits. This is a gate for spending on a broader diagnostic run, not a product accuracy threshold. Otherwise retain and document the failures rather than pool reruns or substitute a favorable sample.

See [the measured results](independent-checklist-results.md). API schema handling follows [official OpenAI Structured Outputs documentation](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses); the configured model is unchanged from the [Terra documentation](https://developers.openai.com/api/docs/models/gpt-6.1-terra).

A compact checklist now has at most eight claims and eight essential requirements. One focused source lookup can resolve missing essential evidence before freezing; every claim is then rebuilt and reviewed against the merged receipts. Missing excerpts alone must not be rendered as historical uncertainty. See [the latest results](completion-budget-results.md).
