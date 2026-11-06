import { z } from "zod";
import {
  claimIdsSchema,
  focusEvidenceSchema,
  batchEvidenceSchema,
} from "./evidence-schema";
import { historicalRangeSchema } from "./historical-time";

export const assetIds = [
  "infantry",
  "officer",
  "cannon",
  "steamship",
  "sailship",
  "city",
  "factory",
  "train",
  "tree",
  "horse",
] as const;
export const assetCatalog = assetIds.map((id) => ({
  id,
  earliestVisualYear:
    (
      { cannon: 1400, steamship: 1800, factory: 1700, train: 1800 } as Partial<
        Record<(typeof assetIds)[number], number>
      >
    )[id] ?? null,
  description: {
    infantry:
      "A formation of uniformed soldiers with walking animation; schematic attacks use effects",
    officer: "A named person in a stylized uniform with walking animation",
    cannon: "A wheeled field cannon",
    steamship: "A late nineteenth-century steam warship",
    sailship: "A wooden sailing ship",
    city: "A small cluster of buildings",
    factory: "A brick factory with a smokestack",
    train: "A steam locomotive with carriages",
    tree: "A low-poly evergreen tree",
    horse: "A mounted traveler or cavalry figure",
  }[id],
}));

const id = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
const sourceUrl = z
  .string()
  .url()
  .refine(
    (url) => /^https?:\/\//i.test(url),
    "Sources must use HTTP or HTTPS.",
  );
const time = z.number().finite().min(0).max(600);
export const geoSchema = z.object({
  lat: z.number().finite().min(-85).max(85),
  lon: z.number().finite().min(-180).max(180),
});
const common = { id, at: time, claimIds: claimIdsSchema.optional() };
const sourceIds = z.array(id).min(1).max(8).optional();
const duration = z.number().finite().min(0.1).max(120);
export const actionSchema = z.discriminatedUnion("type", [
  z.object({
    ...common,
    type: z.literal("spawn"),
    entityId: id,
    asset: z.enum(assetIds),
    position: geoSchema,
    palette: z.enum(["clay", "indigo", "sage", "gold"]),
    label: z.string().max(80),
    scale: z.number().min(0.5).max(2).default(1),
  }),
  z.object({
    ...common,
    type: z.literal("move"),
    entityId: id,
    path: z.array(geoSchema).min(2).max(16),
    duration,
  }),
  z.object({
    ...common,
    type: z.literal("attack"),
    entityId: id,
    targetId: id,
    duration,
  }),
  z.object({
    ...common,
    type: z.literal("speech"),
    entityId: id,
    text: z.string().min(1).max(240),
    kind: z.enum(["narration", "reconstruction", "quote"]),
    sourceUrl: sourceUrl.optional(),
    sourceIds,
    duration,
  }),
  z.object({
    ...common,
    type: z.literal("chapter"),
    date: z.string().max(60),
    title: z.string().max(100),
    caption: z.string().max(400),
    sourceIds,
    yearRange: historicalRangeSchema.optional(),
  }),
  z.object({ ...common, type: z.literal("despawn"), entityId: id }),
]);
export const focusSchema = z.object({
  type: z.literal("focus"),
  title: z.string().min(1).max(100),
  period: z.string().max(60),
  location: z.string().max(100),
  center: geoSchema,
  distance: z.number().min(2.7).max(7),
  sources: z
    .array(
      z.object({
        id: id.optional(),
        title: z.string().max(120),
        url: sourceUrl,
      }),
    )
    .min(1)
    .max(8),
  mode: z.enum(["demo", "live"]),
  yearRange: historicalRangeSchema.optional(),
  evidence: focusEvidenceSchema.optional(),
  discoveryFrom: z
    .object({ title: z.string().max(100), period: z.string().max(100) })
    .optional(),
});
export const messageSchema = z.discriminatedUnion("type", [
  focusSchema,
  z.object({
    type: z.literal("batch"),
    evidence: batchEvidenceSchema.optional(),
    seq: z.number().int().min(0),
    readyThrough: time,
    actions: z.array(actionSchema).min(1).max(100),
  }),
  z.object({ type: z.literal("done"), duration: time }),
  z.object({ type: z.literal("error"), message: z.string().max(300) }),
]);
export type Geo = z.infer<typeof geoSchema>;
export type SceneAction = z.infer<typeof actionSchema>;
export type SpawnAction = Extract<SceneAction, { type: "spawn" }>;
export type SceneFocus = z.infer<typeof focusSchema>;
export type SceneMessage = z.infer<typeof messageSchema>;

export function actionEnd(action: SceneAction) {
  return action.at + ("duration" in action ? action.duration : 0);
}

/** Handles UTF-8-decoded NDJSON independently of network chunk boundaries. */
export class LineDecoder {
  private pending = "";
  *push(chunk: string, flush = false): Generator<unknown> {
    this.pending += chunk;
    const lines = this.pending.split("\n");
    this.pending = flush ? "" : lines.pop()!;
    // Yield one validated record at a time. A later malformed/oversized
    // record must not discard earlier complete records in the same chunk.
    for (const line of lines) {
      if (line.length > 256_000) throw new Error("Scene message is too large.");
      if (line.trim()) yield JSON.parse(line);
    }
    if (this.pending.length > 256_000)
      throw new Error("Scene message is too large.");
  }
}
