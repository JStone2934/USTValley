import { canStand, type Point, type SceneMap } from "../src/shared/world.ts";

/** Surveyed ground-floor doors are the one place where feet may straddle two
 * scenes. Cut a short, foot-deep pocket, retaining each blocked pixel of the
 * surrounding facade even if it shares a coarse navigation cell with the door. */
export function fitEntranceSills(scene: SceneMap) {
  const doors = scene.portals.filter(
    (p) => p.kind === "entrance" && p.entrance,
  );
  if (!doors.length) return;
  const w = scene.width * scene.tileSize,
    h = scene.height * scene.tileSize;
  const ppm = scene.units.pixelsPerMeter,
    size = scene.collisionSize;
  const mask = new Uint8Array(w * h);
  const original = scene.fixtureCollision;
  for (let i = 0; i < (original?.runs.length ?? 0); i += 3) {
    const [y, x, length] = original!.runs.slice(i, i + 3);
    mask.fill(1, y * w + x, y * w + x + length);
  }
  for (const door of doors) {
    const opening = door.entrance!,
      { threshold: sill, toward: n } = opening;
    const depth = (p: Point) => (p.x - sill.x) * n.x + (p.y - sill.y) * n.y;
    const start = Math.min(-ppm, depth(door) - scene.player.radius - 1);
    const end = scene.player.radius + 0.5;
    const extent = Math.ceil(Math.max(-start, end) + opening.width / 2 + 1);
    for (
      let y = Math.max(0, Math.floor(sill.y - extent));
      y < Math.min(h, sill.y + extent);
      y++
    )
      for (
        let x = Math.max(0, Math.floor(sill.x - extent));
        x < Math.min(w, sill.x + extent);
        x++
      ) {
        const dx = x + 0.5 - sill.x,
          dy = y + 0.5 - sill.y;
        const forward = dx * n.x + dy * n.y;
        if (
          forward < start ||
          forward > end ||
          Math.abs(dx * n.y - dy * n.x) > opening.width / 2
        )
          continue;
        const cx = Math.floor(x / size) * size,
          cy = Math.floor(y / size) * size;
        const cell = (cy / size) * (w / size) + cx / size;
        if (scene.collision[cell]) {
          scene.collision[cell] = 0;
          for (let row = cy; row < cy + size; row++)
            mask.fill(1, row * w + cx, row * w + cx + size);
        }
        mask[y * w + x] = 0;
      }
  }
  const runs: number[] = [];
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; ) {
      if (!mask[y * w + x]) {
        x++;
        continue;
      }
      const start = x++;
      while (x < w && mask[y * w + x]) x++;
      runs.push(y, start, x - start);
    }
  scene.fixtureCollision = { sourceIds: original?.sourceIds ?? [], runs };

  // Put the return spawn on a continuous, foot-sized approach to the physical
  // sill. Grid-aligned hints can otherwise line the player up with a jamb.
  for (const door of doors) {
    const { threshold, toward: n, width } = door.entrance!;
    const length = -(
      (door.spawn.x - threshold.x) * n.x +
      (door.spawn.y - threshold.y) * n.y
    );
    const existingSide =
      -(door.spawn.x - threshold.x) * n.y + (door.spawn.y - threshold.y) * n.x;
    const at = (t: number, side: number) => ({
      x: threshold.x + n.x * t - n.y * side,
      y: threshold.y + n.y * t + n.x * side,
    });
    const sides = [0, existingSide];
    for (let side = 0.25; side < width / 2 - scene.player.radius; side += 0.25)
      sides.push(side, -side);
    let placed = false;
    for (
      let retreat = length;
      retreat >= ppm && !placed;
      retreat -= 0.25 * ppm
    ) {
      for (const side of sides) {
        if (Math.abs(side) > width / 2 - scene.player.radius) continue;
        const spawn = at(-retreat, side);
        let clear = true;
        for (let t = -retreat; t < 0.01; t += 0.25)
          if (!canStand(scene, at(t, side))) {
            clear = false;
            break;
          }
        if (!clear || !canStand(scene, at(0, side))) continue;
        const old = door.spawn;
        for (const saved of scene.spawns)
          if (Math.hypot(saved.x - old.x, saved.y - old.y) < 0.01)
            Object.assign(saved, spawn);
        door.spawn = spawn;
        placed = true;
        break;
      }
    }
    if (!placed) throw new Error(`Cannot walk to surveyed sill of ${door.id}`);
  }
}
