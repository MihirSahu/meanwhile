import type { Geo, SceneAction, SceneFocus } from "./scene-schema";
export type Rect = { x: number; y: number; width: number; height: number };
const rad = Math.PI / 180;
function vector(p: Geo) {
  return [
    Math.cos(p.lat * rad) * Math.sin(p.lon * rad),
    Math.sin(p.lat * rad),
    Math.cos(p.lat * rad) * Math.cos(p.lon * rad),
  ];
}
export function sceneFraming(
  focus: SceneFocus | null,
  actions: SceneAction[],
  aspect: number,
) {
  if (!focus) return { center: { lat: 22, lon: 75 }, distance: 6.7 };
  const points = actions.flatMap((a) =>
    a.type === "spawn" ? [a.position] : a.type === "move" ? a.path : [],
  );
  if (!points.length) return { center: focus.center, distance: focus.distance };
  const vectors = points.map(vector),
    sum = vectors.reduce((a, b) => a.map((v, i) => v + b[i]), [0, 0, 0]);
  const length = Math.hypot(...sum);
  const normal =
    length < 0.01 ? vector(focus.center) : sum.map((v) => v / length);
  const radius = Math.max(
    ...vectors.map((v) =>
      Math.acos(
        Math.max(
          -1,
          Math.min(
            1,
            v.reduce((s, n, i) => s + n * normal[i], 0),
          ),
        ),
      ),
    ),
  );
  const halfFov = Math.min(
    19 * rad,
    Math.atan(Math.tan(19 * rad) * Math.max(0.5, aspect)),
  );
  const distance =
    2.05 * Math.cos(Math.min(radius, Math.PI / 2)) +
    (2.05 * Math.sin(Math.min(radius, Math.PI / 2)) + 0.42) / Math.tan(halfFov);
  return {
    center: {
      lat: Math.asin(normal[1]) / rad,
      lon: Math.atan2(normal[0], normal[2]) / rad,
    },
    distance: Math.min(7.8, Math.max(focus.distance, 4.1, distance)),
  };
}
/** Screen-space packing around miniatures and interface controls. */
export function packLabels(
  items: { id: string; rect: Rect; priority: number; anchor?: Rect }[],
  bounds: Rect,
  limit: number,
  obstacles: Rect[] = [],
) {
  const placed: Rect[] = [],
    result: Record<string, { x: number; y: number; shown: boolean }> = {};
  const overlap = (a: Rect, b: Rect) =>
    a.x < b.x + b.width + 6 &&
    a.x + a.width + 6 > b.x &&
    a.y < b.y + b.height + 6 &&
    a.y + a.height + 6 > b.y;
  for (const item of [...items].sort(
    (a, b) => b.priority - a.priority || a.id.localeCompare(b.id),
  )) {
    const r = item.rect;
    let found: Rect | null = null;
    if (
      r.x + r.width / 2 >= bounds.x &&
      r.x + r.width / 2 <= bounds.x + bounds.width &&
      r.y >= bounds.y - r.height &&
      r.y <= bounds.y + bounds.height &&
      placed.length < limit
    ) {
      const anchor = item.anchor;
      const candidates = anchor
        ? [
            // Try either side first, keeping the entire box off the miniature.
            ...[0, -32, 32, -80, 80, -144, 144].flatMap((dy) => [
              { x: anchor.x + anchor.width + 16, y: anchor.y + anchor.height / 2 - r.height / 2 + dy },
              { x: anchor.x - r.width - 16, y: anchor.y + anchor.height / 2 - r.height / 2 + dy },
            ]),
            // On a narrow screen, use clear space above/below rather than
            // drawing through a figure or letting narration leave the screen.
            { x: anchor.x + anchor.width / 2 - r.width / 2, y: anchor.y - r.height - 16 },
            { x: anchor.x + anchor.width / 2 - r.width / 2, y: anchor.y + anchor.height + 16 },
            ...Array.from({ length: Math.ceil(bounds.height / 32) }, (_, i) => [
              { x: bounds.x, y: bounds.y + i * 32 },
              { x: bounds.x + bounds.width - r.width, y: bounds.y + i * 32 },
            ]).flat(),
          ]
        : [0, -32, 32, -64, 64].map((dy) => ({ x: r.x, y: r.y + dy }));
      for (const candidate of candidates) {
        const next = {
          ...r,
          x: Math.max(
            bounds.x,
            Math.min(candidate.x, bounds.x + bounds.width - r.width),
          ),
          y: Math.max(
            bounds.y,
            Math.min(candidate.y, bounds.y + bounds.height - r.height),
          ),
        };
        if (next.width <= bounds.width && next.height <= bounds.height &&
          ![...placed, ...obstacles].some((p) => overlap(next, p))) {
          found = next;
          break;
        }
      }
    }
    result[item.id] = {
      x: found ? found.x - r.x : 0,
      y: found ? found.y - r.y : 0,
      shown: Boolean(found),
    };
    if (found) placed.push(found);
  }
  return result;
}
/** Small presentation offsets; geographic pins and routes retain their true coordinates. */
export function modelOffsets(
  entities: { id: string; position: Geo; scale: number }[],
) {
  const placed: { world: number[]; radius: number }[] = [];
  const result: Record<string, [number, number]> = {};
  for (const entity of [...entities].sort((a, b) => a.id.localeCompare(b.id))) {
    const p = vector(entity.position),
      radius = Math.min(0.16, 0.075 * entity.scale);
    // The renderer rotates local +Y to the surface normal. Match that basis
    // when checking distances between miniatures at nearby geographic anchors.
    const raw = [p[2], 0, -p[0], 1 + p[1]],
      norm = Math.hypot(...raw);
    const q = raw.map((v) => v / norm);
    const rotate = (v: number[]) => {
      const u = q.slice(0, 3),
        dot = u.reduce((sum, n, i) => sum + n * v[i], 0);
      const cross = [
        u[1] * v[2] - u[2] * v[1],
        u[2] * v[0] - u[0] * v[2],
        u[0] * v[1] - u[1] * v[0],
      ];
      return v.map(
        (n, i) =>
          2 * dot * u[i] + (2 * q[3] * q[3] - 1) * n + 2 * q[3] * cross[i],
      );
    };
    let offset: [number, number] = [0, 0],
      world = p.map((v) => v * 2.025);
    for (let i = 0; i < 24; i++) {
      const angle = i * 2.4,
        distance = i === 0 ? 0 : 0.055 * Math.sqrt(i);
      offset = [Math.cos(angle) * distance, Math.sin(angle) * distance];
      const delta = rotate([offset[0], 0, offset[1]]);
      world = p.map((v, k) => v * 2.025 + delta[k]);
      if (
        !placed.some(
          (other) =>
            Math.hypot(...world.map((v, k) => v - other.world[k])) <
            radius + other.radius,
        )
      )
        break;
    }
    result[entity.id] = offset;
    placed.push({ world, radius });
  }
  return result;
}
