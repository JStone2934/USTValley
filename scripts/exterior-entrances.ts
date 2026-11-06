import { measuredGlassBay } from "./doorway-art.ts";
import {
  canStand,
  tileIndex,
  type Point,
  type SceneMap,
} from "../src/shared/world.ts";
import {
  inPolygon,
  bounds,
  distanceSegment,
  type Feature,
  type Polygon,
  type SourceMap,
} from "./source-geometry.ts";

export type ExteriorGate = {
  regionIndex: number;
  modelIndices: number[];
  xy: number[];
  wing: number;
  towardInterior: Point;
  match: number;
};
const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
const along = (p: Point, n: Point, t: number, side = 0) => ({
  x: p.x + n.x * t - n.y * side,
  y: p.y + n.y * t + n.x * side,
});

/** Match only openings attested by BOTH the campus model and the F1 navigation sheet.
 * F1 also contains service/internal links and named room POIs carry private room entries. */
export function exteriorGates(
  source: SourceMap,
  model: Feature,
  floors: Polygon[][],
  convert: (xy: number[]) => Point,
) {
  const region = source.map.mapinfo.regions.find((r) => r.region === 0)!;
  const gates: ExteriorGate[] = [];
  for (const [modelIndex, xy] of (
    model.properties.entry as number[][]
  ).entries()) {
    const candidate = region
      .entries!.map((r, regionIndex) => ({
        regionIndex,
        entry: r.in,
        match: Math.hypot(r.in.x - xy[0], r.in.y - xy[1]),
      }))
      .sort((a, b) => a.match - b.match)[0];
    if (!candidate || candidate.match > 8)
      throw new Error(
        `Unmatched campus door ${model.properties.id}:${modelIndex}`,
      );
    const duplicate = gates.find(
      (g) => g.regionIndex === candidate.regionIndex,
    );
    if (duplicate) {
      duplicate.modelIndices.push(modelIndex);
      continue;
    }
    const point = [candidate.entry.x, candidate.entry.y],
      at = convert(point);
    let best: { distance: number; wing: number; normal: Point } | undefined;
    floors.forEach((polys, wing) => {
      for (const poly of polys)
        for (const ring of poly)
          for (let i = 1; i < ring.length; i++) {
            const a = ring[i - 1],
              b = ring[i],
              dx = b.x - a.x,
              dy = b.y - a.y,
              len = Math.hypot(dx, dy);
            if (len < 0.01) continue;
            const t = Math.max(
              0.001,
              Math.min(
                0.999,
                ((at.x - a.x) * dx + (at.y - a.y) * dy) / (len * len),
              ),
            );
            const closest = { x: a.x + t * dx, y: a.y + t * dy },
              distance = dist(closest, at);
            if (best && best.distance <= distance) continue;
            const normal = { x: -dy / len, y: dx / len };
            const plus = polys.some((p) =>
                inPolygon(along(closest, normal, 0.1), p),
              ),
              minus = polys.some((p) =>
                inPolygon(along(closest, normal, -0.1), p),
              );
            if (plus === minus) continue;
            best = {
              wing,
              distance,
              normal: plus ? normal : { x: -normal.x, y: -normal.y },
            };
          }
    });
    if (!best || best.distance > 7)
      throw new Error(
        `Missing F1 facade at ${model.properties.id}:${modelIndex}`,
      );
    gates.push({
      regionIndex: candidate.regionIndex,
      modelIndices: [modelIndex],
      xy: point,
      wing: best.wing,
      towardInterior: best.normal,
      match: candidate.match,
    });
  }
  return gates;
}

// A library glass-door line is deliberately drawn across the opening in the source.
// Remove only its own collision cells at a corroborated entrance, retaining adjoining panes.
export function openSourceGlass(
  scene: SceneMap,
  sourceMap: string,
  threshold: Point,
  normal: Point,
) {
  const ppm = scene.units.pixelsPerMeter;
  const bay = measuredGlassBay(scene, threshold, normal);
  if (!bay) return;
  const wall = scene.surfaces.find(
    (s) =>
      s.sourceMap === sourceMap &&
      s.sourceId === bay.sourceId &&
      s.sourceLayer === "玻璃外墙-门",
  )!;
  const center = {
      x: (bay.jambA.x + bay.jambB.x) / 2,
      y: (bay.jambA.y + bay.jambB.y) / 2,
    },
    widthAlong = dist(bay.jambA, bay.jambB);
  const axis = {
    x: (bay.jambB.x - bay.jambA.x) / widthAlong,
    y: (bay.jambB.y - bay.jambA.y) / widthAlong,
  };
  const width = (scene.width * scene.tileSize) / scene.collisionSize,
    grid = scene.collisionSize;
  const adjacent = scene.surfaces.filter(
    (s) =>
      s !== wall &&
      s.sourceMap === sourceMap &&
      ["wall", "water"].includes(s.kind),
  );
  for (
    let y = Math.floor((threshold.y - ppm * 2) / grid);
    y <= Math.ceil((threshold.y + ppm * 2) / grid);
    y++
  )
    for (
      let x = Math.floor((threshold.x - ppm * 2) / grid);
      x <= Math.ceil((threshold.x + ppm * 2) / grid);
      x++
    ) {
      const p = { x: (x + 0.5) * grid, y: (y + 0.5) * grid };
      const across = (p.x - center.x) * axis.x + (p.y - center.y) * axis.y;
      if (
        Math.abs(across) > widthAlong / 2 ||
        !wall.polygons.some((poly) => inPolygon(p, poly))
      )
        continue;
      if (!adjacent.some((s) => s.polygons.some((poly) => inPolygon(p, poly))))
        scene.collision[y * width + x] = 0;
    }
  return bay;
}

