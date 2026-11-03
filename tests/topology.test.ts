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
import { reachableWorld, tileIndex } from "../src/shared/world.ts";

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
  assert.equal(academic.portals.filter((p) => p.kind === "entrance").length, 4);
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
