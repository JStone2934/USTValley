import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import sharp from "sharp";
import { polygonMesh, stairMesh } from "../scripts/indoor-art.ts";
import { renderPrimitives, type RasterMaterial } from "../scripts/gltf.ts";
import type { Polygon } from "../scripts/source-geometry.ts";
import type { WorldMap } from "../src/shared/world.ts";

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
    const image = await sharp(
      new URL(`../public/maps/${scene.art.ground}`, import.meta.url).pathname,
    ).metadata();
    assert.equal(image.width, scene.width * 16);
    assert.equal(image.height, scene.height * 16);
    modelCount += art.sourceModelInstances;
  }
  assert.ok(modelCount > 500);
});
