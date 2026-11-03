import type Phaser from "phaser";
import type { RoomDoor } from "../shared/doors";

/** Small cutaway doors use the same ground axes and projected story height as the room. */
export function drawRoomDoor(
  g: Phaser.GameObjects.Graphics,
  door: RoomDoor,
  open: boolean,
  ppm: number,
  projection: number,
) {
  const nx = Math.sign(door.inside.x - door.outside.x),
    ny = Math.sign(door.inside.y - door.outside.y);
  const half = 2,
    tx = -ny,
    ty = nx,
    h = Math.max(3, Math.round(1.85 * ppm * projection));
  const ax = -tx * half,
    ay = -ty * half;
  const dx = (open ? nx : tx) * half * 2,
    dy = (open ? ny : ty) * half * 2;
  const sanitary = /洗手间|卫生间/.test(door.room),
    laboratory = /实验/.test(door.room);
  const shade = sanitary ? 0x487b7a : laboratory ? 0x4b6570 : 0x765237;
  const face = sanitary ? 0x7eb9aa : laboratory ? 0x92aeb0 : 0xc18b57;
  const cap = sanitary ? 0xc9dec7 : laboratory ? 0xd5e0d6 : 0xe6c38a;
  g.clear();
  // A lit threshold and permanent jamb show the opening even when the panel is edge-on.
  for (let i = -half; i <= half; i++)
    g.fillStyle(0xbba681).fillRect(tx * i, ty * i, 1, 1);
  for (const sign of [-1, 1]) {
    const x = sign * (half + 1) * tx,
      y = sign * (half + 1) * ty;
    g.fillStyle(0x4c5048).fillRect(x, y - h, 1, h + 1);
    g.fillStyle(cap).fillRect(x, y - h, 1, 1);
  }
  // Painter's order also handles leaves that fold toward the near side of the cutaway.
  for (let i = 0; i <= 2 * half; i++) {
    const fraction = (dy >= 0 ? i : 2 * half - i) / (2 * half);
    const x = ax + dx * fraction,
      y = ay + dy * fraction;
    g.fillStyle(shade).fillRect(x, y - h, 1, h + 1);
    if (fraction > 0 && fraction < 1) {
      g.fillStyle(face).fillRect(x, y - h + 1, 1, h - 2);
      if (laboratory) g.fillStyle(0xc9e1df).fillRect(x, y - h + 1, 1, 2);
      if (fraction === 0.75) g.fillStyle(0xffda85).fillRect(x, y - 2, 1, 1);
    }
    g.fillStyle(cap).fillRect(x, y - h, 1, 1);
  }
}