/** Use the measured fixed jambs for glazed doors, and the surveyed approach
 * normal and a single-door clearance for an unmeasured campus entrance. */
export function exteriorOpening(
  scene: SceneMap,
  threshold: Point,
  toward: Point,
  glazing?: ReturnType<typeof measuredGlassBay>,
) {
  if (glazing) {
    const { jambA: a, jambB: b } = glazing,
      l = dist(a, b);
    threshold = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const n = { x: (b.y - a.y) / l, y: (a.x - b.x) / l };
    toward = n.x * toward.x + n.y * toward.y > 0 ? n : { x: -n.x, y: -n.y };
  }
  return {
    threshold,
    toward,
    width: glazing
      ? dist(glazing.jambA, glazing.jambB)
      : 1.35 * scene.units.pixelsPerMeter,
  };
}

/** Pick a foot-sized line on the approaching side and prove the whole return walk with
 * avatar collision. Both ends retain the very same surveyed sill in their own transforms. */
export function gateLanding(
  scene: SceneMap,
  space: Set<number>,
  threshold: Point,
  toward: Point,
  glazing?: ReturnType<typeof measuredGlassBay>,
) {
  const entrance = exteriorOpening(scene, threshold, toward, glazing);
  ({ threshold, toward } = entrance);
  const ppm = scene.units.pixelsPerMeter,
    grid = scene.collisionSize;
  const positions: { x: number; y: number; cost: number }[] = [];
  for (
    let y = Math.floor((threshold.y - ppm * 3) / grid);
    y <= Math.ceil((threshold.y + ppm * 3) / grid);
    y++
  )
    for (
      let x = Math.floor((threshold.x - ppm * 3) / grid);
      x <= Math.ceil((threshold.x + ppm * 3) / grid);
      x++
    ) {
      const p = { x: (x + 0.5) * grid, y: (y + 0.5) * grid };
      const u = p.x - threshold.x,
        v = p.y - threshold.y,
        depth = -(u * toward.x + v * toward.y),
        side = Math.abs(u * toward.y - v * toward.x);
      if (
        depth < 0 ||
        depth > 2.7 * ppm ||
        side > 1.15 * ppm ||
        !space.has(tileIndex(scene, p))
      )
        continue;
      positions.push({ ...p, cost: Math.abs(depth - 0.45 * ppm) + side * 1.8 });
    }
  for (const { x, y } of positions.sort((a, b) => a.cost - b.cost)) {
    const point = { x, y };
    // A shallow vestibule may have a wall just behind this routing cell.
    // Keep the return spawn clear of the physical sill on either side.
    for (const retreat of [2.3, 1.85, 1.5, 1.1, 0.8, 0.55]) {
      const spawn = along(point, toward, -retreat * ppm);
      const setback = (threshold.x - spawn.x) * toward.x + (threshold.y - spawn.y) * toward.y;
      if (setback < 1.1 * ppm || !space.has(tileIndex(scene, spawn))) continue;
      let clear = true;
      for (let t = -retreat * ppm; t <= scene.player.radius + 0.51; t += 0.5) {
        if (!canStand(scene, along(point, toward, t))) {
          clear = false;
          break;
        }
      }
      if (clear)
        return {
          point,
          spawn,
          entrance,
        };
    }
  }
}

/** Some registered exterior doors open directly into an office rather than a
 * public corridor. Require a source walking edge from that sill into that room
 * before opening its floor. Retain its perimeter, other rooms and physical walls. */
