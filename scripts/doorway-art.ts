import {
  canStand,
  type Point,
  type SceneMap,
  type Surface,
} from "../src/shared/world.ts";
import { doorCollision, type RoomDoor } from "../src/shared/doors.ts";
import {
  bounds,
  distanceSegment,
  inPolygon,
  type Polygon,
} from "./source-geometry.ts";
import type { Primitive } from "./gltf.ts";
import type { InteriorInk } from "./interior-materials.ts";

export type GlassBay = { sourceId: number; jambA: Point; jambB: Point };
type Mesh = (
  poly: Polygon,
  top: number,
  bottom: number,
  mat: number,
  side?: number,
) => Primitive[];
type Ink = Record<InteriorInk, number>;
type Frame = { center: Point; tangent: Point; normal: Point; width: number };
function frame(a: Point, b: Point): Frame {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    width = Math.hypot(dx, dy);
  const tangent = { x: dx / width, y: dy / width };
  return {
    center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    tangent,
    normal: { x: -tangent.y, y: tangent.x },
    width,
  };
}
const along = (p: Point, f: Frame) =>
  (p.x - f.center.x) * f.tangent.x + (p.y - f.center.y) * f.tangent.y;
const at = (f: Frame, u: number, v: number): Point => ({
  x: f.center.x + u * f.tangent.x + v * f.normal.x,
  y: f.center.y + u * f.tangent.y + v * f.normal.y,
});
function rect(f: Frame, l: number, r: number, n: number, m: number): Polygon {
  return [[at(f, l, n), at(f, r, n), at(f, r, m), at(f, l, m)]];
}
/** Only a labelled glass door and an independently registered entrance can open
 * a facade. Return the original line direction; fixed panels remain on either side. */
export function measuredGlassBay(
  scene: SceneMap,
  threshold: Point,
  toward: Point,
): GlassBay | undefined {
  const ppm = scene.units.pixelsPerMeter;
  let best: { distance: number; bay: GlassBay } | undefined;
  for (const wall of scene.surfaces) {
    if (
      wall.kind !== "wall" ||
      wall.sourceMap !== "xgkdgz_tsg" ||
      wall.sourceFloor !== "0" ||
      wall.sourceLayer !== "玻璃外墙-门" ||
      !wall.line
    )
      continue;
    for (let i = 1; i < wall.line.length; i++) {
      const f = frame(wall.line[i - 1], wall.line[i]);
      if (!Number.isFinite(f.tangent.x) || f.width < ppm * 0.8) continue;
      const angle = Math.abs(toward.x * f.tangent.x + toward.y * f.tangent.y);
      if (angle > 0.72) continue;
      const u = Math.max(
        -f.width / 2,
        Math.min(f.width / 2, along(threshold, f)),
      );
      const p = at(f, u, 0),
        distance = Math.hypot(p.x - threshold.x, p.y - threshold.y);
      if (distance > ppm * 0.65 || (best && distance >= best.distance))
        continue;
      const clear = Math.min(
        f.width - ppm * 0.12,
        ppm * (f.width > ppm * 2.2 ? 1.85 : 1.0),
      );
      const center = Math.max(
        -(f.width - clear) / 2 + ppm * 0.05,
        Math.min((f.width - clear) / 2 - ppm * 0.05, u),
      );
      if (Math.abs(center - u) > ppm * 0.5) continue;
      best = {
        distance,
        bay: {
          sourceId: wall.sourceId,
          jambA: at(f, center - clear / 2, 0),
          jambB: at(f, center + clear / 2, 0),
        },
      };
    }
  }
  return best?.bay;
}
function cutHalf(ring: Point[], f: Frame, limit: number, greater: boolean) {
  const out: Point[] = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i],
      b = ring[(i + 1) % ring.length],
      da = along(a, f) - limit,
      db = along(b, f) - limit;
    const ain = greater ? da >= 0 : da <= 0,
      bin = greater ? db >= 0 : db <= 0;
    if (ain) out.push(a);
    if (ain !== bin) {
      const t = da / (da - db);
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  return out;
}
/** Clip the exact buffered source polygons, not the facade as a whole. Original
 * source coordinates remain in world/Tiled for inspection. A generated wall
 * end-cap is created at each jamb by the normal extrusion pass. */
