import type { Point, SceneMap, Surface } from "../src/shared/world.ts";
import type { Primitive } from "./gltf.ts";
import type { InteriorInk } from "./interior-materials.ts";
import { bounds, inPolygon, type Polygon } from "./source-geometry.ts";

const study =
  "https://www.lib.cuhk.edu.hk/wp-content/uploads/2025/12/integrating-tradition-and-innovation-in-library-space-design-a-case-study-of-the-hkustgz-library-space-transformation.pdf";
export const libraryPhotoReferences = {
  firstFloor: {
    url: study + "#page=9",
    observed: "Pale grey stone and white walls in the exhibition gallery.",
    registration:
      "Gallery POI 47857 in floor surface 141557 and walking polygon 509.",
  },
  thirdFloor: {
    url: study + "#page=4",
    observed:
      "Curved timber seating tiers with muted rose pads and a display under the spiral stair, coloured shell chairs and dark carpet.",
    registration:
      "The actual crescent of leisure feature 143982, the surrounding GLB table placements, and source F3 stair geometry. Cushion spacing, screen pattern and seat colours are artistic.",
  },
  fifthFloor: {
    url: study + "#page=6",
    observed:
      "Grey flooring with ochre and sand-coloured inlays, pale timber chairs, light communal tabletops and metal legs.",
    registration:
      "Original F5 table/chair instances and two clusters of source round-table placements; exact inlay outlines and the colour of individual chairs are inferred.",
  },
};
export function isLibraryTerrace(scene: SceneMap, s: Surface) {
  return (
    scene.sourceMap === "xgkdgz_tsg" &&
    scene.floor.key === "2" &&
    s.sourceLayer === "休闲0" &&
    s.sourceId === 143982
  );
}
type Mesh = (
  p: Polygon,
  top: number,
  bottom: number,
  mat: number,
  side?: number,
) => Primitive[];
type Inks = Record<InteriorInk, number>;
const lerp = (a: Point, b: Point, t: number) => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});
function sampleRow(points: Point[]) {
  const lengths = [0];
  for (let i = 1; i < points.length; i++)
    lengths.push(
      lengths[i - 1] +
        Math.hypot(
          points[i].x - points[i - 1].x,
          points[i].y - points[i - 1].y,
        ),
    );
  const stops = lengths.map((l) => l / lengths.at(-1)!);
  const at = (t: number) => {
    const idx = Math.max(
      1,
      stops.findIndex((s) => s >= t - 1e-8),
    );
    return lerp(
      points[idx - 1],
      points[idx],
      (t - stops[idx - 1]) / (stops[idx] - stops[idx - 1]),
    );
  };
  return { stops, at };
}
export function libraryTerrace(
  polygon: Polygon,
  scale: number,
  ink: Inks,
  mesh: Mesh,
) {
  // The two surveyed rims of source feature 143982 run in opposite directions.
  // Match arc lengths and retain every source corner, including the end caps.
  const ring = polygon[0],
    inner = sampleRow(ring.slice(0, 10)),
    outer = sampleRow(ring.slice(10, -1).reverse());
  const stops = [
    ...new Set([
      ...inner.stops,
      ...outer.stops,
      ...Array.from({ length: 31 }, (_, i) => i / 30),
    ]),
  ].sort((a, b) => a - b);
  const point = (t: number, d: number) => lerp(inner.at(t), outer.at(t), d);
  const strip = (
    a: number,
    b: number,
    front: number,
    back: number,
  ): Polygon => {
    const t = [a, ...stops.filter((s) => s > a + 1e-7 && s < b - 1e-7), b];
    return [
      [
        ...t.map((v) => point(v, front)),
        ...t.reverse().map((v) => point(v, back)),
      ],
    ];
  };
  const parts: Primitive[] = [];
  for (let row = 0; row < 3; row++) {
    const start = row / 3,
      end = (row + 1) / 3,
      top = (1.08 - row * 0.34) * scale;
    parts.push(
      ...mesh(
        strip(0, 1, start, end),
        top,
        0,
        ink.libraryAsh,
        ink.librarySlats,
      ),
    );
    for (let i = 1; i < 14; i++) {
      const t = i / 15;
      parts.push(
        ...mesh(
          strip(t - 0.026, t + 0.026, start + 0.09, end - 0.06),
          top + 0.07 * scale,
          top,
          ink.librarySeat,
          ink.librarySeat,
        ),
      );
    }
  }
  // A low-cut representation preserves the view through the tall winding stair.
  // The moving image is an original abstract tile, not a photograph of the LED.
  const screen = strip(0.55, 0.9, 0.1, 0.145),
    z = 1.08 * scale;
  parts.push(
    ...mesh(screen, z + 1.28 * scale, z, ink.enamel, ink.libraryDisplay),
  );
  return parts;
}
const roundModel = "04d099a5a0fc6453a2717e75723538a1.glb",
  deskModel = "e98dc9bcfd9f2ad147bfd2bd329b0237.glb";
