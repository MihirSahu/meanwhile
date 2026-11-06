# Evaluation results — 2026-10-30

The 20-case evaluation completed 50 saved inference attempts using `gpt-6.1-terra` / `low`. Every case ran with cold and warm application research caches; five also ran the previous separate-resolution workflow as a paired baseline. The benchmark data is preserved in [the result snapshot](../evals/results/2026-10-30.json), with commands and methodology in [live inference](live-inference.md).

## Latency and cost

| Workflow/cache | Attempts | Complete | Clarification | Expectations/contracts | Focus p50 | Playable p50 | Playable p95 | Est. generation cost |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| staged/cold | 5 | 5 | 0 | 5/5 | 15.1s | 22.4s | 53.9s | $0.182 |
| staged/warm | 5 | 5 | 0 | 5/5 | 5.1s | 10.8s | 11.4s | $0.067 |
| opening/cold | 20 | 16 | 2 | 17/20 | 19.6s | 19.6s | 55.0s | $0.598 |
| opening/warm | 20 | 16 | 2 | 17/20 | 9.3s | 9.3s | 10.8s | $0.189 |

Across ten matched cold/warm comparisons, the median paired playable-time reduction was **2.05 seconds (17.3%)**. The combined opening removes one generation request: four calls without repair, compared with five previously. Focus arrives later than the separate-resolution workflow because the opening is validated before emitting either message. The table's full opening and baseline groups contain different case sets; use the paired statistic for comparison. These are small samples, with a few slow research responses, rather than performance guarantees.

Estimated total for these saved attempts, including generation, search and model-assisted reviews: **$1.676**. Cold generation alone cost **$0.598** across 20 requests and produced **16 completed stories**. Cold-workload cost per reviewed accepted story: **Unavailable: no cold story met the automated acceptance rule.**

