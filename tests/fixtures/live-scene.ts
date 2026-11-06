import type { ResolvedEventPlan } from "../../src/lib/server/event-plan";
import { createHash } from "node:crypto";
export const fixtureText =
  "The Silk Roads linked regional trading networks around 1300. A representative reconstructed journey can link cities across Central Asia. Merchants carried goods and ideas between regional markets. This is a schematic network, not a documented expedition.";
export const fixtureDocument = {
  text: fixtureText,
  finalUrl: "https://example.org/history/silk-roads",
  documentHash: createHash("sha256").update(fixtureText).digest("hex"),
  retrievedAt: "2026-10-30T00:00:00.000Z",
};
export const fixturePassage = {
  id: "p1",
  sourceId: "s1",
  text: fixtureText,
  documentHash: fixtureDocument.documentHash,
  start: 0,
  end: fixtureText.length,
  retrievedAt: fixtureDocument.retrievedAt,
};
export const fixtureClaim = {
  id: "c1",
  text: "The Silk Roads linked regional markets around 1300; this representative journey is schematic.",
  passageIds: ["p1"],
  yearRange: { startYear: 1275, endYear: 1325, approximate: true },
  certainty: "approximate" as const,
};
export const fixtureEvidence = {
  method: "passage-review-v1" as const,
  passages: [fixturePassage],
  claims: [fixtureClaim],
};
export const fixtureHtml = () =>
  new Response(`<html><body><main><p>${fixtureText}</p></main></body></html>`, {
    headers: { "content-type": "text/html" },
  });
export const evidenceUrl = "https://example.org/history/silk-roads";
export const fixtureRequirements = [
  {
    id: "r1",
    kind: "context",
    description: "Explain the regional trading network.",
    claimIds: ["c1"],
    chapter: 0,
  },
  {
    id: "r2",
    kind: "actors",
    description: "Introduce the trading communities and merchant.",
    claimIds: ["c1"],
    chapter: 0,
  },
  {
    id: "r3",
    kind: "outcome",
    description: "Explain the exchange of goods and ideas.",
    claimIds: ["c1"],
    chapter: 2,
  },
];
export const fixtureChecklist = {
  claims: [fixtureClaim],
  result: {
    status: "ready",
    requirements: fixtureRequirements.map(({ chapter: _chapter, ...r }) => r),
    relations: [],
  },
};
export function essentialFixture(value = fixtureChecklist) {
  const requirements = value.result.requirements;
  const core = (kind: string) => {
    const { description, claimIds } = requirements.find(
      (r) => r.kind === kind,
    )!;
    return { description, claimIds };
  };
  return {
    claims: value.claims,
    result: {
      status: "ready",
      essentials: {
        context: core("context"),
        actors: core("actors"),
        outcome: core("outcome"),
      },
      additional: requirements
        .filter((r) => !["context", "actors", "outcome"].includes(r.kind))
        .map(({ id: _, ...r }) => r),
    },
  };
}
export const resolution = {
  claims: [fixtureClaim],
  result: {
    status: "resolved",
    title: "Trade across Eurasia",
    period: "c. 1300",
    location: "Central Asia",
    center: { lat: 36, lon: 90 },
    distance: 5.4,
    sourceIds: ["s1"],
    claimIds: ["c1"],
    yearRange: { startYear: 1275, endYear: 1325, approximate: true },
    requirements: fixtureRequirements,
    chapters: [
      {
        date: "c. 1300",
        title: "A connected world",
        summary:
          "A schematic reconstruction of trade across a network of routes.",
        sourceIds: ["s1"],
        claimIds: ["c1"],
        yearRange: { startYear: 1275, endYear: 1325, approximate: true },
      },
      {
        date: "Central Asia",
        title: "Between cities",
        summary: "A representative journey linking regional markets.",
        sourceIds: ["s1"],
        claimIds: ["c1"],
        yearRange: { startYear: 1275, endYear: 1325, approximate: true },
      },
      {
        date: "Across Eurasia",
        title: "Goods and ideas",
        summary: "A narrated summary of exchange across regions.",
        sourceIds: ["s1"],
        claimIds: ["c1"],
        yearRange: { startYear: 1275, endYear: 1325, approximate: true },
      },
    ],
  },
};

