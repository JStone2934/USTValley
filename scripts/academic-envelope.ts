import type { Point, SceneMap, Surface } from "../src/shared/world.ts";
import { inPolygon, type Polygon } from "./source-geometry.ts";
import type { Primitive } from "./gltf.ts";
import type { InteriorInk } from "./interior-materials.ts";

type Mesh = (
  p: Polygon,
  top: number,
  bottom: number,
  ink: number,
  side?: number,
) => Primitive[];
type Trace = { source: number; indices: number[]; kind: "rail" | "glass" };
const span = (a: number, b: number) =>
  Array.from(
    { length: Math.abs(b - a) + 1 },
    (_, i) => a + i * Math.sign(b - a),
  );
// Survey wall polygons sometimes join the balcony edge to room partitions.
// Trace only the exposed edge, not the entire feature. Indices are source-ring
// vertices (including doorway interruptions), never inferred straight shortcuts.
const traces: Record<string, Trace[]> = {
  "1": [
    { source: 45179, indices: span(223, 298), kind: "rail" },
    { source: 45178, indices: span(21, 47), kind: "rail" },
    { source: 45105, indices: span(0, 31), kind: "rail" },
    { source: 45180, indices: span(118, 148), kind: "rail" },
    {
      source: 45182,
      indices: [...span(0, 26), ...span(269, 328)],
      kind: "rail",
    },
    { source: 44821, indices: span(0, 40), kind: "glass" },
    { source: 45179, indices: span(0, 147), kind: "glass" },
    { source: 45179, indices: span(314, 326), kind: "glass" },
    { source: 45179, indices: span(355, 362), kind: "glass" },
    { source: 45179, indices: span(365, 418), kind: "glass" },
    // Curved pavilion facades are separate source features from the balcony.
    { source: 44825, indices: span(65, 75), kind: "glass" },
    { source: 44825, indices: span(83, 89), kind: "glass" },
    { source: 44847, indices: span(1, 5), kind: "glass" },
    { source: 44847, indices: span(13, 16), kind: "glass" },
    { source: 44823, indices: span(15, 19), kind: "glass" },
    { source: 44820, indices: span(20, 26), kind: "glass" },
    { source: 44819, indices: span(0, 3), kind: "glass" },
    { source: 44819, indices: span(24, 26), kind: "glass" },
    { source: 44819, indices: span(33, 34), kind: "glass" },
    { source: 44819, indices: span(41, 43), kind: "glass" },
    { source: 44819, indices: span(53, 57), kind: "glass" },
    { source: 44819, indices: span(80, 81), kind: "glass" },
    { source: 44819, indices: span(118, 121), kind: "glass" },
    { source: 44819, indices: span(129, 131), kind: "glass" },
    { source: 45181, indices: span(0, 6), kind: "glass" },
    { source: 45105, indices: span(58, 67), kind: "glass" },
    {
      source: 45105,
      indices: [...span(72, 78), 241, 242, 243, 244, 247, 248],
      kind: "glass",
    },
    { source: 45105, indices: span(199, 209), kind: "glass" },
    { source: 45180, indices: span(65, 85), kind: "glass" },
    { source: 45180, indices: span(162, 172), kind: "glass" },
    { source: 45180, indices: span(178, 185), kind: "glass" },
    { source: 45182, indices: span(28, 46), kind: "glass" },
    { source: 45182, indices: span(153, 192), kind: "glass" },
    { source: 45182, indices: span(249, 268), kind: "glass" },
    { source: 45102, indices: [1, 2], kind: "glass" },
    { source: 45103, indices: [0, 1, 2], kind: "glass" },
    { source: 45104, indices: [1, 2], kind: "glass" },
  ],
  "2": [
    { source: 44924, indices: span(0, 64), kind: "rail" },
    { source: 44923, indices: span(18, 39), kind: "rail" },
    { source: 44909, indices: span(0, 20), kind: "rail" },
    { source: 44915, indices: span(18, 39), kind: "rail" },
    { source: 44908, indices: span(0, 53), kind: "rail" },
    { source: 44914, indices: span(0, 28), kind: "rail" },
    { source: 44925, indices: span(0, 37), kind: "glass" },
    { source: 44918, indices: span(25, 39), kind: "glass" },
    { source: 44922, indices: span(53, 62), kind: "glass" },
    { source: 44932, indices: span(27, 35), kind: "glass" },
  ],
};
function distance(p: Point, a: Point, b: Point) {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    t = Math.max(
      0,
      Math.min(
        1,
        ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1),
      ),
    );
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
export function academicEnvelope(
  scene: SceneMap,
  ink: Record<InteriorInk, number>,
  mesh: Mesh,
) {
  if (scene.sourceMap !== "xgkjdgz_xsyjzx" || !traces[scene.floor.key])
    return undefined;
  const ppm = scene.units.pixelsPerMeter;
  const paths = traces[scene.floor.key].map((trace) => {
    const surface = scene.surfaces.find((s) => s.sourceId === trace.source)!;
    if (!surface) throw new Error(`Missing academic envelope ${trace.source}`);
    const ring = surface.polygons[0][0];
    const points = trace.indices.map((i) => {
      if (!ring[i])
        throw new Error(`Changed envelope ring ${trace.source}:${i}`);
      return ring[i];
    });
    return { ...trace, points, surface };
  });
  const nearest = (p: Point, source: number, kind: "rail" | "glass") => {
    let d = Infinity;
    for (const path of paths)
      if (path.source === source && path.kind === kind)
        for (let i = 1; i < path.points.length; i++)
          d = Math.min(d, distance(p, path.points[i - 1], path.points[i]));
    return d;
  };
  const role = (p: Point, source: number) =>
    nearest(p, source, "rail") < 2.7
      ? "rail"
      : nearest(p, source, "glass") < 2.1
        ? "glass"
        : "wall";
  const extras: Primitive[] = [];
  const beam = (
    a: Point,
    b: Point,
    width: number,
    lo: number,
    hi: number,
    mat: number,
    node: string,
  ) => {
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (len < 0.001) return;
    const nx = ((-(b.y - a.y) / len) * width) / 2,
      ny = (((b.x - a.x) / len) * width) / 2;
    const p = [
      [
        { x: a.x + nx, y: a.y + ny },
        { x: b.x + nx, y: b.y + ny },
        { x: b.x - nx, y: b.y - ny },
        { x: a.x - nx, y: a.y - ny },
      ],
    ];
    extras.push(...mesh(p, hi, lo, mat).map((p) => ({ ...p, node })));
  };
  const post = (
    p: Point,
    size: number,
    lo: number,
    hi: number,
    mat: number,
    node: string,
  ) =>
    beam(
      { x: p.x - size / 2, y: p.y },
      { x: p.x + size / 2, y: p.y },
      size,
      lo,
      hi,
      mat,
      node,
    );
  for (const path of paths) {
    const rail = path.kind === "rail",
      height = (rail ? 1.1 : 1.95) * ppm;
    // Offset into the original wall ribbon, so thin posts remain grounded on it.
    const points = path.points.map((p, i, all) => {
      const a = all[Math.max(0, i - 1)],
        b = all[Math.min(all.length - 1, i + 1)],
        l = Math.hypot(b.x - a.x, b.y - a.y) || 1;
      let nx = -(b.y - a.y) / l,
        ny = (b.x - a.x) / l;
      if (
        !path.surface.polygons.some((poly) =>
          inPolygon({ x: p.x + nx * 0.7, y: p.y + ny * 0.7 }, poly),
        )
      ) {
        nx = -nx;
        ny = -ny;
      }
      return { x: p.x + nx * 0.7, y: p.y + ny * 0.7 };
    });
    let travelled = 0,
      nextPost = 0,
      nextFlower = ppm * 0.65;
    const spacing = (rail ? 0.24 : 1.4) * ppm;
    for (let i = 1; i < points.length; i++) {
      const a = points[i - 1],
        b = points[i],
        len = Math.hypot(b.x - a.x, b.y - a.y);
      if (!len) continue;
      beam(
        a,
        b,
        (rail ? 0.1 : 0.42) * ppm,
        height - 0.09 * ppm,
        height,
        ink.railWhite,
        `${path.kind}-handrail`,
      );
      beam(
        a,
        b,
        (rail ? 0.07 : 0.42) * ppm,
        (rail ? 0.15 : 0.04) * ppm,
        (rail ? 0.21 : 0.1) * ppm,
        ink.railWhite,
        `${path.kind}-lower-rail`,
      );
      while (nextPost <= travelled + len) {
        const t = (nextPost - travelled) / len;
        if (t >= 0) {
          const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
          if (rail) post(p, 0.055 * ppm, 0, height, ink.railWhite, "rail-post");
          else {
            const dx = ((b.x - a.x) / len) * 0.035 * ppm,
              dy = ((b.y - a.y) / len) * 0.035 * ppm;
            beam(
              { x: p.x - dx, y: p.y - dy },
              { x: p.x + dx, y: p.y + dy },
              0.42 * ppm,
              0,
              height,
              ink.railWhite,
              "glass-mullion",
            );
          }
        }
        nextPost += spacing;
      }
      // Photographed bougainvillea: low, occasional clusters leave the white
      // pickets readable and never add collision or cover an entrance opening.
      while (rail && path.source !== 44914 && nextFlower <= travelled + len) {
        const t = (nextFlower - travelled) / len,
          n = Math.floor(nextFlower / (ppm * 0.65));
        if (
          t >= 0 &&
          n % 13 < 8 &&
          nextFlower > ppm &&
          travelled + len - nextFlower > 0
        ) {
          const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
          post(
            p,
            0.24 * ppm,
            0.66 * ppm,
            0.84 * ppm,
            ink.vineLeaf,
            "balcony-vine",
          );
          post(
            { x: p.x + 0.09 * ppm, y: p.y },
            0.17 * ppm,
            0.8 * ppm,
            (0.94 + (n % 3) * 0.04) * ppm,
            n % 3 ? ink.flowerPink : ink.flowerRose,
            "balcony-flower",
          );
        }
        nextFlower += ppm * 0.65;
      }
      travelled += len;
    }
    post(
      points.at(-1)!,
      0.08 * ppm,
      0,
      height,
      ink.railWhite,
      `${path.kind}-end-post`,
    );
  }
  return {
    extras,
    decorate(surface: Surface, polygon: Polygon): Primitive[] | undefined {
      if (!paths.some((p) => p.source === surface.sourceId)) return undefined;
      const solid = mesh(polygon, 1.95 * ppm, 0, ink.wallCap, ink.masonry);
      // Split the baked triangles by surveyed envelope band. Room partitions
      // retain their original finish; the outer band becomes open pickets.
      const result: Primitive[] = [];
      for (const part of solid) {
        const groups = new Map<string, number[]>();
        for (let i = 0; i < part.indices.length; i += 3) {
          const ids = part.indices.slice(i, i + 3),
            v = ids.map((id) => part.vertices[id]);
          const p = {
            x: v.reduce((n, v) => n + v[0], 0) / 3,
            y: v.reduce((n, v) => n + v[1], 0) / 3,
          };
          const kind = role(p, surface.sourceId);
          if (kind === "rail") continue;
          const list = groups.get(kind) ?? [];
          list.push(...ids);
          groups.set(kind, list);
        }
        for (const [kind, indices] of groups)
          result.push({
            ...part,
            indices,
            material: kind === "glass" ? ink.campusGlass : part.material,
            node: `academic-${kind}`,
          });
      }
      return result;
    },
    report: {
      reference: "User campus photograph, 2026-11-08",
      glass: "white-framed blue-green glazing",
      railing: "white vertical pickets, 1.1m",
      sourceFeatures: [...new Set(paths.map((p) => p.source))],
    },
  };
}
