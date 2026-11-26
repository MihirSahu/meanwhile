import assert from "node:assert/strict";
import test from "node:test";
import { zodTextFormat } from "openai/helpers/zod";
import {
  essentialChecklistSchema,
  normalizeEssentialChecklist,
} from "../src/lib/server/essential-checklist";
import { compileEventPlan } from "../src/lib/server/event-compiler";
import {
  eventPlanSchema,
  type ResolvedEventPlan,
} from "../src/lib/server/event-plan";
import { storyChecklistSchema } from "../src/lib/server/story-checklist";
import { SceneBuffer, entityVisible, chapterAt } from "../src/lib/playback";
import {
  fixtureEventPlan,
  essentialFixture,
  fixtureChecklist,
  fixturePassage,
} from "./fixtures/live-scene";
const plan = () =>
  eventPlanSchema.parse(structuredClone(fixtureEventPlan))
    .result as ResolvedEventPlan;
const checklist = () =>
  storyChecklistSchema.parse(structuredClone(fixtureChecklist));
const research = {
  text: "Synthetic test evidence",
  passages: [fixturePassage],
  sources: [{ id: "s1", title: "Fixture", url: "https://example.org/history" }],
};

test("required checklist slots cannot omit actors and canonical IDs/kinds are server-owned", () => {
  const raw = essentialFixture();
  const parsed = essentialChecklistSchema.parse(raw),
    canonical = normalizeEssentialChecklist(parsed);
  assert.equal(canonical.result.status, "ready");
  if (canonical.result.status !== "ready") throw new Error();
  assert.deepEqual(
    canonical.result.requirements.map((r) => [r.id, r.kind]),
    [
      ["r1", "context"],
      ["r2", "actors"],
      ["r3", "outcome"],
    ],
  );
  const absent = structuredClone(raw) as any;
  delete absent.result.essentials.actors;
  assert.throws(() => essentialChecklistSchema.parse(absent));
  const format = zodTextFormat(essentialChecklistSchema, "essential");
  assert.equal(format.strict, true);
  assert.equal(format.schema.additionalProperties, false);
});

test("focus explicitly selects the requested main site rather than the first background event", () => {
  const p = plan();
  p.events[0].location = {
    name: "Background site",
    position: { lat: 50.512, lon: 4.575 },
  };
  p.events[0].date!.start.year = 1280;
  p.events[0].date!.end.year = 1280;
  p.events[0].statement = "Background context.";
  p.events[1].location = {
    name: "Main site",
    position: { lat: 50.68, lon: 4.41 },
  };
  p.focusEventIndex = 1;
  p.location = "Main site";
  const story = compileEventPlan(p, checklist(), research);
  assert.deepEqual(story.focus.center, { lat: 50.68, lon: 4.41 });
  assert.equal(story.focus.location, "Main site");
  p.focusEventIndex = 14;
  assert.throws(
    () => compileEventPlan(p, checklist(), research),
    /Focus must select/,
  );
});

test("specific overlapping event names are visible and use both claims' citation basis", () => {
  const p = plan(),
    c = checklist();
  c.claims.push({ ...c.claims[0], id: "c2", passageIds: ["p2"] });
  p.events[0].title = "Ongoing fighting";
  p.events[1].title = "A concurrent development";
  p.events[1].claimIndices = [1];
  p.relations = [
    {
      beforeIndex: 0,
      afterIndex: 1,
      kind: "overlaps",
      passageIds: ["p1", "p2"],
    },
  ];
  const story = compileEventPlan(p, c, {
    ...research,
    passages: [fixturePassage, { ...fixturePassage, id: "p2" }],
  });
  const notes = story.messages
    .flatMap((m) => (m.type === "batch" ? m.actions : []))
    .filter((a) => a.type === "speech" && a.text.includes("Concurrent with"));
  assert.equal(notes.length, 1);
  assert.ok(notes[0].type === "speech");
  assert.equal(notes[0].text, "Concurrent with Ongoing fighting.");
  assert.deepEqual(notes[0].claimIds, ["c2", "c1"]);
  assert.deepEqual(story.events.find((e) => e.index === 1)!.relationText, [
    "Concurrent with Ongoing fighting.",
  ]);
});

