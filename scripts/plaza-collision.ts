import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { campusPlacement, parseGlb, primitives } from "./gltf.ts";
import { bounds, getFeature, type SourceMap } from "./source-geometry.ts";
import type { Point, SceneMap } from "../src/shared/world.ts";

/** Rasterize the same placed GLB in XY. Z chooses the surface underfoot, so a
 * stone crossing above basin water stays open and the bird's raised wings do
 * not block an entire landmark rectangle. */
export function stampRedBirdPlaza(
  scene: SceneMap,
  source: SourceMap,
  convert: (p: number[]) => Point,
) {
  const f = getFeature(source, 43597);
  const file = resolve(
    import.meta.dirname,
    "../data/maps",
    f.properties.src.replace(/^\/res\/projects\//, ""),
  );
  const glb = parseGlb(readFileSync(file));
  const parts = primitives(
    glb,
    campusPlacement(glb, f.properties.tarray, f.properties.height),
  );
  const water = parts.find((part) => part.node === "SHUI");
  const pedestal = parts
    .filter((part) => part.node === "柱体.004")
    .sort(
      (a, b) =>
        Math.max(...b.vertices.map((v) => v[2])) -
        Math.max(...a.vertices.map((v) => v[2])),
    )[0];
  if (!water || !pedestal || !parts.some((p) => p.node === "柱体"))
    throw new Error("Missing plaza collision geometry");
  const grid = scene.collisionSize,
    width = (scene.width * scene.tileSize) / grid;
  type Surface = "water" | "apron" | "stone" | "bird";
  const top = new Map<number, { z: number; surface: Surface }>();
  for (const part of parts) {
    const surface: Surface =
      part.material === water.material
        ? "water"
        : part.node === "柱体"
          ? "bird"
          : part === pedestal
            ? "stone"
            : "apron";
    const xy = part.vertices.map(convert);
    for (let i = 0; i < part.indices.length; i += 3) {
      const [ia, ib, ic] = part.indices.slice(i, i + 3),
        [a, b, c] = [xy[ia], xy[ib], xy[ic]];
      const area = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
      if (Math.abs(area) < 0.00001) continue;
      const box = bounds([a, b, c]);
      for (
        let y = Math.max(0, Math.floor(box.y / grid));
        y <
        Math.min(
          (scene.height * scene.tileSize) / grid,
          Math.ceil((box.y + box.height) / grid),
        );
        y++
      ) {
        for (
          let x = Math.max(0, Math.floor(box.x / grid));
          x < Math.min(width, Math.ceil((box.x + box.width) / grid));
          x++
        ) {
          const dx = (x + 0.5) * grid - a.x,
            dy = (y + 0.5) * grid - a.y;
          const u = (dx * (c.y - a.y) - dy * (c.x - a.x)) / area,
            v = ((b.x - a.x) * dy - (b.y - a.y) * dx) / area;
          if (u < 0 || v < 0 || u + v > 1) continue;
          const z =
              (1 - u - v) * part.vertices[ia][2] +
              u * part.vertices[ib][2] +
              v * part.vertices[ic][2],
            key = y * width + x;
          if (z > (top.get(key)?.z ?? -Infinity)) top.set(key, { z, surface });
        }
      }
    }
  }
  // The support primitive also contains the outer plaza paving. Only its
  // connected central island touches the sculpture, across the tops of the
  // plinth's nested stone tiers.
  const plinth = [...top]
    .filter(([, hit]) => hit.surface === "bird")
    .map(([cell]) => cell);
  const foot = new Set(plinth);
  for (let i = 0; i < plinth.length; i++) {
    const cell = plinth[i];
    for (const n of [cell - 1, cell + 1, cell - width, cell + width])
      if (!foot.has(n) && top.get(n)?.surface === "stone") {
        foot.add(n);
        plinth.push(n);
      }
  }
  let waterCells = 0;
  for (const [cell, hit] of top) {
    if (hit.surface === "water") {
      scene.collision[cell] = 1;
      waterCells++;
    }
  }
  for (const cell of foot) scene.collision[cell] = 1;
  if (!waterCells || !foot.size)
    throw new Error("Empty plaza collision footprint");
  return {
    featureId: 43597,
    waterNode: water.node,
    waterMaterial: water.material,
    sculptureNode: "柱体",
    supportNode: pedestal.node,
    visibleWaterCells: waterCells,
    plinthCells: foot.size,
  };
}
