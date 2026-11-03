import type Phaser from "phaser";
import type { RoomDoor } from "../shared/doors";

// Draw in thirds of a map unit, the same texel size as the baked wall. The
// hinge stays anchored to the jamb when the leaf swings into the real room.
export function drawRoomDoor(
  g: Phaser.GameObjects.Graphics,
  door: RoomDoor,
  open: boolean,
  ppm: number,
  projection: number,
) {
  const nx = Math.sign(door.inside.x - door.outside.x);
  const ny = Math.sign(door.inside.y - door.outside.y);
  const tx = -ny,
    ty = nx,
    half = 2,
    unit = 1 / 3;
  const h = Math.round((1.85 * ppm * projection) / unit) * unit;
  const ax = -tx * half,
    ay = -ty * half;
  const dx = (open ? nx : tx) * half * 2,
    dy = (open ? ny : ty) * half * 2;
  const sanitary = /洗手间|卫生间/.test(door.room),
    laboratory = /实验/.test(door.room);
  const edge = sanitary ? 0x446e70 : laboratory ? 0x465f6d : 0x75543d;
  const face = sanitary ? 0x75aaa6 : laboratory ? 0x8ba9aa : 0xb9875f;
  const light = sanitary ? 0x92c4b8 : laboratory ? 0xa7c2c0 : 0xd5a975;
  g.clear();
  for (let j = 0; j <= 12; j++) {
    const u = j * unit - half;
    g.fillStyle(0xaa9c82).fillRect(tx * u, ty * u, unit, unit * 2);
  }
  for (const sign of [-1, 1]) {
    const x = sign * half * tx,
      y = sign * half * ty;
    g.fillStyle(0x575643).fillRect(x - unit, y - h, 3 * unit, h + unit);
    g.fillStyle(light).fillRect(x - unit, y - h, unit, h);
  }
  for (let j = 0; j <= 12; j++) {
    const col = dy >= 0 ? j : 12 - j,
      t = col / 12;
    const x = ax + dx * t,
      y = ay + dy * t;
    g.fillStyle(edge).fillRect(x, y - h, unit + 0.04, h);
    if (col > 0 && col < 12) {
      g.fillStyle(face).fillRect(x, y - h + unit, unit + 0.04, h - unit * 2);
      // Slim glazed vision panel in laboratory doors; a recessed wood panel elsewhere.
      if (col >= 3 && col <= 9) {
        g.fillStyle(laboratory ? 0x729899 : edge).fillRect(
          x,
          y - h + unit * 3,
          unit + 0.04,
          h * 0.43,
        );
        if (col > 3 && col < 9)
          g.fillStyle(laboratory ? 0xbdceca : light).fillRect(
            x,
            y - h + unit * 4,
            unit + 0.04,
            h * 0.43 - unit * 2,
          );
      }
      if (!laboratory && !sanitary && col > 1 && col < 10 && col % 3 === 0)
        g.fillStyle(0xa97b57).fillRect(x, y - h * 0.39, unit, h * 0.23);
      if (col === 9 || col === 10)
        g.fillStyle(0xe9c986).fillRect(x, y - h * 0.54, unit, unit);
    }
    g.fillStyle(light).fillRect(x, y - h, unit + 0.04, unit);
  }
}
