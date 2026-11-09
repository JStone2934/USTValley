import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  photoProps,
  propFootprint,
  propPoint,
  roboticsLabProps,
  roboticsLabScene,
  roboticsLabSource,
} from "../src/shared/photo-props.ts";
import { fitPhotoProps, photoPropArt } from "../scripts/photo-prop-art.ts";
import { inPolygon } from "../scripts/source-geometry.ts";
import {
  canStand,
  reachable,
  tileIndex,
  type SceneMap,
  type WorldMap,
} from "../src/shared/world.ts";
import { doorCollision } from "../src/shared/doors.ts";
const world = JSON.parse(
  readFileSync(new URL("../public/maps/world.json", import.meta.url), "utf8"),
) as WorldMap;
const scene = world.scenes.find((s) => s.id === roboticsLabScene)!;
function before() {
  const empty: SceneMap = { ...scene, fixtureCollision: undefined };
  fitPhotoProps(empty);
  const count = empty.fixtureCollision!.runs.length;
  return {
    ...scene,
    fixtureCollision: {
      ...scene.fixtureCollision!,
      runs: scene.fixtureCollision!.runs.slice(0, -count),
    },
  };
}
test("photo instances stay on W1 F6, inside the annotated laboratory, with stable identities", () => {
  assert.equal(
    new Set(roboticsLabProps.map((p) => p.objectId)).size,
    roboticsLabProps.length,
  );
  const room = scene.surfaces.find((s) => s.sourceId === roboticsLabSource)!;
  const base = before();
  for (const p of photoProps(scene)) {
    assert.ok(
      room.polygons.some((poly) => inPolygon(p, poly)),
      p.objectId,
    );
    for (const v of propFootprint(scene, p)) {
      assert.ok(
        room.polygons.some((poly) => inPolygon(v, poly)),
        `${p.objectId} fits room`,
      );
      assert.ok(
        p.kind === "booth" || canStand(base, v, 0.2),
        `${p.objectId} avoids existing walls and fixtures at ${JSON.stringify(v)}`,
      );
    }
  }
  for (const s of world.scenes.filter((s) => s.id !== scene.id))
    assert.equal(photoProps(s).length, 0);
});
test("robots, furniture and rigs have volume, support and correctly scoped collision", () => {
  const art = photoPropArt(scene, []),
    all = [...art.fixtures, ...art.floor];
  for (const p of photoProps(scene)) {
    const vs = all
      .filter((q) => q.node.startsWith(p.objectId + ":"))
      .flatMap((q) => q.vertices);
    assert.ok(vs.length > 8, p.objectId);
    assert.ok(Math.min(...vs.map((v) => v[2])) >= 0, p.objectId + " grounded");
    assert.ok(
      Math.min(...vs.map((v) => v[2])) < 0.3,
      p.objectId + " attached to floor",
    );
    assert.ok(
      Math.max(...vs.map((v) => v[2])) <=
        (p.height + 0.06) * scene.units.pixelsPerMeter,
      p.objectId + " height",
    );
    if (p.collision)
      assert.equal(canStand(scene, p, 0.1), false, p.objectId + " solid");
  }
  assert.ok(canStand(scene, { x: 590, y: 1100 }), "viewing aisle");
});
test("new lab objects retain every existing entrance and connected walking route", () => {
  const base = before();
  const open = (s: SceneMap) =>
    doorCollision(s, new Set(s.doors?.map((d) => d.id)));
  const old = open(base),
    next = open(scene),
    start = { x: 615.57, y: 1048.63 };
  assert.ok(canStand(old, start));
  assert.ok(canStand(next, start));
  const was = reachable(old, start),
    now = reachable(next, start);
  const points = [
    ...scene.portals,
    ...(scene.doors ?? []).flatMap((d) => [d.inside, d.outside]),
  ].filter(Boolean);
  for (const p of points)
    if (was.has(tileIndex(old, p)))
      assert.ok(
        now.has(tileIndex(next, p)),
        `entry remains reachable ${JSON.stringify(p)}`,
      );
  for (const p of [
    { x: 590, y: 1100 },
    { x: 600, y: 1130 },
    { x: 540, y: 1100 },
  ])
    assert.ok(now.has(tileIndex(next, p)), `lab aisle ${JSON.stringify(p)}`);
});

test("east-wall booths form a connected face-to-face row and the mat follows that wall", () => {
  const booths = photoProps(scene).filter((p) => p.kind === "booth");
  const wallA = { x: 641.48, y: 1028.76 },
    wallB = { x: 667.27, y: 1132.11 };
  const dx = wallB.x - wallA.x,
    dy = wallB.y - wallA.y,
    len = Math.hypot(dx, dy);
  const walls = scene.surfaces.filter((s) => s.kind === "wall");
  for (const [i, p] of booths.entries()) {
    assert.ok(
      Math.abs(p.rotationDegrees - (Math.atan2(dy, dx) * 180) / Math.PI) < 0.1,
    );
    const edge = propPoint(scene, p, 0, -p.depth / 2);
    const gap =
      Math.abs(dy * (edge.x - wallA.x) - dx * (edge.y - wallA.y)) / len;
    assert.ok(gap < 0.6, "booth rear is within 10 cm of east wall");
    // Source collision uses coarse cells. Wall-adjacent furniture is checked
    // against the actual surveyed wall polygons, at 5 cm sampling resolution.
    for (let x = -p.width / 2; x <= p.width / 2; x += 0.05)
      for (let y = -p.depth / 2; y <= p.depth / 2; y += 0.05) {
        const q = propPoint(scene, p, x, y);
        assert.ok(
          !walls.some((w) => w.polygons.some((poly) => inPolygon(q, poly))),
          "booth does not penetrate wall",
        );
      }
    if (i)
      assert.ok(
        Math.abs(
          Math.hypot(p.x - booths[i - 1].x, p.y - booths[i - 1].y) -
            p.width * scene.units.pixelsPerMeter,
        ) < 0.001,
        "adjacent bays touch",
      );
    const mesh = photoPropArt(scene, []).fixtures.filter((q) =>
      q.node.startsWith(p.objectId + ":"),
    );
    assert.equal(
      mesh.filter((q) => q.node.endsWith(":facing-cushion")).length,
      2,
    );
    assert.equal(mesh.filter((q) => q.node.endsWith(":facing-back")).length, 2);
    assert.equal(
      mesh.filter((q) => q.node.endsWith(":shared-table")).length,
      1,
    );
  }
  assert.equal(
    photoProps(scene).find((p) => p.kind === "mat")!.rotationDegrees,
    booths[0].rotationDegrees,
  );
});
