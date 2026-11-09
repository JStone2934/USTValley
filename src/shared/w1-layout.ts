import type { Point, SceneMap } from "./world";
export type LayoutPolygon = Point[][];
export type WalkPlatform = {
  id: string;
  heightMeters: number;
  polygons: LayoutPolygon[];
};
export type LayoutProp = {
  id: string;
  kind:
    | "sofa"
    | "table"
    | "plant"
    | "seat"
    | "workbench"
    | "counter"
    | "display"
    | "treadmill";
  x: number;
  y: number;
  rotationDegrees: number;
  width: number;
  depth: number;
  height: number;
};
export type W1Layout = {
  id: string;
  openArea: LayoutPolygon[];
  platforms: WalkPlatform[];
  zones: { id: string; polygon: LayoutPolygon }[];
  props: LayoutProp[];
  removedDoorIds: string[];
  openedRoomSourceIds: number[];
  openedDoorways: { id: string; inside: Point; outside: Point }[];
};
const angle = (-14 * Math.PI) / 180,
  c = Math.cos(angle),
  s = Math.sin(angle);
const offsets = { x: 1290.0027388336616, y: 999.4512338137856 };
export const w1Floor = (scene: Pick<SceneMap, "id">) =>
  /^interior_west_f[456]$/.test(scene.id)
    ? Number(scene.id.slice(-1))
    : undefined;
/** Align the supplied diagram's long axis with the surveyed W1 wing. Sizes
 * are estimated; source slabs and both unclassified white areas stay intact. */
export function w1Point(scene: SceneMap, u: number, v: number): Point {
  return {
    x: u * c - v * s + scene.sourceOffset.x - offsets.x,
    y: u * s + v * c + scene.sourceOffset.y - offsets.y,
  };
}
export function w1Local(scene: SceneMap, p: Point): Point {
  const x = p.x - scene.sourceOffset.x + offsets.x,
    y = p.y - scene.sourceOffset.y + offsets.y;
  return { x: x * c + y * s, y: -x * s + y * c };
}
const sheets: Record<number, number[]> = {
  4: [50, 65, 1738, 700],
  5: [10, 13, 899, 327],
  6: [16, 28, 897, 344],
};
export function diagramPoint(scene: SceneMap, x: number, y: number): Point {
  const [x0, y0, x1, y1] = sheets[w1Floor(scene)!];
  return w1Point(
    scene,
    -205 + ((x - x0) / (x1 - x0)) * 637,
    1136 + ((y - y0) / (y1 - y0)) * 170,
  );
}
const rect = (x: number, y: number, w: number, h: number) => [
  [x, y],
  [x + w, y],
  [x + w, y + h],
  [x, y + h],
];
type XY = number[][];
const platforms: Record<number, XY[]> = {
  4: [
    [
      [390, 115],
      [418, 115],
      [445, 140],
      [455, 170],
      [455, 495],
      [440, 528],
      [390, 530],
    ],
    rect(790, 70, 228, 345),
    [
      [790, 415],
      [1018, 415],
      [1000, 440],
      [820, 440],
    ],
    [
      [1050, 390],
      [1070, 362],
      [1405, 362],
      [1405, 478],
      [1100, 478],
      [1050, 450],
    ],
    [
      [865, 507],
      [1050, 507],
      [1090, 520],
      [1105, 552],
      [1105, 605],
      [865, 605],
    ],
    rect(1050, 620, 65, 75),
  ],
  5: [
    [
      [150, 60],
      [196, 60],
      [196, 174],
      [170, 171],
      [150, 150],
    ],
    [
      [454, 14],
      [598, 14],
      [598, 204],
      [585, 230],
      [563, 239],
      [489, 239],
      [467, 228],
      [454, 205],
    ],
    [
      [220, 208],
      [345, 208],
      [382, 231],
      [437, 271],
      [355, 271],
      [312, 247],
      [220, 247],
    ],
    rect(438, 272, 70, 7),
    rect(813, 205, 44, 12),
  ],
  6: [
    rect(330, 29, 113, 28),
    rect(414, 57, 29, 153),
    rect(327, 202, 87, 9),
    rect(327, 60, 8, 142),
    rect(598, 30, 34, 151),
    rect(105, 216, 73, 39),
    [
      [410, 248],
      [478, 248],
      [499, 270],
      [564, 270],
      [564, 338],
      [501, 338],
      [501, 290],
      [410, 290],
    ],
  ],
};
const zones: Record<number, [string, number, number, number, number][]> = {
  4: [
    ["4-8", 258, 120, 119, 256],
    ["4-6", 560, 120, 97, 298],
    ["4-5", 674, 122, 96, 297],
    ["4-3", 1129, 120, 112, 235],
    ["4-2", 1271, 117, 110, 237],
    ["4-1", 1412, 120, 109, 235],
    ["4-7", 576, 540, 183, 145],
    ["4-4", 1255, 545, 184, 138],
  ],
  5: [
    ["5-3", 214, 46, 58, 117],
    ["5-2", 278, 46, 56, 117],
    ["5-1", 341, 46, 56, 117],
    ["5-4", 179, 251, 92, 58],
  ],
  6: [
    ["6-9", 117, 68, 50, 135],
    ["6-8", 178, 67, 48, 139],
    ["6-7", 283, 61, 44, 150],
    ["6-6", 468, 62, 50, 153],
    ["6-4", 523, 61, 73, 73],
    ["6-5", 523, 149, 73, 79],
    ["6-1", 654, 58, 78, 77],
    ["6-2", 654, 148, 78, 63],
    ["6-10", 103, 285, 99, 57],
    ["6-3", 610, 284, 137, 60],
  ],
};
const reserved: Record<number, XY[]> = {
  4: [rect(94, 117, 142, 413), rect(1573, 120, 133, 319)],
  5: [rect(40, 38, 100, 236), rect(808, 42, 73, 155)],
  6: [rect(42, 54, 62, 195), rect(741, 50, 116, 174)],
};
export const diagramReserved = (scene: SceneMap) =>
  reserved[w1Floor(scene)!].map((r) => [
    r.map(([x, y]) => diagramPoint(scene, x, y)),
  ]);
