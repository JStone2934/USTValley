import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildWorld,
  tiledMap,
  validateWorld,
  type Sources,
} from "../scripts/map-builder.ts";
import {
  canStand,
  hasLineOfSight,
  move,
  nearbyPortal,
  project,
  reachable,
  tileIndex,
} from "../src/shared/world.ts";

const bytes = readFileSync(
  new URL("../data/maps/all-maps.json", import.meta.url),
);
const sources = JSON.parse(bytes.toString()) as Sources;
const result = buildWorld(sources, bytes),
  world = result.world;
test("build is deterministic and keeps all 15 buildings within tile budgets", () => {
  assert.deepEqual(buildWorld(sources, bytes), result);
  assert.equal(world.scenes.length, 16);
  assert.equal(world.buildings.length, 15);
  assert.doesNotThrow(() => validateWorld(world));
  assert.ok(
    result.report.dimensions.width <= 256 &&
      result.report.dimensions.height <= 256,
  );
  assert.equal(result.report.sourceMapVersion, 271141);
});
test("projection applies translation, rotation, scale and Y flip in order", () => {
  const p = project([11, 20], {
    origin: [10, 20],
    rotationDegrees: 90,
    pixelsPerProjectedUnit: 4,
    flipY: true,
    padding: 0,
  });
  assert.ok(Math.abs(p.x) < 1e-10);
  assert.equal(p.y, -4);
});
test("all numbered anchors preserve source evidence including C3/C4 hall properties", () => {
  assert.equal(
    result.report.buildings.find((b) => b.id === "C1")!.sourceFeatureIds[0],
    43595,
  );
  assert.equal(
    result.report.buildings.find((b) => b.id === "C7")!.sourceFeatureIds[0],
    43596,
  );
  for (const b of result.report.buildings) {
    assert.equal(b.review, "pending");
    assert.ok(b.sourceFeatureIds.length > 0);
  }
  assert.deepEqual(
    result.report.buildings.find((b) => b.id === "C3")!.sourceFeatureIds,
    [45185],
  );
  assert.deepEqual(
    result.report.buildings.find((b) => b.id === "C4")!.sourceFeatureIds,
    [24060],
  );
});
test("export allowlist excludes original location, beacon and model resources", () => {
  const poisoned = structuredClone(sources) as Sources &
    Record<string, unknown>;
  Object.assign(poisoned.xgkdgz_all, {
    beacon: [{ secret: "DO_NOT_PUBLISH_BEACONS" }],
    location: { secret: "DO_NOT_PUBLISH_LOCATION" },
  });
  const exported = JSON.stringify(buildWorld(poisoned, bytes).world);
  assert.doesNotMatch(
    exported,
    /DO_NOT_PUBLISH|beacon|location|\.glb|tarray|uuid|geoTransParams/,
  );
  assert.deepEqual(buildWorld(poisoned, bytes).world, world);
});
test("every portal has a reciprocal exit and both scenes have reachable return positions", () => {
  for (const scene of world.scenes) {
    const visited = reachable(scene, scene.spawns[0], scene.player.radius);
    for (const p of scene.portals) {
      assert.ok(visited.has(tileIndex(scene, p)));
      assert.ok(visited.has(tileIndex(scene, p.spawn)));
      const reverse = world.scenes
        .find((s) => s.id === p.targetScene)!
        .portals.find((q) => q.id === p.targetPortal)!;
      assert.equal(reverse.targetScene, scene.id);
      assert.equal(reverse.targetPortal, p.id);
    }
  }
});
test("validation rejects duplicate IDs, broken references, wall spawns and removed content", () => {
  const cases = [
    (w: typeof world) => {
      w.scenes[1].id = w.scenes[0].id;
    },
    (w: typeof world) => {
      w.scenes[0].portals[0].targetScene = "missing";
    },
    (w: typeof world) => {
      w.scenes[0].portals[0].targetPortal = "missing";
    },
    (w: typeof world) => {
      w.scenes[0].collision[tileIndex(w.scenes[0], w.scenes[0].spawns[0])] = 1;
    },
    (w: typeof world) => {
      w.buildings.pop();
    },
    (w: typeof world) => {
      w.scenes[0].chests[0] = { ...w.scenes[0].portals[0], id: "bad_chest" };
    },
    (w: typeof world) => {
      w.scenes[0].collision.pop();
    },
    (w: typeof world) => {
      w.scenes[0].player.width = 16;
    },
  ];
  for (const mutate of cases) {
    const copy = structuredClone(world);
    mutate(copy);
    assert.throws(() => validateWorld(copy));
  }
});
test("all Tiled maps expose required layers, numeric unique object IDs and matching collision", () => {
  for (const scene of world.scenes) {
    const tiled = tiledMap(scene, world.mapVersion);
    assert.equal(tiled.orientation, "orthogonal");
    assert.equal(tiled.infinite, false);
    for (const layer of [
      "ground",
      "decoration",
      "collision",
      "foreground",
      "portals",
      "exploration",
      "note_zones",
      "chests",
      "spawns",
    ])
      assert.ok(tiled.layers.some((l) => l.name === layer));
    const objects = tiled.layers.flatMap<{ id: number }>((l) =>
      "objects" in l ? (l.objects ?? []) : [],
    );
    assert.ok(objects.every((o) => Number.isInteger(o.id)));
    assert.equal(new Set(objects.map((o) => o.id)).size, objects.length);
    const collision = tiled.layers.find((l) => l.name === "collision")!;
    const restored = Array(scene.collision.length).fill(0),
      step = scene.collisionSize,
      width = (scene.width * 16) / step;
    for (const rect of collision.objects)
      for (let y = rect.y; y < rect.y + rect.height; y += step)
        for (let x = rect.x; x < rect.x + rect.width; x += step)
          restored[(y / step) * width + x / step] = 1;
    assert.deepEqual(restored, scene.collision);
  }
});
test("eight-direction input is normalized and large frame deltas are clamped", () => {
  const scene = world.scenes[1],
    start = scene.spawns[0];
  const straight = move(scene, start, { x: 1, y: 0 }, 0.05);
  const diagonal = move(scene, start, { x: 1, y: -1 }, 0.05);
  const dist = (p: { x: number; y: number }) =>
    Math.hypot(p.x - start.x, p.y - start.y);
  assert.ok(Math.abs(dist(straight) - scene.player.speed * 0.05) < 1e-8);
  assert.ok(Math.abs(dist(straight) - dist(diagonal)) < 1e-8);
  assert.ok(
    dist(move(scene, start, { x: 100, y: 100 }, 1000)) <=
      scene.player.speed * 0.1 + 1e-8,
  );
  for (const input of [
    { x: NaN, y: 0 },
    { x: 0, y: Infinity },
  ])
    assert.deepEqual(move(scene, start, input, 0.05), start);
  assert.deepEqual(move(scene, start, { x: 1, y: 0 }, -1), start);
});
test("human-sized collision prevents thin-wall tunneling and through-wall interactions", () => {
  const scene = structuredClone(world.scenes[1]),
    step = scene.collisionSize,
    width = (scene.width * 16) / step;
  scene.collision.fill(0);
  const x = Math.floor(width / 2) * step + step / 2,
    wallY = 48;
  const portal = { ...scene.portals[0], x, y: wallY + 10 };
  scene.portals = [portal];
  assert.ok(nearbyPortal(scene, { x, y: portal.y - 2 }));
  for (let col = 0; col < width; col++)
    scene.collision[(wallY / step) * width + col] = 1;
  for (const speed of [scene.player.speed, scene.player.runSpeed]) {
    let p = { x, y: wallY - 16 };
    for (let i = 0; i < 200; i++)
      p = move(scene, p, { x: 0, y: 1 }, 0.05, speed);
    assert.ok(canStand(scene, p));
    assert.ok(p.y + scene.player.radius < wallY);
  }
  assert.equal(canStand(scene, { x: -1, y: 100 }), false);
  assert.equal(canStand(scene, { x: NaN, y: 100 }), false);
  const from = { x, y: wallY - 6 };
  assert.equal(hasLineOfSight(scene, from, portal), false);
  assert.equal(nearbyPortal(scene, from, 48), undefined);
});
