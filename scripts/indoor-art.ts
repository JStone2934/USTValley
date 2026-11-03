import { createRequire } from "node:module";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";
import config from "../content/map-config.json";
import {
  project,
  type Point,
  type SceneMap,
  type Surface,
} from "../src/shared/world.ts";
import {
  bounds,
  layers,
  type Polygon,
  type Sources,
} from "./source-geometry.ts";
import {
  loadGlb,
  modelMaterials,
  primitives,
  renderPrimitives,
  textures,
  transformPoint,
  type Primitive,
  type RasterMaterial,
  type Texture,
  type Vec3,
} from "./gltf.ts";
const earcut = createRequire(import.meta.url)(
  "phaser/src/geom/polygon/Earcut.js",
) as (vertices: number[], holes: number[], dimensions: number) => number[];

export function polygonMesh(
  polygon: Polygon,
  top: number,
  bottom: number,
  material: number,
  sideMaterial = material,
): Primitive[] {
  const rings = polygon
    .map((ring) =>
      ring
        .filter((p, i) => !i || p.x !== ring[i - 1].x || p.y !== ring[i - 1].y)
        .filter(
          (p, i, all) =>
            i !== all.length - 1 || p.x !== all[0].x || p.y !== all[0].y,
        ),
    )
    .filter((r) => r.length >= 3);
  if (!rings.length) return [];
  const flat = rings.flat(),
    holes: number[] = [];
  let count = rings[0].length;
  for (const ring of rings.slice(1)) {
    holes.push(count);
    count += ring.length;
  }
  const topMesh: Primitive = {
    node: "polygon-top",
    vertices: flat.map((p) => [p.x, p.y, top]),
    uv: flat.map((p) => [p.x / 6, p.y / 6]),
    indices: earcut(
      flat.flatMap((p) => [p.x, p.y]),
      holes,
      2,
    ),
    material,
  };
  const result = [topMesh];
  if (top !== bottom) {
    const side: Primitive = {
      node: "polygon-sides",
      vertices: [],
      uv: [],
      indices: [],
      material: sideMaterial,
    };
    for (const ring of rings)
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i],
          b = ring[(i + 1) % ring.length],
          n = side.vertices.length,
          length = Math.hypot(b.x - a.x, b.y - a.y) / 6;
        side.vertices.push(
          [a.x, a.y, bottom],
          [b.x, b.y, bottom],
          [b.x, b.y, top],
          [a.x, a.y, top],
        );
        side.uv.push(
          [0, 0],
          [length, 0],
          [length, (top - bottom) / 6],
          [0, (top - bottom) / 6],
        );
        side.indices.push(n, n + 1, n + 2, n, n + 2, n + 3);
      }
    result.push(side);
  }
  return result;
}
function tileTexture(kind: string): Texture {
  const width = 16,
    data = Buffer.alloc(width * width * 4);
  const palette: Record<string, number[]> = {
    stone: [231, 229, 216],
    concrete: [222, 221, 209],
    wood: [190, 161, 117],
    carpet: [163, 182, 176],
    grass: [140, 168, 119],
    water: [119, 167, 175],
    books: [180, 151, 111],
  };
  for (let y = 0; y < width; y++)
    for (let x = 0; x < width; x++) {
      const noise = (((x * 17 + y * 31 + x * y * 7) % 7) - 3) * 1.5;
      let color = [...palette[kind]],
        shade = noise;
      if (kind === "stone" && (x < 1 || y < 1)) shade -= 30;
      if (kind === "wood")
        shade += (x % 7 === 0 ? -18 : 0) + ((x * 3 + y) % 11 === 0 ? 9 : 0);
      if (kind === "books") {
        color = [
          [167, 151, 110],
          [113, 142, 136],
          [169, 113, 85],
          [191, 177, 136],
        ][Math.floor(x / 3) % 4];
        if (y % 7 === 0) shade -= 43;
      }
      if (kind === "water") shade += (x + y * 2) % 9 < 2 ? 16 : 0;
      for (let c = 0; c < 3; c++)
        data[(y * width + x) * 4 + c] = Math.max(
          0,
          Math.min(255, color[c] + shade),
        );
      data[(y * width + x) * 4 + 3] = 255;
    }
  return { width, height: width, data };
}
const kindLayer = (s: Surface) =>
  s.kind === "floor"
    ? "floor"
    : ["road", "garden", "crosswalk"].includes(s.kind)
      ? "terrain"
      : s.kind === "room"
        ? "rooms"
        : s.kind === "corridor"
          ? "passages"
          : s.kind === "wall"
            ? "walls"
            : "fixtures";
