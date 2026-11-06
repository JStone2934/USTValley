import type { SceneMap, Surface } from "../src/shared/world.ts";

/** Keep thin wall sections that fall between structural cell centres. Scan the
 * original rings at walking resolution, preserving jambs and polygon holes. */
export function fitThinWalls(scene: SceneMap, surfaces: Surface[]) {
  const w = scene.width * scene.tileSize,
    h = scene.height * scene.tileSize;
  const pixels = new Uint8Array(w * h);
  const walls = surfaces.filter((s) => s.kind === "wall");
  for (const wall of walls) {
    for (const rings of wall.polygons) {
      const rows = new Map<number, number[]>();
      for (const ring of rings)
        for (let i = 0; i < ring.length; i++) {
          const a = ring[i],
            b = ring[(i + 1) % ring.length];
          const start = Math.max(0, Math.ceil(Math.min(a.y, b.y) - 0.5));
          const end = Math.min(h, Math.ceil(Math.max(a.y, b.y) - 0.5));
          for (let y = start; y < end; y++) {
            const x = a.x + ((b.x - a.x) * (y + 0.5 - a.y)) / (b.y - a.y);
            const intersections = rows.get(y);
            if (intersections) intersections.push(x);
            else rows.set(y, [x]);
          }
        }
      for (const [y, edges] of rows) {
        edges.sort((a, b) => a - b);
        for (let i = 0; i + 1 < edges.length; i += 2) {
          const left = Math.max(0, Math.ceil(edges[i] - 0.5));
          const right = Math.min(w, Math.ceil(edges[i + 1] - 0.5));
          for (let x = left; x < right; x++) pixels[y * w + x] = 1;
        }
      }
    }
  }
  // Some survey walls taper below one pixel. Complete the line only where the
  // centre samples miss it, so a sub-pixel partition still stops the walker.
  for (const wall of walls) {
    for (const polygon of wall.polygons)
      for (const ring of polygon)
        for (let i = 1; i < ring.length; i++) {
          const a = ring[i - 1],
            b = ring[i];
          const steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) * 2);
          for (let k = 0; k < steps; k++) {
            const x = Math.floor(a.x + ((b.x - a.x) * k) / steps);
            const y = Math.floor(a.y + ((b.y - a.y) * k) / steps);
            if (x <= 0 || y <= 0 || x >= w - 1 || y >= h - 1) continue;
            const n = y * w + x;
            if (
              pixels[n] ||
              pixels[n - 1] ||
              pixels[n + 1] ||
              pixels[n - w] ||
              pixels[n + w]
            )
              continue;
            pixels[n] = 1;
          }
        }
  }
  const runs = [...(scene.fixtureCollision?.runs ?? [])];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; ) {
      if (!pixels[y * w + x]) {
        x++;
        continue;
      }
      const start = x++;
      while (x < w && pixels[y * w + x]) x++;
      runs.push(y, start, x - start);
    }
  if (runs.length)
    scene.fixtureCollision = {
      sourceIds: scene.fixtureCollision?.sourceIds ?? [],
      runs,
    };
}
