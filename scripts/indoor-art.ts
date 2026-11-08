import { academicEnvelope } from "./academic-envelope.ts";
import {
  fixedGlazing,
  inferredDoorReturns,
  roomOpeningArt,
  entranceOpeningArt,
} from "./doorway-art.ts";
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
  inPolygon,
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
  type Vec3,
} from "./gltf.ts";
import {
  interiorMaterials,
  roomFinish,
  type InteriorInk,
} from "./interior-materials.ts";

import type { RoomCasework } from "../src/shared/casework.ts";
import { roomPanel, wallFootprint } from "./room-fittings.ts";

import {
  isLibraryTerrace,
  libraryPhotoReferences,
  libraryTerrace,
  libraryStudySet,
  photoFloorInk,
  studyInlays,
} from "./library-photo-art.ts";
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
    uv: flat.map((p) => [p.x / 16, p.y / 16]),
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
          length = Math.hypot(b.x - a.x, b.y - a.y) / 16;
        side.vertices.push(
          [a.x, a.y, bottom],
          [b.x, b.y, bottom],
          [b.x, b.y, top],
          [a.x, a.y, top],
        );
        side.uv.push(
          [0, 0],
          [length, 0],
          [length, (top - bottom) / 16],
          [0, (top - bottom) / 16],
        );
        side.indices.push(n, n + 1, n + 2, n, n + 2, n + 3);
      }
    result.push(side);
  }
  return result;
}
const kindLayer = (s: Surface) =>
  s.kind === "floor"
    ? "floor"
    : ["road", "garden", "water", "crosswalk"].includes(s.kind)
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
function rotate(p: Point, angle: number): Point {
  const c = Math.cos(angle),
    s = Math.sin(angle);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}
export function stairMesh(
  polygon: Polygon,
  scale: number,
  material: number,
  sideMaterial: number,
  edgeMaterial = material,
): Primitive[] {
  // Recover the flight bearing from its footprint. The buildings are rotated
  // relative to screen axes, and the drawing does not record an uphill arrow.
  const ring = polygon[0];
  let bearing = 0,
    smallestArea = Infinity;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i],
      b = ring[(i + 1) % ring.length];
    if (Math.hypot(b.x - a.x, b.y - a.y) < 0.01) continue;
    const angle = Math.atan2(b.y - a.y, b.x - a.x);
    const box = bounds(ring.map((p) => rotate(p, -angle)));
    const area = box.width * box.height;
    if (area + 0.001 < smallestArea) {
      smallestArea = area;
      bearing = angle + (box.width < box.height ? Math.PI / 2 : 0);
    }
  }
  if (
    Math.sin(bearing) > 0.001 ||
    (Math.abs(Math.sin(bearing)) <= 0.001 && Math.cos(bearing) < 0)
  )
    bearing += Math.PI;
  const local = polygon.map((r) => r.map((p) => rotate(p, -bearing)));
  const box = bounds(local[0]),
    start = box.x,
    length = box.width;
  const axis = "x";
  const count = Math.max(3, Math.min(12, Math.round(length / 2))),
    result: Primitive[] = [];
  for (let i = 0; i < count; i++) {
    const clipped = local.map((r) =>
      clipRing(
        clipRing(r, axis, start + (length * i) / count, true),
        axis,
        start + (length * (i + 1)) / count,
        false,
      ).map((p) => rotate(p, bearing)),
    );
    if (clipped[0]?.length >= 3) {
      result.push(
        ...polygonMesh(
          clipped,
          (0.08 + ((i + 1) / count) * 0.75) * scale,
          0,
          material,
          sideMaterial,
        ),
      );
      const left = start + (length * i) / count;
      const nose = local.map((r) =>
        clipRing(
          clipRing(r, axis, left, true),
          axis,
          left + Math.min(1.05, (length / count) * 0.54),
          false,
        ).map((p) => rotate(p, bearing)),
      );
      if (nose[0].length >= 3) {
        const z = (0.08 + ((i + 1) / count) * 0.75) * scale + 0.01;
        result.push(...polygonMesh(nose, z, z, edgeMaterial));
      }
    }
  }
  // The source flight supplies the envelope. Keep a slender rail only on
  // long, near-rectangular flights where it stays completely above the steps.
  const posts = [0.12, 0.5, 0.88],
    thickness = scale * 0.12;
  if (length > 2.5 * scale && box.height > 1.4 * scale) {
    for (const side of [
      box.y + thickness,
      box.y + box.height - 2 * thickness,
    ]) {
      const at = (run: number, across: number) => ({
        x: start + length * run,
        y: side + across * thickness,
      });
      if (
        !Array.from({ length: 12 }, (_, i) => 0.1 + (i * 0.8) / 11).every((t) =>
          [0, 1].every((d) => inPolygon(at(t, d), local)),
        )
      )
        continue;
      const rail = [at(0.1, 0), at(0.9, 0), at(0.9, 1), at(0.1, 1)];
      const height = (x: number) =>
        (0.08 + (0.75 * (x - start)) / length) * scale;
      const railParts = polygonMesh(
        [rail],
        0.84 * scale,
        0.7 * scale,
        edgeMaterial,
        sideMaterial,
      );
      for (const part of railParts) {
        part.node = "stair-rail";
        part.vertices = part.vertices.map(([x, y, z]) => {
          const p = rotate({ x, y }, bearing);
          return [p.x, p.y, z + height(x)];
        });
      }
      result.push(...railParts);
      for (const t of posts) {
        const half = thickness / length / 2;
        const footprint = [
          at(t - half, 0),
          at(t + half, 0),
          at(t + half, 1),
          at(t - half, 1),
        ].map((p) => rotate(p, bearing));
        const z = height(at(t, 0).x);
        result.push(
          ...polygonMesh([footprint], z + 0.73 * scale, z, sideMaterial),
        );
      }
    }
  }
  return result;
}

