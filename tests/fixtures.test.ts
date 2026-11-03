import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { buildWorld, tiledMap } from "../scripts/map-builder.ts";
import {
  canStand,
  move,
  reachableWorld,
  tileIndex,
} from "../src/shared/world.ts";
import { inPolygon } from "../scripts/source-geometry.ts";
import { doorCollision } from "../src/shared/doors.ts";

const bytes = readFileSync(
    new URL("../data/maps/all-maps.json", import.meta.url),
  ),
  { world, report } = buildWorld(JSON.parse(String(bytes)), bytes);
test("library shelves and seat rows use their source plan footprints, leaving the aisle open", () => {
  const scene = world.scenes.find((s) => s.id === "interior_library_f2")!;
  const shelf = scene.surfaces.find(
    (s) => s.sourceLayer === "书柜" && s.sourceId === 143663,
  )!;
  const wood = { x: 85.5, y: 78.5 },
    aisle = { x: 94, y: 78 };
  assert.ok(inPolygon(wood, shelf.polygons[0]));
  assert.ok(canStand({ ...scene, fixtureCollision: undefined }, wood));
  assert.equal(canStand(scene, wood), false);
  assert.ok(canStand(scene, aisle));
  const allOpen = doorCollision(scene, new Set(scene.doors!.map((d) => d.id)));
  assert.equal(canStand(allOpen, wood), false);
  let p = aisle;
  for (let i = 0; i < 20; i++)
    p = move(allOpen, p, { x: -1, y: 0 }, 0.1, scene.player.runSpeed);
  assert.ok(p.x > 89 && p.x < 91, String(p.x));
  assert.ok(reachableWorld(world).get(scene.id)?.has(tileIndex(scene, aisle)));
  const library = world.scenes.filter((s) => s.sourceMap === scene.sourceMap);
  let shelves = 0,
    seating = 0;
  for (const s of library) {
    const ids = new Set(s.fixtureCollision?.sourceIds);
    for (const f of s.surfaces) {
      if (f.sourceLayer !== "书柜" && f.sourceLayer !== "座位") continue;
      if (f.kind !== "detail" || !f.polygons.length) continue;
      assert.ok(ids.has(f.sourceId), `${s.id}:${f.sourceId}`);
      if (f.sourceLayer === "书柜") shelves++;
      else seating++;
    }
    const exported = tiledMap(s, world.mapVersion).layers.find(
      (l) => l.name === "fixture_collision",
    );
    if (ids.size) assert.ok(exported?.objects.length >= ids.size);
  }
  assert.equal(shelves, 677);
  assert.equal(seating, 170);
  assert.ok(
    report.fixtureOccupancy.every((r) => r.conflictingSourceIds.length === 0),
  );
});
