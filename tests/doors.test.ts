import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { buildWorld, tiledMap } from "../scripts/map-builder.ts";
import { layers } from "../scripts/source-geometry.ts";
import {
  distanceToLeaf,
  doorCollision,
  nearbyDoors,
  toggleDoor,
} from "../src/shared/doors.ts";
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
        door.hinge && door.latch,
        "missing surveyed or inferred jambs: " + door.id,
      );
      assert.ok(
        Math.hypot(
          door.x - (door.hinge.x + door.latch.x) / 2,
          door.y - (door.hinge.y + door.latch.y) / 2,
        ) < 0.02,
        door.id,
      );
      // The entry record marks an approach. The collision opening must still
      // be fitted locally even when the actual sill is offset from its grid cell.
      const first = door.cells[0],
        width = (scene.width * scene.tileSize) / scene.collisionSize;
      const firstX = ((first % width) + 0.5) * scene.collisionSize;
      const firstY = (Math.floor(first / width) + 0.5) * scene.collisionSize;
      assert.ok(
        Math.hypot(firstX - door.sourceEntry.x, firstY - door.sourceEntry.y) <=
          1.55 * scene.units.pixelsPerMeter + 1e-5,
        door.id,
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
      const clearForClosing = (side: Point) =>
        distanceToLeaf(door, side) > scene.player.radius
          ? side
          : scene.spawns[0];
      assert.ok(toggleDoor(walk, door, open, clearForClosing(door.inside)));
      assert.ok(nearbyDoors(walk, door.inside).includes(door), door.id);
      assert.ok(toggleDoor(walk, door, open, door.inside));
      assert.deepEqual(
        travel(door.inside, door.outside),
        door.outside,
        door.id,
      );
      assert.ok(toggleDoor(walk, door, open, clearForClosing(door.outside)));
      assert.ok(door.cells.every((cell) => scene.collision[cell] === 1));
    }
  }
  assert.ok(count > 100, "cover source-supported rooms across the campus");
});

test("C2 and library leaves meet the measured wall end faces; the widened C2 gate retains its masonry corner", () => {
  for (const [id, sourceId] of [
    ["interior_c2", 71686],
    ["interior_library_f2", 141190],
  ] as const) {
    const scene = world.scenes.find((s) => s.id === id)!;
    const door = scene.doors!.find(
      (d) => d.sourceId === sourceId && d.id.endsWith("_0"),
    )!;
    assert.equal(door.openingSource, "wall-ends");
    const ends = scene.surfaces
      .filter((s) => s.kind === "wall")
      .flatMap((s) =>
        s.polygons.flatMap((p) =>
          p.flatMap((r) =>
            r.slice(1).map((b, i) => ({
              x: (r[i].x + b.x) / 2,
              y: (r[i].y + b.y) / 2,
            })),
          ),
        ),
      );
    for (const jamb of [door.hinge!, door.latch!]) {
      assert.ok(
        ends.some((p) => Math.hypot(jamb.x - p.x, jamb.y - p.y) < 0.01),
        door.id,
      );
    }
    const span = Math.hypot(
      door.latch!.x - door.hinge!.x,
      door.latch!.y - door.hinge!.y,
    );
    if (id === "interior_c2") {
      assert.ok(span / scene.units.pixelsPerMeter > 1.7);
      assert.ok(door.lanes!.some((l) => l.inside.x < door.inside.x - 3));
      const walk = doorCollision(scene, new Set([door.id]));
      const wallCorner = { x: 168, y: 144.8 };
      assert.ok(
        canStand({ ...walk, fixtureCollision: undefined }, wallCorner, 0),
      );
      assert.equal(canStand(walk, wallCorner, 0), false);
      assert.ok(canStand(walk, { x: 170.5, y: 146 }));
    } else {
      assert.ok(
        span / scene.units.pixelsPerMeter > 0.9 &&
          span / scene.units.pixelsPerMeter < 1,
      );
    }
  }
});
