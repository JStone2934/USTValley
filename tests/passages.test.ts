import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import type { WorldMap } from "../src/shared/world.ts";
import {
  passageLabel,
  passageMarkers,
  visibleFloorPlan,
} from "../src/shared/passages.ts";

const world = JSON.parse(
  readFileSync(new URL("../public/maps/world.json", import.meta.url), "utf8"),
) as WorldMap;

test("a shared stair landing shows both ascending and descending destinations", () => {
  const middle = world.scenes.find((s) => s.id === "interior_library_f2")!;
  const up = middle.portals.find(
    (p) => p.kind === "stairs" && p.targetScene === "interior_library_f3",
  )!;
  const down = middle.portals.find(
    (p) =>
      p.kind === "stairs" &&
      p.x === up.x &&
      p.y === up.y &&
      p.targetScene === "interior_c7",
  )!;
  assert.equal(passageLabel(world, middle, up), "楼梯 ↑ 上楼至 F3");
  assert.equal(passageLabel(world, middle, down), "楼梯 ↓ 下楼至 F1");
  const marker = passageMarkers(world, middle).find(
    (m) => m.kind === "stairs" && m.x === up.x && m.y === up.y,
  )!;
  assert.deepEqual(new Set(marker.portalIds), new Set([up.id, down.id]));
  assert.deepEqual(new Set(marker.destinations), new Set(["↑ F3", "↓ F1"]));
});

test("indoor floor plans ignore a stale preview and track the avatar across floor changes", () => {
  const f1 = world.scenes.find((s) => s.id === "interior_c2")!;
  const f2 = world.scenes.find((s) => s.id === "interior_activity_f2")!;
  assert.equal(visibleFloorPlan(world, f2.id, f1.id), f2);
  assert.equal(visibleFloorPlan(world, f1.id, f2.id), f1);
  assert.equal(visibleFloorPlan(world, "campus_core", f2.id), f2);
  for (const floor of [f1, f2])
    assert.ok(floor.surfaces.every((s) => s.sourceFloor === floor.floor.key));
});
