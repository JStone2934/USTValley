import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import sharp from "sharp";
import { polygonMesh, stairMesh } from "../scripts/indoor-art.ts";
import { renderPrimitives, type RasterMaterial } from "../scripts/gltf.ts";
import type { Polygon } from "../scripts/source-geometry.ts";
import { roomFinish } from "../scripts/interior-materials.ts";
import { preservesAisle } from "../scripts/room-casework.ts";
import { inPolygon } from "../scripts/source-geometry.ts";
import {
  canStand,
  tileIndex,
  type SceneMap,
  type WorldMap,
} from "../src/shared/world.ts";

const square = (x: number, y: number, size: number) => [
  { x, y },
  { x: x + size, y },
  { x: x + size, y: y + size },
  { x, y: y + size },
  { x, y },
];
const materials: RasterMaterial[] = [
  { factor: [0.9, 0.85, 0.75, 1] },
  { factor: [0.3, 0.7, 0.5, 1] },
];
const project = (v: number[]) => ({ x: v[0], y: v[1] });
const viewport = { x: 0, y: 0, width: 40, height: 40 };
async function pixels(parts: ReturnType<typeof polygonMesh>) {
  const { png } = await renderPrimitives(
    parts,
    materials,
    project,
    1,
    0.55,
    viewport,
  );
  return sharp(png).ensureAlpha().raw().toBuffer();
}
const alpha = (buffer: Buffer, x: number, y: number) =>
  buffer[(y * viewport.width + x) * 4 + 3];

test("3D floor triangulation leaves courtyard holes empty, including their vertical edges", async () => {
  const polygon: Polygon = [square(4, 8, 28), square(12, 16, 12)];
  const floor = polygonMesh(polygon, 0, -2, 0);
  const image = await pixels(floor);
  assert.equal(alpha(image, 7, 15), 255);
  assert.equal(alpha(image, 18, 22), 0);
  assert.equal(alpha(image, 0, 0), 0);
  assert.equal(floor[0].vertices.length, 8); // duplicate closing vertices removed
  assert.equal(floor[1].vertices.length, 32); // inner courtyard retains slab walls
});

test("extrusion projects genuine visible side faces and z-buffer order does not depend on draw order", async () => {
  const wall = polygonMesh([square(10, 18, 10)], 8, 0, 0);
  const flat = polygonMesh([square(10, 18, 10)], 0, 0, 0);
  assert.equal(alpha(await pixels(wall), 15, 15), 255);
  assert.equal(alpha(await pixels(flat), 15, 15), 0);
  const floor = polygonMesh([square(2, 2, 35)], -1, -1, 1);
  assert.deepEqual(
    await pixels([...floor, ...wall]),
    await pixels([...wall, ...floor]),
  );
});

test("stair flights contain multiple real tread heights instead of painted flat stripes", () => {
  const steps = stairMesh([square(5, 10, 20)], 6, 0, 0);
  const heights = new Set(
    steps.filter((p) => p.node === "polygon-top").map((p) => p.vertices[0][2]),
  );
  assert.ok(heights.size >= 3);
  assert.ok(Math.max(...heights) > 4);
});

test("every published indoor floor uses the shared 3D renderer and contains only its own source floor", async () => {
  const world = JSON.parse(
    readFileSync(new URL("../public/maps/world.json", import.meta.url), "utf8"),
  ) as WorldMap;
  const report = JSON.parse(
    readFileSync(
      new URL("../content/map-build-report.json", import.meta.url),
      "utf8",
    ),
  );
  assert.equal(report.mapVersion, world.mapVersion);
  assert.equal(report.interiors.length, world.scenes.length - 1);
  let modelCount = 0;
  for (const scene of world.scenes.slice(1)) {
    const art = report.interiors.find(
      (r: { sceneId: string }) => r.sceneId === scene.id,
    );
    assert.equal(scene.art.style, "pixel-3d");
    assert.equal(art.floor, scene.floor.key);
    assert.equal(art.sourceMap, scene.sourceMap);
    assert.equal(art.renderer, "shared-outdoor-orthographic-pixel-rasterizer");
    assert.ok(art.extrudedPolygons > 0);
    assert.ok(art.steppedStairs > 0);
    assert.ok(art.triangles > 100);
    assert.ok(scene.surfaces.every((s) => s.sourceFloor === scene.floor.key));
    const ratio = scene.art.pixelRatio ?? 1;
    assert.ok(ratio >= 3, scene.id);
    assert.equal(art.pixelRatio, ratio);
    assert.ok(scene.art.riseMap);
    const expected = {
      width: scene.width * scene.tileSize * ratio,
      height: scene.height * scene.tileSize * ratio,
    };
    for (const file of [
      scene.art.ground,
      scene.art.riseMap,
      ...scene.art.layers.map((layer) => layer.image),
    ]) {
      const image = await sharp(
        new URL(`../public/maps/${file}`, import.meta.url).pathname,
      ).metadata();
      assert.deepEqual(
        { width: image.width, height: image.height },
        expected,
        file,
      );
    }
    assert.deepEqual(art.pixels, expected);
    modelCount += art.sourceModelInstances;
  }
  assert.ok(modelCount > 500);
});

