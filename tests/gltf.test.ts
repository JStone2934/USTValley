import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import {
  accessor,
  campusPlacement,
  identity,
  multiply,
  nodeMatrix,
  parseGlb,
  primitives,
  transformPoint,
  type Glb,
} from "../scripts/gltf.ts";
import config from "../content/map-config.json";
import {
  getFeature,
  inPolygon,
  polygons,
  bufferLine,
  type Sources,
} from "../scripts/source-geometry.ts";
import { buildWorld } from "../scripts/map-builder.ts";
const root = resolve(import.meta.dirname, ".."),
  folder = resolve(root, "data/maps/xgkdgz_all/mapres");
const bytes = readFileSync(resolve(root, "data/maps/all-maps.json")),
  sources = JSON.parse(bytes.toString()) as Sources;

test("all 70 GLBs decode complete node hierarchies and valid indexed triangles", () => {
  const files = readdirSync(folder).filter((f) => f.endsWith(".glb"));
  assert.equal(files.length, 70);
  let triangles = 0;
  for (const file of files) {
    const glb = parseGlb(readFileSync(resolve(folder, file))),
      parts = primitives(glb);
    assert.ok(parts.length > 0);
    for (const p of parts) {
      assert.ok(p.vertices.every((v) => v.every(Number.isFinite)));
      assert.equal(p.indices.length % 3, 0);
      triangles += p.indices.length / 3;
    }
  }
  assert.equal(triangles, 117656);
});
test("node rotation, negative scale, instancing and parent placement are preserved", () => {
  const local = nodeMatrix({
    translation: [1, 2, 3],
    rotation: [0, 0, Math.SQRT1_2, Math.SQRT1_2],
    scale: [-2, 3, 4],
  });
  const parent = identity();
  parent[12] = 100;
  const point = transformPoint(multiply(parent, local), [1, 0, 0]);
  assert.ok(Math.abs(point[0] - 101) < 1e-9);
  assert.ok(Math.abs(point[1]) < 1e-9);
  assert.equal(point[2], 3);
  const f = getFeature(sources.xgkdgz_all, 45963),
    glb = parseGlb(
      readFileSync(
        resolve(
          root,
          "data/maps",
          f.properties.src.replace(/^\/res\/projects\//, ""),
        ),
      ),
    );
  assert.equal(glb.json.meshes.length, 5);
  assert.equal(glb.json.nodes.length, 8);
  assert.equal(primitives(glb).length, 51); // repeated mesh instances must not disappear
});
test("campus declared height restores normalized meshes without changing XY placement", () => {
  for (const group of config.groups) {
    const f = getFeature(sources.xgkdgz_all, group.featureId),
      glb = parseGlb(
        readFileSync(
          resolve(
            root,
            "data/maps",
            f.properties.src.replace(/^\/res\/projects\//, ""),
          ),
        ),
      );
    const matrix = campusPlacement(
        glb,
        f.properties.tarray,
        f.properties.height,
      ),
      vertices = primitives(glb, matrix).flatMap((p) => p.vertices);
    const min = Math.min(...vertices.map((v) => v[2])),
      max = Math.max(...vertices.map((v) => v[2]));
    assert.ok(Math.abs(max - min - f.properties.height) < 1e-6);
    for (const i of [0, 1, 4, 5, 12, 13])
      assert.equal(matrix[i], f.properties.tarray[i]);
  }
});
test("accessors respect byte offsets, interleaved stride and normalized integer channels", () => {
  const binary = Buffer.alloc(40);
  binary.writeFloatLE(1.5, 4);
  binary.writeFloatLE(2.5, 8);
  binary.writeFloatLE(3.5, 20);
  binary.writeFloatLE(4.5, 24);
  binary[36] = 255;
  binary[37] = 128;
  const glb = {
    binary,
    json: {
      accessors: [
        {
          bufferView: 0,
          byteOffset: 4,
          componentType: 5126,
          count: 2,
          type: "VEC2",
        },
        {
          bufferView: 1,
          componentType: 5121,
          count: 2,
          type: "SCALAR",
          normalized: true,
        },
      ],
      bufferViews: [
        { buffer: 0, byteOffset: 0, byteLength: 32, byteStride: 16 },
        { buffer: 0, byteOffset: 36, byteLength: 2 },
      ],
    },
  } as unknown as Glb;
  assert.deepEqual(accessor(glb, 0), [
    [1.5, 2.5],
    [3.5, 4.5],
  ]);
  assert.deepEqual(accessor(glb, 1), [[1], [128 / 255]]);
  glb.json.accessors[0].count = 3;
  assert.throws(() => accessor(glb, 0), /exceeds/);
  assert.throws(() => parseGlb(Buffer.alloc(20)), /header/);
});
test("polygon holes remain empty, including through transformations", () => {
  const f = {
    properties: {},
    geometry: {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
          [0, 0],
        ],
        [
          [2, 2],
          [8, 2],
          [8, 8],
          [2, 8],
          [2, 2],
        ],
      ],
    },
  };
  const [p] = polygons(f, (v) => ({ x: v[0] * 3 + 4, y: -v[1] * 3 + 50 }));
  assert.equal(inPolygon({ x: 7, y: 47 }, p), true);
  assert.equal(inPolygon({ x: 19, y: 35 }, p), false);
});
test("reconstruction uses real floor wings and source entrances with measured bounded offsets", () => {
  const { world, report } = buildWorld(sources, bytes);
  assert.equal(world.status, "reconstructed");
  assert.equal(world.scenes[0].art.roofs.length, 6);
  assert.ok(new Set(world.buildings.map((b) => Math.round(b.width))).size > 5);
  for (const scene of world.scenes) {
    assert.equal(scene.collisionSize, 4);
    assert.ok(scene.surfaces.some((s) => s.kind === "floor"));
    assert.ok(scene.surfaces.some((s) => s.kind === "room"));
  }
  for (const b of report.buildings) {
    assert.ok(b.entryDisplacement <= 48);
    assert.ok(b.innerEntryDisplacement <= 48);
  }
  assert.equal(
    report.buildings.find((b) => b.id === "C2")!.entryFeatureId,
    72730,
  );
  const east = new Set(
    world.scenes
      .filter((s) => /^interior_e/.test(s.id))
      .map((s) => s.art.ground),
  );
  assert.equal(east.size, 2);
  for (const s of world.scenes.slice(1))
    assert.ok(s.width <= 64 && s.height <= 64);
});

test("source line walls become thin collision strips without filling their courtyards", () => {
  const strips = bufferLine(
    [
      { x: 0, y: 0 },
      { x: 40, y: 0 },
      { x: 40, y: 40 },
    ],
    4,
  );
  assert.equal(strips.length, 2);
  assert.ok(strips.some((p) => inPolygon({ x: 20, y: 1 }, p)));
  assert.ok(strips.some((p) => inPolygon({ x: 39, y: 20 }, p)));
  assert.equal(
    strips.some((p) => inPolygon({ x: 20, y: 20 }, p)),
    false,
  );
});
