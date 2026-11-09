import type { SceneMap, Point } from "../src/shared/world.ts";
import {
  supportHeightMeters,
  w1Local,
  type LayoutPolygon,
} from "../src/shared/w1-layout.ts";
import type { Primitive, RasterMaterial } from "./gltf.ts";
type Mesh = (
  polygon: LayoutPolygon,
  top: number,
  bottom: number,
  material: number,
  sideMaterial?: number,
) => Primitive[];
export function w1LayoutArt(
  scene: SceneMap,
  materials: RasterMaterial[],
  mesh: Mesh,
) {
  const layout = scene.w1Layout;
  if (!layout) return { floor: [] as Primitive[], fixtures: [] as Primitive[] };
  const colors = {
    concrete: [190, 193, 184],
    work: [170, 181, 177],
    line: [125, 151, 133],
    platform: [222, 170, 67],
    edge: [159, 117, 55],
    white: [226, 226, 210],
    blue: [94, 130, 147],
    wood: [179, 137, 82],
    metal: [72, 84, 88],
    screen: [65, 126, 148],
    leaf: [75, 115, 67],
    berry: [167, 105, 103],
  } as const;
  const ink = {} as Record<keyof typeof colors, number>;
  for (const [k, v] of Object.entries(colors)) {
    ink[k as keyof typeof colors] = materials.length;
    if (["concrete", "work", "platform"].includes(k)) {
      const width = 48,
        data = Buffer.alloc(width * width * 4, 255);
      for (let y = 0; y < width; y++)
        for (let x = 0; x < width; x++) {
          const light =
            k === "platform"
              ? y % 4 === 0
                ? -13
                : (x + Math.floor(y / 4) * 7) % 24 === 0
                  ? -8
                  : (x * 7 + y * 3) % 29 === 0
                    ? 5
                    : 0
              : k === "concrete"
                ? x % 12 === 0 || y % 12 === 0
                  ? -8
                  : (x * 7 + y * 11) % 71 === 0
                    ? -4
                    : 0
                : (x * 3 + y * 7) % 31 === 0
                  ? 4
                  : 0;
          for (let c = 0; c < 3; c++)
            data[(y * width + x) * 4 + c] = v[c] + light;
        }
      materials.push({
        factor: [1, 1, 1, 1],
        texture: { width, height: width, data },
      });
    } else materials.push({ factor: [...v.map((v) => v / 255), 1] });
  }
  const floor: Primitive[] = [],
    fixtures: Primitive[] = [];
  for (const polygon of layout.openArea)
    floor.push(...mesh(polygon, 0.1, 0.1, ink.concrete));
  for (const z of layout.zones) {
    floor.push(...mesh(z.polygon, 0.12, 0.12, ink.work));
    for (const ring of z.polygon)
      for (let i = 1; i < ring.length; i++) {
        const a = ring[i - 1],
          b = ring[i],
          length = Math.hypot(a.x - b.x, a.y - b.y),
          nx = (-(b.y - a.y) / length) * 0.13,
          ny = ((b.x - a.x) / length) * 0.13;
        if (length < 0.2) continue;
        floor.push(
          ...mesh(
            [
              [
                { x: a.x + nx, y: a.y + ny },
                { x: b.x + nx, y: b.y + ny },
                { x: b.x - nx, y: b.y - ny },
                { x: a.x - nx, y: a.y - ny },
              ],
            ],
            0.14,
            0.14,
            ink.line,
          ),
        );
      }
  }
  for (const p of layout.platforms)
    for (const poly of p.polygons) {
      const h = p.heightMeters * scene.units.pixelsPerMeter;
      floor.push(...mesh(poly, h, 0.1, ink.platform, ink.edge));
      for (const ring of poly)
        for (let i = 1; i < ring.length; i++) {
          const a = ring[i - 1],
            b = ring[i],
            len = Math.hypot(b.x - a.x, b.y - a.y);
          if (len < 0.5) continue;
          const nx = (-(b.y - a.y) / len) * 0.1,
            ny = ((b.x - a.x) / len) * 0.1;
          floor.push(
            ...mesh(
              [
                [
                  { x: a.x + nx, y: a.y + ny },
                  { x: b.x + nx, y: b.y + ny },
                  { x: b.x - nx, y: b.y - ny },
                  { x: a.x - nx, y: a.y - ny },
                ],
              ],
              h + 0.015,
              h,
              ink.white,
            ),
          );
        }
    }
  const glyphs: Record<string, string[]> = {
    "0": ["111", "101", "101", "101", "111"],
    "1": ["010", "110", "010", "010", "111"],
    "2": ["111", "001", "111", "100", "111"],
    "3": ["111", "001", "111", "001", "111"],
    "4": ["101", "101", "111", "001", "001"],
    "5": ["111", "100", "111", "001", "111"],
    "6": ["111", "100", "111", "101", "111"],
    "7": ["111", "001", "010", "010", "010"],
    "8": ["111", "101", "111", "101", "111"],
    "9": ["111", "101", "111", "001", "111"],
    "-": ["000", "000", "111", "000", "000"],
  };
  const seen = new Set<string>();
  for (const z of layout.zones) {
    if (seen.has(z.id)) continue;
    seen.add(z.id);
    const ring = z.polygon[0],
      at = {
        x: ring.reduce((n, p) => n + p.x, 0) / ring.length,
        y: ring.reduce((n, p) => n + p.y, 0) / ring.length,
      };
    const dot = 0.5,
      a = (-14 * Math.PI) / 180;
    let cursor = -z.id.length * 2 * dot;
    const point = (x: number, y: number): Point => ({
      x: at.x + x * Math.cos(a) - y * Math.sin(a),
      y: at.y + x * Math.sin(a) + y * Math.cos(a),
    });
    for (const ch of z.id) {
      glyphs[ch]?.forEach((row, y) =>
        [...row].forEach((v, x) => {
          if (v === "1")
            floor.push(
              ...mesh(
                [
                  [
                    point(cursor + x * dot, y * dot),
                    point(cursor + (x + 1) * dot, y * dot),
                    point(cursor + (x + 1) * dot, (y + 1) * dot),
                    point(cursor + x * dot, (y + 1) * dot),
                  ],
                ],
                0.16,
                0.16,
                ink.line,
              ),
            );
        }),
      );
      cursor += 4 * dot;
    }
  }
  for (const p of layout.props) {
    const s = scene.units.pixelsPerMeter,
      a = (p.rotationDegrees * Math.PI) / 180,
      base = supportHeightMeters(scene, p);
    const box = (
      x: number,
      y: number,
      z: number,
      w: number,
      d: number,
      h: number,
      color: keyof typeof colors,
      part: string,
    ) => {
      const point = (x: number, y: number) => ({
        x: p.x + (x * Math.cos(a) - y * Math.sin(a)) * s,
        y: p.y + (x * Math.sin(a) + y * Math.cos(a)) * s,
      });
      const poly = [
        [
          point(x - w / 2, y - d / 2),
          point(x + w / 2, y - d / 2),
          point(x + w / 2, y + d / 2),
          point(x - w / 2, y + d / 2),
        ],
      ];
      fixtures.push(
        ...mesh(poly, (base + z + h) * s, (base + z) * s, ink[color]).map(
          (q) => ({ ...q, node: `${p.id}:${part}` }),
        ),
      );
    };
    const legs = (w: number, d: number, h: number) => {
      for (const x of [-w / 2, w / 2])
        for (const y of [-d / 2, d / 2])
          box(x, y, 0, 0.06, 0.06, h, "metal", "leg");
    };
    if (p.kind === "sofa") {
      box(0, 0, 0, p.width, p.depth, 0.38, "wood", "plinth");
      box(0, 0.05, 0.38, p.width - 0.08, p.depth - 0.12, 0.16, "blue", "seat");
      box(
        0,
        -p.depth / 2 + 0.08,
        0.38,
        p.width,
        0.16,
        p.height - 0.38,
        "blue",
        "back",
      );
      for (const x of [-p.width / 2 + 0.07, p.width / 2 - 0.07])
        box(x, 0, 0.38, 0.14, p.depth, 0.24, "white", "arm");
    }
    if (p.kind === "table") {
      box(0, 0, 0, 0.12, 0.12, p.height - 0.06, "metal", "pedestal");
      box(0, 0, p.height - 0.06, p.width, p.depth, 0.06, "white", "top");
    }
    if (p.kind === "seat") {
      legs(p.width - 0.12, p.depth - 0.12, 0.4);
      box(0, 0, 0.4, p.width, p.depth, 0.09, "berry", "seat");
      box(
        0,
        -p.depth / 2 + 0.04,
        0.45,
        p.width,
        0.08,
        p.height - 0.45,
        "blue",
        "back",
      );
    }
    if (p.kind === "plant") {
      box(0, 0, 0, p.width * 0.7, p.depth * 0.7, 0.38, "white", "pot");
      box(0, 0, 0.38, 0.08, 0.08, 0.3, "wood", "stem");
      box(0, 0, 0.52, p.width, p.depth, 0.32, "leaf", "leaves");
      box(
        0.03,
        0,
        0.75,
        p.width * 0.7,
        p.depth * 0.7,
        p.height - 0.75,
        "leaf",
        "crown",
      );
    }
    if (p.kind === "counter") {
      box(0, 0, 0, p.width, p.depth, p.height - 0.08, "white", "cabinet");
      box(
        0,
        0,
        p.height - 0.08,
        p.width + 0.02,
        p.depth + 0.02,
        0.08,
        "wood",
        "top",
      );
    }
    if (p.kind === "workbench") {
      legs(p.width - 0.12, p.depth - 0.12, p.height - 0.07);
      box(0, 0, p.height - 0.07, p.width, p.depth, 0.07, "white", "top");
      box(0, 0, p.height, 0.5, 0.2, 0.35, "metal", "instrument");
    }
    if (p.kind === "display") {
      box(0, 0, 0, 0.5, 0.35, 0.08, "metal", "foot");
      box(0, 0, 0.08, 0.08, 0.08, 0.85, "metal", "stand");
      box(0, 0, 0.9, p.width, 0.12, 0.65, "screen", "display");
    }
    if (p.kind === "treadmill") {
      box(0, 0, 0, p.width, p.depth, 0.16, "white", "base");
      box(0, 0, 0.16, p.width - 0.12, p.depth - 0.12, 0.04, "metal", "belt");
      for (const y of [-p.depth / 2 + 0.05, p.depth / 2 - 0.05])
        box(-p.width / 2 + 0.1, y, 0.2, 0.06, 0.06, 0.8, "metal", "rail");
      box(-p.width / 2 + 0.1, 0, 1, 0.12, p.depth, 0.07, "screen", "console");
    }
  }
  for (const p of floor)
    if (p.node === "polygon-top")
      p.uv = p.vertices.map(([x, y]) => {
        const q = w1Local(scene, { x, y });
        const repeat = scene.units.pixelsPerMeter * 2.4;
        return [q.x / repeat, q.y / repeat];
      });
  return { floor, fixtures };
}
