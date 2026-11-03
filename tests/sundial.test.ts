import sharp from "sharp";
import config from "../content/map-config.json";
import { campusPlacement, loadGlb, renderModel } from "../scripts/gltf.ts";
import { getFeature } from "../scripts/source-geometry.ts";
import { project } from "../src/shared/world.ts";
import { isSundialSculpturePixel, sundialCrop } from "../src/shared/sundial.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  canObserveSundial,
  sundial,
  sundialViewpoints,
} from "../src/shared/sundial.ts";
import {
  canStand,
  reachable,
  tileIndex,
  type WorldMap,
} from "../src/shared/world.ts";

test("observation anchors remain on the plaza crossing, steps and reachable dial platform", () => {
  const world = JSON.parse(
    readFileSync(new URL("../public/maps/world.json", import.meta.url), "utf8"),
  ) as WorldMap;
  const campus = world.scenes[0],
    points = sundialViewpoints(campus);
  // Verified against the placed 43597 GLB top triangles: NW (柱体.006, material 6);
  // SE (柱体.004, material 6); the two dial-deck samples (柱体.004, material 3).
  assert.deepEqual(points, [
    { x: 854, y: 1386 },
    { x: 950, y: 1434 },
    { x: 902, y: 1394 },
    { x: 902, y: 1430 },
  ]);
  const reachableCells = reachable(campus, campus.spawns[0]);
  for (const p of points) {
    assert.ok(canStand(campus, p) && reachableCells.has(tileIndex(campus, p)));
    assert.ok(canObserveSundial(campus, p));
  }
  assert.equal(canObserveSundial(campus, campus.spawns[0]), false);
  assert.equal(canObserveSundial(campus, { x: 902, y: 1414 }), false); // sculpture plinth
  assert.equal(
    canObserveSundial(
      { ...campus, chests: [{ ...points[0], id: "nearby_chest" }] },
      points[0],
    ),
    false,
  );
  assert.equal(
    canObserveSundial(
      {
        ...campus,
        art: {
          ...campus.art,
          landmarks: campus.art.landmarks!.filter(
            (l) => l.id !== sundial.featureId,
          ),
        },
      },
      points[0],
    ),
    false,
  );
  assert.equal(canObserveSundial(world.scenes[1], points[0]), false);
});

test("foreground mask contains every pixel of the three raised sundial materials and no stone or water", async () => {
  const root = new URL("../", import.meta.url);
  const json = (p: string) =>
    JSON.parse(readFileSync(new URL(p, root), "utf8"));
  const world = json("public/maps/world.json") as WorldMap,
    campus = world.scenes[0];
  const feature = getFeature(
    json("data/maps/all-maps.json").xgkdgz_all,
    sundial.featureId,
  );
  const glb = await loadGlb(
    new URL(
      "data/maps/" + feature.properties.src.replace(/^\/res\/projects\//, ""),
      root,
    ).pathname,
  );
  const placement = campusPlacement(
    glb,
    feature.properties.tarray,
    feature.properties.height,
  );
  const bake = await renderModel(
    glb,
    placement,
    (coords) => {
      const q = project(coords, config.transform);
      return { x: q.x + campus.sourceOffset.x, y: q.y + campus.sourceOffset.y };
    },
    config.transform.pixelsPerProjectedUnit,
    config.roofHeightFactor,
    campus.art.pixelRatio ?? 1,
  );
  const { data, info } = await sharp(
    new URL("public/maps/landmark-43597.png", root).pathname,
  )
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  assert.deepEqual([bake.width, bake.height], [info.width, info.height]);
  const clip = sundialCrop(info.width, info.height);
  const counts = [0, 0, 0];
  let wrong = 0;
  for (let i = 0; i < bake.surfaceIds!.length; i++) {
    const material = (bake.surfaceIds![i] & 0x7fff) - 1;
    const raised = material >= 0 && material < 3;
    if (raised) counts[material]++;
    const x = i % info.width,
      y = Math.floor(i / info.width),
      k = i * 4;
    const above =
      x >= clip.x &&
      x < clip.x + clip.width &&
      y >= clip.y &&
      y < clip.y + clip.height &&
      data[k + 3] > 0 &&
      isSundialSculpturePixel(data[k], data[k + 1], data[k + 2]);
    if (above !== raised) wrong++;
  }
  assert.ok(counts.every((n) => n > 0));
  assert.equal(wrong, 0);
});
