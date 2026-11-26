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
  const receipt = validateDiscovery(context, event);
  assert.equal(receipt.angularDistanceDegrees, angularDistance(context.originCenter, event.center));
  assert.equal(receipt.minimumAngularDistanceDegrees, 20);
  assert.equal(receipt.periodCheck, "within_requested_range");
  assert.throws(() => validateDiscovery(context, { ...event, title: context.originTitle }), /different historical event/);
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

test("narration sits beside the full miniature and avoids the right story panel", () => {
  const figure = { x: 400, y: 180, width: 170, height: 230 };
  const panel = { x: 760, y: 90, width: 200, height: 450 };
  const rect = { x: 460, y: 180, width: 210, height: 180 };
  const result = packLabels([{ id: "speaker", rect, anchor: figure, priority: 1000 }],
    { x: 8, y: 80, width: 944, height: 500 }, 6, [figure, panel]).speaker;
  assert.ok(result.shown);
  const placed = { ...rect, x: rect.x + result.x, y: rect.y + result.y };
  assert.ok(placed.x + placed.width < figure.x);
  assert.ok(placed.y >= 80 && placed.y + placed.height <= 580);
});

test("narrow-screen narration uses clear space without covering models or playback", () => {
  const figure = { x: 125, y: 300, width: 140, height: 100 };
  const top = { x: 0, y: 0, width: 390, height: 210 };
  const playback = { x: 12, y: 680, width: 366, height: 100 };
  const rect = { x: 150, y: 280, width: 150, height: 140 };
  const result = packLabels([{ id: "speaker", rect, anchor: figure, priority: 1000 }],
    { x: 8, y: 80, width: 374, height: 580 }, 4, [figure, top, playback]).speaker;
  assert.ok(result.shown);
  const placed = { ...rect, x: rect.x + result.x, y: rect.y + result.y };
  assert.ok(placed.y > figure.y + figure.height);
  assert.ok(placed.x >= 8 && placed.x + placed.width <= 382);
  assert.ok(placed.y + placed.height < playback.y);
});