// Stylised fixtures use only explicit source point locations. Their sizes and
// finishes are illustrative. The source-centred footprint is reserved during the world build.
function pointFixture(
  point: Point,
  scale: number,
  coffee: boolean,
  ink: Record<InteriorInk, number>,
) {
  const result: Primitive[] = [];
  function box(
    x: number,
    y: number,
    w: number,
    d: number,
    z: number,
    top: number,
    cap: InteriorInk,
    side: InteriorInk,
  ) {
    const ring = [
      [x, y],
      [x + w, y],
      [x + w, y + d],
      [x, y + d],
    ].map(([a, b]) => ({ x: point.x + a * scale, y: point.y + b * scale }));
    result.push(
      ...polygonMesh([ring], top * scale, z * scale, ink[cap], ink[side]),
    );
  }
  if (coffee) {
    box(-0.58, -0.34, 1.16, 0.68, 0, 1.75, "bronze", "enamel");
    box(-0.36, 0.34, 0.72, 0.06, 0.63, 1.34, "bronze", "pine");
    box(-0.12, 0.41, 0.27, 0.17, 0.64, 0.91, "porcelain", "porcelain");
    box(0.13, 0.35, 0.22, 0.02, 1.41, 1.58, "porcelain", "porcelain");
  } else {
    box(-0.51, -0.18, 1.02, 0.36, 0.64, 1.55, "porcelain", "pine");
    box(-0.13, 0.18, 0.26, 0.02, 0.79, 1.38, "porcelain", "porcelain");
    box(-0.34, 0.18, 0.68, 0.02, 0.97, 1.19, "porcelain", "porcelain");
  }
  return result;
}