test("contested facts require a visible qualification, retained during seeking", () => {
  const p = plan(),
    c = checklist();
  c.claims[0].certainty = "contested";
  assert.throws(
    () => compileEventPlan(p, c, research),
    /visible source qualification/,
  );
  p.events.forEach(
    (e) => (e.qualification = "Accounts differ on the precise location."),
  );
  const story = compileEventPlan(p, c, research),
    buffer = new SceneBuffer();
  story.messages.forEach((m) => buffer.ingest(m));
  const note = buffer.actions.find(
    (a) =>
      a.type === "speech" &&
      a.text === "Accounts differ on the precise location.",
  );
  assert.ok(note?.type === "speech");
  const spawn = buffer.actions.find(
    (a) => a.type === "spawn" && a.entityId === note.entityId,
  );
  assert.ok(spawn?.type === "spawn");
  assert.ok(entityVisible(buffer.actions, spawn, note.at + 0.1));
  assert.ok(buffer.complete);
  assert.ok(
    buffer.actions.some(
      (a) =>
        a.type === "chapter" &&
        a.id.endsWith("ev_0_heading") &&
        a.caption.startsWith("Accounts differ"),
    ),
  );
});

test("non-Earth facts render as sourced captions without any Earth marker and restore later headings", () => {
  const p = plan();
  p.events[1].template = "narration";
  p.events[1].location = { name: "Moon", position: null };
  p.events[1].statement = "A synthetic lunar context fact.";
  p.events[1].date!.start.year = 1301;
  p.events[1].date!.end.year = 1301;
  p.events[2].date!.start.year = 1302;
  p.events[2].date!.end.year = 1302;
  const story = compileEventPlan(p, checklist(), research),
    buffer = new SceneBuffer();
  story.messages.forEach((m) => buffer.ingest(m));
  assert.ok(buffer.complete);
  assert.ok(
    !buffer.actions.some(
      (a) => a.type === "spawn" && a.entityId.startsWith("ev_1"),
    ),
  );
  const caption = buffer.actions.find((a) => a.id.endsWith("ev_1_heading"));
  assert.ok(caption?.type === "chapter");
  assert.match(caption.caption, /Moon\. No Earth marker is shown\./);
  assert.match(
    chapterAt(buffer.actions, caption.at)!.caption,
    /synthetic lunar context/,
  );
  const end = buffer.actions.find((a) => a.id.endsWith("ev_2_heading"));
  assert.ok(end?.type === "chapter");
  assert.ok(!end.caption.includes("synthetic lunar context"));
  p.focusEventIndex = 1;
  assert.throws(
    () => compileEventPlan(p, checklist(), research),
    /Focus must select/,
  );
  p.focusEventIndex = 0;
  p.events[1].location.position = { lat: 0, lon: 0 };
  assert.throws(
    () => compileEventPlan(p, checklist(), research),
    /no Earth coordinate/,
  );
});

function dated(
  year: number,
  month: number | null = null,
  day: number | null = null,
) {
  return {
    start: { year, month, day },
    end: { year, month, day },
    approximate: false,
    zone: null,
  };
}
function datedPlan() {
  const p = plan();
  p.events.forEach((e, i) => {
    e.date = dated(1300, 7, [16, 20, 24][i]);
    e.statement = "A supported occurrence.";
  });
  return p;
}

test("generated before/overlap/unordered notes can cite another validated event date without weakening normal narration checks", () => {
  for (const kind of ["before", "overlaps", "unordered"] as const) {
    const p = datedPlan();
    p.events[0].title = "Launch on 16 July 1300";
    if (kind === "overlaps")
      p.events[0].date!.end = { year: 1300, month: 7, day: 24 };
    p.relations = [{ beforeIndex: 0, afterIndex: 2, kind, passageIds: ["p1"] }];
    const story = compileEventPlan(p, checklist(), research);
    assert.ok(
      story.events
        .find((e) => e.index === 2)!
        .relationText.some((t) => t.includes("16 July 1300")),
    );
    p.events[2].statement = "The current event occurred on 25 July 1300.";
    assert.throws(
      () => compileEventPlan(p, checklist(), research),
      /outside the visible heading/,
    );
  }
});

