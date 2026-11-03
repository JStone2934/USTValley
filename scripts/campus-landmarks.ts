import { resolve } from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";
import config from "../content/map-config.json";
import type { Point, SceneMap } from "../src/shared/world.ts";
import {
  bounds,
  coordinates,
  layers,
  type SourceMap,
} from "./source-geometry.ts";
import {
  campusPlacement,
  loadGlb,
  primitives,
  modelMaterials,
  textures,
  renderPrimitives,
} from "./gltf.ts";
import { gradeCampusModel } from "./campus-art.ts";

export async function bakeLandmarks(
  root: string,
  source: SourceMap,
  scene: SceneMap,
  convert: (xy: number[]) => Point,
) {
  const density = scene.art.pixelRatio ?? 1;
  const width = scene.width * scene.tileSize,
    height = scene.height * scene.tileSize;
  const files = new Map<string, Buffer>();
  const landmarks = [];
  for (const layer of layers(source)) {
    if (
      ![
        "树",
        "模型",
        "绿化模型-行政楼pcode",
        "天鹅模型-pcode",
        "建筑模型",
        "售卖机打印机",
      ].includes(layer.name)
    )
      continue;
    for (const feature of layer.data?.features ?? []) {
      const { src, id, tarray, height: rise } = feature.properties;
      if (
        !src ||
        !tarray ||
        !rise ||
        (layer.name === "建筑模型" && id !== 43597)
      )
        continue;
      const box = bounds(
        coordinates(feature.geometry.coordinates).map(convert),
      );
      const projectedRise =
        rise *
        config.transform.pixelsPerProjectedUnit *
        config.roofHeightFactor;
      if (
        box.x > width ||
        box.x + box.width < 0 ||
        box.y - projectedRise > height ||
        box.y + box.height < 0
      )
        continue;
      const glb = await loadGlb(
        resolve(root, "data/maps", src.replace(/^\/res\/projects\//, "")),
      );
      const placement = campusPlacement(glb, tarray, rise);
      const parts = primitives(glb, placement);
      const materials = modelMaterials(glb, await textures(glb));
      // The plaza model explicitly labels its fountain water mesh.
      for (const part of parts)
        if (id === 43597 && part.node === "SHUI") {
          part.material = materials.length;
          materials.push({ factor: [0.4, 0.76, 0.8, 1] });
        }
      const baked = await renderPrimitives(
        parts,
        materials,
        convert,
        config.transform.pixelsPerProjectedUnit,
        config.roofHeightFactor,
        undefined,
        false,
        false,
        density,
      );
      const x = Math.max(0, baked.x),
        y = Math.max(0, baked.y);
      const w = Math.min(baked.x + baked.width, width * density) - x,
        h = Math.min(baked.y + baked.height, height * density) - y;
      if (w <= 0 || h <= 0) continue;
      const png = await gradeCampusModel(
        await sharp(baked.png)
          .extract({ left: x - baked.x, top: y - baked.y, width: w, height: h })
          .png()
          .toBuffer(),
      );
      if ((await sharp(png).stats()).channels[3].max === 0) continue;
      const image = `landmark-${id}.png`;
      files.set(`public/maps/${image}`, png);
      // The plaza's flush stone apron belongs beneath avatars and the fountain.
      const foot = bounds(parts.flatMap((p) => p.vertices.map(convert)));
      const frontY = id === 48569 ? -1 : foot.y + foot.height / 2;
      landmarks.push({
        id,
        image,
        x: x / density,
        y: y / density,
        width: w / density,
        height: h / density,
        frontY,
        sourceLayer: layer.name,
        modelSha256: createHash("sha256").update(glb.bytes).digest("hex"),
      });
    }
  }
  landmarks.sort((a, b) => a.frontY - b.frontY || a.id - b.id);
  return { files, landmarks };
}
