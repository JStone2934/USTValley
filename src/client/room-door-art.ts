import type Phaser from "phaser";
import type { RoomDoor } from "../shared/doors";
import type { Point } from "../shared/world";

/** Geometry is in map coordinates, height is projected by the same camera as
 * the baked jambs. The source records the opening but not the swing handing. */
export function drawRoomDoor(
  g: Phaser.GameObjects.Graphics,
  door: RoomDoor,
  progress: number,
  ppm: number,
  projection: number,
) {
  g.clear();
  // Existing saved maps have a four-unit cardinal gate but no surveyed jambs.
  const dx = Math.sign(door.inside.x - door.outside.x),
    dy = Math.sign(door.inside.y - door.outside.y);
  const hinge = door.hinge ?? { x: door.x + 2 * dy, y: door.y - 2 * dx };
  const latch = door.latch ?? { x: door.x - 2 * dy, y: door.y + 2 * dx };
  const width = Math.hypot(latch.x - hinge.x, latch.y - hinge.y);
  if (width < 0.1) return;
  const tx = (latch.x - hinge.x) / width,
    ty = (latch.y - hinge.y) / width;
  const inward = Math.sign(-ty * dx + tx * dy) || 1;
  const angle = (Math.max(0, Math.min(1, progress)) * Math.PI) / 2;
  const nx = -ty * inward * Math.sin(angle),
    ny = tx * inward * Math.sin(angle);
  const double = width > ppm * 1.42;
  const gap = ppm * 0.045,
    height = ppm * projection * 1.83,
    halfThick = ppm * 0.035;
  const sanitary = /洗手间|卫生间/.test(door.room),
    lab = /实验|冷藏/.test(door.room);
  const edge = sanitary ? 0x426665 : lab ? 0x566c70 : 0x684d3c;
  const face = sanitary ? 0x80a7a1 : lab ? 0x98acb0 : 0xb88c69;
  const light = sanitary ? 0xadc6b8 : lab ? 0xc5d1ca : 0xd8b48a;

  const leaves = (double ? [1, -1] : [1])
    .map((sign) => {
      const pivot = sign > 0 ? hinge : latch;
      const x = pivot.x - door.x + sign * gap * tx,
        y = pivot.y - door.y + sign * gap * ty;
      const ux = sign * tx * Math.cos(angle) + nx,
        uy = sign * ty * Math.cos(angle) + ny;
      const span = (double ? width / 2 : width) - gap * (double ? 1.3 : 2);
      return { x, y, ux, uy, span };
    })
    .sort((a, b) => a.y + (a.uy * a.span) / 2 - b.y - (b.uy * b.span) / 2);

  for (const { x, y, ux, uy, span } of leaves) {
    // Draw the face nearer the viewer, its exposed end, and the thin top.
    const side = ux >= 0 ? 1 : -1,
      wx = -uy * halfThick * side,
      wy = ux * halfThick * side;
    const p = (t: number, z: number, side = 1): Point => ({
      x: x + ux * t * span + side * wx,
      y: y + uy * t * span - z * height + side * wy,
    });
    const quad = (color: number, a: Point, b: Point, c: Point, d: Point) =>
      g.fillStyle(color).fillPoints([a, b, c, d], true);
    const panel = (
      color: number,
      a: number,
      b: number,
      lo: number,
      hi: number,
    ) => quad(color, p(a, lo), p(b, lo), p(b, hi), p(a, hi));
    const end = uy >= 0 ? 1 : 0;
    quad(edge, p(end, 0, -1), p(end, 0), p(end, 1), p(end, 1, -1));
    panel(edge, 0, 1, 0, 1);
    panel(face, 0.045, 0.955, 0.035, 0.965);
    if (lab) {
      panel(0x536e76, 0.23, 0.77, 0.54, 0.87);
      panel(0x9cc1c1, 0.28, 0.72, 0.58, 0.83);
      panel(0xc5d8d0, 0.3, 0.38, 0.6, 0.81);
    } else if (!sanitary) {
      panel(light, 0.12, 0.16, 0.13, 0.89);
      panel(0xaa7e60, 0.22, 0.24, 0.21, 0.79);
      panel(0xc39a76, 0.5, 0.53, 0.14, 0.89);
    }
    if (sanitary || lab) panel(0xa7b6af, 0.08, 0.92, 0.06, 0.14);
    // Backplate and lever remain at the free end as the leaf rotates.
    panel(edge, 0.76, 0.86, 0.41, 0.58);
    panel(0xe4dfc8, 0.68, 0.86, 0.5, 0.54);
    quad(light, p(0, 1), p(1, 1), p(1, 1, -1), p(0, 1, -1));
  }
}
