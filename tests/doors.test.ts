import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { buildWorld, tiledMap } from "../scripts/map-builder.ts";
import { layers } from "../scripts/source-geometry.ts";
import { doorCollision, nearbyDoors, toggleDoor } from "../src/shared/doors.ts";
import {
  canStand,
  move,
  reachableWorld,
  tileIndex,
  type Point,
} from "../src/shared/world.ts";

const bytes = readFileSync(
  new URL("../data/maps/all-maps.json", import.meta.url),
);
const sources = JSON.parse(String(bytes)),
  { world } = buildWorld(sources, bytes);
test("source room doors are reachable from the campus, isolate their rooms when closed, and support a physical round trip", () => {
  const fromCampus = reachableWorld(world);
  let count = 0;
  for (const scene of world.scenes) {
    const publicSpace = fromCampus.get(scene.id)!;
    const features = new Map(
      layers(sources[scene.sourceMap], scene.floor.key).flatMap((l) =>
        (l.data?.features ?? []).map((f) => [f.properties.id, f] as const),
      ),
    );
    const doors = scene.doors ?? [];
    assert.equal(new Set(doors.map((d) => d.id)).size, doors.length);
    const exported = tiledMap(scene, world.mapVersion).layers.find(
      (l) => l.name === "doors",
    );
    assert.equal(exported?.objects?.length ?? 0, doors.length);
    const open = new Set<string>(),
      walk = doorCollision(scene, open);
    for (const door of doors) {
      count++;
      const f = features.get(door.sourceId);
      assert.ok(f?.properties.entry?.length, door.id);
      assert.ok(
        Math.hypot(door.x - door.sourceEntry.x, door.y - door.sourceEntry.y) <=
          1.55 * scene.units.pixelsPerMeter + 1e-5,
      );
      assert.ok(publicSpace.has(tileIndex(scene, door.outside)), door.id);
      assert.ok(
        !publicSpace.has(tileIndex(scene, door.inside)),
        `closed room has a bypass: ${door.id}`,
      );
      assert.ok(nearbyDoors(walk, door.outside).includes(door));
      const travel = (from: Point, to: Point) => {
        const delta = { x: to.x - from.x, y: to.y - from.y },
          length = Math.hypot(delta.x, delta.y);
        let p = from;
        for (let i = 0; i < length; i++)
          p = move(
            walk,
            p,
            { x: delta.x / length, y: delta.y / length },
            0.05,
            20,
          );
        return p;
      };
      assert.notDeepEqual(travel(door.outside, door.inside), door.inside);
      assert.ok(toggleDoor(walk, door, open, door.outside));
      assert.equal(
        toggleDoor(walk, door, open, door),
        false,
        "cannot close onto the avatar",
      );
      assert.deepEqual(travel(door.outside, door.inside), door.inside, door.id);
      assert.ok(toggleDoor(walk, door, open, door.inside));
      assert.ok(nearbyDoors(walk, door.inside).includes(door), door.id);
      assert.ok(toggleDoor(walk, door, open, door.inside));
      assert.deepEqual(
        travel(door.inside, door.outside),
        door.outside,
        door.id,
      );
      assert.ok(toggleDoor(walk, door, open, door.outside));
      assert.equal(canStand(scene, door), false);
    }
  }
  assert.ok(count > 100, "cover source-supported rooms across the campus");
});
