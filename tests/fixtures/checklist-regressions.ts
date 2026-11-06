import { createHash } from "node:crypto";
import {
  batchOutput,
  fixtureDocument,
  fixtureForRequest,
  resolution,
  responseFixture,
} from "./live-scene";

// Synthetic receipts exercise the gate contract; they are not historical verification.
export function historicalChecklistFixture(subject: "apollo" | "railway") {
  const apollo = subject === "apollo",
    year = apollo ? 1969 : 1830;
  const facts = apollo
    ? [
        "Apollo 11 aimed to land people on the Moon and return them safely. Armstrong, Aldrin and Collins were the crew.",
        "Apollo 11 splashed down in the Pacific on July 24, 1969.",
        "After splashdown USS Hornet recovered the Apollo 11 crew on July 24, 1969.",
      ]
    : [
        "The Liverpool and Manchester Railway opened on 15 September 1830 to carry passengers and goods. Huskisson and Wellington attended.",
        "After the accident the opening party continued to Manchester on 15 September 1830.",
        "Huskisson died at Eccles later that day, after the opening party had continued to Manchester.",
      ];
  const range = { startYear: year, endYear: year, approximate: false };
  const claims = facts.map((text, i) => ({
    id: `c${i + 1}`,
    text,
    passageIds: ["p1"],
    yearRange: range,
    certainty: "established",
  }));
  const requirements = [
    { id: "r1", kind: "context", description: facts[0], claimIds: ["c1"] },
    {
      id: "r2",
      kind: "actors",
      description: apollo
        ? "Name Armstrong, Aldrin and Collins."
        : "Name Huskisson and Wellington.",
      claimIds: ["c1"],
    },
    { id: "r3", kind: "outcome", description: facts[1], claimIds: ["c2"] },
    { id: "r4", kind: "outcome", description: facts[2], claimIds: ["c3"] },
  ];
  const checklist = {
    claims,
    result: {
      status: "ready",
      requirements,
      relations: [
        {
          id: "t1",
          beforeClaimId: "c2",
          afterClaimId: "c3",
          passageIds: ["p1"],
          qualification: null,
        },
      ],
    },
  };
  const text = facts.join(" ");
  const document = {
    ...fixtureDocument,
    text,
    documentHash: createHash("sha256").update(text).digest("hex"),
  };
  const date = apollo ? "July 1969" : "15 September 1830";
  const captions = [facts[0], facts[0], facts.slice(1).join(" ")];
  const planned = {
    claims: [],
    result: {
      ...resolution.result,
      yearRange: range,
      period: date,
      requirements: requirements.map((r) => ({
        ...r,
        chapter: r.kind === "outcome" ? 2 : 0,
      })),
      chapters: resolution.result.chapters.map((c, i) => ({
        ...c,
        date,
        summary: captions[i],
        yearRange: range,
        claimIds: i === 2 ? ["c2", "c3"] : ["c1"],
      })),
    },
  };
  const batch = (seq: number) => ({
    ...batchOutput(seq),
    actions: batchOutput(seq).actions.map((a) => ({
      ...a,
      claimIds: seq === 2 ? ["c2", "c3"] : ["c1"],
      ...(a.type === "chapter"
        ? { date, caption: captions[seq], yearRange: range }
        : {}),
      ...(a.type === "speech" ? { text: captions[seq] } : {}),
    })),
  });
  const respond = (body: Record<string, any>) => {
    if (
      body.tools ||
      body.text.format.name === "meanwhile_evidence_review" ||
      body.text.format.name === "meanwhile_checklist_review"
    )
      return fixtureForRequest(body);
    if (body.text.format.name === "meanwhile_checklist")
      return responseFixture(JSON.stringify(checklist));
    const input = JSON.parse(body.input).request;
    return responseFixture(
      JSON.stringify(
        body.text.format.schema.properties.opening
          ? { ...planned, opening: batch(0) }
          : body.text.format.schema.properties.actions
            ? batch(input.interval.start / 12)
            : planned,
      ),
    );
  };
  return { document, checklist, planned, batch, respond };
}