export function libraryStudySet(
  scene: SceneMap,
  src: string,
  sourceId: number,
  ink: Inks,
  mesh: Mesh,
) {
  if (scene.sourceMap !== "xgkdgz_tsg" || !["2", "4"].includes(scene.floor.key))
    return;
  const round = src.endsWith(roundModel);
  if (!round && !src.endsWith(deskModel)) return;
  // Both original models encode the table footprint and the facing chairs as
  // boxes. Rebuild in their local coordinates; the original instance matrix,
  // orientation, scale, floor position and highest seat-back are kept.
  const parts: Primitive[] = [];
  const add = (
    p: Point[],
    top: number,
    bottom: number,
    cap: number,
    side = cap,
    castsShadow = false,
  ) => {
    const out = mesh([p], top, bottom, cap, side);
    if (castsShadow && out[0]) out[0].node = "study-caster";
    for (const part of out) part.uv = part.uv.map(([u, v]) => [u * 6, v * 6]);
    parts.push(...out);
  };
  function circle(cx: number, cy: number, rx: number, ry: number, n = 12) {
    return Array.from({ length: n }, (_, i) => ({
      x: cx + rx * Math.cos((i * Math.PI * 2) / n),
      y: cy + ry * Math.sin((i * Math.PI * 2) / n),
    }));
  }
  function rect(a: number, b: number, c: number, d: number) {
    return [
      { x: a, y: b },
      { x: c, y: b },
      { x: c, y: d },
      { x: a, y: d },
    ];
  }
  const table = round
    ? circle(0, 0, 0.77, 0.8)
    : rect(-0.59, -0.79, 0.59, 0.79);
  add(
    table,
    round ? 0.78 : 1,
    round ? 0.68 : 0.87,
    round ? ink.porcelain : ink.libraryAsh,
    ink.libraryAsh,
    true,
  );
  if (round) {
    add(circle(0, 0, 0.1, 0.1, 8), 0.7, 0.04, ink.enamel);
    add(circle(0, 0, 0.5, 0.42), 0.07, 0, ink.riser);
  } else {
    for (const x of [-0.48, 0.48])
      for (const y of [-0.68, 0.68])
        add(
          rect(x - 0.038, y - 0.038, x + 0.038, y + 0.038),
          0.89,
          0,
          ink.riser,
        );
  }
  const hues = [
    ink.libraryOchre,
    ink.libraryBerry,
    ink.bindingTeal,
    ink.enamel,
  ];
  for (let i = 0; i < (round ? 4 : 2); i++) {
    const theta = round ? (i * Math.PI) / 2 : i * Math.PI,
      c = Math.cos(theta),
      s = Math.sin(theta);
    // Turn the backrests away from the table. A curved octagonal bucket,
    // bent timber back and slender runners replace each solid cuboid.
    const place = (ring: Point[]) =>
      ring.map((p) => ({ x: p.x * c - p.y * s, y: p.y * c + p.x * s }));
    const far = round ? 1.46 : 0.96,
      near = round ? 0.8 : 0.57,
      mid = (far + near) / 2,
      half = round ? 0.3 : 0.37;
    const color =
      scene.floor.key === "2" && round
        ? hues[(sourceId + i) % hues.length]
        : ink.libraryAsh;
    const seat = [
      { x: near, y: -half * 0.75 },
      { x: near + 0.07, y: -half },
      { x: far - 0.08, y: -half },
      { x: far, y: -half * 0.72 },
      { x: far, y: half * 0.72 },
      { x: far - 0.08, y: half },
      { x: near + 0.07, y: half },
      { x: near, y: half * 0.75 },
    ];
    add(place(seat), 0.6, 0.49, color, color, true);
    add(
      place([
        { x: far - 0.12, y: -half },
        { x: far, y: -half * 0.7 },
        { x: far, y: half * 0.7 },
        { x: far - 0.12, y: half },
        { x: far - 0.18, y: half * 0.73 },
        { x: far - 0.11, y: half * 0.52 },
        { x: far - 0.11, y: -half * 0.52 },
        { x: far - 0.18, y: -half * 0.73 },
      ]),
      1.18,
      0.56,
      color,
      scene.floor.key === "4" ? ink.libraryAsh : color,
    );
    if (round && scene.floor.key === "2") {
      add(place(circle(mid, 0, 0.085, 0.085, 6)), 0.5, 0.06, ink.riser);
      add(
        place(circle(mid, 0, (far - near) * 0.4, half * 0.78)),
        0.07,
        0,
        ink.riser,
      );
    } else
      for (const y of [-half * 0.7, half * 0.7]) {
        for (const x of [near + 0.08, far - 0.09])
          add(
            place(rect(x - 0.028, y - 0.025, x + 0.028, y + 0.025)),
            0.52,
            0.045,
            ink.riser,
          );
        add(
          place(rect(near + 0.05, y - 0.032, far - 0.06, y + 0.032)),
          0.055,
          0,
          ink.riser,
        );
      }
  }
  return parts;
}

