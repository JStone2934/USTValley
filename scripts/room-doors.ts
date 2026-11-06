import { angledRoomGates } from "./angled-room-doors.ts";
import { clearOfFixtures } from "../src/shared/fixtures.ts";
import { doorEdgeCollision } from "./door-edge-collision.ts";
import config from "../content/map-config.json";
import {
  canStand,
  project,
  tileIndex,
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

type WallFace = Point & { dx: number; dy: number; length: number };

/** The thin end faces of source wall polygons bracket a door gap. Keep their
 * actual centres so the moving leaf and the baked reveals share the wall axis. */
function wallFaces(scene: SceneMap): WallFace[] {
  const ends: WallFace[] = [],
    ppm = scene.units.pixelsPerMeter;
  for (const wall of scene.surfaces.filter((s) => s.kind === "wall")) {
    for (const polygon of wall.polygons)
      for (const ring of polygon) {
        for (let i = 0; i < ring.length; i++) {
          const a = ring[i],
            b = ring[(i + 1) % ring.length];
          const dx = b.x - a.x,
            dy = b.y - a.y,
            length = Math.hypot(dx, dy);
          if (length >= ppm * 0.035)
            ends.push({
              x: (a.x + b.x) / 2,
              y: (a.y + b.y) / 2,
              length,
              dx: dx / length,
              dy: dy / length,
            });
        }
      }
  }
  return ends;
}

/** Locate the actual edge crossed by the certified public-to-room walking line.
 * The source's entry point can be set back in the corridor or in the room. */
function locateOpening(
  door: RoomDoor,
  polygon: Polygon,
  ends: WallFace[],
  ppm: number,
  radius: number,
) {
  const outside = door.outside,
    rayX = door.inside.x - outside.x,
    rayY = door.inside.y - outside.y;
  let nearest = Infinity,
    edge:
      | { a: Point; tx: number; ty: number; u: number; length: number }
      | undefined;
  for (const ring of polygon)
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i],
        b = ring[(i + 1) % ring.length],
        dx = b.x - a.x,
        dy = b.y - a.y;
      const cross = rayX * dy - rayY * dx;
      if (Math.abs(cross) < 1e-6) continue;
      const ax = a.x - outside.x,
        ay = a.y - outside.y;
      const k = (ax * dy - ay * dx) / cross,
        t = (ax * rayY - ay * rayX) / cross;
      if (k < 0 || k > 1 || t < 0 || t > 1 || k >= nearest) continue;
      nearest = k;
      const length = Math.hypot(dx, dy);
      edge = { a, tx: dx / length, ty: dy / length, u: t * length, length };
    }
  if (!edge) return;
  const { a, tx, ty, u, length } = edge;
  const x = a.x + u * tx,
    y = a.y + u * ty;
  let left: Point | undefined,
    right: Point | undefined,
    low = -Infinity,
    high = Infinity;
  // Most jambs are a short end cap. At an L/T junction the same opening
  // is bounded by a long return wall. Intersect that face at wall mid-depth.
  const midDepth = -Math.sign(-rayX * ty + rayY * tx) * ppm * 0.1;
  for (const face of ends) {
    if (Math.abs(face.dx * tx + face.dy * ty) > 0.38) continue;
    let fx = face.x,
      fy = face.y;
    const depth = -(fx - x) * ty + (fy - y) * tx;
    if (face.length > 0.55 * ppm) {
      const t = (midDepth - depth) / (-face.dx * ty + face.dy * tx);
      if (Math.abs(t) > face.length / 2) continue;
      fx += t * face.dx;
      fy += t * face.dy;
    } else if (Math.abs(depth) > 0.4 * ppm) continue;
    const along = (fx - x) * tx + (fy - y) * ty;
    if (Math.abs(along) > 2.1 * ppm) continue;
    if (along <= 0 && along > low) {
      left = { x: fx, y: fy };
      low = along;
    }
    if (along > 0 && along < high) {
      right = { x: fx, y: fy };
      high = along;
    }
  }
  const width = high - low;
  let hinge: Point, latch: Point, openingSource: RoomDoor["openingSource"];
  if (
    left &&
    right &&
    width >= 0.62 * ppm &&
    width <= 2.55 * ppm &&
    Math.abs((right.x - left.x) * ty - (right.y - left.y) * tx) <= 0.23 * ppm
  ) {
    hinge = left;
    latch = right;
    openingSource = "wall-ends";
  } else {
    // No trustworthy pair of wall ends. Reconstruct a single leaf on the room
    // boundary, using the source entry projected onto this same edge. Limit
    // the shift so the certified crossing still passes between the jambs.
    const half = Math.min(length / 2, 0.49 * ppm);
    const reach = Math.max(
      0,
      half - radius * (Math.abs(tx) + Math.abs(ty)) - 1 / 3,
    );
    const requested =
      (door.sourceEntry.x - a.x) * tx + (door.sourceEntry.y - a.y) * ty;
    const along = Math.max(
      half,
      Math.min(
        length - half,
        Math.max(u - reach, Math.min(u + reach, requested)),
      ),
    );
    hinge = { x: a.x + (along - half) * tx, y: a.y + (along - half) * ty };
    latch = { x: a.x + (along + half) * tx, y: a.y + (along + half) * ty };
    openingSource = "room-edge";
  }
  const rounded = (p: Point) => ({ x: +p.x.toFixed(2), y: +p.y.toFixed(2) });
  door.hinge = rounded(hinge);
  door.latch = rounded(latch);
  door.x = +((door.hinge.x + door.latch.x) / 2).toFixed(3);
  door.y = +((door.hinge.y + door.latch.y) / 2).toFixed(3);
  door.openingSource = openingSource;
}

