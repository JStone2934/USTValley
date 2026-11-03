import { canStand, type Point, type SceneMap } from "../src/shared/world.ts";
import { bounds, inPolygon, type Polygon } from "./source-geometry.ts";

type Gate = { outside: Point; inside: Point; cells: number[] };

/** A slanted jamb sometimes clips just one corner of a structural grid cell.
 * Keep even sub-pixel wall slivers in the fine mask if that cell opens. */
function touchesWall(p: Point, polygon: Polygon): boolean {
  if (inPolygon(p, polygon)) return true;
  for (const ring of polygon)
    for (let i = 1; i < ring.length; i++) {
      const a = ring[i - 1],
        b = ring[i];
      if (
        Math.max(a.x, b.x) <= p.x - 0.5 ||
        Math.min(a.x, b.x) >= p.x + 0.5 ||
        Math.max(a.y, b.y) <= p.y - 0.5 ||
        Math.min(a.y, b.y) >= p.y + 0.5
      )
        continue;
      const dx = b.x - a.x,
        dy = b.y - a.y;
      if (
        Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) <
        0.5 * (Math.abs(dx) + Math.abs(dy))
      )
        return true;
    }
  return false;
}

export function doorEdgeCollision(scene: SceneMap) {
  const size = scene.collisionSize,
    w = scene.width * scene.tileSize;
  const walls = scene.surfaces
    .filter((s) => s.kind === "wall")
    .flatMap((s) =>
      s.polygons.map((polygon) => ({ polygon, box: bounds(polygon.flat()) })),
    );
  const cache = new Map<number, number[]>(),
    retained = new Set<number>();
  function pixels(cell: number) {
    const cached = cache.get(cell);
    if (cached) return cached;
    const x0 = (cell % (w / size)) * size,
      y0 = Math.floor(cell / (w / size)) * size;
    const here = walls.filter(
      ({ box: b }) =>
        b.x < x0 + size &&
        b.y < y0 + size &&
        b.x + b.width > x0 &&
        b.y + b.height > y0,
    );
    const covered: number[] = [];
    for (let y = y0; y < y0 + size; y++)
      for (let x = x0; x < x0 + size; x++)
        if (
          here.some(({ polygon }) =>
            touchesWall({ x: x + 0.5, y: y + 0.5 }, polygon),
          )
        )
          covered.push(y * w + x);
    cache.set(cell, covered);
    return covered;
  }
  return {
    /** Temporarily open just these closed gates. Exercise the avatar footprint
     * through the entire lane against furniture, coarse cells and exact jambs. */
    fits(lane: Gate, edgeCells: number[]) {
      const r = scene.player.radius,
        { outside: a, inside: b } = lane;
      const left = Math.floor(Math.min(a.x, b.x) - r),
        right = Math.floor(Math.max(a.x, b.x) + r),
        top = Math.floor(Math.min(a.y, b.y) - r),
        bottom = Math.floor(Math.max(a.y, b.y) + r);
      const wall = edgeCells.flatMap(pixels);
      if (
        wall.some(
          (i) =>
            i % w >= left &&
            i % w <= right &&
            Math.floor(i / w) >= top &&
            Math.floor(i / w) <= bottom,
        )
      )
        return false;
      if (!canStand(scene, a) || !canStand(scene, b)) return false;
      for (const cell of lane.cells) scene.collision[cell] = 0;
      let clear = true;
      const steps = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) * 2);
      for (let i = 0; i <= steps && clear; i++)
        clear = canStand(scene, {
          x: a.x + ((b.x - a.x) * i) / steps,
          y: a.y + ((b.y - a.y) * i) / steps,
        });
      for (const cell of lane.cells) scene.collision[cell] = 1;
      if (clear) for (const i of wall) retained.add(i);
      return clear;
    },
    install() {
      if (!retained.size) return;
      const fixture = scene.fixtureCollision;
      const runs = [...(fixture?.runs ?? [])];
      for (const i of [...retained].sort((a, b) => a - b)) {
        const y = Math.floor(i / w),
          x = i % w,
          n = runs.length;
        if (n >= 3 && runs[n - 3] === y && runs[n - 2] + runs[n - 1] === x)
          runs[n - 1]++;
        else runs.push(y, x, 1);
      }
      scene.fixtureCollision = { sourceIds: fixture?.sourceIds ?? [], runs };
    },
  };
}