test("cross-year reference notes work for mapped and text-only events", () => {
  for (const textOnly of [false, true]) {
    const p = datedPlan();
    p.events[0].date = dated(1299, 7, 16);
    p.events[0].title = "Launch on 16 July 1299";
    if (textOnly) {
      p.events[2].template = "narration";
      p.events[2].location = { name: "Moon", position: null };
    }
    p.relations = [
      { beforeIndex: 0, afterIndex: 2, kind: "before", passageIds: ["p1"] },
    ];
    const story = compileEventPlan(p, checklist(), research),
      buffer = new SceneBuffer();
    story.messages.forEach((m) => buffer.ingest(m));
    assert.ok(buffer.complete);
  }
});

test("before rejects a campaign still ongoing at the later event", () => {
  const p = datedPlan();
  p.events[0].date!.end = { year: 1300, month: 7, day: 30 };
  p.relations = [
    { beforeIndex: 0, afterIndex: 2, kind: "before", passageIds: ["p1"] },
  ];
  assert.throws(
    () => compileEventPlan(p, checklist(), research),
    /cannot end before/,
  );
  // Partially specified endpoints still cannot override an exact opposing bound.
  p.events[0].date = {
    ...dated(1300, 7, 30),
    end: { year: 1300, month: 7, day: null },
  };
  assert.throws(
    () => compileEventPlan(p, checklist(), research),
    /cannot end before/,
  );
  p.events[0].date = dated(1300, 7, 24);
  p.events[2].date = {
    ...dated(1300, 7),
    end: { year: 1300, month: 7, day: 15 },
  };
  assert.throws(
    () => compileEventPlan(p, checklist(), research),
    /cannot end before/,
  );
});

test("before preserves feasible coarse-date and same-day sourced ordering", () => {
  const p = datedPlan();
  p.events[0].date = dated(1300);
  p.relations = [
    { beforeIndex: 0, afterIndex: 2, kind: "before", passageIds: ["p1"] },
  ];
  assert.ok(compileEventPlan(p, checklist(), research));
  p.events[0].date = dated(1300, 7, 24);
  assert.ok(compileEventPlan(p, checklist(), research));
});

test("supporting year unions cross BCE/CE without inventing a year-zero gap", () => {
  const p = plan(),
    c = checklist();
  c.claims[0].yearRange = { startYear: -1, endYear: -1, approximate: false };
  c.claims.push({
    ...c.claims[0],
    id: "c2",
    yearRange: { startYear: 1, endYear: 1, approximate: false },
  });
  p.events.forEach((e) => {
    e.claimIndices = [0, 1];
    e.date = { ...dated(-1), end: { year: 1, month: null, day: null } };
    e.statement = "A state spanning the era boundary.";
  });
  assert.ok(compileEventPlan(p, c, research));
  c.claims[1].yearRange = { startYear: 2, endYear: 2, approximate: false };
  p.events.forEach((e) => (e.date!.end.year = 2));
  assert.throws(() => compileEventPlan(p, c, research), /unsupported gap/);
});

test("multi-digit BCE/CE labels preserve the typed crossing instead of parsing both endpoints as BCE", () => {
  const p = plan(),
    c = checklist();
  c.claims[0].yearRange = { startYear: -100, endYear: 100, approximate: false };
  p.events.forEach((e) => {
    e.date = { ...dated(-100), end: { year: 100, month: null, day: null } };
    e.statement = "A state spanning the era boundary.";
  });
  const story = compileEventPlan(p, c, research);
  assert.equal(story.focus.period, "100 BCE–100 CE");
  assert.ok(story.structuralValidation.dates.every((d) => d.contained));
  assert.match(story.events[0].date, /100 CE$/);
});

