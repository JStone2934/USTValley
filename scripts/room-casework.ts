import config from "../content/map-config.json";
import {
  project,
  tileIndex,
  type Point,
  type SceneMap,
} from "../src/shared/world.ts";
import type { RoomCasework } from "../src/shared/casework.ts";
import {
  bounds,
  distanceSegment,
  inPolygon,
  layers,
  type SourceMap,
} from "./source-geometry.ts";
import { roomFinish } from "./interior-materials.ts";
import { findPanelMount, wallFootprint } from "./room-fittings.ts";

const finishKinds = {
  teaching: "lectern",
  laboratory: "lab-bench",
  office: "office-cabinet",
} as const;
function nearbyCells(scene: SceneMap, footprint: Point[]) {
  const b = bounds(footprint),
    size = scene.collisionSize,
    stride = (scene.width * scene.tileSize) / size;
  const result: number[] = [];
  for (
    let y = Math.floor(b.y / size) - 1;
    y <= Math.ceil((b.y + b.height) / size);
    y++
  )
    for (
      let x = Math.floor(b.x / size) - 1;
      x <= Math.ceil((b.x + b.width) / size);
      x++
    ) {
      if (
        x < 0 ||
        x >= stride ||
        y < 0 ||
        y >= (scene.height * scene.tileSize) / size
      )
        continue;
      const p = { x: (x + 0.5) * size, y: (y + 0.5) * size };
      if (
        inPolygon(p, [footprint]) ||
        footprint.some(
          (a, i) => distanceSegment(p, a, footprint[(i + 1) % 4]) <= size / 2,
        )
      )
        result.push(y * stride + x);
    }
  return result;
}
/** Every previously walkable neighbour must retain a local route around the new
 * cabinet, with all room doors closed. Opening any door can only add paths. */
export function preservesAisle(scene: SceneMap, cells: number[]) {
  const w = (scene.width * scene.tileSize) / scene.collisionSize,
    cut = new Set(cells);
  const neighbours = (c: number) => [c - 1, c + 1, c - w, c + w];
  const rim = new Set(
    cells
      .filter((c) => !scene.collision[c])
      .flatMap(neighbours)
      .filter((c) => !cut.has(c) && scene.collision[c] === 0),
  );
  const start = rim.values().next().value;
  if (start === undefined) return cells.every((c) => scene.collision[c] !== 0);
  const nearby = new Set<number>();
  for (const c of cells)
    for (let dy = -3; dy <= 3; dy++)
      for (let dx = -3; dx <= 3; dx++) nearby.add(c + dy * w + dx);
  const queue = [start],
    seen = new Set(queue);
  for (let head = 0; head < queue.length; head++)
    for (const n of neighbours(queue[head]))
      if (
        nearby.has(n) &&
        !cut.has(n) &&
        scene.collision[n] === 0 &&
        !seen.has(n)
      ) {
        seen.add(n);
        queue.push(n);
      }
  return [...rim].every((c) => seen.has(c));
}

