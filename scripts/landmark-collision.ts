import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { campusPlacement, parseGlb, primitives } from "./gltf.ts";
import {
  bounds,
  distanceSegment,
  getFeature,
  inRing,
  type SourceMap,
} from "./source-geometry.ts";
import type { Point, SceneMap } from "../src/shared/world.ts";

// These are the surveyed freestanding props in the cropped campus scene.
// The bird court has separate, height-aware water, bridge and plinth collision.
const planters = [45972, 45974, 45975, 48569];
const treeGroups = [45779, 45953, 45955];
const shelters = [49275, 49276, 49277, 49278, 49279, 49280, 49281, 49282];

function below(face: number[][], z: number) {
  const cut: number[][] = [];
  for (let i = 0; i < face.length; i++) {
    const a = face[i],
      b = face[(i + 1) % face.length];
    if (a[2] <= z) cut.push(a);
    if (a[2] <= z === b[2] <= z) continue;
    const t = (z - a[2]) / (b[2] - a[2]);
    cut.push([a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1]), z]);
  }
  return cut;
}

/** Project only the low, physically solid part of each placed mesh. This keeps
 * paving under canopies and between planter arcs open, including sub-pixel posts. */
export function stampLandmarkFeet(
  blocks: Uint8Array,
  scene: SceneMap,
  source: SourceMap,
  convert: (v: number[]) => Point,
) {
  const width = scene.width * scene.tileSize,
    height = scene.height * scene.tileSize;
  for (const id of [...planters, ...treeGroups, ...shelters, 50038]) {
    const props = getFeature(source, id).properties;
    const asset = resolve(
      import.meta.dirname,
      "../data/maps",
      props.src.replace(/^\/res\/projects\//, ""),
    );
    const glb = parseGlb(readFileSync(asset));
    const parts = primitives(
      glb,
      campusPlacement(glb, props.tarray, props.height),
    );
    // The concentric planting islands have a one-unit curb below their cap.
    const cut = id === 48569 ? props.height + 0.01 : 0.8;
    for (const part of parts) {
      const name = glb.json.materials?.[part.material]?.name ?? "";
      if (/树叶|网格/.test(name)) continue;
      for (let i = 0; i < part.indices.length; i += 3) {
        const face = below(
          part.indices.slice(i, i + 3).map((j) => part.vertices[j]),
          cut,
        ).map(convert);
        if (face.length < 3) continue;
        const b = bounds(face);
        for (
          let y = Math.max(0, Math.floor(b.y - 0.5));
          y < Math.min(height, b.y + b.height + 0.5);
          y++
        )
          for (
            let x = Math.max(0, Math.floor(b.x - 0.5));
            x < Math.min(width, b.x + b.width + 0.5);
            x++
          ) {
            const p = { x: x + 0.5, y: y + 0.5 };
            if (
              inRing(p, face) ||
              face.some(
                (a, i) =>
                  distanceSegment(p, a, face[(i + 1) % face.length]) <= 0.5,
              )
            )
              blocks[y * width + x] = 1;
          }
      }
    }
  }
}