type Gate = Pick<RoomDoor, "outside" | "inside" | "cells">;

/** Reserve only lanes meeting the real opening between its jambs with room
 * for the full avatar. The original centre lane remains valid on older maps. */
function withinOpening(gate: Gate, a: Point, b: Point, radius: number) {
  const tx = b.x - a.x,
    ty = b.y - a.y,
    width = Math.hypot(tx, ty);
  const dx = gate.inside.x - gate.outside.x,
    dy = gate.inside.y - gate.outside.y;
  const den = dx * ty - dy * tx;
  if (Math.abs(den) < 1e-6) return false;
  const ax = a.x - gate.outside.x,
    ay = a.y - gate.outside.y;
  const k = (ax * ty - ay * tx) / den,
    t = (ax * dy - ay * dx) / den;
  const clearance = (radius * (Math.abs(tx) + Math.abs(ty))) / width;
  return (
    k >= 0 && k <= 1 && t * width >= clearance && (1 - t) * width >= clearance
  );
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
    hard = new Uint8Array(floor.length),
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
    polygon: Polygon;
    label: string;
    sourceId: number;
    entries: number[][];
  }[] = [];
  const taken = new Set<number>();
  const ends = wallFaces(scene),
    edges = doorEdgeCollision(scene);
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
      if (physical)
        protectEdges(scene, polygon, surface.kind === "wall" ? solid : hard);
      if (physical || surface.kind === "floor") {
        const mask = physical
          ? surface.kind === "wall"
            ? solid
            : hard
          : floor;
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
          polygon,
          label,
          sourceId: surface.sourceId,
          entries: Array.isArray(entries) && label ? entries : [],
        });
      }
    }
  }
  for (let i = 0; i < hard.length; i++) solid[i] |= hard[i];
  scene.doors = [];
  const neighbors = directions.concat([
    -width - 1,
    -width + 1,
    width - 1,
    width + 1,
  ]);
  for (const room of rooms) {
    if (!room.entries.length || !room.members.size) continue;
    const possibleGate = (cell: number) =>
      owners[cell] === room.owner &&
      floor[cell] &&
      !hard[cell] &&
      original[cell] === 1;
    const valid = (cell: number) => possibleGate(cell) && !solid[cell];
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
    const alternatives = new Map<string, Gate[]>();
    for (const [index, coordinates] of [
      ...room.entries.entries(),
      ...room.entries.entries(),
    ]) {
      if (
        fitted.some(
          (d) => d.id === `door_${scene.id}_${room.sourceId}_${index}`,
        )
      )
        continue;
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
      const candidates: Gate[] = [];
      let best: { distance: number; door: RoomDoor } | undefined;
      const cx = Math.floor(sourceEntry.x / size),
        cy = Math.floor(sourceEntry.y / size),
        search = Math.ceil((maxDistance + scene.units.pixelsPerMeter) / size);
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
          if (!possibleGate(first) || interior.has(first) || taken.has(first))
            continue;
          for (const d of directions) {
            const outside = position(first - d);
            if (
              (!publicSpace.has(first - d) && !fitted.length) ||
              owners[first - d] ||
              !floor[first - d] ||
              hard[first - d] ||
              !canStand(scene, outside)
            )
              continue;
            const cells = [first];
            if (!interior.has(first + d)) {
              if (!possibleGate(first + d) || taken.has(first + d)) continue;
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
            candidates.push({ outside, inside, cells });
            // Fine geometry preserves a real doorway inside a partially occupied
            // coarse cell. Older scenes retain their structural wall mask.
            if (
              (!scene.fixtureCollision && cells.some((c) => solid[c])) ||
              !clearOfFixtures(
                scene,
                Math.min(outside.x, inside.x) - scene.player.radius,
                Math.min(outside.y, inside.y) - scene.player.radius,
                Math.max(outside.x, inside.x) + scene.player.radius,
                Math.max(outside.y, inside.y) + scene.player.radius,
              ) ||
              distance > maxDistance ||
              (best && distance >= best.distance)
            )
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
      if (!best) {
        const outside: Point[] = [],
          inside: Point[] = [];
        gridBox(
          scene,
          { x: sourceEntry.x - maxDistance, y: sourceEntry.y - maxDistance },
          { x: sourceEntry.x + maxDistance, y: sourceEntry.y + maxDistance },
          (cell, p) => {
            if (interior.has(cell)) inside.push(p);
            else if (
              (publicSpace.has(cell) || fitted.length > 0) &&
              !owners[cell] &&
              floor[cell] &&
              canStand(scene, p)
            )
              outside.push(p);
          },
        );
        const approaches = outside
          .flatMap((p) =>
            [-1, 0, 1].flatMap((dx) =>
              [-1, 0, 1].map((dy) => ({ x: p.x + dx, y: p.y + dy })),
            ),
          )
          .filter((p) => canStand(scene, p));
        for (const gate of angledRoomGates(
          scene,
          sourceEntry,
          approaches,
          inside,
          interior,
          (c) =>
            owners[c] === room.owner &&
            floor[c] !== 0 &&
            !hard[c] &&
            !taken.has(c),
        )) {
          const door: RoomDoor = {
            ...sourceEntry,
            id: `door_${scene.id}_${room.sourceId}_${index}`,
            room: room.label,
            sourceId: room.sourceId,
            sourceEntry,
            ...gate,
          };
          locateOpening(
            door,
            room.polygon,
            ends,
            scene.units.pixelsPerMeter,
            scene.player.radius,
          );
          if (
            door.openingSource !== "wall-ends" ||
            !withinOpening(door, door.hinge!, door.latch!, scene.player.radius)
          )
            continue;
          best = {
            door,
            distance: Math.hypot(
              door.x - sourceEntry.x,
              door.y - sourceEntry.y,
            ),
          };
          break;
        }
      }
      if (best) {
        locateOpening(
          best.door,
          room.polygon,
          ends,
          scene.units.pixelsPerMeter,
          scene.player.radius,
        );
        fitted.push(best.door);
        alternatives.set(best.door.id, candidates);
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
    for (const door of fitted) {
      if (!door.hinge || !door.latch || door.openingSource !== "wall-ends")
        continue;
      const dx = Math.sign(door.inside.x - door.outside.x),
        dy = Math.sign(door.inside.y - door.outside.y);
      for (const lane of alternatives.get(door.id)!) {
        // Keep separate door IDs disjoint. An extra lane may only end inside
        // an already connected room, never a courtyard or separate enclosure.
        if (
          Math.sign(lane.inside.x - lane.outside.x) !== dx ||
          Math.sign(lane.inside.y - lane.outside.y) !== dy ||
          lane.cells.some((c) => taken.has(c)) ||
          !canStand(scene, lane.inside)
        )
          continue;
        const partial = lane.cells.filter((c) => solid[c]);
        let found: Gate | undefined;
        for (const offset of [0, -0.5, 0.5]) {
          const shift = (p: Point) => ({
            x: p.x + dy * offset,
            y: p.y - dx * offset,
          });
          const candidate = {
            outside: shift(lane.outside),
            inside: shift(lane.inside),
            cells: lane.cells,
          };
          if (
            withinOpening(
              candidate,
              door.hinge,
              door.latch,
              scene.player.radius,
            ) &&
            edges.fits(candidate, partial)
          ) {
            found = candidate;
            break;
          }
        }
        if (!found) continue;
        (door.lanes ??= []).push({
          outside: found.outside,
          inside: found.inside,
        });
        door.cells.push(...lane.cells);
        for (const c of lane.cells) taken.add(c);
      }
    }
    for (const door of fitted) {
      // A survey's wall centreline can lie just beyond the corridor grid
      // centre. Use the next public cell when needed to stand clear of the leaf.
      if (!door.hinge || !door.latch) continue;
      // Angled approaches were already validated as a complete body sweep.
      if (door.inside.x !== door.outside.x && door.inside.y !== door.outside.y)
        continue;
      const tx = door.latch.x - door.hinge.x,
        ty = door.latch.y - door.hinge.y,
        dx = Math.sign(door.inside.x - door.outside.x),
        dy = Math.sign(door.inside.y - door.outside.y);
      const signed = (p: Point) =>
        (((p.x - door.x) * -ty + (p.y - door.y) * tx) *
          Math.sign(-ty * dx + tx * dy)) /
        Math.hypot(tx, ty);
      for (const lane of [door, ...(door.lanes ?? [])])
        if (signed(lane.outside) > -scene.player.radius) {
          const p = {
            x: lane.outside.x - dx * size,
            y: lane.outside.y - dy * size,
          };
          if (
            publicSpace.has(tileIndex(scene, p)) &&
            canStand(scene, p) &&
            canStand(scene, {
              x: (p.x + lane.outside.x) / 2,
              y: (p.y + lane.outside.y) / 2,
            })
          )
            lane.outside = p;
        }
    }
    scene.doors.push(...fitted);
  }
  edges.install();
}