export function batchOutput(seq: number) {
  const at = seq * 12,
    chapter = resolution.result.chapters[seq];
  return {
    claims: [],
    actions: [
      {
        type: "chapter",
        id: `b${seq}_chapter`,
        at,
        date: chapter.date,
        title: chapter.title,
        caption: chapter.summary,
        sourceIds: ["s1"],
        claimIds: ["c1"],
        yearRange: { startYear: 1275, endYear: 1325, approximate: true },
      },
      ...(seq === 0
        ? [
            {
              type: "spawn",
              id: "b0_merchant",
              at: 0,
              entityId: "merchant",
              asset: "horse",
              position: { lat: 36, lon: 100 },
              palette: "clay",
              label: "A traveling merchant",
              scale: 1,
              claimIds: ["c1"],
            },
          ]
        : []),
      {
        claimIds: ["c1"],
        type: "move",
        id: `b${seq}_move`,
        at: at + 1,
        entityId: "merchant",
        path: [
          { lat: 36, lon: 100 - seq * 10 },
          { lat: 36, lon: 90 - seq * 10 },
        ],
        duration: 10,
      },
      {
        type: "speech",
        id: `b${seq}_speech`,
        at: at + 2,
        entityId: "merchant",
        kind: "narration",
        text: chapter.summary,
        sourceIds: ["s1"],
        claimIds: ["c1"],
        duration: 7,
      },
    ],
  };
}

export const fixtureEventPlan = {
  result: {
    status: "resolved" as const,
    title: "Trade across Eurasia",
    location: "Central Asia",
    presentation: "comparison" as const,
    focusEventIndex: 0,
    events: [
      {
        title: "Regional networks",
        statement: "Regional trading networks linked markets around 1300.",
      },
      {
        title: "Merchants",
        statement:
          "Merchants carried goods and ideas between regional markets.",
      },
      {
        title: "Exchange",
        statement:
          "This schematic network illustrates exchange across Central Asia.",
      },
    ].map((e) => ({
      ...e,
      claimIndices: [0],
      qualification: null,
      kind: "event" as const,
      location: { name: "Central Asia", position: { lat: 36, lon: 90 } },
      participants: [],
      date: {
        start: { year: 1300, month: null, day: null },
        end: { year: 1300, month: null, day: null },
        approximate: true,
        zone: null,
      },
      template: "place" as const,
    })),
    relations: [],
  },
};

export function fixtureEventReview(
  plan: ResolvedEventPlan,
  checklist = fixtureChecklist,
) {
  const supported = {
    verdict: "supported" as const,
    reason: "Fixture support.",
  };
  return {
    events: plan.events.map((_, index) => ({
      index,
      ...supported,
      passageIds: [
        ...new Set(
          plan.events[index].claimIndices.flatMap(
            (i) => checklist.claims[i].passageIds,
          ),
        ),
      ],
    })),
    requirements: checklist.result.requirements.map((_, index) => ({
      index,
      ...supported,
    })),
    relations: plan.relations.map((r: any, index) => ({
      index,
      ...supported,
      passageIds: r.passageIds,
    })),
    metadata: supported,
    chronology: supported,
  };
}

export function responseFixture(
  text: string,
  research = false,
  model = "gpt-6.1-terra",
) {
  return {
    id: "resp_fixture",
    object: "response",
    created_at: 1,
    status: "completed",
    model,
    output: [
      ...(research
        ? [
            {
              id: "ws_fixture",
              type: "web_search_call",
              status: "completed",
              action: {
                type: "search",
                queries: ["fixture historical evidence"],
                sources: [{ type: "url", url: evidenceUrl }],
              },
            },
          ]
        : []),
      {
        id: "msg_fixture",
        type: "message",
        role: "assistant",
        status: "completed",
        content: [
          {
            type: "output_text",
            text,
            annotations: research
              ? [
                  {
                    type: "url_citation",
                    url: evidenceUrl,
                    title: "Historical evidence fixture",
                    start_index: 0,
                    end_index: text.length,
                  },
                ]
              : [],
          },
        ],
      },
    ],
    usage: {
      input_tokens: 100,
      input_tokens_details: { cached_tokens: 20 },
      output_tokens: 200,
      output_tokens_details: { reasoning_tokens: 40 },
      total_tokens: 300,
    },
    error: null,
    incomplete_details: null,
  };
}

