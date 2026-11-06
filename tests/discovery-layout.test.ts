import assert from "node:assert/strict";
import test from "node:test";
import {
  currentHistoricalContext,
  validateDiscovery,
  angularDistance,
} from "../src/lib/discovery";
import {
  inferHistoricalRange,
  historicalRangeSchema,
} from "../src/lib/historical-time";
import {
  modelOffsets,
  packLabels,
  sceneFraming,
} from "../src/lib/scene-layout";
import { makeDemo } from "../src/lib/demo";
import { SceneBuffer } from "../src/lib/playback";
import { citedResearch } from "../src/lib/server/evidence";
import { responseFixture, evidenceUrl } from "./fixtures/live-scene";

test("historical dates handle BCE and uncertainty conservatively", () => {
  assert.deepEqual(inferHistoricalRange("c. 1300"), {
    startYear: 1275,
    endYear: 1325,
    approximate: true,
  });
  assert.deepEqual(inferHistoricalRange("1250–1150 BCE"), {
    startYear: -1250,
    endYear: -1150,
    approximate: false,
  });
  assert.equal(inferHistoricalRange("19th century"), null);
  assert.equal(
    historicalRangeSchema.safeParse({
      startYear: 0,
      endYear: 1,
      approximate: false,
    }).success,
    false,
  );
});
test("Meanwhile uses the current chapter and rejects another period or nearby event", () => {
  const buffer = new SceneBuffer();
  makeDemo("The First Sino-Japanese War").forEach((message) =>
    buffer.ingest(message),
  );
  const context = currentHistoricalContext(buffer.focus!, buffer.actions, 57)!;
  assert.deepEqual(context.yearRange, {
    startYear: 1895,
    endYear: 1895,
    approximate: false,
  });
  assert.ok(angularDistance({ lat: 0, lon: 179 }, { lat: 0, lon: -179 }) < 3);
  const event = {
    title: "Elsewhere",
    center: { lat: 0, lon: -70 },
    yearRange: context.yearRange,
  };
  assert.doesNotThrow(() => validateDiscovery(context, event));
  assert.throws(
    () =>
      validateDiscovery(context, {
        ...event,
        yearRange: { startYear: 1894, endYear: 1894, approximate: false },
      }),
    /period/,
  );
  assert.throws(
    () =>
      validateDiscovery(context, { ...event, center: context.originCenter }),
    /elsewhere/,
  );
});
test("source markers preserve cited prose and use stable registry IDs", () => {
  const bundle = citedResearch(
    responseFixture("The entire supported sentence.", true) as any,
  );
  assert.equal(bundle.text, "The entire supported sentence. [s1]");
  assert.equal(bundle.sources[0].url, evidenceUrl);
});
test("camera framing spans the dateline without centering the opposite hemisphere", () => {
  const focus = makeDemo("The First Sino-Japanese War")[0];
  assert.equal(focus.type, "focus");
  if (focus.type !== "focus") return;
  const actions = [179, -179].map(
    (lon, i) =>
      ({
        type: "spawn",
        id: `s${i}`,
        entityId: `e${i}`,
        at: 0,
        asset: "city",
        position: { lat: 10, lon },
        palette: "gold",
        scale: 1,
        label: "City",
      }) as const,
  );
  const frame = sceneFraming(focus, actions, 0.7);
  assert.ok(Math.abs(frame.center.lon) > 175);
  assert.ok(frame.distance >= focus.distance && frame.distance <= 7.8);
});
test("labels prioritize speakers, avoid overlap and clamp within the viewport", () => {
  const result = packLabels(
    [
      {
        id: "ordinary",
        priority: 0,
        rect: { x: 95, y: 30, width: 40, height: 30 },
      },
      {
        id: "speaker",
        priority: 1000,
        rect: { x: 95, y: 30, width: 40, height: 70 },
      },
    ],
    { x: 0, y: 0, width: 140, height: 100 },
    1,
  );
  assert.equal(result.speaker.shown, true);
  assert.equal(result.ordinary.shown, false);
  assert.equal(result.speaker.x, 0);
});
test("model spacing is deterministic and leaves isolated anchors in place", () => {
  const entities = ["a", "b", "c"].map((id) => ({
    id,
    position: { lat: 30, lon: 120 },
    scale: 1,
  }));
  const offsets = modelOffsets(entities);
  assert.deepEqual(offsets, modelOffsets(entities.toReversed()));
  assert.deepEqual(offsets.a, [0, 0]);
  assert.notDeepEqual(offsets.b, offsets.a);
  assert.ok(Math.hypot(...offsets.c) < 0.3);
});