export function fixedGlazing(wall: Surface, bays: GlassBay[]): Polygon[] {
  const apertures = bays.filter((b) => b.sourceId === wall.sourceId);
  if (!apertures.length) return wall.polygons;
  let parts = wall.polygons;
  for (const bay of apertures) {
    const f = frame(bay.jambA, bay.jambB);
    parts = parts.flatMap((poly) => {
      // A source door layer is a buffered line with one ring per segment.
      // Never remove a disconnected segment aligned behind the active one.
      const center = bounds(poly[0]);
      const maxDepth = Math.max(2, wall.strokeWidth ?? 0) + 0.5;
      if (
        Math.abs(
          (center.x + center.width / 2 - f.center.x) * f.normal.x +
            (center.y + center.height / 2 - f.center.y) * f.normal.y,
        ) > maxDepth
      )
        return [poly];
      return [false, true].flatMap((after) => {
        const rings = poly.map((r) =>
          cutHalf(r, f, after ? f.width / 2 : -f.width / 2, after),
        );
        if (rings[0].length < 3) return [];
        return [rings.filter((r) => r.length >= 3)];
      });
    });
  }
  return parts;
}
function jambs(f: Frame, ppm: number, ink: Ink, mesh: Mesh, metal: boolean) {
  const parts: Primitive[] = [];
  const jamb = 0.12 * ppm,
    depth = 0.13 * ppm,
    top = 1.91 * ppm,
    body = metal ? ink.enamel : ink.oak;
  for (const side of [-1, 1]) {
    const edge = (side * f.width) / 2;
    // All vertical solids lie outside the negotiated clear interval.
    const shape = (lo: number, hi: number, thick: number) =>
      rect(f, edge + side * lo, edge + side * hi, -thick, thick);
    parts.push(
      ...mesh(
        shape(0, jamb, depth),
        top,
        0,
        metal ? ink.glass : ink.wallCap,
        body,
      ),
    );
    parts.push(
      ...mesh(
        shape(jamb * 0.58, jamb * 1.35, depth * 1.3),
        top + 0.025 * ppm,
        0,
        metal ? ink.riser : ink.moulding,
        metal ? ink.riser : ink.moulding,
      ),
    );
    parts.push(
      ...mesh(
        shape(jamb * 0.25, jamb * 1.4, depth * 1.36),
        0.19 * ppm,
        0,
        ink.riser,
      ),
    );
  }
  return parts;
}
export function roomOpeningArt(
  door: RoomDoor,
  ppm: number,
  ink: Ink,
  mesh: Mesh,
) {
  if (!door.hinge || !door.latch) return { floor: [], walls: [] };
  const f = frame(door.hinge, door.latch);
  if (!Number.isFinite(f.tangent.x)) return { floor: [], walls: [] };
  const depth = 0.24 * ppm,
    half = f.width / 2;
  const floor = mesh(
    rect(f, -half, half, -depth, depth),
    0.115,
    0.115,
    ink.galleryStone,
  );
  for (const side of [-1, 1])
    floor.push(
      ...mesh(
        rect(f, -half, half, depth * side, depth * side + 0.045 * ppm),
        0.12,
        0.12,
        ink.riser,
      ),
    );
  // The lintel is above this cutaway height. Baking a solid strip across the
  // top would conceal the open leaf and the walking avatar in the doorway.
  return { floor, walls: jambs(f, ppm, ink, mesh, false) };
}
export function entranceOpeningArt(
  entrance: { threshold: Point; toward: Point; glazing?: GlassBay },
  ppm: number,
  ink: Ink,
  mesh: Mesh,
) {
  const bay = entrance.glazing;
  const f = bay
    ? frame(bay.jambA, bay.jambB)
    : {
        center: entrance.threshold,
        tangent: { x: -entrance.toward.y, y: entrance.toward.x },
        normal: entrance.toward,
        width: 1.16 * ppm,
      };
  const half = f.width / 2;
  // For unmeasured entries this is just an inset threshold strip. Its width
  // is a drawing convention, not the width of an inferred exterior wall.
  const floor = mesh(
    rect(f, -half, half, -0.16 * ppm, 0.16 * ppm),
    0.115,
    0.115,
    ink.riser,
  );
  for (const v of [-0.11, 0, 0.11])
    floor.push(
      ...mesh(
        rect(f, -half, half, v * ppm, (v + 0.032) * ppm),
        0.12,
        0.12,
        ink.wallCap,
      ),
    );
  return { floor, walls: bay ? jambs(f, ppm, ink, mesh, true) : [] };
}