export function fixtureForRequest(body: Record<string, any>) {
  if (body.tools?.length)
    return responseFixture(
      "Evidence brief: the Silk Roads linked regional trading networks. This is a representative reconstructed journey.",
      true,
      body.model,
    );
  const input = JSON.parse(body.input);
  if (body.text?.format.name === "meanwhile_checklist")
    return responseFixture(
      JSON.stringify(
        body.text.format.schema.properties.result.anyOf.some(
          (b: any) => b.properties?.essentials,
        )
          ? essentialFixture()
          : fixtureChecklist,
      ),
      false,
      body.model,
    );
  if (body.text?.format.name === "meanwhile_checklist_review") {
    const candidate = input.checklist;
    return responseFixture(
      JSON.stringify({
        missingEvidence: [],
        claims: candidate.claims.map((c: any) => ({
          id: c.id,
          verdict: "supported",
          passageIds: c.passageIds,
          reason: "Fixture support.",
        })),
        requirements: candidate.result.requirements.map((r: any) => ({
          id: r.id,
          verdict: "supported",
          reason: "Fixture scope.",
        })),
        relations: candidate.result.relations.map((r: any) => ({
          id: r.id,
          verdict: "supported",
          passageIds: r.passageIds,
          reason: "Fixture order.",
        })),
        scope: { verdict: "supported", reason: "Fixture scope." },
      }),
      false,
      body.model,
    );
  }
  if (body.text?.format.name === "meanwhile_event_plan")
    return responseFixture(JSON.stringify(fixtureEventPlan), false, body.model);
  if (body.text?.format.name === "meanwhile_event_review")
    return responseFixture(
      JSON.stringify(fixtureEventReview(input.plan, input.checklist)),
      false,
      body.model,
    );
  if (body.text?.format.name === "meanwhile_evidence_review")
    return responseFixture(
      JSON.stringify({
        claims: input.claims.map((c: any) => ({
          id: c.id,
          verdict: "supported",
          passageIds: c.passageIds,
          reason: "Supported by the fixture passage.",
        })),
        actions: input.actions.map((a: any) => ({
          id: a.id,
          verdict: "supported",
          reason: "Supported schematic action.",
        })),
        coverage: (input.story?.requirements ?? []).map((r: any) => {
          const previous = input.story.covered.find(
            (c: any) => c.id === r.id && c.status === "covered",
          );
          const rendered = [...input.committedActions, ...input.actions].filter(
            (a: any) =>
              a.claimIds?.some((id: string) => r.claimIds.includes(id)),
          );
          const covered =
            Boolean(previous) ||
            (r.chapter <= input.story.chapter && rendered.length > 0);
          return {
            id: r.id,
            status: covered ? "covered" : "pending",
            actionIds:
              previous?.actionIds ??
              (covered ? rendered.slice(-2).map((a: any) => a.id) : []),
            reason: covered
              ? "Rendered in fixture actions."
              : "Scheduled in a future chapter.",
          };
        }),
        scope: { verdict: "supported", reason: "Matches request." },
        chronology: { verdict: "supported", reason: "Consistent dates." },
        metadata: { verdict: "supported", reason: "Supported metadata." },
        checklist: {
          verdict: "supported",
          reason: "Supported independent checklist.",
        },
        order: (input.story?.relations ?? []).map((r: any) => ({
          id: r.id,
          support: "supported",
          status: input.story.final ? "consistent" : "pending",
          actionIds: input.story.final
            ? [...input.committedActions, ...input.actions]
                .filter(
                  (a: any) =>
                    (a.type === "chapter" || a.type === "speech") &&
                    a.claimIds?.some(
                      (id: string) =>
                        id === r.beforeClaimId || id === r.afterClaimId,
                    ),
                )
                .map((a: any) => a.id)
                .slice(-16)
            : [],
          reason: "Fixture event sequence.",
        })),
      }),
    );
  return responseFixture(
    JSON.stringify(
      body.text.format.schema.properties.opening
        ? { ...resolution, opening: batchOutput(0) }
        : body.text.format.schema.properties.result
          ? resolution
          : batchOutput(input.request.interval.start / 12),
    ),
    false,
    body.model,
  );
}
