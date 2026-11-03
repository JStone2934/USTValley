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
      const isPlaza = id === 43597 || id === 48569;
      const baked = await renderPrimitives(
        parts,
        materials,
        convert,
        config.transform.pixelsPerProjectedUnit,
        config.roofHeightFactor,
        undefined,
        isPlaza,
        isPlaza,
        density,
      );
      const x = Math.max(0, baked.x),
        y = Math.max(0, baked.y);
      const w = Math.min(baked.x + baked.width, width * density) - x,
        h = Math.min(baked.y + baked.height, height * density) - y;
      if (w <= 0 || h <= 0) continue;
      const crop = { left: x - baked.x, top: y - baked.y, width: w, height: h };
      const png = isPlaza
        ? await sharp(
            await plazaFinish(
              id,
              baked,
              convert(tarray.slice(12, 14)),
              density,
            ),
          )
            .extract(crop)
            .png({ compressionLevel: 9 })
            .toBuffer()
        : await gradeCampusModel(
            await sharp(baked.png).extract(crop).png().toBuffer(),
          );
      if ((await sharp(png).stats()).channels[3].max === 0) continue;
      const image = `landmark-${id}.png`;
      files.set(`public/maps/${image}`, png);
      // The low planted beds around the sundial sit beneath the standing figure.
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

type Bake = Awaited<ReturnType<typeof renderPrimitives>>;
type RGB = [number, number, number];

// 43597 and the concentric planted beds in 48569 share a surveyed centre.
// The paving is drawn on the real horizontal mesh faces, so open water,
// the stone crossings and the gnomon keep their original three-dimensional profiles.
async function plazaFinish(
  id: number,
  bake: Bake,
  center: Point,
  density: number,
) {
  const { data, info } = await sharp(bake.png)
    .raw()
    .toBuffer({ resolveWithObject: true });
  const heights = await sharp(bake.riseMap!).greyscale().raw().toBuffer();
  const ids = bake.surfaceIds!;
  const tau = 2 * Math.PI;
  const red: RGB[] = [
    [133, 35, 41],
    [166, 39, 44],
    [194, 46, 44],
    [215, 58, 53],
    [233, 80, 68],
  ];
  for (let i = 0; i < ids.length; i++) {
    if (!ids[i]) continue;
    const k = i * 4,
      mat = (ids[i] & 0x7fff) - 1,
      flat = (ids[i] & 0x8000) !== 0;
    const px = i % info.width,
      py = Math.floor(i / info.width);
    const x = (bake.x + px + 0.5) / density - center.x;
    const y = (bake.y + py + 0.5) / density + heights[i] / 8 - center.y;
    const radius = Math.hypot(x, y);
    const angle = (Math.atan2(y, x) + tau) % tau;
    const nativeLuma = data[k] * 0.28 + data[k + 1] * 0.53 + data[k + 2] * 0.19;
    let color: RGB,
      accent = 0;
    if (id === 48569 && mat === 1 && flat) {
      // Paired leaves group into low shrubs inside the source planter curbs.
      const u = Math.floor(x * 1.4),
        v = Math.floor(y * 1.4);
      const hash = (Math.imul(u >> 1, 317) ^ Math.imul(v >> 1, 977)) >>> 0;
      const sun = (u & 1) === 0 && (v & 1) === 0;
      color = hash % 7 < 2 ? [83, 111, 72] : [97, 123, 76];
      accent = (sun ? 8 : v & 1 ? -6 : 0) + Math.round((nativeLuma - 120) / 13);
    } else if (id === 48569) {
      color = [183, 185, 173];
      accent = (nativeLuma - 175) * 0.4;
    } else if (mat === 0) {
      color = red[Math.max(0, Math.min(4, Math.floor((data[k] - 161) / 10)))];
    } else if (mat === 1) {
      // Preserve the detailing on the dial face from the original texture.
      continue;
    } else if (mat === 2) {
      // The narrow, separate gnomon catches a cool silver highlight.
      color = [208, 213, 211];
      accent = (nativeLuma - 185) * 1.3;
    } else if (mat === 9) {
      // Dark reflective water on both source water meshes, including the two
      // narrower basins. Horizontal reflection clusters stop at the mesh edge.
      const band = Math.floor(y * 1.1),
        lane = Math.floor((x + band * 2.7) / 4.8);
      const hash = (Math.imul(band, 48611) ^ Math.imul(lane, 7919)) >>> 0;
      const glint =
        hash % 19 === 0 &&
        ((Math.floor((x + band * 2.7) * 3) % 13) + 13) % 13 < 7;
      const reflection = Math.round(3 * Math.sin(x * 0.12 + y * 0.18));
      color = [52, 77, 77];
      accent = reflection + (glint ? 17 : hash % 4 === 0 ? -6 : 0);
    } else if (flat) {
      // Narrow, staggered radial strips are visible between the light pavers in
      // the June 2023 university photograph. Use real ground XY at each tread.
      const ring = Math.floor(radius / 2.6),
        along = radius / 2.6 - ring;
      const sectors = Math.max(6, Math.round((tau * (ring + 0.5) * 2.6) / 5.2));
      const phase = (angle / tau) * sectors + (ring % 2) * 0.5;
      const tile = Math.floor(phase),
        u = phase - tile;
      const hash = (Math.imul(ring + 1, 49999) ^ Math.imul(tile, 701)) >>> 0;
      color = radius < 12 ? [172, 175, 168] : [206, 207, 198];
      if (radius >= 12) {
        if (
          hash % 4 === 0 &&
          along > 0.22 &&
          along < 0.58 &&
          u > 0.17 &&
          u < 0.65
        )
          color = [136, 148, 147];
        else if (along < 0.085 || u < 0.04) color = [168, 173, 167];
        else accent = ((hash % 5) - 2) * 2;
      }
      if (
        py > 0 &&
        ids[i - info.width] === ids[i] &&
        heights[i] - heights[i - info.width] >= 2
      )
        accent += 11;
      if (
        py + 1 < info.height &&
        ids[i + info.width] === ids[i] &&
        heights[i] - heights[i + info.width] >= 2
      )
        accent -= 16;
    } else {
      // The stone nosing and shaded risers read separately at close zoom.
      color = [133, 143, 140];
      accent = (nativeLuma - 150) * 0.45;
    }
    for (let ch = 0; ch < 3; ch++)
      data[k + ch] = Math.max(0, Math.min(255, Math.round(color[ch] + accent)));
  }
  return sharp(data, { raw: info }).png({ compressionLevel: 9 }).toBuffer();
}
