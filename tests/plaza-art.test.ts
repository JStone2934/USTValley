import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import sharp from "sharp";
import config from "../content/map-config.json";
import { bakeLandmarks } from "../scripts/campus-landmarks.ts";
import {
  getFeature,
  layers,
  type Sources,
} from "../scripts/source-geometry.ts";
import {
  canStand,
  project,
  type Point,
  type WorldMap,
} from "../src/shared/world.ts";

test("the red bird court distinguishes the real pool, crossing and clipped planter arcs", async () => {
  const root = resolve(import.meta.dirname, "..");
  const world: WorldMap = JSON.parse(
    readFileSync(resolve(root, "public/maps/world.json"), "utf8"),
  );
  const source = (
    JSON.parse(readFileSync(resolve(root, config.source), "utf8")) as Sources
  ).xgkdgz_all;
  const scene = world.scenes[0];
  const projectCampus = (xy: number[]) => {
    const p = project(xy, config.transform);
    return { x: p.x + scene.sourceOffset.x, y: p.y + scene.sourceOffset.y };
  };
  const center = projectCampus(
    getFeature(source, 43597).properties.tarray.slice(12, 14),
  );
  for (const layer of layers(source)) {
    if (layer.data)
      layer.data.features = layer.data.features.filter((f) =>
        [43597, 48569].includes(f.properties.id),
      );
  }
  const { files, landmarks } = await bakeLandmarks(
    root,
    source,
    scene,
    projectCampus,
  );
  assert.deepEqual(
    landmarks.map((l) => l.id),
    [48569, 43597],
  );
  const ratio = scene.art.pixelRatio ?? 1;
  const polar = (radius: number, degree: number): Point => ({
    x: center.x + radius * Math.cos((degree * Math.PI) / 180),
    y: center.y + radius * Math.sin((degree * Math.PI) / 180),
  });
  const [beds, dial] = await Promise.all(
    landmarks.map(async (l) => {
      const { data, info } = await sharp(files.get(`public/maps/${l.image}`)!)
        .raw()
        .toBuffer({ resolveWithObject: true });
      return (p: Point, rise = 0) => {
        const x = Math.floor((p.x - l.x) * ratio),
          y = Math.floor((p.y - rise - l.y) * ratio);
        const i = 4 * (y * info.width + x);
        return [...data.subarray(i, i + 4)];
      };
    }),
  );
  for (let r = 56; r <= 65; r++) {
    const basin = polar(r, -90),
      bridge = polar(r, 210);
    const [wr, wg, wb, wa] = dial(basin, 2),
      [sr, sg, sb, sa] = dial(bridge, 2);
    assert.equal(canStand(scene, basin), false);
    assert.equal(canStand(scene, bridge), true);
    assert.ok(
      wa === 255 && wr < 90 && wg > wr + 12 && Math.abs(wg - wb) < 8,
      `water radius ${r}`,
    );
    assert.ok(
      sa === 255 &&
        Math.min(sr, sg, sb) > 110 &&
        Math.max(sr, sg, sb) - Math.min(sr, sg, sb) < 22,
      `stone radius ${r}`,
    );
  }
  const [r, g, b, a] = beds(polar(109, 30), 2);
  assert.ok(
    a === 255 && g > r + 12 && g > b + 20,
    "eastern clipped planting is green",
  );
  assert.equal(beds(center)[3], 0, "planting has no fill across the centre");
  assert.equal(
    beds(polar(100, -90), 2)[3],
    0,
    "the northern approach is an opening in the planter",
  );
});
