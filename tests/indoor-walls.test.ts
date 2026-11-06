import { doorCollision } from "../src/shared/doors.ts";
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { inPolygon } from "../scripts/source-geometry.ts";
import {
  canStand,
  move,
  reachableWorld,
  tileIndex,
  type WorldMap,
} from "../src/shared/world.ts";

const world: WorldMap = JSON.parse(
  readFileSync(new URL("../public/maps/world.json", import.meta.url), "utf8"),
);

test("sprinting into the surveyed walls of each floor stops the player's feet", () => {
  const openWorld = {
    ...world,
    scenes: world.scenes.map((s) =>
      doorCollision(s, new Set(s.doors?.map((d) => d.id))),
    ),
  };
  const publicSpace = reachableWorld(openWorld);
  for (const scene of openWorld.scenes.slice(1)) {
    const space = publicSpace.get(scene.id)!;
    const portals = scene.portals.filter((p) => p.entrance);
    let approaches = 0;
    for (const wall of scene.surfaces.filter((s) => s.kind === "wall"))
      for (const polygon of wall.polygons)
        for (const ring of polygon)
          for (let i = 1; i < ring.length; i++) {
            const a = ring[i - 1],
              b = ring[i],
              dx = b.x - a.x,
              dy = b.y - a.y;
            const length = Math.hypot(dx, dy);
            for (let t = 3; t < length - 2; t += 5) {
              const x = a.x + (dx * t) / length,
                y = a.y + (dy * t) / length;
              if (
                portals.some(
                  (p) =>
                    Math.hypot(
                      p.entrance!.threshold.x - x,
                      p.entrance!.threshold.y - y,
                    ) < p.entrance!.width,
                )
              )
                continue;
              const n = { x: -dy / length, y: dx / length };
              if (
                !inPolygon({ x: x + 0.13 * n.x, y: y + 0.13 * n.y }, polygon)
              ) {
                n.x *= -1;
                n.y *= -1;
                if (
                  !inPolygon({ x: x + 0.13 * n.x, y: y + 0.13 * n.y }, polygon)
                )
                  continue;
              }
              let feet = { x: x - 3 * n.x, y: y - 3 * n.y };
              if (!canStand(scene, feet) || !space.has(tileIndex(scene, feet)))
                continue;
              approaches++;
              for (let j = 0; j < 8; j++)
                feet = move(
                  scene,
                  feet,
                  n,
                  5 / (8 * scene.player.runSpeed),
                  scene.player.runSpeed,
                );
              assert.ok(
                Math.hypot(feet.x - x - 2 * n.x, feet.y - y - 2 * n.y) > 0.01,
                `${scene.id} wall ${wall.sourceId} at ${x},${y}`,
              );
            }
          }
    assert.ok(approaches > 0, scene.id);
  }
});

test("Tiled carries the same pixel-accurate obstruction rows as the walking game", () => {
  for (const scene of world.scenes) {
    const tiled = JSON.parse(
      readFileSync(
        new URL(`../public/maps/${scene.id}.tmj`, import.meta.url),
        "utf8",
      ),
    );
    const attributes = tiled.layers.find(
      (layer: { name: string }) => layer.name === "fixture_collision",
    )?.properties;
    const ratio = scene.art.pixelRatio ?? 1;
    assert.equal(
      attributes.find((p: { name: string }) => p.name === "rowHeight").value,
      ratio,
    );
    const rows = JSON.parse(
      attributes.find((p: { name: string }) => p.name === "blockedRowRuns")
        .value,
    );
    assert.deepEqual(
      rows,
      scene.fixtureCollision!.runs.map((v) => v * ratio),
      scene.id,
    );
  }
});