function clipRing(
  ring: Point[],
  axis: "x" | "y",
  edge: number,
  above: boolean,
): Point[] {
  const result: Point[] = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i],
      b = ring[(i + 1) % ring.length],
      insideA = above ? a[axis] >= edge : a[axis] <= edge,
      insideB = above ? b[axis] >= edge : b[axis] <= edge;
    if (insideA) result.push(a);
    if (insideA !== insideB) {
      const t = (edge - a[axis]) / (b[axis] - a[axis]);
      result.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  return result;
}
export function stairMesh(
  polygon: Polygon,
  scale: number,
  material: number,
  sideMaterial: number,
): Primitive[] {
  const box = bounds(polygon.flat()),
    axis = box.width >= box.height ? "x" : "y",
    start = box[axis],
    length = axis === "x" ? box.width : box.height;
  const count = Math.max(3, Math.min(12, Math.round(length / 2))),
    result: Primitive[] = [];
  for (let i = 0; i < count; i++) {
    const clipped = polygon.map((r) =>
      clipRing(
        clipRing(r, axis, start + (length * i) / count, true),
        axis,
        start + (length * (i + 1)) / count,
        false,
      ),
    );
    if (clipped[0]?.length >= 3)
      result.push(
        ...polygonMesh(
          clipped,
          (0.08 + ((i + 1) / count) * 0.75) * scale,
          0,
          material,
          sideMaterial,
        ),
      );
  }
  return result;
}

