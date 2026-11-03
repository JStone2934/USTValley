import type { Point, Rect } from "../src/shared/world.ts";
import {
  bounds,
  distanceSegment,
  inPolygon,
  type Polygon,
} from "./source-geometry.ts";
import type { InteriorInk } from "./interior-materials.ts";
import type { Primitive } from "./gltf.ts";

type Panel =
  | "blackboard"
  | "noticeboard"
  | "instruments"
  | "mirror"
  | "patchbay";
const panelType: Partial<Record<InteriorInk, Panel>> = {
  teaching: "blackboard",
  office: "noticeboard",
  laboratory: "instruments",
  washroom: "mirror",
  plant: "patchbay",
};
export type WallFootprint = { polygon: Polygon; box: Rect };
export const wallFootprint = (polygon: Polygon): WallFootprint => ({
  polygon,
  box: bounds(polygon.flat()),
});

export function findPanelMount(
  room: Polygon,
  finish: InteriorInk,
  doors: Point[],
  walls: WallFootprint[],
  scale: number,
) {
  const kind = panelType[finish];
  if (!kind) return;
  const ring = room[0];
  const width =
    {
      blackboard: 3.5,
      noticeboard: 1.7,
      instruments: 2.1,
      mirror: 1.35,
      patchbay: 1.15,
    }[kind] * scale;
  let best:
    | { at: Point; tangent: Point; inward: Point; score: number }
    | undefined;
  const wallAt = (p: Point) =>
    walls.some(
      ({ box, polygon }) =>
        p.x >= box.x &&
        p.y >= box.y &&
        p.x <= box.x + box.width &&
        p.y <= box.y + box.height &&
        inPolygon(p, polygon),
    );
  for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i],
      b = ring[i + 1],
      dx = b.x - a.x,
      dy = b.y - a.y,
      length = Math.hypot(dx, dy);
    if (length < width + scale) continue;
    // Looking into the cutaway from the south, a panel on a rear wall presents
    // its face. Never fill a doorway or suspend a board against a missing wall.
    const tangent = { x: dx / length, y: dy / length };
    if (tangent.x < 0) {
      tangent.x *= -1;
      tangent.y *= -1;
    }
    const inward = { x: -tangent.y, y: tangent.x };
    if (inward.y < 0.55) continue;
    for (const t of [0.5, 0.3, 0.7]) {
      if (length * Math.min(t, 1 - t) < width / 2 + 1) continue;
      const edge = { x: a.x + dx * t, y: a.y + dy * t };
      const point = (along: number, offset: number) => ({
        x: edge.x + along * tangent.x + offset * inward.x,
        y: edge.y + along * tangent.y + offset * inward.y,
      });
      if (
        doors.some(
          (p) =>
            distanceSegment(p, point(-width / 2, 0), point(width / 2, 0)) <
            scale * 1.25,
        )
      )
        continue;
      const anchors = [-0.48, 0, 0.48].map((n) => width * n);
      if (
        !anchors.every(
          (l) =>
            inPolygon(point(l, scale * 0.55), room) &&
            [0, -0.12, -0.28, -0.48, 0.12].some((d) =>
              wallAt(point(l, d * scale)),
            ),
        )
      )
        continue;
      let inset = 0.12 * scale;
      while (
        inset < scale * 0.6 &&
        anchors.some((l) => wallAt(point(l, inset)))
      )
        inset += 0.12 * scale;
      if (anchors.some((l) => wallAt(point(l, inset)))) continue;
      const score = inward.y * Math.min(length / width, 3) - Math.abs(t - 0.5);
      if (!best || score > best.score)
        best = { at: point(0, inset), tangent, inward, score };
    }
  }
  if (!best) return;
  return {
    kind,
    center: best.at,
    tangent: best.tangent,
    inward: best.inward,
    width,
  };
}
export function roomPanel(
  room: Polygon,
  finish: InteriorInk,
  doors: Point[],
  walls: WallFootprint[],
  scale: number,
  ink: Record<InteriorInk, number>,
) {
  const mount = findPanelMount(room, finish, doors, walls, scale);
  if (!mount) return;
  const { kind, center: at, tangent, inward, width } = mount;
  const parts: Primitive[] = [];
  // Painted pixels on a narrow 3-D panel. Fractions run along the source wall;
  // height and projection remain in the same units as the rest of the floor.
  const vertex = (
    u: number,
    depth: number,
    z: number,
  ): [number, number, number] => [
    at.x + (u - 0.5) * width * tangent.x + depth * scale * inward.x,
    at.y + (u - 0.5) * width * tangent.y + depth * scale * inward.y,
    z * scale,
  ];
  function stripe(
    u: number,
    v: number,
    lo: number,
    hi: number,
    depth: number,
    material: InteriorInk,
  ) {
    parts.push({
      node: kind,
      material: ink[material],
      vertices: [
        vertex(u, depth, lo),
        vertex(v, depth, lo),
        vertex(v, depth, hi),
        vertex(u, depth, hi),
      ],
      indices: [0, 1, 2, 0, 2, 3],
      uv: [
        [0, 0],
        [0.99, 0],
        [0.99, 0.99],
        [0, 0.99],
      ],
    });
  }
  stripe(0, 1, 0.65, 1.86, 0, "enamel");
  const face: Record<Panel, InteriorInk> = {
    blackboard: "blackboard",
    noticeboard: "bronze",
    instruments: "porcelain",
    mirror: "glass",
    patchbay: "riser",
  };
  stripe(0.04, 0.96, 0.76, 1.73, 0.03, face[kind]);
  if (kind === "blackboard") {
    stripe(0.14, 0.38, 1.27, 1.39, 0.05, "porcelain");
    stripe(0.18, 0.29, 1.04, 1.14, 0.05, "porcelain");
    stripe(0.52, 0.56, 0.95, 1.47, 0.05, "porcelain");
    stripe(0.56, 0.79, 0.95, 1.05, 0.05, "porcelain");
  } else if (kind === "noticeboard") {
    stripe(0.15, 0.44, 0.96, 1.55, 0.05, "porcelain");
    stripe(0.56, 0.82, 1.13, 1.56, 0.05, "passage");
  } else if (kind === "instruments" || kind === "patchbay") {
    stripe(0.11, 0.37, 1.06, 1.47, 0.05, "enamel");
    stripe(0.46, 0.55, 1.07, 1.49, 0.05, "bindingRust");
    stripe(0.68, 0.84, 1.22, 1.45, 0.05, "pine");
  } else {
    stripe(0.21, 0.32, 0.99, 1.59, 0.05, "porcelain");
  }
  parts.push({
    node: "panel-sill",
    material: ink.bronze,
    vertices: [
      vertex(0, 0, 0.69),
      vertex(1, 0, 0.69),
      vertex(1, 0.16, 0.69),
      vertex(0, 0.16, 0.69),
    ],
    indices: [0, 1, 2, 0, 2, 3],
    uv: [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ],
  });
  return { kind, center: at, tangent, inward, parts };
}
