import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import config from "../content/map-config.json";
import { buildWorld, tiledMap, type Sources } from "../scripts/map-builder.ts";
import { crossedEntrance } from "../src/shared/automatic-doors.ts";
import { canStand, move, project, type Point } from "../src/shared/world.ts";
const bytes = readFileSync(
  new URL("../data/maps/all-maps.json", import.meta.url),
);
const sources = JSON.parse(bytes.toString()) as Sources;
const { world, report } = buildWorld(sources, bytes),
  campus = world.scenes[0];
const dist = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);

test("each exterior model opening is paired with its own surveyed F1 boundary and footprint", () => {
  assert.equal(report.exteriorEntrances.length, 47);
  assert.equal(
    report.exteriorEntrances.flatMap((g) => g.modelIndices).length,
    48,
  );
  assert.equal(campus.portals.length, 47);
  for (const gate of report.exteriorEntrances) {
    assert.ok(gate.accepted && gate.inside && gate.outside);
    const group = config.groups.find((g) => g.key === gate.group)!;
    const r = sources[group.sourceMap].map.mapinfo.regions.find(
      (r) => r.region === 0,
    )!.entries![gate.regionIndex];
    assert.deepEqual(gate.sourceEntry, [r.in.x, r.in.y]);
    const p = project(gate.sourceEntry, config.transform);
    p.x += campus.sourceOffset.x;
    p.y += campus.sourceOffset.y;
    const portal = campus.portals.toSorted(
      (a, b) => dist(a.entrance!.threshold, p) - dist(b.entrance!.threshold, p),
    )[0];
    assert.ok(
      dist(portal.entrance!.threshold, p) < 0.65 * campus.units.pixelsPerMeter,
    );
    const destination = world.scenes.find((s) => s.id === portal.targetScene)!;
    assert.equal(destination.sourceMap, group.sourceMap);
    assert.equal(destination.floor.key, "0");
    const interior = destination.portals.find(
      (i) => i.id === portal.targetPortal,
    )!;
    assert.ok(
      dist(interior.entrance!.toward, {
        x: -portal.entrance!.toward.x,
        y: -portal.entrance!.toward.y,
      }) < 0.01,
    );
  }
  assert.deepEqual(
    report.exteriorEntrances.flatMap((g) => (g.office ? [g.office] : [])),
    [
      { roomId: 39883, walkRoadId: 660 },
      { roomId: 11576, walkRoadId: 785 },
    ],
  );
  const lib = campus.portals.filter((p) => p.buildingId === "C7");
  assert.deepEqual(
    lib.map((p) => p.entrance!.glazing!.sourceId).sort(),
    [47050, 47051, 47052, 47082, 47083, 47085],
  );
  assert.equal(campus.portals.filter((p) => p.buildingId === "C2").length, 3);
});

test("walking from each side of all 47 entrances crosses its exact line, and walking away never re-enters", () => {
  let crossings = 0;
  for (const scene of world.scenes)
    for (const gate of scene.portals) {
      if (gate.kind !== "entrance") continue;
      const { toward: n, width } = gate.entrance!;
      assert.ok(
        Math.abs(Math.hypot(n.x, n.y) - 1) < 1e-8 && width > scene.player.width,
      );
      const { threshold } = gate.entrance!;
      const dot =
        (gate.spawn.x - threshold.x) * n.x + (gate.spawn.y - threshold.y) * n.y;
      assert.ok(
        dot < -scene.units.pixelsPerMeter,
        `arrival is on approach side of ${gate.id}`,
      );
      assert.ok(canStand(scene, gate.spawn));
      let from = gate.spawn,
        hit;
      for (let tick = 0; tick < 240 && !hit; tick++) {
        const to = move(scene, from, n, 1 / 120);
        if (dist(to, from) < 1e-6) break;
        hit = crossedEntrance(scene, from, to);
        from = to;
      }
      assert.equal(hit?.id, gate.id, `cannot walk through ${gate.id}`);
      const depth = (from.x - threshold.x) * n.x + (from.y - threshold.y) * n.y;
      assert.ok(
        Math.abs(depth) <= scene.player.radius,
        `only a foot touching the physical sill transfers at ${gate.id}`,
      );
      assert.equal(
        crossedEntrance(
          scene,
          gate.spawn,
          move(scene, gate.spawn, { x: -n.x, y: -n.y }, 0.1),
        ),
        undefined,
      );
      crossings++;
    }
  assert.equal(crossings, 94);
});

test("Tiled glass jambs and widths use native image coordinates while the entrance normal remains unit length", () => {
  const portal = campus.portals.find((p) => p.id === "enter_c7")!,
    d = portal.entrance!,
    ratio = campus.art.pixelRatio!;
  const object = tiledMap(campus, world.mapVersion)
    .layers.find((l) => l.name === "portals")
    .objects.find((o: { name: string }) => o.name === portal.id);
  const field = JSON.parse(
    object.properties.find((p: { name: string }) => p.name === "entrance")
      .value,
  );
  const scaled = (p: Point) => ({ x: p.x * ratio, y: p.y * ratio });
  assert.deepEqual(field.threshold, scaled(d.threshold));
  assert.equal(field.width, d.width * ratio);
  assert.deepEqual(field.toward, d.toward);
  assert.deepEqual(field.glazing, {
    sourceId: d.glazing!.sourceId,
    jambA: scaled(d.glazing!.jambA),
    jambB: scaled(d.glazing!.jambB),
  });
});

test("Tiled scales both absolute feet of each room-door lane and both jambs", () => {
  const scene = world.scenes.find((s) => s.doors?.length)!,
    door = scene.doors![0];
  const lanes = [{ outside: door.outside, inside: door.inside }],
    ratio = scene.art.pixelRatio!;
  const testScene = {
    ...scene,
    doors: [{ ...door, hinge: door.outside, latch: door.inside, lanes }],
  };
  const object = tiledMap(testScene, world.mapVersion).layers.find(
    (l) => l.name === "doors",
  ).objects[0];
  const values = Object.fromEntries(
    object.properties.map((p: { name: string; value: string }) => [
      p.name,
      p.value,
    ]),
  );
  const scaled = (p: Point) => ({ x: p.x * ratio, y: p.y * ratio });
  assert.deepEqual(JSON.parse(values.hinge), scaled(door.outside));
  assert.deepEqual(JSON.parse(values.latch), scaled(door.inside));
  assert.deepEqual(JSON.parse(values.lanes), [
    { outside: scaled(door.outside), inside: scaled(door.inside) },
  ]);
});

test("feet reaching either clear edge of an entrance also transfer", () => {
  let edges = 0;
  for (const scene of world.scenes) {
    const r = scene.player.radius;
    for (const gate of scene.portals) {
      if (!gate.entrance) continue;
      const { threshold: sill, toward: n, width } = gate.entrance;
      for (const side of [-1, 1]) {
        const b = side * (width / 2 - r * 0.5);
        const start = {
          x: sill.x - n.x * r - n.y * b,
          y: sill.y - n.y * r + n.x * b,
        };
        const end = { x: start.x + n.x * r, y: start.y + n.y * r };
        if (!canStand(scene, start) || !canStand(scene, end)) continue;
        assert.equal(crossedEntrance(scene, start, end)?.id, gate.id);
        edges++;
      }
    }
  }
  assert.ok(
    edges > 10,
    "exercised off-centre foot crossings through real apertures",
  );
});
