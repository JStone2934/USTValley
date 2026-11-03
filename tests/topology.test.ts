import sharp from "sharp";
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import config from "../content/map-config.json";
import { buildWorld, tiledMap } from "../scripts/map-builder.ts";
import {
  inPolygon,
  walkPassages,
  type Sources,
} from "../scripts/source-geometry.ts";
import {
  canStand,
  move,
  project,
  reachable,
  reachableWorld,
  tileIndex,
  type Point,
} from "../src/shared/world.ts";

const bytes = readFileSync(
  new URL("../data/maps/all-maps.json", import.meta.url),
);
const sources = JSON.parse(bytes.toString()) as Sources;
const { world, report } = buildWorld(sources, bytes);

test("every core source floor is reconstructed with source names and elevations", () => {
  for (const group of config.groups) {
    const source = sources[group.sourceMap];
    for (const [floor, sourceLayers] of Object.entries(source.map.mapdata)) {
      const scenes = world.scenes.filter(
        (s) => s.sourceMap === group.sourceMap && s.floor.key === floor,
      );
      assert.ok(scenes.length, `${group.key}:${floor}`);
      const metadata = source.map.mapinfo.regions.find(
        (r) => String(r.region) === floor,
      )!;
      for (const scene of scenes) {
        assert.equal(scene.floor.name, metadata.name);
        assert.equal(scene.floor.elevation, metadata.z);
        for (const surface of scene.surfaces) {
          assert.equal(surface.sourceFloor, floor);
          assert.equal(surface.sourceMap, group.sourceMap);
          assert.ok(
            surface.sourceLayer === "walk-passages" ||
              Object.values(sourceLayers).some(
                (l) => l.name === surface.sourceLayer,
              ),
          );
        }
        assert.ok(scene.art.layers.some((l) => l.id === "passages"));
      }
    }
  }
  assert.equal(report.checks.sourceFloors, 32); // campus plus 31 indoor source planes
  assert.equal(world.scenes.length, 34); // two pairs of physically separate F1 wings
});

test("all source floor links retain type, direction, road ID and bounded landing offsets", () => {
  const connected = reachableWorld(world);
  assert.equal(report.connections.length, 393);
  assert.ok(report.connections.every((c) => c.accepted));
  const kinds = new Set<string>();
  for (const c of report.connections) {
    const road = sources[c.sourceMap].road.roads["-10000"][c.roadId];
    assert.equal(c.kind, road.type);
    assert.ok(c.offsets!.every((v) => v >= 0 && v <= 24));
    const endpoints = world.scenes.flatMap((scene) =>
      scene.sourceMap === c.sourceMap
        ? scene.portals
            .filter((p) => p.sourceRoadId === c.roadId)
            .map((portal) => ({ scene, portal }))
        : [],
    );
    assert.equal(endpoints.length, 2);
    for (const { scene, portal } of endpoints) {
      assert.equal(portal.kind, c.kind);
      assert.ok(connected.get(scene.id)!.has(tileIndex(scene, portal)));
      const target = world.scenes.find((s) => s.id === portal.targetScene)!;
      assert.notEqual(scene.floor.key, target.floor.key);
      assert.match(portal.label, new RegExp(target.floor.name));
      kinds.add(portal.kind);
    }
  }
  assert.deepEqual([...kinds].sort(), ["escalator", "lift", "stairs"]);
});

test("building numbers in the same physical F1 wing share entrances and circulation", () => {
  const target = (id: string) =>
    world.scenes[0].portals.find((p) => p.buildingId === id)!.targetScene;
  assert.equal(target("E1"), target("E2"));
  assert.equal(target("C3"), target("C6"));
  assert.notEqual(target("E1"), target("E3"));
  const academic = world.scenes.find((s) => s.id === target("C3"))!;
  assert.equal(academic.exploration.length, 4);
  assert.equal(
    academic.portals.filter((p) => p.kind === "entrance").length,
    13,
  );
});

test("polygon and multi-polygon navigation preserve courtyard holes and reject missing vertices", () => {
  const source = {
    road: {
      points: {
        1: { x: 0, y: 0 },
        2: { x: 20, y: 0 },
        3: { x: 20, y: 20 },
        4: { x: 0, y: 20 },
        5: { x: 5, y: 5 },
        6: { x: 15, y: 5 },
        7: { x: 15, y: 15 },
        8: { x: 5, y: 15 },
      },
      roads: {
        0: {
          1: {
            mode: ["walk"],
            geometry: "multi-polygon",
            vertexes: [
              [1, 2, 3, 4],
              [5, 6, 7, 8],
            ],
          },
          2: { mode: ["walk"], geometry: "polygon", vertexes: [1, 2, 3, 4] },
          3: { mode: ["car"], geometry: "line", vertexes: [1, 2] },
        },
      },
    },
  } as unknown as Sources[string];
  const transform = (p: number[]) => ({ x: p[0], y: p[1] });
  const passages = walkPassages(source, "0", transform);
  assert.equal(passages.length, 2);
  assert.equal(inPolygon({ x: 2, y: 2 }, passages[0].polygons[0]), true);
  assert.equal(inPolygon({ x: 10, y: 10 }, passages[0].polygons[0]), false);
  assert.equal(inPolygon({ x: 10, y: 10 }, passages[1].polygons[0]), true);
  delete source.road.points["2"];
  assert.throws(
    () => walkPassages(source, "0", transform),
    /Missing road vertex/,
  );
});

