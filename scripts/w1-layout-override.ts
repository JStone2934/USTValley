import clipping, { type MultiPolygon } from "polygon-clipping";
import type { Point, SceneMap } from "../src/shared/world.ts";
import { canStand } from "../src/shared/world.ts";
import {
  diagramLayout,
  diagramReserved,
  w1Point,
  w1Local,
  insideLayoutPolygon,
  layoutPropFootprint,
  supportHeightMeters,
  type LayoutPolygon,
  type LayoutProp,
} from "../src/shared/w1-layout.ts";
import { bufferLine, bounds, inPolygon } from "./source-geometry.ts";
const geom = (polys: LayoutPolygon[]): MultiPolygon =>
  polys.map((p) => p.map((r) => r.map((v) => [v.x, v.y])));
const points = (g: MultiPolygon): LayoutPolygon[] =>
  g.map((p) =>
    p.map((r) =>
      r.map(([x, y]) => ({
        x: Math.round(x * 1e5) / 1e5,
        y: Math.round(y * 1e5) / 1e5,
      })),
    ),
  );
const box = (x: number, y: number, w: number, h: number): LayoutPolygon => [
  [
    { x, y },
    { x: x + w, y },
    { x: x + w, y: y + h },
    { x, y: y + h },
  ],
];
export function applyW1Layout(scene: SceneMap) {
  const layout = diagramLayout(scene);
  if (!layout) return;
  const floors = scene.surfaces
    .filter((s) => s.kind === "floor")
    .flatMap((s) => s.polygons);
  const slab = clipping.union(geom(floors));
  const region: LayoutPolygon = [
    [
      [-198, 1142],
      [430, 1142],
      [430, 1304],
      [-198, 1304],
    ].map(([x, y]) => w1Point(scene, x, y)),
  ];
  const protect: LayoutPolygon[] = [...diagramReserved(scene)];
  // Preserve the surveyed slab edge (including voids), so opening a laboratory
  // never creates a walking route through the exterior of an upper floor.
  for (const poly of floors)
    for (const ring of poly)
      for (let i = 1; i < ring.length; i++) {
        if (
          Math.max(w1Local(scene, ring[i - 1]).y, w1Local(scene, ring[i]).y) <
          1128
        )
          continue;
        protect.push(...bufferLine([ring[i - 1], ring[i]], 3));
      }
  for (const s of scene.surfaces.filter((s) =>
    ["stairs", "lift", "water", "garden"].includes(s.kind),
  ))
    for (const poly of s.polygons) {
      const b = bounds(poly.flat());
      protect.push(box(b.x - 1, b.y - 1, b.width + 2, b.height + 2));
    }
  for (const wall of scene.surfaces.filter((s) => s.kind === "wall"))
    for (const poly of wall.polygons) {
      const b = bounds(poly.flat());
      if (
        b.width < scene.units.pixelsPerMeter * 0.9 &&
        b.height < scene.units.pixelsPerMeter * 0.9 &&
        b.width * b.height > 1.5
      )
        protect.push(
          box(b.x - 0.35, b.y - 0.35, b.width + 0.7, b.height + 0.7),
        );
    }
  for (const p of scene.portals)
    protect.push(box(p.x - 2.6, p.y - 2.6, 5.2, 5.2));
  const open = clipping.difference(
    clipping.intersection(slab, geom([region])),
    geom(protect),
  );
  layout.openArea = points(open);
  const inside = (p: Point) =>
    layout.openArea.some((poly) => insideLayoutPolygon(p, poly));
  const overlaps = (poly: LayoutPolygon) =>
    clipping.intersection(geom([poly]), open).length > 0;
  // A source room may extend into an explicitly preserved white area. Keep
  // that area's walls and gates, while recording that the room as a whole is
  // now open and can legitimately be reached around the retained gate.
  layout.openedRoomSourceIds = scene.surfaces
    .filter((s) => s.kind === "room" && s.polygons.some(overlaps))
    .map((s) => s.sourceId);
  scene.surfaces = scene.surfaces.flatMap((s) => {
    if (
      !["wall", "room", "detail"].includes(s.kind) ||
      !s.polygons.some(overlaps)
    )
      return [s];
    // Actual 3-D model instances cannot be partially clipped by changing only
    // their footprint; remove superseded instances in the authorized open zone.
    if (s.kind === "detail") return [];
    const polygons = points(clipping.difference(geom(s.polygons), open));
    if (!polygons.length) return [];
    const { line, strokeWidth, ...rest } = s;
    return [{ ...rest, polygons }];
  });
  const step = scene.collisionSize,
    stride = (scene.width * scene.tileSize) / step;
  // A removed partition may cross the edge of the protected mask. Its old
  // approach markers can lie outside the mask even when the leaf is gone.
  // Remove the gate whenever its threshold is opened; never leave a closed
  // door whose collision cells were cleared underneath it.
  layout.openedDoorways = (scene.doors ?? [])
    .filter(
      (d) =>
        inside(d) ||
        d.cells.some((i) =>
          inside({
            x: ((i % stride) + 0.5) * step,
            y: (Math.floor(i / stride) + 0.5) * step,
          }),
        ),
    )
    .map((d) => ({ id: d.id, inside: d.inside, outside: d.outside }));
  layout.removedDoorIds = layout.openedDoorways.map((d) => d.id);
  scene.doors = scene.doors?.filter(
    (d) => !layout.removedDoorIds.includes(d.id),
  );
  scene.roomCasework = scene.roomCasework?.filter(
    (p) => !p.footprint.some(inside),
  );
  scene.pointFixtures = scene.pointFixtures?.filter((p) => !inside(p));
  for (let i = 0; i < scene.collision.length; i++)
    if (
      inside({
        x: ((i % stride) + 0.5) * step,
        y: (Math.floor(i / stride) + 0.5) * step,
      })
    )
      scene.collision[i] = 0;
  const runs: number[] = [];
  const old = scene.fixtureCollision?.runs ?? [];
  for (let i = 0; i < old.length; i += 3) {
    const y = old[i],
      x0 = old[i + 1],
      end = x0 + old[i + 2];
    let start = -1;
    for (let x = x0; x <= end; x++) {
      const keep = x < end && !inside({ x: x + 0.5, y: y + 0.5 });
      if (keep && start < 0) start = x;
      if (!keep && start >= 0) {
        runs.push(y, start, x - start);
        start = -1;
      }
    }
  }
  scene.fixtureCollision = {
    sourceIds: scene.fixtureCollision?.sourceIds ?? [],
    runs,
  };
  layout.platforms = layout.platforms
    .map((p) => ({
      ...p,
      polygons: points(clipping.intersection(geom(p.polygons), open)),
    }))
    .filter((p) => p.polygons.length);
  layout.zones = layout.zones.flatMap((z) =>
    points(clipping.intersection(geom([z.polygon]), open)).map((polygon) => ({
      ...z,
      polygon,
    })),
  );
  scene.w1Layout = layout;
  // Nudge approximate furniture positions only within a small neighbourhood;
  // every footprint must sit entirely on one support level and outside exits.
  const placed: LayoutProp[] = [];
  for (const p of layout.props) {
    let found: LayoutProp | undefined;
    for (const r of [0, 2, 4, 6, 8, 10]) {
      for (let a = 0; a < (r ? 12 : 1); a++) {
        const at = {
            ...p,
            x: p.x + r * Math.cos((a * Math.PI) / 6),
            y: p.y + r * Math.sin((a * Math.PI) / 6),
          },
          foot = layoutPropFootprint(scene, at),
          h = supportHeightMeters(scene, at);
        if (
          !foot.every(
            (q) =>
              inside(q) &&
              canStand(scene, q, 0.25) &&
              Math.abs(supportHeightMeters(scene, q) - h) < 0.01,
          )
        )
          continue;
        if (
          scene.portals.some(
            (q) =>
              Math.hypot(q.x - at.x, q.y - at.y) <
              scene.units.pixelsPerMeter * 1.5,
          )
        )
          continue;
        if (
          placed.some(
            (q) =>
              foot.some((v) => inPolygon(v, [layoutPropFootprint(scene, q)])) ||
              layoutPropFootprint(scene, q).some((v) => inPolygon(v, [foot])),
          )
        )
          continue;
        found = at;
        break;
      }
      if (found) break;
    }
    if (found) placed.push(found);
  }
  layout.props = placed;
  for (const p of placed) {
    const poly = [layoutPropFootprint(scene, p)],
      b = bounds(poly[0]);
    for (let y = Math.floor(b.y); y <= Math.ceil(b.y + b.height); y++) {
      let start = -1;
      for (let x = Math.floor(b.x); x <= Math.ceil(b.x + b.width) + 1; x++) {
        const hit = inPolygon({ x: x + 0.5, y: y + 0.5 }, poly);
        if (hit && start < 0) start = x;
        if (!hit && start >= 0) {
          runs.push(y, start, x - start);
          start = -1;
        }
      }
    }
  }
  scene.fixtureCollision = { ...scene.fixtureCollision, runs };
}