// Subpieces use the very same four corners used to stamp the floor's collision.
function caseworkMesh(
  item: RoomCasework,
  scale: number,
  ink: Record<InteriorInk, number>,
) {
  const [a, b, , d] = item.footprint;
  const point = (u: number, v: number) => ({
    x: a.x + (b.x - a.x) * u + (d.x - a.x) * v,
    y: a.y + (b.y - a.y) * u + (d.y - a.y) * v,
  });
  const result: Primitive[] = [];
  function block(
    u0: number,
    v0: number,
    u1: number,
    v1: number,
    lo: number,
    hi: number,
    top: InteriorInk,
    side: InteriorInk,
  ) {
    const ring = [point(u0, v0), point(u1, v0), point(u1, v1), point(u0, v1)];
    result.push(
      ...polygonMesh([ring], hi * scale, lo * scale, ink[top], ink[side]),
    );
  }
  // Recessed toe-kick, frame, worktop and front edge give the silhouette
  // a separate highlight, shaded face and foot at normal walking zoom.
  const lab = item.kind === "lab-bench",
    desk = item.kind === "lectern";
  block(0.07, 0.08, 0.93, 0.9, 0, 0.18, "riser", "enamel");
  block(
    0.03,
    0.03,
    0.97,
    0.94,
    0.18,
    0.87,
    lab ? "pine" : "oak",
    lab ? "office" : "oak",
  );
  block(
    0,
    0,
    1,
    1,
    0.87,
    0.99,
    lab ? "enamel" : "bindingGold",
    lab ? "riser" : "bronze",
  );
  block(0.12, 0.94, 0.36, 0.98, 0.65, 0.72, "porcelain", "enamel");
  if (lab) {
    block(0.06, 0.15, 0.3, 0.62, 0.99, 1.08, "porcelain", "riser");
    block(0.44, 0.12, 0.61, 0.48, 0.99, 1.42, "glass", "bindingTeal");
    block(0.48, 0.19, 0.57, 0.38, 1.42, 1.58, "porcelain", "glass");
    block(0.72, 0.2, 0.88, 0.6, 0.99, 1.24, "porcelain", "bindingRust");
  } else if (desk) {
    block(0.09, 0.14, 0.47, 0.68, 0.99, 1.08, "porcelain", "bindingRust");
    block(0.6, 0.24, 0.9, 0.48, 0.99, 1.1, "enamel", "riser");
    block(0.55, 0.17, 0.94, 0.29, 1.04, 1.48, "enamel", "glass");
  } else {
    block(0.08, 0.15, 0.49, 0.65, 0.99, 1.14, "porcelain", "bindingTeal");
    for (const [u, h, material] of [
      [0.57, 1.39, "bindingRust"],
      [0.69, 1.46, "bindingTeal"],
      [0.81, 1.36, "bindingGold"],
    ] as const)
      block(u, 0.15, u + 0.105, 0.68, 0.99, h, material, material);
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
  return async (scene: SceneMap, exterior?: Buffer) => {
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
    const { materials, id: material } = interiorMaterials();
    const groups = new Map<string, Primitive[]>(
      ["floor", "terrain", "rooms", "passages", "fixtures", "walls"].map(
        (id) => [id, []],
      ),
    );
    const entries = scene.portals.flatMap((p) =>
      p.kind === "entrance" && p.entrance ? [p.entrance] : [],
    );
    const glassBays = entries.flatMap((e) => (e.glazing ? [e.glazing] : []));
    // The same jambs drive door animation, collision, the main texture,
    // separate layer images, the map panel and pixel-height occlusion.
    for (const door of scene.doors ?? []) {
      const art = roomOpeningArt(
        door,
        scene.units.pixelsPerMeter,
        material,
        polygonMesh,
      );
      groups.get("rooms")!.push(...art.floor);
      groups.get("walls")!.push(...art.walls);
    }
    const returns = inferredDoorReturns(scene);
    for (const piece of returns) {
      const target = groups.get("walls")!;
      target.push(
        ...polygonMesh(
          piece,
          1.1 * scale,
          0,
          material.wallCap,
          material.masonry,
        ),
      );
      const dado = polygonMesh(
        piece,
        0.52 * scale,
        0.12 * scale,
        material.dado,
      )[1];
      if (dado) target.push(dado);
    }
    for (const e of entries) {
      const art = entranceOpeningArt(
        e,
        scene.units.pixelsPerMeter,
        material,
        polygonMesh,
      );
      groups.get("passages")!.push(...art.floor);
      groups.get("walls")!.push(...art.walls);
    }
    const sourceLayers = layers(sources[scene.sourceMap], scene.floor.key);
    const featureInfo = new Map(
      sourceLayers.flatMap((layer) =>
        (layer.data?.features ?? []).map(
          (f) => [f.properties.id, { feature: f, layer }] as const,
        ),
      ),
    );
    const photoSets: number[] = [],
      terraces: number[] = [];
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
    const darkCarpet =
      scene.sourceMap === "xgkdgz_tsg" && scene.floor.key === "2";
    const addShadow = (polygon: Polygon, elevation: number, group: string) => {
      if (elevation < 1) return;
      for (const [distance, z, ink] of [
        [1.0, 0.14, darkCarpet ? material.darkCarpetPenumbra : material.shadow],
        [
          0.55,
          0.15,
          darkCarpet ? material.darkCarpetContact : material.contact,
        ],
      ]) {
        const shadow = polygon.map((r) =>
          r.map((p) => ({
            x: p.x + distance * elevation * 0.37,
            y: p.y + distance * elevation * 0.27,
          })),
        );
        groups.get(group)!.push(...polygonMesh(shadow, z, z, ink));
      }
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
      const refined = libraryStudySet(
        scene,
        src,
        s.sourceId,
        material,
        polygonMesh,
      );
      if (refined) photoSets.push(s.sourceId);
      const parts = (refined ?? model.parts).map(
        (p): Primitive => ({
          ...p,
          node: `feature-${s.sourceId}:${p.node}`,
          material: refined
            ? p.material
            : p.material < 0
              ? material.masonry
              : p.material + offset,
          vertices: p.vertices.map((v): Vec3 => {
            const placed = transformPoint(matrix, v),
              q = convert(placed);
            return [q.x, q.y, (v[2] - model.minZ) * zFactor * scale];
          }),
        }),
      );
      const group = kindLayer(s);
      if (refined) {
        for (const part of parts.filter((p) =>
          p.node.endsWith(":study-caster"),
        )) {
          addShadow(
            [part.vertices.map(([x, y]) => ({ x, y }))],
            part.vertices[0][2],
            group,
          );
        }
      } else
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
    for (const item of scene.roomCasework ?? []) {
      addShadow([item.footprint], 1.05 * scale, "fixtures");
      groups.get("fixtures")!.push(...caseworkMesh(item, scale, material));
    }
    const inlays = studyInlays(scene, material, polygonMesh);
    // The open-space floor image must keep its coloured inlays when fixture
    // visibility is toggled. Its 0.09 elevation sits just above walk polygons.
    groups.get("floor")!.push(...inlays);
    const pointFixtures = scene.pointFixtures ?? [];
    for (const f of pointFixtures) {
      groups
        .get("fixtures")!
        .push(...pointFixture(f, scale, f.kind === "coffee", material));
    }
    const envelope = academicEnvelope(scene, material, polygonMesh);
    if (envelope) groups.get("walls")!.push(...envelope.extras);
    const walls = scene.surfaces
      .filter((s) => s.kind === "wall" && !/玻璃/.test(s.sourceLayer))
      .flatMap((s) =>
        s.polygons.filter((p) => visible(p.flat())).map(wallFootprint),
      );
    const inferredFittings: {
      featureId: number;
      kind: string;
      x: number;
      y: number;
    }[] = [];
    const roomFinishes: Partial<Record<InteriorInk, number>> = {};
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
      const finish = roomFinish(s.sourceLayer, info?.feature.properties ?? {});
      if (s.kind === "room")
        roomFinishes[finish] = (roomFinishes[finish] ?? 0) + 1;
      const visiblePolygons =
        s.kind === "wall" ? fixedGlazing(s, glassBays) : s.polygons;
      for (const polygon of visiblePolygons) {
        const envelopeParts =
          s.kind === "wall" ? envelope?.decorate(s, polygon) : undefined;
        if (envelopeParts) {
          target.push(...envelopeParts);
          extruded++;
          continue;
        }
        const photoInk = photoFloorInk(scene, s);
        if (isLibraryTerrace(scene, s)) {
          target.push(...libraryTerrace(polygon, scale, material, polygonMesh));
          addShadow(polygon, scale * 1.08, group);
          terraces.push(s.sourceId);
        } else if (s.kind === "floor")
          target.push(
            ...polygonMesh(
              polygon,
              0,
              -scale * 0.35,
              photoInk ? material[photoInk] : material.slab,
              material.riser,
            ),
          );
        else if (s.kind === "corridor")
          target.push(
            ...polygonMesh(
              polygon,
              0.08,
              0.08,
              photoInk ? material[photoInk] : material.passage,
            ),
          );
        else if (s.kind === "room") {
          const roomFloor = polygonMesh(polygon, 0.04, 0.04, material[finish]);
          if (roomFloor[0]) {
            // Lay boards, acoustic tiles and ceramic joints parallel to a
            // real room edge rather than running a screen-space texture across walls.
            const ring = polygon[0];
            let longest = 0,
              angle = 0;
            for (let i = 1; i < ring.length; i++) {
              const a = ring[i - 1],
                b = ring[i],
                length = Math.hypot(b.x - a.x, b.y - a.y);
              if (length > longest) {
                longest = length;
                angle = Math.atan2(b.y - a.y, b.x - a.x);
              }
            }
            roomFloor[0].uv = roomFloor[0].vertices.map(([x, y]) => {
              const p = rotate({ x: x - ring[0].x, y: y - ring[0].y }, -angle);
              return [p.x / 16, p.y / 16];
            });
          }
          target.push(...roomFloor);
          const entries = (info?.feature.properties.entry ?? []) as number[][];
          const panel = roomPanel(
            polygon,
            finish,
            entries.filter((p) => Array.isArray(p)).map(convert),
            walls,
            scale,
            material,
          );
          if (panel) {
            groups.get("fixtures")!.push(...panel.parts);
            inferredFittings.push({
              featureId: s.sourceId,
              kind: panel.kind,
              x: panel.center.x,
              y: panel.center.y,
            });
          }
        } else if (s.kind === "garden")
          target.push(
            ...polygonMesh(polygon, 0.16, 0, material.grass, material.masonry),
          );
        else if (s.kind === "water")
          target.push(...polygonMesh(polygon, 0.03, 0.03, material.water));
        else if (s.kind === "stairs") {
          target.push(
            ...stairMesh(
              polygon,
              scale,
              material.tread,
              material.riser,
              material.porcelain,
            ),
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
          // Bookcase polygons are supplied by the library floor plan. A small
          // set of cloth bindings distinguishes neighbouring stacks at game scale.
          const bindings = [
            material.bindingRust,
            material.bindingTeal,
            material.bindingGold,
            material.oak,
          ];
          const mat = /玻璃/.test(s.sourceLayer)
            ? material.glass
            : wall
              ? material.wallCap
              : shelf
                ? bindings[Math.abs(s.sourceId) % bindings.length]
                : seat
                  ? material.oak
                  : material.masonry;
          addShadow(polygon, elevation, group);
          target.push(
            ...polygonMesh(
              polygon,
              elevation,
              0,
              mat,
              wall && mat !== material.glass
                ? material.masonry
                : shelf
                  ? material.books
                  : mat,
            ),
          );
          if (wall && mat !== material.glass) {
            // A projecting skirting and a light timber picture rail give even
            // angled cut faces two readable horizontal height references.
            const band = (lo: number, hi: number, ink: number) => {
              const side = polygonMesh(
                polygon,
                elevation * hi,
                elevation * lo,
                ink,
              )[1];
              if (side) target.push(side);
            };
            band(0, 0.11, material.riser);
            band(0.11, 0.42, material.dado);
            band(0.42, 0.49, material.moulding);
            band(0.9, 0.975, material.wallCap);
          }
          extruded++;
        }
      }
    }
    const viewport = { x: 0, y: 0, width, height },
      projection = (v: number[]) => ({ x: v[0], y: v[1] });
    const pixelRatio = scene.art.pixelRatio ?? 1;
    const render = async (parts: Primitive[], includeRise = false) =>
      renderPrimitives(
        parts,
        materials,
        projection,
        1,
        config.roofHeightFactor,
        viewport,
        includeRise,
        false,
        pixelRatio,
      );
    const base =
      exterior ??
      (await sharp({
        create: {
          width: width * pixelRatio,
          height: height * pixelRatio,
          channels: 4,
          background: "#b5c6a1",
        },
      })
        .png({ compressionLevel: 6 })
        .toBuffer());
    const images = new Map<string, Uint8Array>([["base", base]]);
    for (const [id, parts] of groups) images.set(id, (await render(parts)).png);
    const all = [...groups.values()].flat(),
      rendered = await render(all, true);
    const ground = await sharp(base)
      .composite([{ input: rendered.png }])
      .png({ compressionLevel: 6 })
      .toBuffer();
    return {
      ground,
      riseMap: rendered.riseMap!,
      layers: images,
      report: {
        exteriorBackdrop: exterior
          ? "survey-aligned-campus-cutaway"
          : "garden-fallback",
        sceneId: scene.id,
        sourceMap: scene.sourceMap,
        floor: scene.floor.key,
        renderer: "shared-outdoor-orthographic-pixel-rasterizer",
        projectionRise: config.roofHeightFactor,
        pixels: { width: width * pixelRatio, height: height * pixelRatio },
        pixelRatio,
        logicalPixels: { width, height },
        ...(scene.sourceMap === "xgkdgz_tsg" &&
        ["0", "2", "4"].includes(scene.floor.key)
          ? {
              photoReference: {
                ...libraryPhotoReferences[
                  scene.floor.key === "0"
                    ? "firstFloor"
                    : scene.floor.key === "2"
                      ? "thirdFloor"
                      : "fifthFloor"
                ],
                refinedSourceSets: photoSets,
                tieredSeats: terraces,
                colourInlays: inlays.length,
              },
            }
          : {}),
        academicEnvelope: envelope?.report,
        roomFinishes,
        inferredFittings,
        inferredCasework: scene.roomCasework?.length ?? 0,
        pointFixtures,
        sourceModelInstances: models.length,
        sourceModels: models,
        extrudedPolygons: extruded,
        steppedStairs: steps,
        openings: {
          sourceJambs:
            scene.doors?.filter((d) => d.openingSource === "wall-ends")
              .length ?? 0,
          roomEdges:
            scene.doors?.filter((d) => d.openingSource === "room-edge")
              .length ?? 0,
          entranceSills: entries.length,
          inferredSolidReturns: returns.length,
          activeGlassBays: glassBays,
        },
        triangles: rendered.triangleCount,
        pixelSha256: createHash("sha256").update(ground).digest("hex"),
      },
    };
  };
}