test("Tiled source layers retain hole rings and ordered runtime image layers", () => {
  let holes = 0;
  for (const scene of world.scenes) {
    const tiled = tiledMap(scene, world.mapVersion);
    assert.deepEqual(
      tiled.layers
        .filter((l) => l.type === "imagelayer")
        .slice(0, 7)
        .map((l) => l.name),
      ["ground", "floor", "terrain", "rooms", "passages", "fixtures", "walls"],
    );
    for (const layer of tiled.layers.filter((l) =>
      l.name.startsWith("source_"),
    )) {
      for (const object of layer.objects ?? []) {
        const rings = object.properties?.find(
          (p: { name: string }) => p.name === "holes",
        );
        if (rings && JSON.parse(rings.value).length) holes++;
      }
    }
  }
  assert.ok(holes > 0);
});

test("surveyed F2 and F3 skybridges connect separate building maps at the same elevation", () => {
  assert.equal(report.galleries.length, 15);
  assert.equal(report.galleries.filter((g) => g.elevation === 3).length, 10);
  assert.equal(report.galleries.filter((g) => g.elevation === 6).length, 5);
  for (const g of report.galleries) {
    const [a, b] = [g.from, g.to].map(
      (id) => world.scenes.find((s) => s.id === id)!,
    );
    assert.notEqual(a.sourceMap, b.sourceMap);
    assert.equal(a.floor.elevation, b.floor.elevation);
    const sourceEntries = [a, b].map(
      (scene, i) =>
        sources[scene.sourceMap].map.mapinfo.regions.find(
          (r) => String(r.region) === scene.floor.key,
        )!.entries![g.sourceEntries[i]],
    );
    const [from, to] = sourceEntries;
    assert.equal(from.out.z, to.in.z);
    assert.equal(to.out.z, from.in.z);
    assert.ok(
      Math.hypot(from.out.x - to.in.x, from.out.y - to.in.y) *
        a.units.metersPerProjectedUnit <=
        0.75,
    );
    for (const [i, scene] of [a, b].entries()) {
      const portal = scene.portals.find(
        (p) => p.kind === "gallery" && p.id.endsWith(`_${g.sourceEntries[i]}`),
      )!;
      const other = i === 0 ? b : a;
      assert.equal(portal.targetScene, other.id);
      assert.equal(
        other.portals.find((p) => p.id === portal.targetPortal)?.targetPortal,
        portal.id,
      );
      assert.ok(g.landingOffsets[i] < scene.units.pixelsPerMeter * 1.5);
      const walk = reachable(scene, portal);
      assert.ok(
        scene.portals.some(
          (p) =>
            ["stairs", "lift", "escalator"].includes(p.kind) &&
            walk.has(tileIndex(scene, p)),
        ),
      );
    }
  }
});

