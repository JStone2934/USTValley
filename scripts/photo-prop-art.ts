import type { SceneMap } from "../src/shared/world.ts";
import {
  photoProps,
  propPoint,
  type PhotoProp,
} from "../src/shared/photo-props.ts";
import type { Primitive, RasterMaterial, Vec3 } from "./gltf.ts";
import { bounds, inPolygon } from "./source-geometry.ts";
import { propFootprint } from "../src/shared/photo-props.ts";

/** Only local object occupancy changes; the source walls/doors/floors stay intact. */
export function fitPhotoProps(scene: SceneMap) {
  const props = photoProps(scene).filter((p) => p.collision);
  if (!props.length) return;
  const runs = [...(scene.fixtureCollision?.runs ?? [])];
  for (const p of props) {
    const polygon = [propFootprint(scene, p)],
      b = bounds(polygon[0]);
    for (let y = Math.floor(b.y); y <= Math.ceil(b.y + b.height); y++) {
      let start = -1;
      for (let x = Math.floor(b.x); x <= Math.ceil(b.x + b.width) + 1; x++) {
        const hit = inPolygon({ x: x + 0.5, y: y + 0.5 }, polygon);
        if (hit && start < 0) start = x;
        if (!hit && start >= 0) {
          runs.push(y, start, x - start);
          start = -1;
        }
      }
    }
  }
  scene.fixtureCollision = {
    sourceIds: scene.fixtureCollision?.sourceIds ?? [],
    runs,
  };
}
export function photoPropArt(scene: SceneMap, materials: RasterMaterial[]) {
  const props = photoProps(scene);
  if (!props.length)
    return { fixtures: [] as Primitive[], floor: [] as Primitive[] };
  const colors = {
    white: [224, 225, 214],
    black: [35, 43, 47],
    joint: [57, 67, 72],
    silver: [165, 178, 182],
    blue: [93, 126, 145],
    yellow: [237, 177, 39],
    orange: [225, 106, 47],
    screen: [66, 123, 148],
    mat: [77, 82, 82],
    seam: [52, 59, 60],
    speck: [115, 128, 127],
  } as const;
  const inks = {} as Record<keyof typeof colors, number>;
  for (const [key, value] of Object.entries(colors)) {
    inks[key as keyof typeof colors] = materials.length;
    materials.push({ factor: [...value.map((v) => v / 255), 1] });
  }
  const fixtures: Primitive[] = [],
    floor: Primitive[] = [];
  for (const p of props) {
    const target = p.kind === "mat" ? floor : fixtures,
      s = scene.units.pixelsPerMeter;
    const vertex = (x: number, y: number, z: number): Vec3 => {
      const q = propPoint(scene, p, x, y);
      return [q.x, q.y, z * s];
    };
    const box = (
      x: number,
      y: number,
      z: number,
      w: number,
      d: number,
      h: number,
      ink: keyof typeof colors,
      label = "part",
    ) => {
      const vs = [
        [-w / 2, -d / 2, 0],
        [w / 2, -d / 2, 0],
        [w / 2, d / 2, 0],
        [-w / 2, d / 2, 0],
        [-w / 2, -d / 2, h],
        [w / 2, -d / 2, h],
        [w / 2, d / 2, h],
        [-w / 2, d / 2, h],
      ].map(([a, b, c]) => vertex(x + a, y + b, z + c));
      target.push({
        node: `${p.objectId}:${label}`,
        vertices: vs,
        indices: [
          4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7,
          6, 3, 0, 4, 3, 4, 7, 0, 3, 2, 0, 2, 1,
        ],
        material: inks[ink],
        uv: vs.map(() => [0, 0]),
      });
    };
    // Solid rectangular beam oriented between two 3-D endpoints.
    const beam = (
      a: Vec3,
      b: Vec3,
      r: number,
      ink: keyof typeof colors,
      label = "beam",
    ) => {
      const dx = b[0] - a[0],
        dy = b[1] - a[1],
        dz = b[2] - a[2],
        len = Math.hypot(dx, dy, dz),
        u: Vec3 = [dx / len, dy / len, dz / len];
      const n = Math.hypot(u[0], u[1]);
      const v: Vec3 = n > 0.001 ? [-u[1] / n, u[0] / n, 0] : [1, 0, 0];
      const q: Vec3 = [
        u[1] * v[2] - u[2] * v[1],
        u[2] * v[0] - u[0] * v[2],
        u[0] * v[1] - u[1] * v[0],
      ];
      const vs = [a, b].flatMap((t) =>
        [
          [-1, -1],
          [1, -1],
          [1, 1],
          [-1, 1],
        ].map(([j, k]) =>
          vertex(
            t[0] + ((j * v[0] + k * q[0]) * r) / 2,
            t[1] + ((j * v[1] + k * q[1]) * r) / 2,
            t[2] + ((j * v[2] + k * q[2]) * r) / 2,
          ),
        ),
      );
      target.push({
        node: `${p.objectId}:${label}`,
        vertices: vs,
        indices: [
          0, 1, 2, 0, 2, 3, 4, 7, 6, 4, 6, 5, 0, 4, 5, 0, 5, 1, 1, 5, 6, 1, 6,
          2, 2, 6, 7, 2, 7, 3, 3, 7, 4, 3, 4, 0,
        ],
        material: inks[ink],
        uv: vs.map(() => [0, 0]),
      });
    };
    const casters = (w: number, d: number) => {
      for (const x of [-w / 2, w / 2])
        for (const y of [-d / 2, d / 2]) {
          box(x, y, 0, 0.14, 0.18, 0.14, "joint", "caster");
          box(x, y, 0.1, 0.06, 0.08, 0.13, "silver");
        }
    };
    if (p.kind === "humanoid") {
      const shell = p.variant === "silver" ? "silver" : "white";
      for (const x of [-0.18, 0.18]) {
        box(x, 0.07, 0, 0.21, 0.4, 0.1, "black", "foot");
        beam([x, 0, 0.12], [x, 0, 0.5], 0.14, shell, "shin");
        box(x, 0, 0.48, 0.2, 0.2, 0.15, "joint", "knee");
        beam([x, 0, 0.62], [x * 0.7, 0, 0.87], 0.17, shell, "thigh");
      }
      box(0, 0, 0.83, 0.4, 0.25, 0.19, "joint", "pelvis");
      box(0, 0, 1, 0.43, 0.27, 0.37, shell, "torso");
      box(
        0,
        0.145,
        1.12,
        0.2,
        0.02,
        0.14,
        shell === "white" ? "silver" : "joint",
        "chest",
      );
      box(0, 0, 1.37, 0.12, 0.15, 0.07, "joint");
      box(0, 0, 1.44, 0.29, 0.25, 0.21, "black", "head");
      box(0, 0.132, 1.51, 0.21, 0.022, 0.055, "screen", "visor");
      for (const side of [-1, 1]) {
        box(side * 0.29, 0, 1.22, 0.17, 0.21, 0.18, "joint", "shoulder");
        beam([side * 0.3, 0, 1.23], [side * 0.34, 0.02, 0.99], 0.12, shell);
        box(side * 0.34, 0.02, 0.96, 0.15, 0.16, 0.14, "joint");
        beam([side * 0.34, 0.02, 0.96], [side * 0.31, 0.09, 0.75], 0.11, shell);
        box(side * 0.31, 0.09, 0.71, 0.12, 0.13, 0.12, "joint", "hand");
      }
    } else if (p.kind === "mobile-arms") {
      casters(1.05, 0.65);
      box(0, 0, 0.12, 1.2, 0.88, 0.18, "black", "mobile-base");
      box(0, 0.03, 0.2, 1.15, 0.85, 0.15, "white");
      box(0, 0, 0.34, 0.7, 0.65, 0.7, "white", "cabinet");
      box(0, 0.33, 0.43, 0.48, 0.02, 0.45, "silver");
      for (let k = 0; k < 3; k++)
        box(0, 0.348, 0.48 + k * 0.12, 0.38, 0.025, 0.04, "joint", "vent");
      box(0, 0, 1.04, 0.9, 0.75, 0.09, "black");
      for (const side of [-1, 1]) {
        beam(
          [side * 0.28, 0, 1.08],
          [side * 0.48, 0, 1.4],
          0.16,
          "silver",
          "arm-upper",
        );
        box(side * 0.48, 0, 1.33, 0.22, 0.22, 0.2, "joint", "motor");
        beam(
          [side * 0.48, 0, 1.42],
          [side * 0.62, 0.35, 1.34],
          0.12,
          "silver",
          "arm-forearm",
        );
        box(side * 0.62, 0.38, 1.29, 0.2, 0.14, 0.12, "black", "gripper");
      }
      beam([0, -0.21, 1.1], [0, -0.21, 1.55], 0.045, "joint");
      box(0, -0.21, 1.47, 0.32, 0.06, 0.22, "black", "monitor");
      box(0, -0.17, 1.49, 0.25, 0.02, 0.16, "screen");
    } else if (p.kind === "support-frame" || p.kind === "hoist") {
      const hoist = p.kind === "hoist",
        c = hoist ? "black" : "white",
        w = p.width - 0.18,
        d = p.depth - 0.18;
      casters(w, d);
      for (const side of [-1, 1])
        beam(
          [(side * w) / 2, -d / 2, 0.21],
          [(side * w) / 2, d / 2, 0.21],
          0.1,
          c,
          "base-rail",
        );
      beam([-w / 2, -d / 2, 0.21], [w / 2, -d / 2, 0.21], 0.1, c);
      if (hoist) {
        beam([w / 2, -d / 2, 0.21], [w / 2, -d / 2, 2], 0.14, c, "mast");
        beam([w / 2, -d / 2, 1.8], [0, 0, 2.7], 0.13, "joint", "boom");
        box(w / 2, -d / 2 + 0.06, 1.7, 0.28, 0.22, 0.3, "yellow", "winch");
        beam([0, 0, 2.68], [0, 0, 1.7], 0.035, "orange", "strap");
      } else {
        for (const side of [-1, 1]) {
          beam(
            [(side * w) / 2, -d / 2, 0.24],
            [(side * w) / 2, -d / 2, 1.8],
            0.075,
            c,
            "upright",
          );
          beam([(side * w) / 2, -d / 2, 1.8], [side * 0.48, 0, 2.25], 0.075, c);
          beam(
            [side * 0.48, 0, 2.2],
            [side * 0.25, 0, 1.4],
            0.025,
            "orange",
            "strap",
          );
        }
        beam([-0.48, 0, 2.25], [0.48, 0, 2.25], 0.07, c);
      }
    } else if (p.kind === "booth") {
      // Contiguous bays along the east wall. Two seats face one another
      // across the table; adjacent bays share the white dividing back.
      box(0, -0.76, 0, p.width, 0.08, 1.65, "white", "wall-side-shell");
      box(0, -0.7, 0.45, p.width - 0.12, 0.035, 1.12, "blue", "wall-padding");
      for (const side of [-1, 1]) {
        box(side * 0.8, 0, 0, 0.6, 1.6, 0.42, "white", "seat-plinth");
        box(side * 0.77, 0, 0.42, 0.56, 1.45, 0.13, "blue", "facing-cushion");
        box(side * 1.06, 0, 0.42, 0.08, 1.6, 0.48, "white", "shared-partition");
        box(side * 1.008, 0, 0.55, 0.025, 1.43, 0.3, "blue", "facing-back");
      }
      box(0, 0, 0, 0.12, 0.12, 0.73, "silver", "table-pedestal");
      box(0, 0.05, 0.73, 0.64, 1.2, 0.07, "white", "shared-table");
    } else if (p.kind === "desk") {
      for (const x of [-0.57, 0.57])
        for (const y of [-0.25, 0.25])
          box(x, y, 0, 0.06, 0.06, 0.74, "silver", "leg");
      box(0, 0, 0.74, 1.4, 0.7, 0.07, "white", "desktop");
      box(0, -0.12, 0.81, 0.2, 0.14, 0.1, "joint", "monitor-stand");
      box(0, -0.17, 0.91, 0.56, 0.06, 0.34, "black", "monitor");
      box(0, -0.13, 0.95, 0.49, 0.015, 0.26, "screen");
      box(0, 0.17, 0.82, 0.4, 0.13, 0.02, "joint", "keyboard");
    } else if (p.kind === "cabinet") {
      box(0, 0, 0, 0.8, 0.65, 1.6, "joint", "rack");
      for (let i = 0; i < 4; i++) {
        box(0, 0.33, 0.13 + i * 0.35, 0.7, 0.025, 0.29, "silver", "drawer");
        box(0.18, 0.35, 0.26 + i * 0.35, 0.15, 0.025, 0.035, "black", "handle");
      }
    } else {
      box(0, 0, 0.025, p.width, p.depth, 0.015, "mat", "rubber-tiles");
      for (let x = -p.width / 2 + 0.6; x < p.width / 2; x += 0.6)
        box(x, 0, 0.041, 0.018, p.depth, 0.002, "seam");
      for (let y = -p.depth / 2 + 0.6; y < p.depth / 2; y += 0.6)
        box(0, y, 0.041, p.width, 0.018, 0.002, "seam");
      for (let i = 0; i < 250; i++) {
        const x = (((i * 0.618033) % 1) - 0.5) * p.width,
          y = (((i * 0.414214) % 1) - 0.5) * p.depth;
        box(x, y, 0.043, 0.025, 0.025, 0.001, "speck");
      }
    }
  }
  return { fixtures, floor };
}