export function photoFloorInk(
  scene: SceneMap,
  s: Surface,
): InteriorInk | undefined {
  if (
    scene.sourceMap !== "xgkdgz_tsg" ||
    (s.kind !== "floor" && s.kind !== "corridor")
  )
    return;
  if (
    scene.floor.key === "0" &&
    ((s.kind === "floor" && s.sourceId === 141557) ||
      (s.kind === "corridor" && s.sourceId === 509))
  )
    return "galleryStone";
  if (scene.floor.key === "2") return "libraryCarpet";
  if (scene.floor.key === "4") return "libraryFelt";
}
export function studyInlays(scene: SceneMap, ink: Inks, mesh: Mesh) {
  if (scene.sourceMap !== "xgkdgz_tsg" || scene.floor.key !== "4") return [];
  const output: Primitive[] = [];
  // Use the two actual four-seat groups as anchors. The carpet is a finish,
  // never an extra obstacle. Reject any inferred inlay touching walls/voids.
  const pads = scene.surfaces
    .filter((s) => s.kind === "floor")
    .flatMap((s) => s.polygons);
  const walls = scene.surfaces
    .filter((s) => s.kind === "wall")
    .flatMap((s) => s.polygons);
  for (const [ids, color] of [
    [[144427, 144428, 144429, 144430, 144431], ink.libraryOchre],
    [[144408, 144412], ink.librarySand],
  ] as const) {
    const pts = scene.surfaces
      .filter((s) => (ids as readonly number[]).includes(s.sourceId))
      .flatMap((s) => s.polygons.flat(2));
    if (!pts.length) continue;
    const box = bounds(pts),
      cx = box.x + box.width / 2,
      cy = box.y + box.height / 2;
    for (const fraction of [1, 0.93, 0.85, 0.78]) {
      const rim = Array.from({ length: 48 }, (_, i) => ({
        x: cx + Math.cos((i * Math.PI) / 24) * (box.width / 2 + 5) * fraction,
        y: cy + Math.sin((i * Math.PI) / 24) * (box.height / 2 + 5) * fraction,
      }));
      if (
        !rim.every(
          (p) =>
            pads.some((poly) => inPolygon(p, poly)) &&
            !walls.some((poly) => inPolygon(p, poly)),
        )
      )
        continue;
      output.push(...mesh([rim], 0.09, 0.09, color));
      break;
    }
  }
  return output;
}
