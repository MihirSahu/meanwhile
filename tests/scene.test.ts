import assert from "node:assert/strict";
import test from "node:test";
import { makeDemo } from "../src/lib/demo";
import {
  advanceClock,
  chapterAt,
  entityVisible,
  positionAt,
  SceneBuffer,
} from "../src/lib/playback";
import {
  LineDecoder,
  messageSchema,
  type SceneAction,
  type SpawnAction,
} from "../src/lib/scene-schema";
import { readSceneStream } from "../src/lib/scene-stream";

const focus = makeDemo("The First Sino-Japanese War")[0];
const spawn: SpawnAction = {
  type: "spawn",
  id: "spawn",
  at: 0,
  entityId: "merchant",
  asset: "horse",
  position: { lat: 10, lon: 170 },
  palette: "clay",
  label: "Merchant",
  scale: 1,
};
const move: SceneAction = {
  type: "move",
  id: "move",
  at: 1,
  entityId: "merchant",
  path: [spawn.position, { lat: 20, lon: -170 }],
  duration: 5,
};
const batch = (actions: SceneAction[], seq = 0, readyThrough = 10) => ({
  type: "batch",
  actions,
  seq,
  readyThrough,
});
const focused = () => {
  const buffer = new SceneBuffer();
  buffer.ingest(focus);
  return buffer;
};
const encode = (messages: unknown[], newline = true) =>
  new TextEncoder().encode(
    messages.map((message) => JSON.stringify(message)).join("\n") +
      (newline ? "\n" : ""),
  );
function response(bytes: Uint8Array, sizes = [1]) {
  let offset = 0,
    index = 0;
  return new Response(
    new ReadableStream({
      pull(controller) {
        if (offset === bytes.length) {
          controller.close();
          return;
        }
        const size = sizes[index++ % sizes.length];
        controller.enqueue(bytes.slice(offset, offset + size));
        offset = Math.min(offset + size, bytes.length);
      },
    }),
  );
}

for (const prompt of [
  "The First Sino-Japanese War",
  "Trade along the Silk Road",
]) {
  test(`${prompt}: the full demo obeys the same protocol and remains replayable`, () => {
    const buffer = new SceneBuffer();
    for (const message of makeDemo(prompt)) buffer.ingest(message);
    assert.ok(buffer.complete);
    assert.ok(buffer.readyThrough > 60);
    assert.equal(chapterAt(buffer.actions, 0)?.at, 0);
    assert.ok(chapterAt(buffer.actions, buffer.readyThrough)!.at > 0);
    assert.equal(
      advanceClock(buffer.readyThrough, 1, 4, buffer.readyThrough),
      buffer.readyThrough,
    );
    assert.equal(advanceClock(0, 0.1, 4, buffer.readyThrough), 0.4);
    assert.equal(chapterAt(buffer.actions, 0)?.at, 0);
  });
}

test("unrelated and unsupported historical prompts never select an arbitrary demo", () => {
  for (const prompt of [
    "Japan",
    "trade in ancient Egypt",
    "World War II",
    "The Second Sino-Japanese War 1937",
  ])
    assert.throws(() => makeDemo(prompt), /demo|second war/i);
});

test("NDJSON handles CRLF, blank lines and an unterminated final message", () => {
  const lines = new LineDecoder();
  assert.deepEqual([...lines.push(' \n{"a":')], []);
  assert.deepEqual([...lines.push('1}\r\n\n{"b":2')], [{ a: 1 }]);
  assert.deepEqual([...lines.push("}", true)], [{ b: 2 }]);
});

test("the line limit applies to each record, not the network chunk", () => {
  const lines = new LineDecoder();
  assert.equal(
    [...lines.push(('"' + "x".repeat(140_000) + '"\n').repeat(2))].length,
    2,
  );
  assert.throws(() => [...lines.push("x".repeat(256_001))], /too large/);
});

test("stream decoding preserves split UTF-8 code points and commits progressively", async () => {
  const special = { ...focus, title: "Xi’an · 世界 🐎" };
  const messages = [special, batch([spawn]), { type: "done", duration: 10 }];
  const buffer = new SceneBuffer();
  const commits: number[] = [];
  await readSceneStream(
    response(encode(messages, false), [1, 2, 7, 3]),
    buffer,
    new AbortController().signal,
    () => commits.push(buffer.readyThrough),
  );
  assert.equal(buffer.focus?.title, special.title);
  assert.deepEqual(commits, [0, 10, 10]);
  assert.ok(buffer.complete);
});

test("cancellation rejects queued stale messages before another commit", async () => {
  const controller = new AbortController();
  const buffer = new SceneBuffer();
  let commits = 0;
  await assert.rejects(
    readSceneStream(
      response(encode([focus, batch([spawn])]), [100_000]),
      buffer,
      controller.signal,
      () => {
        commits++;
        controller.abort();
      },
    ),
    { name: "AbortError" },
  );
  assert.equal(commits, 1);
  assert.equal(buffer.readyThrough, 0);
});