export function fitRoomCasework(scene: SceneMap, source: SourceMap) {
  const scale = scene.units.pixelsPerProjectedUnit,
    step = scene.collisionSize;
  const width = scene.width * scene.tileSize,
    height = scene.height * scene.tileSize;
  const walls = scene.surfaces
    .filter((s) => s.kind === "wall" && !/玻璃/.test(s.sourceLayer))
    .flatMap((s) => s.polygons.map(wallFootprint));
  const protectedShapes = scene.surfaces
    .filter((s) => ["stairs", "lift", "corridor", "detail"].includes(s.kind))
    .flatMap((s) => s.polygons.map(wallFootprint));
  const protectedPoints = [
    ...scene.portals,
    ...scene.spawns,
    ...scene.chests,
    ...scene.portals.map((p) => p.spawn),
  ];
  const reserved = new Set(protectedPoints.map((p) => tileIndex(scene, p)));
  for (const d of scene.doors ?? []) {
    const dx = Math.sign(d.inside.x - d.outside.x),
      dy = Math.sign(d.inside.y - d.outside.y);
    for (const cell of d.cells) reserved.add(cell);
    for (const lane of [d, ...(d.lanes ?? [])]) {
      for (const p of [
        lane.outside,
        lane.inside,
        {
          x: lane.inside.x + dx * step,
          y: lane.inside.y + dy * step,
        },
      ])
        reserved.add(tileIndex(scene, p));
    }
  }
  const featureInfo = new Map(
    layers(source, scene.floor.key).flatMap((l) =>
      (l.data?.features ?? []).map((f) => [f.properties.id, f] as const),
    ),
  );
  const convert = (v: number[]) => {
    const p = project(v, {
      ...config.transform,
      pixelsPerProjectedUnit: scale,
    });
    return { x: p.x + scene.sourceOffset.x, y: p.y + scene.sourceOffset.y };
  };
  const floorPlates = scene.surfaces
    .filter((s) => s.kind === "floor")
    .flatMap((s) => s.polygons);
  scene.pointFixtures = [];
  for (const f of featureInfo.values()) {
    const name = f.properties.name;
    if (f.geometry.type !== "Point" || (name !== "咖啡机" && name !== "急救箱"))
      continue;
    const p = convert(f.geometry.coordinates);
    if (
      p.x < 0 ||
      p.y < 0 ||
      p.x >= width ||
      p.y >= height ||
      !floorPlates.some((poly) => inPolygon(p, poly))
    )
      continue;
    const coffee = name === "咖啡机",
      rx = scale * (coffee ? 0.58 : 0.51),
      ry = scale * (coffee ? 0.34 : 0.18);
    const footprint = [
      { x: p.x - rx, y: p.y - ry },
      { x: p.x + rx, y: p.y - ry },
      { x: p.x + rx, y: p.y + ry },
      { x: p.x - rx, y: p.y + ry },
    ];
    const cells = nearbyCells(scene, footprint);
    // A source point fixes the location but provides no orientation or model.
    // Omit the inferred cabinet when physical placement would obstruct a door.
    if (
      !cells.length ||
      cells.some((c) => reserved.has(c)) ||
      !preservesAisle(scene, cells)
    )
      continue;
    scene.pointFixtures.push({
      ...p,
      sourceId: f.properties.id,
      kind: coffee ? "coffee" : "first-aid",
      cells,
    });
    for (const c of cells) {
      scene.collision[c] = 1;
      reserved.add(c);
    }
  }
  scene.roomCasework = [];
  for (const surface of scene.surfaces) {
    if (surface.kind !== "room") continue;
    const f = featureInfo.get(surface.sourceId);
    if (!f) continue;
    const finish = roomFinish(surface.sourceLayer, f.properties);
    if (finish !== "teaching" && finish !== "laboratory" && finish !== "office")
      continue;
    const entries = (f.properties.entry ?? [])
      .filter(Array.isArray)
      .map(convert);
    for (const polygon of surface.polygons) {
      const roomBox = bounds(polygon[0]);
      if (
        roomBox.x < 0 ||
        roomBox.y < 0 ||
        roomBox.x + roomBox.width > width ||
        roomBox.y + roomBox.height > height ||
        roomBox.width * roomBox.height < scale * scale * 12
      )
        continue;
      const panel = findPanelMount(polygon, finish, entries, walls, scale);
      if (!panel) continue;
      const t = panel.tangent,
        n = panel.inward,
        at = panel.center;
      const w =
        scale *
        (finish === "laboratory" ? 2.7 : finish === "teaching" ? 1.75 : 1.9);
      const d = scale * (finish === "laboratory" ? 0.86 : 0.68);
      const point = (u: number, v: number) => ({
        x: at.x + t.x * u * w + n.x * v * d,
        y: at.y + t.y * u * w + n.y * v * d,
      });
      const footprint = [
        point(-0.5, 0.12),
        point(0.5, 0.12),
        point(0.5, 1.12),
        point(-0.5, 1.12),
      ];
      const probes = [...footprint, point(0, 0.6), point(0, 1.12)];
      if (!probes.every((p) => inPolygon(p, polygon))) continue;
      const box = bounds(footprint);
      if (
        protectedShapes.some(
          (s) =>
            s.box.x <= box.x + box.width &&
            s.box.y <= box.y + box.height &&
            s.box.x + s.box.width >= box.x &&
            s.box.y + s.box.height >= box.y &&
            (probes.some((p) => inPolygon(p, s.polygon)) ||
              s.polygon[0].some((p) => inPolygon(p, [footprint]))),
        )
      )
        continue;
      const cells = nearbyCells(scene, footprint);
      if (
        !cells.length ||
        cells.some((c) => reserved.has(c)) ||
        !preservesAisle(scene, cells)
      )
        continue;
      const item: RoomCasework = {
        kind: finishKinds[finish],
        sourceId: surface.sourceId,
        footprint,
        cells,
      };
      scene.roomCasework.push(item);
      for (const c of cells) {
        scene.collision[c] = 1;
        reserved.add(c);
      }
    }
  }
}
