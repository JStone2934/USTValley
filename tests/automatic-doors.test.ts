import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  approachedRoomDoor,
  clearOfDoor,
  crossedEntrance,
  facesEntrance,
} from "../src/shared/automatic-doors.ts";
import { doorCollision, toggleDoor } from "../src/shared/doors.ts";
import {
  canStand,
  move,
  type Point,
  type WorldMap,
} from "../src/shared/world.ts";

const world: WorldMap = JSON.parse(
  readFileSync(new URL("../public/maps/world.json", import.meta.url), "utf8"),
);
test("every published leaf opens automatically from both navigable sides", () => {
  for (const source of world.scenes) {
    const opened = new Set<string>();
    const scene = doorCollision(source, opened);
    for (const door of scene.doors ?? []) {
      const crossings = [door, ...(door.lanes ?? [])].flatMap((lane) => [
        [lane.outside, lane.inside], [lane.inside, lane.outside],
      ]);
      for (const [start, end] of crossings) {
        const motion = { x: end.x - start.x, y: end.y - start.y };
        const length = Math.hypot(motion.x, motion.y);
        const direction = { x: motion.x / length, y: motion.y / length };
        assert.equal(
          approachedRoomDoor(scene, start, { x: 0, y: 0 }),
          undefined,
        );
        assert.equal(clearOfDoor(scene, door, start), false);
        let feet = start;
        for (let step = 0; step < Math.ceil(length); step++) {
          const approaching = approachedRoomDoor(scene, feet, direction);
          if (approaching && !opened.has(approaching.id))
            toggleDoor(scene, approaching, opened, feet);
          feet = move(scene, feet, direction, 0.05, 20);
        }
        assert.ok(
          opened.has(door.id),
          door.id + " failed to open from " + JSON.stringify(start),
        );
        assert.ok(
          Math.hypot(feet.x - end.x, feet.y - end.y) < 1.01,
          "failed to cross " + door.id,
        );
        assert.ok(
          toggleDoor(scene, door, opened, scene.spawns[0]),
          "failed to close " + door.id,
        );
        assert.equal(source.collision[door.cells[0]], 1);
      }
    }
  }
});

test("building doors trigger only while approaching their accessible threshold", () => {
  for (const scene of world.scenes) {
    for (const p of scene.portals.filter((p) => p.kind === "entrance")) {
      assert.ok(p.entrance, p.id);
      const { toward: n, threshold, width } = p.entrance;
      const side =
        -(p.spawn.x - threshold.x) * n.y + (p.spawn.y - threshold.y) * n.x;
      const offset = (a: number, b: number): Point => ({
        x: threshold.x + a * n.x - b * n.y,
        y: threshold.y + a * n.y + b * n.x,
      });
      const before = offset(-scene.player.radius, side),
        end = offset(0, side);
      assert.ok(canStand(scene, before), "no navigable approach to " + p.id);
      assert.equal(crossedEntrance(scene, before, end)?.id, p.id);
      assert.equal(crossedEntrance(scene, end, before), undefined);
      assert.equal(crossedEntrance(scene, before, before), undefined);
      assert.equal(
        crossedEntrance(scene, offset(0, -1), offset(0, 1)),
        undefined,
      );
      for (const missed of [-width, width]) {
        assert.equal(
          crossedEntrance(
            scene,
            offset(-scene.player.radius, missed),
            offset(0, missed),
          ),
          undefined,
        );
        assert.equal(
          facesEntrance(scene, offset(-scene.player.radius, missed), p),
          false,
        );
      }
      assert.equal(
        crossedEntrance(
          scene,
          offset(-1.2 * scene.units.pixelsPerMeter, side),
          offset(-0.45 * scene.units.pixelsPerMeter, side),
        ),
        undefined,
      );
      assert.equal(facesEntrance(scene, before, p), true);
    }
  }
});