test("cancellation takes precedence over malformed queued data", async () => {
  const controller = new AbortController(),
    buffer = new SceneBuffer();
  const bytes = new TextEncoder().encode(
    JSON.stringify(focus) + "\n{broken}\n",
  );
  let commits = 0;
  await assert.rejects(
    readSceneStream(
      response(bytes, [bytes.length]),
      buffer,
      controller.signal,
      () => {
        commits++;
        controller.abort();
      },
    ),
    { name: "AbortError" },
  );
  assert.equal(commits, 1);
  assert.equal(buffer.readyThrough, 0);
});

test("cancellation interrupts a stalled reader and cancels its source", async () => {
  const controller = new AbortController();
  let cancelled = false;
  const stream = new ReadableStream({
    start(c) {
      c.enqueue(encode([focus]));
    },
    cancel() {
      cancelled = true;
    },
  });
  const buffer = new SceneBuffer();
  const run = readSceneStream(
    new Response(stream),
    buffer,
    controller.signal,
    () => {
      queueMicrotask(() => controller.abort());
    },
  );
  await assert.rejects(run, { name: "AbortError" });
  assert.ok(cancelled);
});

test("truncated streams preserve their last committed batch", async () => {
  const buffer = new SceneBuffer();
  await assert.rejects(
    readSceneStream(
      response(encode([focus, batch([spawn])])),
      buffer,
      new AbortController().signal,
      () => {},
    ),
    /ended early/,
  );
  assert.equal(buffer.readyThrough, 10);
  assert.ok(!buffer.complete);
});

test("valid records before malformed data remain committed for any network chunk size", async () => {
  const prefix = encode([focus, batch([spawn])]);
  for (const suffix of [
    new TextEncoder().encode("{broken}\n"),
    new TextEncoder().encode("{broken}"),
    new TextEncoder().encode("x".repeat(256_001)),
    new Uint8Array([0xff, 10]),
  ]) {
    const bytes = new Uint8Array(prefix.length + suffix.length);
    bytes.set(prefix);
    bytes.set(suffix, prefix.length);
    for (const sizes of [[bytes.length], [37, 101]]) {
      const buffer = new SceneBuffer();
      await assert.rejects(
        readSceneStream(
          response(bytes, sizes),
          buffer,
          new AbortController().signal,
          () => {},
        ),
      );
      assert.equal(buffer.readyThrough, 10);
      assert.equal(buffer.actions.length, 1);
      assert.ok(!buffer.complete);
    }
  }
});

test("malformed data and invalid UTF-8 are rejected", async () => {
  for (const bytes of [
    new TextEncoder().encode('{"type":'),
    new Uint8Array([0xff]),
  ]) {
    await assert.rejects(
      readSceneStream(
        response(bytes),
        new SceneBuffer(),
        new AbortController().signal,
        () => {},
      ),
    );
  }
});

test("HTTP errors expose safe server explanations", async () => {
  await assert.rejects(
    readSceneStream(
      Response.json({ error: "Try a supported story." }, { status: 422 }),
      new SceneBuffer(),
      new AbortController().signal,
      () => {},
    ),
    /supported story/,
  );
});

test("focus must come first and cannot be duplicated", () => {
  assert.throws(
    () => new SceneBuffer().ingest(batch([spawn])),
    /first message/,
  );
  assert.throws(() => focused().ingest(focus), /one focus/);
});

test("invalid assets, coordinates, IDs, and unsafe source URLs fail schema validation", () => {
  for (const action of [
    { ...spawn, asset: "dragon" },
    { ...spawn, id: "bad id" },
    { ...spawn, position: { lat: 91, lon: 0 } },
  ])
    assert.ok(!messageSchema.safeParse(batch([action as SpawnAction])).success);
  assert.ok(
    !messageSchema.safeParse({
      ...focus,
      sources: [{ title: "Unsafe", url: "javascript:alert(1)" }],
    }).success,
  );
});

test("batch rejection is atomic even after valid actions", () => {
  const buffer = focused();
  assert.throws(
    () => buffer.ingest(batch([spawn, { ...move, entityId: "missing" }])),
    /unavailable entity/,
  );
  assert.equal(buffer.actions.length, 0);
  assert.equal(buffer.readyThrough, 0);
  buffer.ingest(batch([spawn, move]));
  assert.equal(buffer.actions.length, 2);
});

