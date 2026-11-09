import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  photoProps,
  propFootprint,
  propPoint,
  roboticsLabProps,
  roboticsLabScene,
} from "../src/shared/photo-props.ts";
import { fitPhotoProps, photoPropArt } from "../scripts/photo-prop-art.ts";
import {
  insideLayoutPolygon,
  diagramPoint,
  supportHeightMeters,
} from "../src/shared/w1-layout.ts";
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
  return {
    ...scene,
    fixtureCollision: {
      ...scene.fixtureCollision!,
      runs: scene.fixtureCollision!.runs.slice(
        0,
        -empty.fixtureCollision!.runs.length,
      ),
    },
  };
}
test("photo equipment uses stable IDs in the W1 F6 user-marked eastern 6-1/6-2 area", () => {
  assert.equal(
    new Set(roboticsLabProps.map((p) => p.objectId)).size,
    roboticsLabProps.length,
  );
  const base = before();
  for (const p of photoProps(scene))
    for (const v of propFootprint(scene, p)) {
      assert.ok(
        scene.w1Layout!.openArea.some((poly) => insideLayoutPolygon(v, poly)),
        `${p.objectId} fits open lab`,
      );
      // Keep the full footprint inside the red-box target; checking only an
      // open floor would miss a mistaken move to another laboratory bay.
      const target = [
        [
          diagramPoint(scene, 654, 58),
          diagramPoint(scene, 732, 58),
          diagramPoint(scene, 732, 211),
          diagramPoint(scene, 654, 211),
        ],
      ];
      assert.ok(
        insideLayoutPolygon(v, target),
        p.objectId + " inside eastern 6-1/6-2 target",
      );
      assert.ok(
        canStand(base, v, 0.2),
        `${p.objectId} avoids fixed structures`,
      );
      assert.equal(
        supportHeightMeters(scene, v),
        supportHeightMeters(scene, p),
        `${p.objectId} sits on one support level`,
      );
    }
  for (const s of world.scenes.filter((s) => s.id !== scene.id))
    assert.equal(photoProps(s).length, 0);
});
test("robots and furniture remain grounded and solid after plan alignment", () => {
  const art = photoPropArt(scene, []),
    all = [...art.fixtures, ...art.floor];
  for (const p of photoProps(scene)) {
    const vs = all
        .filter((q) => q.node.startsWith(p.objectId + ":"))
        .flatMap((q) => q.vertices),
      base = supportHeightMeters(scene, p) * scene.units.pixelsPerMeter;
    assert.ok(vs.length > 8);
    assert.ok(Math.min(...vs.map((v) => v[2])) >= base);
    assert.ok(Math.min(...vs.map((v) => v[2])) - base < 0.3);
    assert.ok(
      Math.max(...vs.map((v) => v[2])) <=
        base + (p.height + 0.06) * scene.units.pixelsPerMeter,
      p.objectId,
    );
    if (p.collision) assert.equal(canStand(scene, p, 0.1), false);
  }
});
test("photo equipment leaves the reconfigured laboratory circulation connected", () => {
  const open = (s: SceneMap) =>
    doorCollision(s, new Set(s.doors?.map((d) => d.id)));
  const old = open(before()),
    next = open(scene),
    start = diagramPoint(scene, 450, 245),
    was = reachable(old, start),
    now = reachable(next, start);
  assert.ok(was.size > 0 && now.size > 0);
  for (const p of [
    ...scene.portals,
    ...(scene.doors ?? []).flatMap((d) => [d.inside, d.outside]),
  ])
    if (was.has(tileIndex(old, p)))
      assert.ok(
        now.has(tileIndex(next, p)),
        `retained connection ${JSON.stringify(p)}`,
      );
  for (const [x, y] of [
    [663, 145],
    [698, 220],
    [450, 245],
  ])
    assert.ok(
      now.has(tileIndex(next, diagramPoint(scene, x, y))),
      `equipment aisle ${x},${y}`,
    );
});
test("linked face-to-face booths follow the equipment bay east edge without a room wall", () => {
  const booths = photoProps(scene).filter((p) => p.kind === "booth"),
    a = diagramPoint(scene, 732, 60),
    b = diagramPoint(scene, 732, 140),
    dx = b.x - a.x,
    dy = b.y - a.y,
    len = Math.hypot(dx, dy);
  for (const [i, p] of booths.entries()) {
    const edge = propPoint(scene, p, 0, -p.depth / 2);
    assert.ok(Math.abs(dy * (edge.x - a.x) - dx * (edge.y - a.y)) / len < 3);
    if (i)
      assert.ok(
        Math.abs(
          Math.hypot(p.x - booths[i - 1].x, p.y - booths[i - 1].y) -
            p.width * scene.units.pixelsPerMeter,
        ) < 1e-6,
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
    346,
  );
});
