# Scene reliability and browser readiness

The default harness is now `stream-review-v1`; see [review fixes](review-fixes.md) for the graph-wide timing, date parsing, stream decoding and replacement-state corrections. Curated demos and the legacy upstream protocol continue to use the same scene messages. The configured model remains `gpt-6.1-terra` with the existing server effort setting; there is no automatic substitution.

## Required preparation

The default extraction schema has required `essentials.context`, `essentials.actors` and `essentials.outcome` slots rather than asking the model to remember three categories inside an array. Each carries its description and supporting claims. The server normalizes them into immutable canonical requirements and assigns IDs/kinds, then applies the existing source review before freezing. Up to five additional requirements can cover explicit requests or necessary caveats. The staged legacy baseline retains its old schema.

Instructions emphasize essential scope and compare all fetched passages for conflicting exact dates/locations. When sources conflict, wording must narrow precision or attribute the accounts; the claim's certainty must reflect a genuine dispute. Optional casualty totals, later meetings and minor stops should not inflate required scope. A valid schema does not prove that the description or claim links are historically sufficient: those still need source review.

## Explicit focus and visible relationships

The plan must select `focusEventIndex` for an Earth-mapped event representing the requested main site. The compiler derives both the focus coordinates and visible location label from that event, instead of using the first dated background record. Invalid indices and text-only focus targets fail before publication. Review receives the actual center, selected event and location to check against the request. Coordinates remain model-proposed; this is not an independent geocoder or guarantee of geographic accuracy.

Declared before, overlap and unordered relations become visible, named notes at the later record in playback. For example, an overlap note says `Concurrent with [event title]` rather than relying only on a generic chapter disclaimer. A before note says `After [event title]`; an unordered note describes presentation order without claiming that historians cannot know the sequence. Each note cites the union of both events' selected claims. Relation passages must belong to that evidence basis. Notes have their own reading time and never interrupt active narration. Typed ordering, cycles and date intersections remain server-checked; historical order and completeness of relation extraction remain model judgments.

An event selecting a contested claim requires a nonempty `qualification`. Mapped records show it immediately in their event caption and retain it as a separate sourced narration note with its own reading time. Source review must still check that the qualification is meaningful and that the main assertion is not misleading. The compiler does not infer historical disagreement merely from a missing passage.

## Text-only non-Earth facts

The new internal `narration` template requires `location.position=null` and no participant markers. It renders the actual location name, formatted date and sourced statement in a chapter caption, explicitly saying that no Earth marker is shown. It creates no city, person, invisible stand-in or speech anchor for that fact. Qualifications and relationship notes use sourced chapter captions as needed. Subsequent mapped events restore their own heading. The browser can pause, seek and replay these facts using the existing protocol.

Mapped templates still require an Earth position. Focus must remain an actual Earth-mapped event; a request without a supportable Earth focus may need clarification. The app does not acquire a Moon globe or spacecraft asset through this change.

## Testing and server lifecycle

`AGENTS.md` records the user's requirement: start servers only when explicitly requested or when required for a test, and stop test servers afterward. Verification uses the managed Playwright production server on loopback port 3100 with `reuseExistingServer=false`, graceful shutdown and demo credentials. No dev server is needed. Check for remaining listeners after the suite, including failure cases; do not leave an application server running at handoff.

Regressions cover required checklist slots and canonical IDs, explicit main-site focus, named overlap notes/citations, contested qualifications and entity lifetime, and text-only lunar captions with later-heading restoration. An end-to-end browser test seeks into and out of a compiled text-only event and checks that its caption displays without a lunar Earth-marker control. Existing playback, mobile, fallback, source, cancellation and replacement tests remain in the suite.

Measurements and historical limits are recorded separately in [results](scene-reliability-results.md). The reference facts remain test/audit input and do not enter production generation. Automated source review is not human historical certification. The required/nullable schema design follows [official OpenAI Structured Outputs documentation](https://developers.openai.com/api/docs/guides/structured-outputs).