test("coarse year/month mentions do not contradict a matching precise day heading", () => {
  const p = datedPlan();
  p.events[0].statement = "The event occurred in 1300.";
  p.events[0].title = "The event of July 1300";
  assert.ok(compileEventPlan(p, checklist(), research));
  p.events[0].statement = "The event occurred in 1301.";
  assert.throws(
    () => compileEventPlan(p, checklist(), research),
    /outside the visible heading/,
  );
  p.events[0].statement = "The event occurred in August 1300.";
  assert.throws(
    () => compileEventPlan(p, checklist(), research),
    /outside the visible heading/,
  );
});

test("asymmetric era crossings parse each explicit BCE/CE suffix independently", () => {
  const p = plan(),
    c = checklist();
  c.claims[0].yearRange = { startYear: -100, endYear: 500, approximate: false };
  p.events.forEach((e) => {
    e.date = { ...dated(-100), end: { year: 500, month: null, day: null } };
    e.statement = "A state spanning the era boundary, continuing in 400 CE.";
  });
  const story = compileEventPlan(p, c, research);
  assert.equal(story.focus.period, "100 BCE–500 CE");
  p.events[0].statement = "The state continued in 600 CE.";
  assert.throws(
    () => compileEventPlan(p, c, research),
    /outside the visible heading/,
  );
  p.events[0].statement = "The state began in 200 BCE.";
  assert.throws(
    () => compileEventPlan(p, c, research),
    /outside the visible heading/,
  );
});

test("accepting coarse date precision does not hide a future endpoint in a narrated year range", () => {
  for (const statement of [
    "The state lasted from 1300 to 1301.",
    "The state lasted in 1300–1301.",
    "The state lasted from 1299 through 1300.",
  ]) {
    const p = datedPlan();
    p.events[0].statement = statement;
    assert.throws(
      () => compileEventPlan(p, checklist(), research),
      /outside the visible heading/,
    );
  }
});

test("quantity ranges remain measurements rather than future event years", () => {
  const p = datedPlan();
  p.events[0].statement = "A force of 1400–1500 soldiers assembled.";
  assert.ok(compileEventPlan(p, checklist(), research));
  p.events[0].statement = "A journey of 1400 to 1500 miles was planned.";
  assert.ok(compileEventPlan(p, checklist(), research));
});

test("explicit era prefixes are validated as dates rather than ignored", () => {
  const p = datedPlan();
  p.events[0].statement = "The event occurred in AD 1300.";
  assert.ok(compileEventPlan(p, checklist(), research));
  p.events[0].statement = "The event occurred in AD 1400.";
  assert.throws(
    () => compileEventPlan(p, checklist(), research),
    /outside the visible heading/,
  );
  p.events[0].statement = "The event occurred in BC 1400.";
  assert.throws(
    () => compileEventPlan(p, checklist(), research),
    /outside the visible heading/,
  );
});

test("before chains must have one jointly feasible schedule regardless of relation order", () => {
  for (const reverse of [false, true]) {
    const p = datedPlan();
    p.events[0].date = {
      ...dated(1300, 7, 1),
      end: { year: 1300, month: 7, day: 20 },
    };
    p.events[1].date = dated(1300);
    p.events[2].date = {
      ...dated(1300, 7, 10),
      end: { year: 1300, month: 8, day: 1 },
    };
    p.relations = [
      { beforeIndex: 0, afterIndex: 1, kind: "before", passageIds: ["p1"] },
      { beforeIndex: 1, afterIndex: 2, kind: "before", passageIds: ["p1"] },
    ];
    if (reverse) p.relations.reverse();
    assert.throws(
      () => compileEventPlan(p, checklist(), research),
      /no jointly feasible historical timing/,
    );
    p.events[2].date!.start.day = 25;
    assert.ok(compileEventPlan(p, checklist(), research));
  }
});

