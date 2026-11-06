import {
  canTraverse,
  move,
  type Point,
  type SceneMap,
} from "../src/shared/world.ts";
import type { RoomDoor } from "../src/shared/doors.ts";

type Gate = Pick<RoomDoor, "outside" | "inside" | "cells">;
/** At a corner, the room landing can be offset from the opening. Prove the
 * whole body path against the original wall pixels before opening its cells. */
export function angledRoomGates(
  scene: SceneMap,
  entry: Point,
  outside: Point[],
  inside: Point[],
  interior: Set<number>,
  allowed: (cell: number) => boolean,
): Gate[] {
  if (!scene.fixtureCollision) return [];
  const size = scene.collisionSize,
    width = (scene.width * scene.tileSize) / size;
  const radius = scene.player.radius;
  const pairs = outside
    .flatMap((a) =>
      inside.map((b) => ({
        a,
        b,
        cost:
          Math.hypot(a.x - entry.x, a.y - entry.y) +
          Math.hypot(b.x - entry.x, b.y - entry.y),
      })),
    )
    .sort((a, b) => a.cost - b.cost);
  const result: Gate[] = [];
  for (const { a, b } of pairs) {
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length < 4 || length > scene.units.pixelsPerMeter * 2.5) continue;
    const changed = new Set<number>();
    for (let t = 0; t <= Math.ceil(length * 2); t++) {
      const k = t / Math.ceil(length * 2),
        x = a.x + (b.x - a.x) * k,
        y = a.y + (b.y - a.y) * k;
      for (
        let row = Math.floor((y - radius) / size);
        row <= Math.floor((y + radius) / size);
        row++
      )
        for (
          let col = Math.floor((x - radius) / size);
          col <= Math.floor((x + radius) / size);
          col++
        ) {
          const cell = row * width + col;
          if (scene.collision[cell]) changed.add(cell);
        }
    }
    const cells = [...changed].filter((c) => !interior.has(c));
    if (
      !cells.length ||
      cells.length > 8 ||
      [...changed].some((c) => !allowed(c))
    )
      continue;
    for (const c of changed) scene.collision[c] = 0;
    let clear = canTraverse(scene, a, b);
    for (const [from, to] of [
      [a, b],
      [b, a],
    ]) {
      let p = from;
      for (let d = 0; d < length && clear; d += 0.5) {
        const step = Math.min(0.5, length - d);
        p = move(
          scene,
          p,
          { x: to.x - from.x, y: to.y - from.y },
          step / 20,
          20,
        );
        const k = Math.min(length, d + step) / length;
        if (
          Math.hypot(
            p.x - from.x - (to.x - from.x) * k,
            p.y - from.y - (to.y - from.y) * k,
          ) > 0.01
        )
          clear = false;
      }
    }
    for (const c of changed) scene.collision[c] = 1;
    if (clear) result.push({ outside: a, inside: b, cells });
    if (result.length >= 24) break;
  }
  return result;
}
