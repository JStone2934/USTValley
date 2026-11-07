import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  planGuide,
  walkingPath,
  recommendedTarget,
  type GuideTarget,
} from "../src/shared/guide";
import {
  canStand,
  canTraverse,
  type WorldMap,
  type Point,
  type SceneMap,
} from "../src/shared/world";
import { doorCollision } from "../src/shared/doors";
import { crossedEntrance } from "../src/shared/automatic-doors";
import { crossedGallery } from "../src/shared/passages";
import { newProgress } from "../src/shared/journey";
const world: WorldMap = JSON.parse(
  readFileSync(new URL("../public/maps/world.json", import.meta.url), "utf8"),
);
function verifySegments(scene: SceneMap, points: Point[]) {
  const walk = doorCollision(scene, new Set(scene.doors?.map((d) => d.id)));
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i];
    assert.ok(
      canTraverse(walk, a, b),
      `${scene.id} route crosses solid geometry`,
    );
    const count = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y));
    let previous = a;
    for (let n = 1; n <= count; n++) {
      const p = {
        x: a.x + ((b.x - a.x) * n) / count,
        y: a.y + ((b.y - a.y) * n) / count,
      };
      assert.equal(crossedEntrance(walk, previous, p), undefined);
      assert.equal(crossedGallery(walk, previous, p), undefined);
      previous = p;
    }
  }
}
function completeTrip(scene: SceneMap, start: Point, target: GuideTarget) {
  const visited = new Set<string>();
  for (let n = 0; n < 12; n++) {
    const route = planGuide(world, scene.id, start, target);
    assert.notEqual(route.status, "unavailable", `${scene.id} -> ${target.id}`);
    verifySegments(scene, route.points);
    if (!route.portalId) {
      if (route.status !== "arrived") {
        const end = route.points.at(-1)!;
        assert.equal(planGuide(world, scene.id, end, target).status, "arrived");
      }
      return;
    }
    const key = scene.id + ":" + route.portalId;
    assert.ok(!visited.has(key), "route must not loop");
    visited.add(key);
    const portal = scene.portals.find((p) => p.id === route.portalId)!;
    scene = world.scenes.find((s) => s.id === portal.targetScene)!;
    start = scene.portals.find((p) => p.id === portal.targetPortal)!.spawn;
  }
  assert.fail("route failed to arrive within twelve passages");
}
test("guides all fifteen buildings through reachable entrances and permanent geometry", () => {
  for (const b of world.buildings)
    completeTrip(world.scenes[0], world.scenes[0].spawns[0], {
      kind: "building",
      id: b.id,
    });
});
test("routes from every upper floor back to a campus friend without scene loops", () => {
  for (const s of world.scenes.filter((s) => s.floor.elevation > 0))
    completeTrip(s, s.spawns[0] ?? s.portals[0].spawn, {
      kind: "npc",
      id: "lin",
    });
});
test("swept routes detour around fixtures and do not mutate closed door collision", () => {
  const scene = world.scenes.find((s) => s.id === "interior_c2")!,
    before = scene.collision.slice();
  const door = scene.doors![0],
    path = walkingPath(scene, door.outside, door.inside);
  assert.ok(path);
  verifySegments(scene, path);
  assert.deepEqual(scene.collision, before);
  const synthetic = {
    ...scene,
    width: 4,
    height: 4,
    tileSize: 16,
    collisionSize: 4,
    collision: Array(256).fill(0),
    doors: [],
    portals: [],
    fixtureCollision: undefined,
    player: { ...scene.player, radius: 0.6 },
  };
  for (let y = 0; y < 15; y++) synthetic.collision[y * 16 + 7] = 1;
  const route = walkingPath(synthetic, { x: 12, y: 12 }, { x: 50, y: 12 });
  assert.ok(route);
  verifySegments(synthetic, route);
  assert.ok(route.some((p) => p.y > 59));
  synthetic.collision[15 * 16 + 7] = 1;
  assert.equal(
    walkingPath(synthetic, { x: 12, y: 12 }, { x: 50, y: 12 }),
    undefined,
  );
});
test("task tracking selects its own unmet action and invalid destinations fail safely", () => {
  const p = newProgress();
  assert.deepEqual(recommendedTarget(world, p, "campus_core"), {
    kind: "npc",
    id: "lin",
  });
  assert.equal(
    recommendedTarget(world, p, "campus_core", "explore_5")?.kind,
    "building",
  );
  assert.deepEqual(recommendedTarget(world, p, "campus_core", "reading"), {
    kind: "npc",
    id: "yun",
  });
  p.talked.push("yun");
  assert.deepEqual(recommendedTarget(world, p, "campus_core", "reading"), {
    kind: "building",
    id: "C7",
  });
  assert.equal(
    planGuide(world, "campus_core", world.scenes[0].spawns[0], {
      kind: "building",
      id: "unknown",
    }).status,
    "unavailable",
  );
  assert.ok(canStand(world.scenes[0], world.scenes[0].spawns[0]));
});
