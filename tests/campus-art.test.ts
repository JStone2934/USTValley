import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import sharp from "sharp";
import { renderPrimitives, type Primitive } from "../scripts/gltf.ts";
import { campusLayerSvg } from "../scripts/campus-art.ts";
import type { WorldMap, Surface } from "../src/shared/world.ts";

const world = JSON.parse(
  readFileSync(new URL("../public/maps/world.json", import.meta.url), "utf8"),
) as WorldMap;
test("the HD depth image encodes projected height in world pixels for front/back occlusion", async () => {
  const top: Primitive = {
    node: "shelf top",
    material: 0,
    vertices: [
      [0, 8, 4],
      [12, 8, 4],
      [0, 20, 4],
    ],
    uv: [
      [0, 0],
      [0, 0],
      [0, 0],
    ],
    indices: [0, 1, 2],
  };
  for (const ratio of [1, 3]) {
    const image = await renderPrimitives(
      [top],
      [{ factor: [1, 1, 1, 1] }],
      (v) => ({ x: v[0], y: v[1] }),
      1,
      0.75,
      { x: 0, y: 0, width: 16, height: 20 },
      true,
      false,
      ratio,
    );
    const { data, info } = await sharp(image.riseMap!)
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    assert.equal(info.width, 16 * ratio);
    const y = 8 * ratio,
      x = 2 * ratio,
      rise = data[y * info.width + x] / 8;
    assert.equal(rise, 3);
    const baseY = (y + 0.5) / ratio + rise;
    assert.ok(
      baseY > 10 && baseY < 12,
      "a 10px footpoint is behind the shelf, a 12px footpoint is in front",
    );
  }
});

test("source lawns have pixel highlights at camera scale and leave courtyard holes unpainted", async () => {
  const scene = world.scenes[0];
  const loop = (x: number, y: number, size: number) => [
    { x, y },
    { x: x + size, y },
    { x: x + size, y: y + size },
    { x, y: y + size },
  ];
  const garden: Surface = {
    kind: "garden",
    color: "#97ad83",
    sourceId: 17,
    sourceLayer: "绿化",
    sourceMap: scene.sourceMap,
    sourceFloor: "0",
    polygons: [[loop(3, 3, 54), loop(22, 22, 15)]],
  };
  const svg = campusLayerSvg(
    { ...scene, width: 4, height: 4, surfaces: [garden] },
    "terrain",
  );
  const { data, info } = await sharp(Buffer.from(svg), { density: 216 })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const idx = (x: number, y: number) => (y * info.width + x) * 4;
  assert.equal(data[idx(28 * 3, 28 * 3) + 3], 0);
  const colors = new Set<number>();
  for (let y = 5 * 3; y < 20 * 3; y++)
    for (let x = 5 * 3; x < 20 * 3; x++) {
      const i = idx(x, y);
      assert.equal(data[i + 3], 255);
      colors.add((data[i] << 16) | (data[i + 1] << 8) | data[i + 2]);
    }
  assert.ok(
    colors.size >= 4,
    "authored tufts and seams must survive rasterization",
  );
});
