import config from "../content/map-config.json";
import {
  canStand,
  project,
  type Point,
  type SceneMap,
} from "../src/shared/world.ts";
import type { RoomDoor } from "../src/shared/doors.ts";
import {
  bounds,
  inPolygon,
  layers,
  type Polygon,
  type SourceMap,
} from "./source-geometry.ts";

/** Clip to this floor's grid; F1 wings share the same source features. */
function gridBox(
  scene: SceneMap,
  low: Point,
  high: Point,
  visit: (cell: number, p: Point) => void,
) {
  const step = scene.collisionSize,
    width = (scene.width * scene.tileSize) / step,
    height = (scene.height * scene.tileSize) / step;
  for (
    let y = Math.max(1, Math.floor(low.y / step));
    y < Math.min(height - 1, Math.ceil(high.y / step));
    y++
  )
    for (
      let x = Math.max(1, Math.floor(low.x / step));
      x < Math.min(width - 1, Math.ceil(high.x / step));
      x++
    )
      visit(y * width + x, { x: (x + 0.5) * step, y: (y + 0.5) * step });
}

function cellsOf(scene: SceneMap, polygon: Polygon): number[] {
  const b = bounds(polygon.flat()),
    cells: number[] = [];
  gridBox(scene, b, { x: b.x + b.width, y: b.y + b.height }, (i, p) => {
    if (inPolygon(p, polygon)) cells.push(i);
  });
  return cells;
}

/** The avatar footprint is already checked by canStand. Reject cells intersecting the actual
 * obstacle instead of applying the avatar radius a second time to each side of an opening. */
function protectEdges(scene: SceneMap, polygon: Polygon, solid: Uint8Array) {
  const half = scene.collisionSize / 2;
  for (const ring of polygon) {
    for (let i = 1; i < ring.length; i++) {
      const a = ring[i - 1],
        b = ring[i];
      gridBox(
        scene,
        { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) },
        { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y) },
        (cell, p) => {
          // gridBox already tests the two grid axes. The segment normal is the last separating axis.
          const dx = b.x - a.x,
            dy = b.y - a.y;
          if (
            Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) <
            half * (Math.abs(dx) + Math.abs(dy))
          )
            solid[cell] = 1;
        },
      );
    }
  }
}