export function diagramLayout(scene: SceneMap): W1Layout | undefined {
  const f = w1Floor(scene);
  if (!f) return;
  const map = (p: XY) => [p.map(([x, y]) => diagramPoint(scene, x, y))];
  const props: LayoutProp[] = [];
  let serial = 0;
  const add = (
    kind: LayoutProp["kind"],
    x: number,
    y: number,
    rot = 346,
    w = 1.5,
    d = 0.7,
    h = 0.8,
  ) =>
    props.push({
      id: `w1-f${f}-${kind}-${++serial}`,
      kind,
      ...diagramPoint(scene, x, y),
      rotationDegrees: rot,
      width: w,
      depth: d,
      height: h,
    });
  const lounge = (x: number, y: number, rot = 346) => {
    add("sofa", x, y, rot, 2.4, 0.8, 0.85);
    add("table", x + 12, y + 18, rot, 0.7, 0.7, 0.48);
    add("seat", x + 30, y + 23, rot, 0.55, 0.55, 0.65);
  };
  if (f === 4) {
    lounge(413, 185, 76);
    lounge(418, 458, 76);
    lounge(1150, 419);
    lounge(990, 557);
    lounge(1334, 421);
    add("counter", 843, 208, 76, 7, 1.2, 1.05);
    add("workbench", 961, 157, 346, 2, 0.8, 0.8);
    add("treadmill", 979, 94, 76, 2, 0.8, 0.2);
    add("treadmill", 1001, 94, 76, 2, 0.8, 0.2);
    add("plant", 1095, 460, 0, 0.65, 0.65, 1.15);
    add("plant", 424, 388, 0, 0.65, 0.65, 1.15);
    add("display", 1340, 393, 346, 0.9, 0.25, 1.65);
  }
  if (f === 5) {
    lounge(174, 105, 76);
    lounge(524, 216);
    lounge(285, 226);
    lounge(356, 253);
    add("counter", 490, 54, 346, 4, 0.9, 0.85);
    for (let r = 0; r < 5; r++)
      for (let col = 0; col < 6; col++)
        add("seat", 538 + col * 9, 70 + r * 17, 346, 0.48, 0.48, 0.8);
    for (const x of [366, 392, 416]) add("plant", x, 267, 0, 0.6, 0.6, 1);
    add("table", 575, 203, 346, 0.8, 0.8, 0.48);
  }
  if (f === 6) {
    lounge(132, 237);
    lounge(448, 270);
    lounge(532, 309, 76);
    add("table", 613, 125, 346, 0.7, 0.7, 0.5);
    add("seat", 614, 154, 346, 0.55, 0.55, 0.7);
    add("plant", 605, 63, 0, 0.6, 0.6, 1);
    add("display", 575, 306, 76, 0.8, 0.25, 1.55);
  }
  return {
    id: `w1-f${f}-open-plan`,
    openArea: [],
    platforms: platforms[f].map((p, i) => ({
      id: `w1-f${f}-platform-${i + 1}`,
      heightMeters: 0.3,
      polygons: [map(p)],
    })),
    zones: zones[f].map(([id, x, y, w, h]) => ({
      id,
      polygon: map(rect(x, y, w, h)),
    })),
    props,
    removedDoorIds: [],
    openedRoomSourceIds: [],
    openedDoorways: [],
  };
}
export function insideRing(p: Point, ring: Point[]) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i],
      b = ring[j];
    if (
      a.y > p.y !== b.y > p.y &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x
    )
      inside = !inside;
  }
  return inside;
}
export const insideLayoutPolygon = (p: Point, poly: LayoutPolygon) =>
  insideRing(p, poly[0]) && !poly.slice(1).some((r) => insideRing(p, r));
export function supportHeightMeters(scene: SceneMap, p: Point) {
  return Math.max(
    0,
    ...(scene.w1Layout?.platforms ?? [])
      .filter((s) => s.polygons.some((poly) => insideLayoutPolygon(p, poly)))
      .map((s) => s.heightMeters),
  );
}
export function layoutPropFootprint(scene: SceneMap, p: LayoutProp) {
  const a = (p.rotationDegrees * Math.PI) / 180,
    s = scene.units.pixelsPerMeter;
  return rect(-p.width / 2, -p.depth / 2, p.width, p.depth).map(([x, y]) => ({
    x: p.x + (x * Math.cos(a) - y * Math.sin(a)) * s,
    y: p.y + (x * Math.sin(a) + y * Math.cos(a)) * s,
  }));
}
