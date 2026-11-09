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
  const closedCampus = reachableWorld(world);
  const fromCampus = reachableWorld({
    ...world,
    scenes: world.scenes.map((s) =>
      doorCollision(s, new Set(s.doors?.map((d) => d.id))),
    ),
  });
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
      // W1's newly opened rooms can extend into preserved white regions.
      // Retained gates there still open and block locally, but their former
      // whole-room isolation is intentionally removed by the open layout.
      if (!scene.w1Layout?.openedRoomSourceIds.includes(door.sourceId))
        assert.ok(
          !closedCampus.get(scene.id)!.has(tileIndex(scene, door.inside)),
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
            Math.min(1, length - i) / 20,
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
      const forward = travel(door.outside, door.inside);
      assert.ok(
        Math.hypot(forward.x - door.inside.x, forward.y - door.inside.y) < 0.03,
        door.id,
      );
      const clearForClosing = (side: Point) =>
        distanceToLeaf(door, side) > scene.player.radius
          ? side
          : scene.spawns[0];
      assert.ok(toggleDoor(walk, door, open, clearForClosing(door.inside)));
      assert.ok(nearbyDoors(walk, door.inside).includes(door), door.id);
      assert.ok(toggleDoor(walk, door, open, door.inside));
      const back = travel(door.inside, door.outside);
      assert.ok(
        Math.hypot(back.x - door.outside.x, back.y - door.outside.y) < 0.03,
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

test("a wall touching a grid corner does not erase the surveyed opening beside it", () => {
  for (const id of [
    "door_interior_c3_24060_1",
    "door_interior_c7_47554_0",
    "door_interior_activity_f2_71211_0",
    "door_interior_library_f2_141197_0",
  ]) {
    const scene = world.scenes.find((s) => s.doors?.some((d) => d.id === id));
    assert.ok(scene, `missing source opening ${id}`);
    const door = scene.doors!.find((d) => d.id === id)!;
    assert.equal(door.openingSource, "wall-ends");
    const open = new Set<string>();
    const walk = doorCollision(scene, open);
    assert.ok(toggleDoor(walk, door, open, door.outside));
    const delta = {
      x: door.inside.x - door.outside.x,
      y: door.inside.y - door.outside.y,
    };
    const length = Math.hypot(delta.x, delta.y);
    let feet = door.outside;
    for (let step = 0; step < length; step++)
      feet = move(walk, feet, delta, 0.05, 20);
    assert.deepEqual(feet, door.inside, id);
  }
});

test("all door lanes support walking and running both ways at variable frame rates", () => {
  for (const scene of world.scenes)
    for (const door of scene.doors ?? []) {
      const open = doorCollision(scene, new Set([door.id]));
      for (const lane of [door, ...(door.lanes ?? [])])
        for (const [from, to] of [
          [lane.outside, lane.inside],
          [lane.inside, lane.outside],
        ])
          for (const dt of [1 / 60, 0.05, 0.1])
            for (const speed of [scene.player.speed, scene.player.runSpeed]) {
              const input = { x: to.x - from.x, y: to.y - from.y };
              const duration = Math.hypot(input.x, input.y) / speed;
              let p = from;
              for (let t = 0; t < duration - 1e-8; t += dt)
                p = move(open, p, input, Math.min(dt, duration - t), speed);
              assert.ok(
                Math.hypot(p.x - to.x, p.y - to.y) < 0.03,
                `${door.id} dt=${dt} speed=${speed}`,
              );
            }
    }
});

test("E3 F4 room 403 connects through the two surveyed 401 meeting room doors", () => {
  const scene = world.scenes.find((s) => s.id === "interior_east_f4")!;
  const meeting = scene.doors!.filter((d) => d.sourceId === 382479);
  const office = scene.doors!.find((d) => d.sourceId === 382471)!;
  assert.equal(meeting.length, 2);
  assert.ok(office);
  for (const d of [...meeting, office])
    assert.equal(d.openingSource, "wall-ends");
  const closed = reachableWorld(world).get(scene.id)!;
  assert.ok(!closed.has(tileIndex(scene, office.outside)));
  const connected = reachableWorld({
    ...world,
    scenes: world.scenes.map((s) =>
      s === scene ? doorCollision(s, new Set(meeting.map((d) => d.id))) : s,
    ),
  }).get(scene.id)!;
  assert.ok(connected.has(tileIndex(scene, office.outside)));
  assert.ok(!connected.has(tileIndex(scene, office.inside)));
});