type ModelAsset = {
  parts: Primitive[];
  materials: RasterMaterial[];
  minZ: number;
  height: number;
  sha256: string;
};
export function createIndoorBaker(root: string, sources: Sources) {
  const cache = new Map<string, Promise<ModelAsset>>();
  const asset = (src: string) => {
    if (!cache.has(src))
      cache.set(
        src,
        (async () => {
          const glb = await loadGlb(
            resolve(root, "data/maps", src.replace(/^\/res\/projects\//, "")),
          );
          const parts = primitives(glb),
            images = await textures(glb),
            z = parts.flatMap((p) => p.vertices.map((v) => v[2]));
          const minZ = Math.min(...z);
          return {
            parts,
            materials: modelMaterials(glb, images),
            minZ,
            height: Math.max(...z) - minZ,
            sha256: createHash("sha256").update(glb.bytes).digest("hex"),
          };
        })(),
      );
    return cache.get(src)!;
  };
  return async (scene: SceneMap) => {
    const width = scene.width * 16,
      height = scene.height * 16,
      scale = scene.units.pixelsPerProjectedUnit;
    const convert = (v: number[]) => {
      const q = project(v, {
        ...config.transform,
        pixelsPerProjectedUnit: scale,
      });
      return { x: q.x + scene.sourceOffset.x, y: q.y + scene.sourceOffset.y };
    };
    const materials: RasterMaterial[] = [
      "stone",
      "concrete",
      "wood",
      "carpet",
      "grass",
      "water",
      "books",
    ].map((kind) => ({ factor: [1, 1, 1, 1], texture: tileTexture(kind) }));
    const material = {
      stone: 0,
      concrete: 1,
      wood: 2,
      carpet: 3,
      grass: 4,
      water: 5,
      books: 6,
      glass: materials.length,
      shadow: materials.length + 1,
    };
    materials.push(
      { factor: [0.65, 0.8, 0.82, 1] },
      { factor: [0.68, 0.71, 0.64, 1] },
    );
    const groups = new Map<string, Primitive[]>(
      ["floor", "terrain", "rooms", "passages", "fixtures", "walls"].map(
        (id) => [id, []],
      ),
    );
    const sourceLayers = layers(sources[scene.sourceMap], scene.floor.key);
    const featureInfo = new Map(
      sourceLayers.flatMap((layer) =>
        (layer.data?.features ?? []).map(
          (f) => [f.properties.id, { feature: f, layer }] as const,
        ),
      ),
    );
    const modelIds = new Set<number>(),
      modelMaterialOffsets = new Map<string, number>();
    const models: {
      featureId: number;
      sourceLayer: string;
      sha256: string;
      triangles: number;
    }[] = [];
    const visible = (points: Point[]) => {
      if (!points.length) return false;
      const box = bounds(points);
      return (
        box.x + box.width >= -24 &&
        box.y + box.height >= -24 &&
        box.x <= width + 24 &&
        box.y <= height + 24
      );
    };
    const addShadow = (polygon: Polygon, elevation: number, group: string) => {
      if (elevation < 1) return;
      const shadow = polygon.map((r) =>
        r.map((p) => ({
          x: p.x + elevation * 0.32,
          y: p.y + elevation * 0.24,
        })),
      );
      groups
        .get(group)!
        .push(...polygonMesh(shadow, 0.14, 0.14, material.shadow));
    };
    for (const s of scene.surfaces) {
      const info = featureInfo.get(s.sourceId),
        f = info?.feature;
      if (
        s.kind === "roof" ||
        !f?.properties.src?.endsWith(".glb") ||
        !f.properties.tarray ||
        modelIds.has(s.sourceId) ||
        !visible(s.polygons.flat(2))
      )
        continue;
      modelIds.add(s.sourceId);
      const src = f.properties.src as string,
        model = await asset(src);
      if (!modelMaterialOffsets.has(src)) {
        modelMaterialOffsets.set(src, materials.length);
        materials.push(...model.materials);
      }
      const offset = modelMaterialOffsets.get(src)!;
      const matrix = f.properties.tarray as number[],
        realHeight = Math.min(
          2.5,
          f.properties.height ?? model.height * Math.abs(matrix[10] || 1),
        );
      const zFactor = model.height > 0 ? realHeight / model.height : 1;
      const parts = model.parts.map(
        (p): Primitive => ({
          ...p,
          node: `feature-${s.sourceId}:${p.node}`,
          material: p.material < 0 ? material.concrete : p.material + offset,
          vertices: p.vertices.map((v): Vec3 => {
            const placed = transformPoint(matrix, v),
              q = convert(placed);
            return [q.x, q.y, (v[2] - model.minZ) * zFactor * scale];
          }),
        }),
      );
      const group = kindLayer(s);
      for (const polygon of s.polygons)
        addShadow(polygon, realHeight * scale, group);
      groups.get(group)!.push(...parts);
      models.push({
        featureId: s.sourceId,
        sourceLayer: s.sourceLayer,
        sha256: model.sha256,
        triangles: parts.reduce((n, p) => n + p.indices.length / 3, 0),
      });
    }
    let extruded = 0,
      steps = 0;
    for (const s of scene.surfaces) {
      if (
        s.kind === "roof" ||
        modelIds.has(s.sourceId) ||
        !s.polygons.length ||
        !visible(s.polygons.flat(2))
      )
        continue;
      const group = kindLayer(s),
        target = groups.get(group)!;
      const info = featureInfo.get(s.sourceId),
        sourceHeight =
          info?.feature.properties.height ??
          info?.layer.layerStyle?.height ??
          0;
      const floorMaterial = /洗手间/.test(s.sourceLayer)
        ? material.stone
        : /实验室|办公室/.test(s.sourceLayer)
          ? material.carpet
          : material.wood;
      for (const polygon of s.polygons) {
        if (s.kind === "floor")
          target.push(
            ...polygonMesh(
              polygon,
              0,
              -scale * 0.35,
              material.stone,
              material.concrete,
            ),
          );
        else if (s.kind === "corridor")
          target.push(...polygonMesh(polygon, 0.08, 0.08, material.stone));
        else if (s.kind === "room")
          target.push(...polygonMesh(polygon, 0.04, 0.04, floorMaterial));
        else if (s.kind === "garden")
          target.push(
            ...polygonMesh(polygon, 0.16, 0, material.grass, material.concrete),
          );
        else if (s.kind === "water")
          target.push(...polygonMesh(polygon, 0.03, 0.03, material.water));
        else if (s.kind === "stairs") {
          target.push(
            ...stairMesh(polygon, scale, material.concrete, material.concrete),
          );
          steps++;
        } else {
          const wall = s.kind === "wall",
            shelf = /书柜|书架|储物柜/.test(s.sourceLayer),
            seat = /座位|座椅|休闲|休息/.test(s.sourceLayer),
            lift = s.kind === "lift";
          const elevation =
            (wall
              ? Math.min(2, Math.max(1.4, sourceHeight))
              : shelf
                ? 1.5
                : seat
                  ? 0.45
                  : lift
                    ? 2
                    : Math.min(1.2, Math.max(0.25, sourceHeight))) * scale;
          const mat = /玻璃/.test(s.sourceLayer)
            ? material.glass
            : shelf
              ? material.wood
              : seat
                ? material.wood
                : material.concrete;
          addShadow(polygon, elevation, group);
          target.push(
            ...polygonMesh(
              polygon,
              elevation,
              0,
              mat,
              shelf ? material.books : mat,
            ),
          );
          extruded++;
        }
      }
    }
    const viewport = { x: 0, y: 0, width, height },
      projection = (v: number[]) => ({ x: v[0], y: v[1] });
    const render = async (parts: Primitive[]) =>
      renderPrimitives(
        parts,
        materials,
        projection,
        1,
        config.roofHeightFactor,
        viewport,
      );
    const base = await sharp({
      create: { width, height, channels: 4, background: "#596a5b" },
    })
      .png({ compressionLevel: 9 })
      .toBuffer();
    const images = new Map<string, Uint8Array>([["base", base]]);
    for (const [id, parts] of groups) images.set(id, (await render(parts)).png);
    const all = [...groups.values()].flat(),
      rendered = await render(all);
    const ground = await sharp(base)
      .composite([{ input: rendered.png }])
      .png({ compressionLevel: 9 })
      .toBuffer();
    return {
      ground,
      layers: images,
      report: {
        sceneId: scene.id,
        sourceMap: scene.sourceMap,
        floor: scene.floor.key,
        renderer: "shared-outdoor-orthographic-pixel-rasterizer",
        projectionRise: config.roofHeightFactor,
        pixels: { width, height },
        sourceModelInstances: models.length,
        sourceModels: models,
        extrudedPolygons: extruded,
        steppedStairs: steps,
        triangles: rendered.triangleCount,
        pixelSha256: createHash("sha256").update(ground).digest("hex"),
      },
    };
  };
}