/** Only a named entry plus the surveyed perimeter supports a reconstructed
 * return. Build each side outwards from its jamb, stopping at physical walls,
 * open floor, another opening or a source corner. The four-pixel collision
 * grid can put the reserved perimeter on the room side of its surveyed edge:
 * use a shallow reveal to meet that strip, never a row of disconnected pieces. */
export function inferredDoorReturns(scene: SceneMap) {
  const doors = scene.doors ?? [],
    ppm = scene.units.pixelsPerMeter,
    half = 0.065 * ppm;
  const open = doorCollision(scene, new Set(doors.map((d) => d.id)));
  const walls = scene.surfaces
    .filter((s) => s.kind === "wall")
    .flatMap((s) => s.polygons.map((p) => ({ p, box: bounds(p[0]) })));
  const result: Polygon[] = [];
  for (const door of doors) {
    if (door.openingSource !== "room-edge" || !door.hinge || !door.latch)
      continue;
    const f = frame(door.hinge, door.latch);
    const room = scene.surfaces.find(
      (s) => s.kind === "room" && s.sourceId === door.sourceId,
    );
    const edge = room?.polygons
      .flatMap((poly) =>
        poly.flatMap((r) => r.slice(1).map((p, i) => [r[i], p])),
      )
      .find(
        ([a, b]) =>
          distanceSegment(door.hinge!, a, b) < 0.12 &&
          distanceSegment(door.latch!, a, b) < 0.12,
      );
    if (!edge) continue;
    const inward = Math.sign(
      (door.inside.x - f.center.x) * f.normal.x +
        (door.inside.y - f.center.y) * f.normal.y,
    );
    const min = Math.min(...edge.map((p) => along(p, f))),
      max = Math.max(...edge.map((p) => along(p, f)));
    const near = doors.filter(
      (d) => Math.hypot(d.x - door.x, d.y - door.y) < ppm * 5,
    );
    for (const side of [-1, 1]) {
      const start = side * (f.width / 2 + 0.09 * ppm),
        available = side > 0 ? max - start : start - min,
        maxRun = Math.min(available, 3.8 * ppm);
      const clear = (u: number, v: number) => {
        const p = at(f, u, v);
        if (
          near.some(
            (d) =>
              [d, ...(d.lanes ?? [])].some(
                (lane) =>
                  distanceSegment(p, lane.outside, lane.inside) <
                  scene.player.radius + half + 0.1,
              ) ||
              (d !== door &&
                d.hinge &&
                d.latch &&
                distanceSegment(p, d.hinge, d.latch) < half + 0.2),
          )
        )
          return false;
        if (
          walls.some(
            ({ p: poly, box: b }) =>
              p.x >= b.x &&
              p.x <= b.x + b.width &&
              p.y >= b.y &&
              p.y <= b.y + b.height &&
              inPolygon(p, poly),
          )
        )
          return false;
        return [-half, 0, half].every(
          (delta) => !canStand(open, at(f, u, v + delta)),
        );
      };
      let best = { run: 0, depth: 0 };
      for (const offset of [0, 0.5, 1, 1.5, 2, 2.5, 3]) {
        const depth = offset * inward;
        let run = 0;
        while (
          run + 0.4 <= maxRun &&
          clear(start + side * run, depth) &&
          clear(start + side * (run + 0.4), depth)
        )
          run += 0.4;
        if (run - offset * 0.7 > best.run - Math.abs(best.depth) * 0.7)
          best = { run, depth };
      }
      if (best.run < ppm * 0.4) continue;
      result.push(
        rect(
          f,
          start,
          start + side * best.run,
          best.depth - half,
          best.depth + half,
        ),
      );
      if (best.depth && clear(start, best.depth / 2))
        result.push(
          rect(f, start - side * half, start + side * half, 0, best.depth),
        );
    }
  }
  return result;
}
