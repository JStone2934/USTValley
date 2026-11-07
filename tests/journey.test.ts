import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  advanceProgress,
  campusNpcs,
  canInteractWith,
  chestCooldown,
  newProgress,
  restoreProgress,
} from "../src/shared/journey";
import { ProgressStore, progressKey } from "../src/client/progress-store";
import { canStand, canTraverse, type WorldMap } from "../src/shared/world";
const world: WorldMap = JSON.parse(
  readFileSync(new URL("../public/maps/world.json", import.meta.url), "utf8"),
);
test("first campus loop settles rewards once and wardrobe ownership prevents double charges", () => {
  let p = newProgress();
  p = advanceProgress(p, { type: "talk", id: "lin" }, world).progress;
  p = advanceProgress(p, { type: "discover", id: "C2" }, world).progress;
  assert.equal(p.coins, 5);
  assert.equal(
    advanceProgress(p, { type: "discover", id: "C2" }, world).progress,
    p,
  );
  p = advanceProgress(
    p,
    { type: "chest", id: "chest_c2", now: 1000 },
    world,
  ).progress;
  assert.equal(p.coins, 30);
  assert.deepEqual(p.completed, ["first_walk", "first_chest"]);
  assert.equal(
    advanceProgress(p, { type: "chest", id: "chest_c2", now: 1000 }, world)
      .progress,
    p,
  );
  p = advanceProgress(
    p,
    { type: "wear", kind: "outfit", id: "moss" },
    world,
  ).progress;
  p = advanceProgress(
    p,
    { type: "wear", kind: "hat", id: "cap" },
    world,
  ).progress;
  assert.equal(p.coins, 0);
  assert.equal(p.hat, "cap");
  assert.equal(p.outfit, "moss");
  assert.equal(
    advanceProgress(p, { type: "wear", kind: "outfit", id: "lake" }, world)
      .progress,
    p,
  );
  assert.equal(
    advanceProgress(p, { type: "wear", kind: "hat", id: "cap" }, world).progress
      .coins,
    0,
  );
  const refreshed = advanceProgress(
    p,
    { type: "chest", id: "chest_c2", now: 1000 + chestCooldown },
    world,
  ).progress;
  assert.equal(refreshed.coins, 10);
  assert.equal(refreshed.chestsOpened, 2);
  assert.equal(
    advanceProgress(
      refreshed,
      { type: "chest", id: "invented", now: 1e12 },
      world,
    ).progress,
    refreshed,
  );
});
test("NPCs stand on connected paths clear of entrances, and interaction cannot cross walls", () => {
  const campus = world.scenes[0];
  for (const n of campusNpcs(world)) {
    assert.ok(canStand(campus, n));
    const anchor =
      n.id === "lin"
        ? campus.spawns[0]
        : campus.portals.find(
            (p) => p.id === (n.id === "yun" ? "enter_c7" : "enter_e1"),
          )!.spawn;
    assert.ok(canTraverse(campus, anchor, n));
    assert.ok(
      campus.portals.every(
        (p) =>
          Math.hypot(p.x - n.x, p.y - n.y) >
          campus.player.interactionRadius * 1.7,
      ),
    );
  }
  const tiny = {
    ...campus,
    width: 4,
    height: 4,
    tileSize: 4,
    collisionSize: 1,
    fixtureCollision: undefined,
    collision: Array(256).fill(0),
    player: { ...campus.player, radius: 0.1, interactionRadius: 6 },
  };
  for (let y = 0; y < 16; y++) tiny.collision[y * 16 + 8] = 1;
  assert.equal(canInteractWith(tiny, { x: 6, y: 8 }, { x: 10, y: 8 }), false);
  assert.equal(canInteractWith(tiny, { x: 6, y: 8 }, { x: 6, y: 11 }), true);
});
test("saved progress filters unknown content and unsafe positions without erasing valid ownership", () => {
  const raw = {
    ...newProgress(),
    coins: 25,
    discovered: ["C2", "C2", "FAKE"],
    ownedOutfits: ["moss"],
    outfit: "moss",
    hat: "beret",
    location: {
      sceneId: "campus_core",
      mapVersion: world.mapVersion,
      x: NaN,
      y: 0,
    },
  };
  const p = restoreProgress(raw, world);
  assert.deepEqual(p.discovered, ["C2"]);
  assert.equal(p.outfit, "moss");
  assert.equal(p.hat, "none");
  assert.equal(p.location, undefined);
  assert.equal(p.coins, 25);
  assert.deepEqual(restoreProgress({ schema: 2 }, world), newProgress());
});
test("auto-save survives reload and storage failure leaves play and rewards usable", () => {
  const records = new Map<string, string>();
  const storage = {
    getItem: (key: string) => records.get(key) ?? null,
    setItem: (key: string, value: string) => {
      records.set(key, value);
    },
  };
  const store = new ProgressStore(storage);
  store.init(world);
  store.act({ type: "discover", id: "C2" });
  store.locate(
    {
      ...world.scenes[0].spawns[0],
      sceneId: "campus_core",
      mapVersion: world.mapVersion,
    },
    true,
  );
  const restored = new ProgressStore(storage);
  restored.init(world);
  assert.equal(restored.snapshot.progress.coins, 5);
  assert.equal(
    restored.snapshot.progress.location?.x,
    world.scenes[0].spawns[0].x,
  );
  const failed = new ProgressStore({
    getItem: () => null,
    setItem: () => {
      throw new Error("quota");
    },
  });
  failed.init(world);
  failed.act({ type: "discover", id: "C2" });
  assert.equal(failed.snapshot.progress.coins, 5);
  assert.equal(failed.snapshot.saveError, true);
  records.set(progressKey, "bad json");
  const corrupt = new ProgressStore(storage);
  corrupt.init(world);
  assert.equal(corrupt.snapshot.progress.coins, 0);
  assert.equal(corrupt.snapshot.saveError, true);
});

test("a changed map keeps achievements but discards an old saved location", () => {
  const storage = {
    getItem: () => null,
    setItem: (_key: string, _value: string) => {},
  };
  const store = new ProgressStore(storage);
  store.init(world);
  store.act({ type: "discover", id: "C2" });
  store.locate(
    {
      ...world.scenes[0].spawns[0],
      sceneId: "campus_core",
      mapVersion: world.mapVersion,
    },
    true,
  );
  store.init({ ...world, mapVersion: "changed-map" });
  assert.equal(store.snapshot.progress.location, undefined);
  assert.equal(store.snapshot.progress.coins, 5);
  assert.deepEqual(store.snapshot.progress.discovered, ["C2"]);
});