test("duplicate action and entity IDs, batches and out-of-order batches are rejected", () => {
  assert.throws(
    () => focused().ingest(batch([spawn, { ...spawn, entityId: "other" }])),
    /IDs must be unique/,
  );
  assert.throws(
    () => focused().ingest(batch([spawn, { ...spawn, id: "another" }])),
    /spawned twice/,
  );
  const buffer = focused();
  buffer.ingest(batch([spawn]));
  for (const seq of [0, 2])
    assert.throws(
      () =>
        buffer.ingest(
          batch(
            [
              {
                type: "chapter",
                id: "chapter",
                at: 10,
                date: "Later",
                title: "Later",
                caption: "Later",
              },
            ],
            seq,
            20,
          ),
        ),
      /missing or duplicated/,
    );
  assert.equal(buffer.readyThrough, 10);
});

test("committed intervals cannot be rewritten or crossed", () => {
  assert.throws(
    () => focused().ingest(batch([spawn, { ...move, duration: 10 }])),
    /boundary/,
  );
  const buffer = focused();
  buffer.ingest(batch([spawn]));
  assert.throws(
    () => buffer.ingest(batch([{ ...move, at: 9 }], 1, 20)),
    /boundary/,
  );
  assert.throws(
    () => buffer.ingest(batch([{ ...move, at: 10 }], 1, 10)),
    /advance/,
  );
  assert.equal(buffer.actions.length, 1);
});

test("references, attack targets and quotations are validated", () => {
  assert.throws(
    () =>
      focused().ingest(
        batch([
          spawn,
          {
            type: "attack",
            id: "attack",
            at: 1,
            entityId: spawn.entityId,
            targetId: "missing",
            duration: 1,
          },
        ]),
      ),
    /target is unavailable/,
  );
  assert.throws(
    () =>
      focused().ingest(
        batch([
          spawn,
          {
            type: "speech",
            id: "speech",
            at: 1,
            entityId: spawn.entityId,
            kind: "quote",
            text: "Unsourced",
            duration: 1,
          },
        ]),
      ),
    /needs a source/,
  );
});

test("movement cannot overlap and despawns cannot interrupt active actions", () => {
  assert.throws(
    () =>
      focused().ingest(batch([spawn, move, { ...move, id: "move2", at: 2 }])),
    /overlapping/,
  );
  assert.throws(
    () =>
      focused().ingest(
        batch([
          spawn,
          move,
          { type: "despawn", id: "bye", entityId: spawn.entityId, at: 3 },
        ]),
      ),
    /active action/,
  );
  assert.throws(
    () =>
      focused().ingest(
        batch([
          spawn,
          { type: "despawn", id: "bye", entityId: spawn.entityId, at: 0.5 },
          move,
        ]),
      ),
    /unavailable entity/,
  );
});

test("an attack target cannot disappear during an attack", () => {
  const target = { ...spawn, id: "target", entityId: "target" };
  assert.throws(
    () =>
      focused().ingest(
        batch([
          spawn,
          target,
          {
            type: "attack",
            id: "attack",
            at: 1,
            entityId: spawn.entityId,
            targetId: target.entityId,
            duration: 5,
          },
          { type: "despawn", id: "bye", entityId: target.entityId, at: 3 },
        ]),
      ),
    /active action/,
  );
});

test("done must match the final boundary; post-completion messages fail", () => {
  const buffer = focused();
  assert.throws(() => buffer.ingest({ type: "done", duration: 0 }), /nonempty/);
  buffer.ingest(batch([spawn]));
  assert.throws(() => buffer.ingest({ type: "done", duration: 11 }), /match/);
  buffer.ingest({ type: "done", duration: 10 });
  assert.throws(
    () => buffer.ingest({ type: "done", duration: 10 }),
    /already complete/,
  );
});

test("the clock waits at a buffer boundary and resumes at exactly the chosen speed", () => {
  assert.equal(advanceClock(9.9, 0.1, 4, 10), 10);
  assert.equal(advanceClock(10, 0.1, 4, 10), 10);
  assert.equal(advanceClock(10, 0.1, 4, 20), 10.4);
  assert.equal(advanceClock(10, 4, 1, 20), 10.1);
  assert.equal(advanceClock(10, -1, 1, 20), 10);
});

test("position and visibility recover on rewind, including dateline movement", () => {
  const actions: SceneAction[] = [
    spawn,
    move,
    { type: "despawn", id: "bye", entityId: spawn.entityId, at: 8 },
  ];
  assert.deepEqual(positionAt(actions, spawn, 0), spawn.position);
  assert.deepEqual(positionAt(actions, spawn, 3.5), { lat: 15, lon: -180 });
  assert.deepEqual(positionAt(actions, spawn, 10), { lat: 20, lon: -170 });
  assert.deepEqual(positionAt(actions, spawn, 0), spawn.position);
  assert.ok(!entityVisible(actions, spawn, -1));
  assert.ok(!entityVisible(actions, spawn, 9));
  assert.ok(entityVisible(actions, spawn, 0));
});