Rates were checked against [official OpenAI pricing](https://developers.openai.com/api/docs/pricing): $1/M input, $0.05/M cached input, $5/M output and $0.01/search action. Estimates exclude cache-write surcharges, taxes, hosting, the preliminary pilot and discovery smoke test. The run was resumed after an external process termination; interrupted in-flight usage can be missing. Two workers ran the first two cases, then three ran the remaining cases. Provider prompt caching may occur on cold application-cache attempts. Warm cache hits reuse research, not generated scenes.

## Source quality and limitations

Independent retrieval and a model-assisted rubric reviewed **16** complete cold opening stories: **0 accepted**, **16 needing review**, **0 failing**. Complete stories without an available review: **0**. Acceptance requires the deterministic checks, a passing supported-source rubric and at least one original source also cited by independent retrieval. This is a second retrieval with the same model family, not human verification; warm scenes were not separately source-reviewed.

The generated scenes remain prototypes requiring historical review. Recurring issues include claims more precise than their citations, inaccessible assigned pages, disagreements between sources and chronology compressed too strongly. A passing protocol check establishes playable data, not factual correctness. The preliminary pilot exposed a misleading direct fleet route; shared generation rules now require sourced sequences or stationary markers, omit unsupported detail and preserve explicit source-ID markers in research.

| Cold opening case | Outcome | Expectations/contracts | Source review | First playable |
| --- | --- | --- | --- | ---: |
| sino-japanese-war | complete | pass | needs_review | 20.6s |
| silk-road | complete | pass | needs_review | 18.1s |
| railway-1830 | complete | pass | needs_review | 19.6s |
| waterloo | complete | pass | needs_review | 18.9s |
| beagle-voyage | complete | pass | needs_review | 18.5s |
| apollo-earth | complete | pass | needs_review | 17.6s |
| silk-road-premise | complete | pass | needs_review | 18.6s |
| indian-ocean | complete | pass | needs_review | 55.0s |
| industrial-comparison | complete | pass | needs_review | 19.6s |
| shimonoseki | complete | pass | needs_review | 21.8s |
| meiji | complete | pass | needs_review | 20.1s |
| french-revolution | complete | pass | needs_review | 18.1s |
| haitian-revolution | complete | pass | needs_review | 21.9s |
| mansa-musa | complete | pass | needs_review | 54.1s |
| bronze-age-uncertainty | complete | fail | needs_review | 23.0s |
| ambiguous-civil-war | clarification | pass | not scheduled | — |
| ambiguous-revolution | clarification | pass | not scheduled | — |
| ambiguous-time-place | error | fail | not scheduled | — |
| ambiguous-battle | evidence | fail | not scheduled | — |
| waterloo-quote | complete | pass | needs_review | 21.2s |

The Bronze Age case failed the benchmark's chosen 1250–1150 BCE band because it used a broader late-13th-to-12th-century range (1250–1101 BCE). Its data still passed the engine contract. The benchmark band is an evaluation assumption for “around 1200 BCE,” not an explicit user-supplied bound, so this flags scope for review rather than establishing an incorrect date.

The two context-free cases initially failed during research instead of clarifying. A local intent check now asks for the event/place/period before any retrieval for unqualified wars, revolutions, battles and purely deictic requests. Specific names, dates and requests to choose an example still go through normal research. A separate [targeted follow-up](../evals/results/2026-10-30-ambiguity-fix.json) reran all four ambiguity cases cold and warm: **8/8 returned clarification with zero model calls**. The original 50-run table is retained without replacing its failures. Normal scene generation was unchanged by this follow-up.

Automated review findings to inspect before broader use:

- **sino-japanese-war**: The scene identifies the 1894–1895 war, covers the Korean context and peace terms, and presents placements as schematic. Most events are supported, but the Taiwan endpoint and the Yalu damage assessment need revision or stronger verification.
- **silk-road**: The independently checked itinerary supports the principal route and trade details, and the schematic staging and uncertain final section are appropriately qualified. The main limitations are the later date and the lack of an explicit network framing or evidence of typicality around 1300.
- **railway-1830**: The date, northwest England setting, steam railway imagery and main sequence are supported. The schematic staging is clearly qualified, but an Eccles claim, the implied order of death and arrival, and citation limitations merit review.
- **waterloo**: The independently checked museum account supports the broad battle sequence and Allied–Prussian context. The Cambridge citations were inaccessible, and some timings are disputed. The staging is explicitly schematic and does not present invented quotations or a precise pursuit route.
- **beagle-voyage**: Independent sources support the principal chronology and route sequence. The sailing-ship asset and schematic framing are appropriate, and the scene does not imply Darwin published his theory during the voyage. Some cited-source assignments remain unverified because the PDFs were inaccessible.
- **apollo-earth**: The main Earth-side sequence is independently supported, and the schematic ship represents USS Hornet rather than a spacecraft. However, source assignments need correction, the Houston date conflict is undisclosed, and the required explanation of missing spacecraft assets is absent.
- **silk-road-premise**: The scene explicitly corrects the single-road premise and labels its stationary markers as schematic, not documented journeys. The historical overview is broadly supported, but some citations and the around-1300 framing need stronger evidence.
- **indian-ocean**: The principal historical claims are supported, the chronology is sound, and the schematic staging avoids an invented expedition or industrial anachronisms. The main presentation gap is that the trading network is described rather than visually connected.
- **industrial-comparison**: Independent checks support the narrowly scoped comparison and its different industrial timelines. The Coventry chronology needs qualification, and the visibility of the geographically separated markers is uncertain.
- **shimonoseki**: The independently checked sources support much of the sequence and the distinction between the treaty, diplomatic pressure and subsequent fighting. The schematic staging and explicit return to May–June are appropriate. However, the scene omits the treaty's basic terms and presents two disputed dates without qualification.
- **meiji**: The Kyoto coup and Toba–Fushimi sequence are supported, and the scene does not import later industrial development into 1868. The Edo handover date remains insufficiently verified, and the requested distinction between stylized figures and accurate portraits is not explicit.
- **french-revolution**: The scene covers relevant Parisian events within 1789 and does not introduce Napoleon’s later rule. Its principal historical claims are supported, but one destination needs corrected attribution. The stationary markers are appropriately described as schematic.
- **haitian-revolution**: The scene covers enslaved people’s uprising and emancipation, changing alliances, and the final war and independence in a coherent sequence. Bois Caïman is appropriately qualified, and the static staging is identified as schematic. Citation support and one set of details remain insufficiently verified.
- **mansa-musa**: Independent checks support the broad journey and Cairo encounter, while the scene appropriately labels its staging as schematic and uses narration rather than invented dialogue. A citation gap and date qualifications warrant review.
- **bronze-age-uncertainty**: The scene presents multiple possible pressures without asserting a universal cause, uses BCE dates, and labels its static staging as schematic. Independent review supports the broad account, but the precise drought finding and some assigned citations remain unverified.
- **waterloo-quote**: The checked museum account supports the main chronology and battle narrative, and no invented quotation is presented. The schematic staging is disclosed. Review is needed for the unverified format limitation and the potential visual attribution of the quotation clarification.

## Discovery and rendering verification

A real **Meanwhile…** request from the curated war story's 1895 chapter selected **Oscar Wilde's libel trial in London**. It returned three cited sources, reached focus/first playable at **20.8s**, and completed a 36-second scene at **28.9s**. The server validated the contained year range and minimum 20-degree geographic separation. This smoke test checks the workflow; it is not an independent historical audit. Its local artifacts are in `artifacts/live-meanwhile/`.

Camera framing, local model spacing with geographic tethers, and packed labels were checked with desktop/mobile Playwright runs. Discovery checks cover preserving the current story during research, Back without inference, recently visited exclusions, failure recovery and cancellation. The renderer retains the original anchors/routes; label suppression never removes objects from the accessible object list.

The full local interactive report and evidence traces are saved under ignored `artifacts/evaluations/history-20/`. The compact result snapshot above remains with the source. Finished historical assets, human source review, physical-device profiling and synchronized multi-event scenes remain further work.