export function openSourceOffice(
  scene: SceneMap,
  threshold: Point,
  toward: Point,
  space: Set<number>,
) {
  const ppm = scene.units.pixelsPerMeter,
    grid = scene.collisionSize;
  const links = scene.surfaces.filter(
    (s) =>
      s.kind === "corridor" &&
      s.line?.length === 2 &&
      s.line.some((p) => dist(p, threshold) < 0.35 * ppm),
  );
  for (const road of links) {
    const inside = road.line!.toSorted(
      (a, b) => dist(b, threshold) - dist(a, threshold),
    )[0];
    if (dist(inside, threshold) > 2 * ppm) continue;
    const room = scene.surfaces.find(
      (s) =>
        s.kind === "room" &&
        /办公室/.test(s.sourceLayer) &&
        s.polygons.some((poly) => inPolygon(inside, poly)),
    );
    if (!room) continue;
    const obstacles = scene.surfaces.filter(
      (s) => s !== room && ["wall", "water", "lift", "room"].includes(s.kind),
    );
    const floors = scene.surfaces.filter((s) => s.kind === "floor");
    const opened: number[] = [];
    for (const poly of room.polygons) {
      const box = bounds(poly.flat());
      for (
        let y = Math.floor(box.y / grid);
        y <= Math.ceil((box.y + box.height) / grid);
        y++
      )
        for (
          let x = Math.floor(box.x / grid);
          x <= Math.ceil((box.x + box.width) / grid);
          x++
        ) {
          const p = { x: (x + 0.5) * grid, y: (y + 0.5) * grid },
            index = tileIndex(scene, p);
          if (
            !scene.collision[index] ||
            !inPolygon(p, poly) ||
            !floors.some((s) => s.polygons.some((f) => inPolygon(p, f)))
          )
            continue;
          const doorLane =
            Math.abs(
              (p.x - threshold.x) * toward.y - (p.y - threshold.y) * toward.x,
            ) <
              0.8 * ppm && dist(p, threshold) < 1.3 * ppm;
          if (
            !doorLane &&
            poly.some((r) =>
              r
                .slice(1)
                .some((b, i) => distanceSegment(p, r[i], b) < grid * 0.6),
            )
          )
            continue;
          if (obstacles.some((s) => s.polygons.some((f) => inPolygon(p, f))))
            continue;
          scene.collision[index] = 0;
          opened.push(index);
        }
    }
    for (const index of opened) {
      const w = (scene.width * scene.tileSize) / grid;
      const p = {
        x: ((index % w) + 0.5) * grid,
        y: (Math.floor(index / w) + 0.5) * grid,
      };
      if (canStand(scene, p)) space.add(index);
    }
    return { roomId: room.sourceId, walkRoadId: road.sourceId };
  }
}

/** W2 and W3 have a small exterior recess on F1. Two surveyed walking edges
 * meet outside the floor polygon and lead back through its two openings. */
export function fitDoorApron(
  scene: SceneMap,
  threshold: Point,
  space: Set<number>,
) {
  const ppm = scene.units.pixelsPerMeter,
    grid = scene.collisionSize;
  const floors = scene.surfaces
    .filter((s) => /^(1_floor|floor)/i.test(s.sourceLayer))
    .flatMap((s) => s.polygons);
  if (floors.some((p) => inPolygon(threshold, p))) return;
  const edges = floors.flatMap((p) =>
    p.flatMap((r) =>
      r.slice(1).map((b, i) => distanceSegment(threshold, r[i], b)),
    ),
  );
  if (Math.min(...edges) < ppm * 0.55) return;
  const roads = scene.surfaces.filter(
    (s) =>
      s.kind === "corridor" &&
      s.line?.length === 2 &&
      s.line.some((p) => dist(threshold, p) < 0.35 * ppm) &&
      s.line.some((p) => floors.some((f) => inPolygon(p, f))),
  );
  if (roads.length < 2) return;
  // These surveyed walking edges extend across the recessed forecourt beyond
  // the main F1 slab. Give them the same round-ended paving used by collision.
  const halfWidth = ppm * 0.65;
  for (const road of roads) {
    const [a, b] = road.line!;
    const bearing = Math.atan2(b.y - a.y, b.x - a.x);
    const cap = (p: Point, start: number) =>
      Array.from({ length: 9 }, (_, i) => {
        const angle = bearing + start + (i * Math.PI) / 8;
        return { x: p.x + halfWidth * Math.cos(angle), y: p.y + halfWidth * Math.sin(angle) };
      });
    road.polygons = [[[...cap(b, -Math.PI / 2), ...cap(a, Math.PI / 2)]]];
    road.strokeWidth = 2 * halfWidth;
  }
  const barriers = scene.surfaces.filter((s) =>
    ["room", "wall", "water", "lift"].includes(s.kind),
  );
  for (
    let y = Math.floor((threshold.y - ppm * 2) / grid);
    y <= Math.ceil((threshold.y + ppm * 2) / grid);
    y++
  )
    for (
      let x = Math.floor((threshold.x - ppm * 2) / grid);
      x <= Math.ceil((threshold.x + ppm * 2) / grid);
      x++
    ) {
      const p = { x: (x + 0.5) * grid, y: (y + 0.5) * grid };
      if (
        floors.some((poly) => inPolygon(p, poly)) ||
        barriers.some((s) => s.polygons.some((poly) => inPolygon(p, poly)))
      )
        continue;
      if (
        !roads.some(
          (s) => distanceSegment(p, s.line![0], s.line![1]) <= halfWidth,
        )
      )
        continue;
      const i = tileIndex(scene, p);
      scene.collision[i] = 0;
      if (canStand(scene, p)) space.add(i);
    }
  return roads.map((s) => s.sourceId);
}