test("source room names override broad layer labels and unlabelled rooms retain a neutral finish", () => {
  assert.equal(roomFinish("办公室0", { name: "演讲厅B" }), "teaching");
  assert.equal(roomFinish("实验室", { name: "中央实验室办公室" }), "office");
  assert.equal(roomFinish("其他0", { name: "低压配电室" }), "plant");
  assert.equal(roomFinish("房间9", { name: "419 密集书库" }), "archive");
  assert.equal(roomFinish("其他0", { name: "203" }), "neutral");
});

test("nosing and raised rails follow a diagonally rotated flight", () => {
  const c = Math.cos(0.6),
    s = Math.sin(0.6);
  const ring = [
    [0, 0],
    [30, 0],
    [30, 12],
    [0, 12],
    [0, 0],
  ].map(([x, y]) => ({ x: x * c - y * s, y: x * s + y * c }));
  const mesh = stairMesh([ring], 6, 0, 1, 2);
  const rails = mesh.filter((p) => p.node === "stair-rail");
  assert.ok(rails.length);
  const positions = rails[0].vertices;
  const a = positions[0],
    b = positions[1];
  assert.ok(Math.abs((b[1] - a[1]) * c - (b[0] - a[0]) * s) < 0.001);
  assert.ok(
    Math.max(...positions.map((v) => v[2])) -
      Math.min(...positions.map((v) => v[2])) >
      3,
  );
});

test("casework cannot disconnect a walkable aisle", () => {
  const scene = {
    width: 2,
    height: 2,
    tileSize: 16,
    collisionSize: 4,
    collision: Array<number>(64).fill(1),
  } as SceneMap;
  for (let x = 1; x < 7; x++) scene.collision[3 * 8 + x] = 0;
  assert.equal(preservesAisle(scene, [27]), false);
  for (let x = 2; x < 5; x++) scene.collision[4 * 8 + x] = 0;
  assert.equal(preservesAisle(scene, [27]), true);
});

test("inferred furniture stays in its named source room, has physical collision and leaves door approaches free", () => {
  const world = JSON.parse(
    readFileSync(new URL("../public/maps/world.json", import.meta.url), "utf8"),
  ) as WorldMap;
  const kinds = new Set<string>();
  for (const scene of world.scenes.slice(1)) {
    const protectedCells = new Set<number>();
    for (const d of scene.doors ?? []) {
      for (const c of d.cells) protectedCells.add(c);
      const step = scene.collisionSize;
      for (const p of [
        d.inside,
        d.outside,
        {
          x: d.inside.x + Math.sign(d.inside.x - d.outside.x) * step,
          y: d.inside.y + Math.sign(d.inside.y - d.outside.y) * step,
        },
      ])
        protectedCells.add(tileIndex(scene, p));
    }
    for (const point of scene.pointFixtures ?? []) {
      assert.ok(
        point.cells.length &&
          point.cells.every(
            (c) => scene.collision[c] === 1 && !protectedCells.has(c),
          ),
      );
      assert.equal(canStand(scene, point), false);
    }
    for (const item of scene.roomCasework ?? []) {
      kinds.add(item.kind);
      const floor = scene.surfaces.find(
        (s) => s.kind === "room" && s.sourceId === item.sourceId,
      );
      assert.ok(
        floor?.polygons.some((poly) =>
          item.footprint.every((p) => inPolygon(p, poly)),
        ),
      );
      assert.ok(
        item.cells.length &&
          item.cells.every(
            (c) => scene.collision[c] === 1 && !protectedCells.has(c),
          ),
      );
      const [a, , b] = item.footprint;
      assert.equal(
        canStand(scene, { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }),
        false,
      );
    }
  }
  assert.deepEqual([...kinds].sort(), [
    "lab-bench",
    "lectern",
    "office-cabinet",
  ]);
});