test("undated intermediary events cannot bridge contradictory temporal bounds", () => {
  const p = datedPlan();
  p.events[0].date!.end.day = 25;
  p.events[1].kind = "context";
  p.events[1].date = null;
  p.events[2].date!.start.day = 20;
  p.relations = [
    { beforeIndex: 0, afterIndex: 1, kind: "before", passageIds: ["p1"] },
    { beforeIndex: 1, afterIndex: 2, kind: "before", passageIds: ["p1"] },
  ];
  assert.throws(
    () => compileEventPlan(p, checklist(), research),
    /no jointly feasible historical timing/,
  );
  p.events[2].date!.start.day = 25;
  p.events[2].date!.end.day = 25;
  assert.ok(compileEventPlan(p, checklist(), research));
});

test("overlap and before relations must be jointly feasible", () => {
  const p = datedPlan();
  p.events[1].date = dated(1300);
  p.events[2].date = dated(1300, 7, 10);
  p.relations = [
    { beforeIndex: 0, afterIndex: 1, kind: "overlaps", passageIds: ["p1"] },
    { beforeIndex: 1, afterIndex: 2, kind: "before", passageIds: ["p1"] },
  ];
  assert.throws(
    () => compileEventPlan(p, checklist(), research),
    /no jointly feasible historical timing/,
  );
  p.events[2].date = dated(1300, 7, 16);
  assert.ok(compileEventPlan(p, checklist(), research));
});

test("bare year ranges in narration, titles, and qualifications cannot escape the heading", () => {
  for (const text of [
    "1300–1301: the campaign continued.",
    "1299—1300: the campaign continued.",
    "1300 to 1301: the campaign continued.",
    "1300 through 1301: the campaign continued.",
    "1300 until 1301: the campaign continued.",
  ]) {
    for (const field of ["statement", "title", "qualification"] as const) {
      const p = datedPlan();
      p.events[0][field] = text;
      assert.throws(
        () => compileEventPlan(p, checklist(), research),
        /outside the visible heading/,
      );
    }
  }
});

test("bare year ranges respect heading precision and do not consume calendar dates or quantities", () => {
  const p = datedPlan();
  for (const text of [
    "1300–1300: a supported campaign.",
    "The event occurred on 1300-07-16.",
    "16–16 July 1300: a supported campaign.",
    "July 16–16, 1300: a supported campaign.",
    ...["soldiers", "miles", "km", "kilometres", "percent", "%"].map(
      (unit) => `A total of 1400–1500 ${unit} was recorded.`,
    ),
  ]) {
    p.events[0].statement = text;
    assert.ok(compileEventPlan(p, checklist(), research), text);
  }
  p.events[0].date = {
    ...dated(1299),
    end: { year: 1301, month: null, day: null },
  };
  p.events[0].statement = "1299–1301: a supported campaign.";
  assert.ok(compileEventPlan(p, checklist(), research));
});

test("bare era ranges validate both endpoints, including short BCE years", () => {
  const p = plan(),
    c = checklist();
  c.claims[0].yearRange = { startYear: -100, endYear: 100, approximate: false };
  p.events.forEach((e) => {
    e.date = dated(-50);
    e.statement = "A supported occurrence.";
  });
  p.events[0].statement = "50–50 BCE: a supported occurrence.";
  assert.ok(compileEventPlan(p, c, research));
  for (const text of [
    "50–49 BCE: a campaign continued.",
    "50 BCE–50 CE: a campaign continued.",
    "BC 50–AD 50: a campaign continued.",
    "50 BCE to AD 50: a campaign continued.",
    "50–0 BCE: a campaign continued.",
  ]) {
    p.events[0].statement = text;
    assert.throws(
      () => compileEventPlan(p, c, research),
      /outside the visible heading|year zero/,
    );
  }
});

test("recognized invalid calendar dates are rejected rather than falling back to their year", () => {
  const p = datedPlan();
  for (const text of [
    "The event occurred on 1300-13-01.",
    "The event occurred on 1300-00-01.",
    "The event occurred on 1300-07-00.",
    "The event occurred on 31 April 1300.",
    "The event occurred on July 32, 1300.",
  ]) {
    p.events[0].statement = text;
    assert.throws(
      () => compileEventPlan(p, checklist(), research),
      /Invalid calendar date/,
    );
  }
});