test("the source crossings north of Red Bird Plaza walk bank to bank and the adjacent pools remain blocked", () => {
  const campus = world.scenes[0],
    graph = sources.xgkdgz_all.road;
  const pixel = (raw: number[]) => {
    const q = project(raw, config.transform);
    return { x: q.x + campus.sourceOffset.x, y: q.y + campus.sourceOffset.y };
  };
  const vertex = (id: number) => {
    const { x, y } = graph.points[id];
    return pixel([x, y]);
  };
  const mid = (a: number, b: number) => ({
    x: (vertex(a).x + vertex(b).x) / 2,
    y: (vertex(a).y + vertex(b).y) / 2,
  });
  const walk = (a: Point, b: Point) => {
    const direction = { x: b.x - a.x, y: b.y - a.y };
    const distance = Math.hypot(direction.x, direction.y);
    const ticks = Math.ceil(distance / (campus.player.speed / 60));
    let at = a;
    for (let i = 0; i < ticks; i++)
      at = move(
        campus,
        at,
        direction,
        distance / (ticks * campus.player.speed),
      );
    assert.ok(Math.hypot(at.x - b.x, at.y - b.y) < 0.01);
  };
  // The map leaves gaps between individual water polygons at the footbridges.
  for (const id of [1001, 1004, 1138, 1139]) {
    const road = graph.roads["0"][id];
    assert.ok(road.mode.includes("walk"));
    const [a, b] = (road.vertexes as number[]).map(vertex);
    walk(a, b);
    walk(b, a);
  }
  const plazaCrossing = campus.surfaces.find(
    (s) =>
      s.sourceMap === campus.sourceMap &&
      s.sourceLayer === "walk-passages" &&
      s.sourceId === 1855,
  )!;
  const a = mid(741, 543),
    b = mid(233, 748);
  for (let i = 0; i <= 100; i++)
    assert.ok(
      plazaCrossing.polygons.some((poly) =>
        inPolygon(
          {
            x: a.x + ((b.x - a.x) * i) / 100,
            y: a.y + ((b.y - a.y) * i) / 100,
          },
          poly,
        ),
      ),
    );
  walk(a, b);
  walk(b, a);
  for (const [id, raw] of [
    [48605, [12632163.63336, 2618740.51343]],
    [46043, [12632214.99696, 2618832.59939]],
  ] as const) {
    const probe = pixel([...raw]);
    assert.ok(
      campus.surfaces.some(
        (s) =>
          s.sourceId === id &&
          s.kind === "water" &&
          s.polygons.some((poly) => inPolygon(probe, poly)),
      ),
    );
    assert.equal(canStand(campus, probe), false);
  }
});

test("the plaza's visible pool and sculpture stop feet, and its stone rim and inset crossing remain walkable", () => {
  const scene = world.scenes[0],
    src = sources.xgkdgz_all.map.mapdata["0"];
  const model = Object.values(src)
    .flatMap((l) => l.data?.features ?? [])
    .find((f) => f.properties.id === 43597)!;
  const q = project(model.properties.tarray.slice(12, 14), config.transform);
  const center = {
    x: q.x + scene.sourceOffset.x,
    y: q.y + scene.sourceOffset.y,
  };
  const polar = (r: number, deg: number) => ({
    x: center.x + r * Math.cos((deg * Math.PI) / 180),
    y: center.y + r * Math.sin((deg * Math.PI) / 180),
  });
  assert.equal(canStand(scene, center), false);
  assert.equal(canStand(scene, polar(60, -90)), false);
  for (let deg = 0; deg < 360; deg++) {
    assert.ok(canStand(scene, polar(78, deg)), `outer rim ${deg}°`);
    assert.ok(canStand(scene, polar(30, deg)), `inner stone steps ${deg}°`);
  }
  // This source stone slab crosses SHUI at 210 degrees and is physically above it.
  for (let r = 20; r <= 84; r += 0.25)
    assert.ok(canStand(scene, polar(r, 210)), `stone crossing radius ${r}`);
  assert.equal(report.plazaCollision.waterNode, "SHUI");
  assert.equal(report.plazaCollision.sculptureNode, "柱体");
  assert.ok(
    report.plazaCollision.visibleWaterCells > 290 &&
      report.plazaCollision.plinthCells < 32,
  );
});

test("the C2 approach starts on foot with a transparent 40px opening in all six baked roofs", async () => {
  const scene = world.scenes[0],
    point = scene.spawns[0],
    entry = scene.portals.find((p) => p.id === "enter_c2")!;
  assert.ok(reachable(scene, point).has(tileIndex(scene, entry)));
  assert.ok(Math.hypot(point.x - entry.x, point.y - entry.y) < 125);
  const baked = JSON.parse(
    readFileSync(new URL("../public/maps/world.json", import.meta.url), "utf8"),
  ) as typeof world;
  const published = baked.scenes[0],
    ratio = published.art.pixelRatio ?? 1;
  assert.deepEqual(point, published.spawns[0]);
  assert.equal(published.art.roofs.length, 6);
  for (const roof of published.art.roofs) {
    const image = sharp(
      new URL(`../public/maps/${roof.image}`, import.meta.url).pathname,
    );
    const { width, height } = await image.metadata();
    const pad = report.campusSpawn.projectedRoofClearancePixels * ratio;
    const x = Math.round((point.x - roof.x) * ratio),
      y = Math.round((point.y - roof.y) * ratio);
    const left = Math.max(0, x - pad),
      top = Math.max(0, y - pad),
      right = Math.min(width!, x + pad + 1),
      bottom = Math.min(height!, y + pad + 1);
    if (right <= left || bottom <= top) continue;
    const alpha = await image
      .extract({ left, top, width: right - left, height: bottom - top })
      .ensureAlpha()
      .extractChannel(3)
      .raw()
      .toBuffer();
    assert.ok(
      alpha.every((n) => n === 0),
      `spawn obscured by ${roof.id}`,
    );
  }
});