/** Only source-annotated room entries with a physically clear path to an existing public component become doors. */
export function fitRoomDoors(
  scene: SceneMap,
  source: SourceMap,
  publicSpace: Set<number>,
) {
  const size = scene.collisionSize,
    width = (scene.width * scene.tileSize) / size;
  const position = (cell: number): Point => ({
    x: ((cell % width) + 0.5) * size,
    y: (Math.floor(cell / width) + 0.5) * size,
  });
  const directions = [-1, 1, -width, width];
  const floor = new Uint8Array(scene.collision.length),
    solid = new Uint8Array(floor.length),
    owners = new Uint16Array(floor.length);
  const original = scene.collision.slice();
  const sourceFeatures = new Map(
    layers(source, scene.floor.key).flatMap((l) =>
      (l.data?.features ?? []).map((f) => [f.properties.id, f] as const),
    ),
  );
  const rooms: {
    owner: number;
    members: Set<number>;
    label: string;
    sourceId: number;
    entries: number[][];
  }[] = [];
  const taken = new Set<number>();
  for (const surface of scene.surfaces) {
    const f = sourceFeatures.get(surface.sourceId);
    const isRoom = surface.kind === "room";
    const physical =
      ["wall", "lift", "water", "garden", "stairs"].includes(surface.kind) ||
      (surface.kind === "detail" &&
        (/座椅|书柜|书架|储物柜|家具|设施|模型|打印机|售卖机/.test(
          surface.sourceLayer,
        ) ||
          !!f?.properties.tarray));
    if (surface.kind !== "floor" && !physical && !isRoom) continue;
    for (const polygon of surface.polygons) {
      const cells = cellsOf(scene, polygon);
      if (physical) protectEdges(scene, polygon, solid);
      if (physical || surface.kind === "floor") {
        const mask = physical ? solid : floor;
        for (const cell of cells) mask[cell] = 1;
      } else {
        // Mechanical shafts and service plant remain closed; records without an entry cannot provide a hinge location.
        const label = String(f?.properties.name ?? "")
          .replace(/\\n/g, " ")
          .replace(/\s+/g, " ")
          .trim();
        const entries = /办公室|房间|实验室|洗手间/.test(surface.sourceLayer)
          ? f?.properties.entry
          : undefined;
        const owner = rooms.length + 1;
        for (const cell of cells) owners[cell] = owners[cell] ? 65535 : owner;
        rooms.push({
          owner,
          members: new Set(cells),
          label,
          sourceId: surface.sourceId,
          entries: Array.isArray(entries) && label ? entries : [],
        });
      }
    }
  }
  scene.doors = [];
  const neighbors = directions.concat([
    -width - 1,
    -width + 1,
    width - 1,
    width + 1,
  ]);
  for (const room of rooms) {
    if (!room.entries.length || !room.members.size) continue;
    const valid = (cell: number) =>
      owners[cell] === room.owner &&
      floor[cell] &&
      !solid[cell] &&
      original[cell] === 1;
    // Leave a continuous one-cell perimeter, including around internal polygon holes.
    // Preserve original public paths while preventing access to a new interior around a closed leaf.
    const interior = new Set(
      [...room.members].filter(
        (cell) =>
          valid(cell) &&
          neighbors.every(
            (d) => owners[cell + d] === room.owner && original[cell + d] === 1,
          ),
      ),
    );
    if (!interior.size) continue;
    const fitted: RoomDoor[] = [];
    for (const [index, coordinates] of room.entries.entries()) {
      const projected = project(coordinates, {
        ...config.transform,
        pixelsPerProjectedUnit: config.interiorScale,
      });
      const sourceEntry = {
        x: +(projected.x + scene.sourceOffset.x).toFixed(2),
        y: +(projected.y + scene.sourceOffset.y).toFixed(2),
      };
      // The source marks the approach point, sometimes in the corridor. Require an immediately
      // adjacent structural opening; never dig through a separate source wall to reach it.
      const maxDistance = scene.units.pixelsPerMeter * 1.55;
      let best: { distance: number; door: RoomDoor } | undefined;
      const cx = Math.floor(sourceEntry.x / size),
        cy = Math.floor(sourceEntry.y / size),
        search = Math.ceil(maxDistance / size);
      for (
        let y = Math.max(1, cy - search);
        y <= Math.min((scene.height * scene.tileSize) / size - 2, cy + search);
        y++
      )
        for (
          let x = Math.max(1, cx - search);
          x <= Math.min(width - 2, cx + search);
          x++
        ) {
          const first = y * width + x;
          if (!valid(first) || interior.has(first) || taken.has(first))
            continue;
          for (const d of directions) {
            const outside = position(first - d);
            if (
              !publicSpace.has(first - d) ||
              owners[first - d] ||
              !floor[first - d] ||
              solid[first - d] ||
              !canStand(scene, outside)
            )
              continue;
            const cells = [first];
            if (!interior.has(first + d)) {
              if (!valid(first + d) || taken.has(first + d)) continue;
              cells.push(first + d);
            }
            const last = cells[cells.length - 1],
              inner = last + d;
            if (!interior.has(inner) || !interior.has(inner + d)) continue;
            const inside = position(inner),
              mark = position(first);
            const distance = Math.hypot(
              sourceEntry.x - mark.x,
              sourceEntry.y - mark.y,
            );
            if (distance > maxDistance || (best && distance >= best.distance))
              continue;
            best = {
              distance,
              door: {
                ...mark,
                id: `door_${scene.id}_${room.sourceId}_${index}`,
                room: room.label,
                sourceId: room.sourceId,
                sourceEntry,
                outside,
                inside,
                cells,
              },
            };
          }
        }
      if (best) {
        fitted.push(best.door);
        best.door.cells.forEach((c) => taken.add(c));
      }
    }
    if (!fitted.length) continue;
    // Visit only interior components actually attached to a fitted door. Furniture and partitions remain solid.
    const queue = fitted.map(
      (d) =>
        Math.floor(d.inside.y / size) * width + Math.floor(d.inside.x / size),
    );
    for (let k = 0; k < queue.length; k++) {
      const cell = queue[k];
      if (!interior.delete(cell)) continue;
      scene.collision[cell] = 0;
      for (const d of directions)
        if (interior.has(cell + d)) queue.push(cell + d);
    }
    scene.doors.push(...fitted);
  }
}