test("explicit era markers keep a year range temporal even before a quantity word", () => {
  const p = datedPlan();
  p.events[0].statement = "1300–1301 CE soldiers assembled.";
  assert.throws(
    () => compileEventPlan(p, checklist(), research),
    /outside the visible heading/,
  );
});

test("short-era event headings preserve valid year, month and day precision", () => {
  const p = plan(),
    c = checklist();
  c.claims[0].yearRange = {
    startYear: -10000,
    endYear: 100,
    approximate: false,
  };
  for (const year of [-10000, -50, -1, 1, 16, 50, 99]) {
    for (const [month, day] of [
      [null, null],
      [7, null],
      [7, 16],
    ]) {
      p.events.forEach((e) => {
        e.date = dated(year, month, day);
        e.statement = "A supported occurrence.";
      });
      assert.ok(compileEventPlan(p, c, research), `${year}/${month}/${day}`);
      p.events[0].statement = `The event occurred in ${year < 0 ? `${-year} BCE` : `AD ${year}`}.`;
      assert.ok(compileEventPlan(p, c, research));
      p.events[0].statement = `The event occurred in ${year < 0 ? `${-year + 1} BCE` : `AD ${year + 1}`}.`;
      assert.throws(
        () => compileEventPlan(p, c, research),
        /outside the visible heading/,
      );
    }
  }
});

test("precise era-crossing headings retain day bounds rather than widening to whole years", () => {
  const p = plan(),
    c = checklist();
  c.claims[0].yearRange = { startYear: -1, endYear: 1, approximate: false };
  p.events.forEach((e) => {
    e.date = { ...dated(-1, 7, 16), end: { year: 1, month: 7, day: 16 } };
    e.statement = "A supported occurrence.";
  });
  assert.ok(compileEventPlan(p, c, research));
  p.events[0].statement = "The event ended on 17 July 1 CE.";
  assert.throws(
    () => compileEventPlan(p, c, research),
    /outside the visible heading/,
  );
  p.events[0].statement = "The event began on 15 July 1 BCE.";
  assert.throws(
    () => compileEventPlan(p, c, research),
    /outside the visible heading/,
  );
});

test("compact narrated day ranges validate both endpoints without a repeated year", () => {
  for (const [day, statement] of [
    [16, "The campaign lasted July 16–24."],
    [24, "The campaign lasted 16–24 July."],
    [16, "The campaign lasted July 16 through 24."],
    [24, "The campaign lasted 16 to 24 July."],
    [16, "The campaign lasted July 16–24, 50 BCE."],
    [24, "The campaign lasted 16–24 July 50 BCE."],
  ] as const) {
    const p = datedPlan(),
      c = checklist();
    const year = statement.includes("BCE") ? -50 : 1300;
    c.claims[0].yearRange = {
      startYear: year,
      endYear: year,
      approximate: false,
    };
    p.events.forEach((e) => (e.date = dated(year, 7, day)));
    p.events[0].statement = statement;
    assert.throws(
      () => compileEventPlan(p, c, research),
      /outside the visible heading/,
    );
    p.events[0].date = {
      ...dated(year, 7, 16),
      end: { year, month: 7, day: 24 },
    };
    assert.ok(compileEventPlan(p, c, research));
  }
});

test("month ranges inherit a shared year while checking both named months", () => {
  const p = datedPlan();
  for (const statement of [
    "The campaign lasted June–July 1300.",
    "The campaign lasted July through August.",
    "The campaign lasted July 1300 to August.",
    "The campaign lasted July 1300–August 1301.",
  ]) {
    p.events[0].date = dated(1300, 7, 16);
    p.events[0].statement = statement;
    assert.throws(
      () => compileEventPlan(p, checklist(), research),
      /outside the visible heading/,
    );
    p.events[0].date = {
      ...dated(1300, 6),
      end: {
        year: statement.includes("1301") ? 1301 : 1300,
        month: 8,
        day: null,
      },
    };
    assert.ok(compileEventPlan(p, checklist(), research));
  }
});
