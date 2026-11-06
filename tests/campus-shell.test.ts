import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { inPolygon, bounds } from "../scripts/source-geometry.ts";
import {
  canStand,
  move,
  type Point,
  type WorldMap,
} from "../src/shared/world.ts";

const campus = (
  JSON.parse(
    readFileSync(new URL("../public/maps/world.json", import.meta.url), "utf8"),
  ) as WorldMap
).scenes[0];
const awayFromDoor = (p: Point) =>
  campus.portals.every(
    ({ entrance }) =>
      Math.hypot(entrance!.threshold.x - p.x, entrance!.threshold.y - p.y) >
      2.5 * campus.units.pixelsPerMeter,
  );

test("campus movement cannot enter any F1 footprint through a facade, including diagonal returns", () => {
  let approaches = 0,
    interiorCells = 0;
  for (const roof of campus.art.roofs) {
    for (const poly of roof.footprint) {
      const b = bounds(poly.flat()),
        grid = campus.collisionSize;
      for (
        let y = (Math.floor(b.y / grid) + 0.5) * grid;
        y < b.y + b.height;
        y += grid
      )
        for (
          let x = (Math.floor(b.x / grid) + 0.5) * grid;
          x < b.x + b.width;
          x += grid
        ) {
          const p = { x, y };
          if (!inPolygon(p, poly) || !awayFromDoor(p)) continue;
          assert.equal(
            canStand(campus, p),
            false,
            `outdoor feet inside ${roof.id} at ${x},${y}`,
          );
          interiorCells++;
        }
      for (const ring of poly)
        for (let i = 1; i < ring.length; i++) {
          const a = ring[i - 1],
            b = ring[i],
            length = Math.hypot(b.x - a.x, b.y - a.y);
          for (let t = 1.5; t < length; t += 3) {
            const p = {
              x: a.x + ((b.x - a.x) * t) / length,
              y: a.y + ((b.y - a.y) * t) / length,
            };
            if (!awayFromDoor(p)) continue;
            const n = { x: (a.y - b.y) / length, y: (b.x - a.x) / length };
            if (!inPolygon({ x: p.x + 0.1 * n.x, y: p.y + 0.1 * n.y }, poly)) {
              n.x *= -1;
              n.y *= -1;
            }
            let foot = { x: p.x - 6 * n.x, y: p.y - 6 * n.y };
            if (
              !canStand(campus, foot) ||
              roof.footprint.some((f) => inPolygon(foot, f))
            )
              continue;
            for (let frame = 0; frame < 10; frame++) {
              foot = move(campus, foot, n, 0.1, campus.player.runSpeed);
              assert.equal(
                roof.footprint.some((f) => inPolygon(foot, f)),
                false,
                `crossed ${roof.id} at ${p.x},${p.y}`,
              );
            }
            approaches++;
          }
        }
    }
  }
  assert.ok(interiorCells > 55_000 && approaches > 4_000);
});
