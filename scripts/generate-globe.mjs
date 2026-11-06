import { readFile, writeFile, mkdir } from "node:fs/promises";
import { feature } from "topojson-client";
import { geoContains } from "d3-geo";

// Natural Earth coastlines, distributed by world-atlas (ISC).
// Generate static geometry once; no mapping API or runtime network required.
const topology = JSON.parse(await readFile(new URL("../node_modules/world-atlas/land-110m.json", import.meta.url), "utf8"));
const land = feature(topology, topology.objects.land);
const positions = [], colors = [];
const radius = 2.012, step = 1.5;
const point = (lat, lon) => {
  const a = lat * Math.PI / 180, b = lon * Math.PI / 180;
  return [radius * Math.cos(a) * Math.sin(b), radius * Math.sin(a), radius * Math.cos(a) * Math.cos(b)];
};
for (let lat = -84; lat < 84; lat += step) {
  for (let lon = -180; lon < 180; lon += step) {
    if (!geoContains(land, [lon + step / 2, lat + step / 2])) continue;
    const corners = [point(lat, lon), point(lat, lon + step), point(lat + step, lon + step), point(lat + step, lon)];
    const noise = (Math.sin(lat * 13.1 + lon * 5.7) + 1) / 2;
    const c = lat > 63 ? [0.72, 0.75, 0.61] : lat > 12 && lat < 36 && lon > -20 && lon < 65 ? [0.71, 0.64, 0.43] : [0.32 + noise * 0.06, 0.47 + noise * 0.06, 0.34 + noise * 0.05];
    for (const index of [0, 1, 2, 0, 2, 3]) { positions.push(...corners[index].map((n) => +n.toFixed(5))); colors.push(...c.map((n) => +n.toFixed(3))); }
  }
}
await mkdir(new URL("../public/", import.meta.url), { recursive: true });
await writeFile(new URL("../public/globe-land.json", import.meta.url), JSON.stringify({ positions, colors }));
console.log(`Generated ${positions.length / 9} land triangles.`);
