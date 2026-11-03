import { nearbyDoors, type RoomDoor } from "./doors.ts";
import { hasLineOfSight, type Point, type SceneMap } from "./world.ts";

/** Only the door whose passage the walker is aimed at should open. Side points
 * belong to the walk mesh; the leaf itself may be on an oblique wall. */
export function approachedRoomDoor(
  scene: SceneMap,
  feet: Point,
  motion: Point,
) {
  const speed = Math.hypot(motion.x, motion.y);
  if (!speed) return;
  let nearest: RoomDoor | undefined;
  let best = Infinity;
  for (const door of nearbyDoors(scene, feet)) {
    for (const lane of [door, ...(door.lanes ?? [])]) {
      const dx = lane.inside.x - lane.outside.x,
        dy = lane.inside.y - lane.outside.y;
      const length = Math.hypot(dx, dy);
      if (!length) continue;
      const nx = dx / length,
        ny = dy / length;
      const forward = (motion.x * nx + motion.y * ny) / speed;
      if (Math.abs(forward) < 0.4) continue;
      const side = forward > 0 ? lane.outside : lane.inside;
      const distance = Math.hypot(feet.x - side.x, feet.y - side.y);
      if (distance > scene.player.interactionRadius) continue;
      const ax = feet.x - (lane.outside.x + lane.inside.x) / 2;
      const ay = feet.y - (lane.outside.y + lane.inside.y) / 2;
      if ((ax * nx + ay * ny) * Math.sign(forward) > 0) continue;
      const lateral = Math.abs(ax * ny - ay * nx);
      if (lateral > scene.collisionSize / 2 + scene.player.radius) continue;
      const score = distance + lateral;
      if (score < best && hasLineOfSight(scene, feet, side)) {
        best = score;
        nearest = door;
      }
    }
  }
  return nearest;
}

/** Leave clearance on both faces, including multi-cell passages. */
export function clearOfDoor(scene: SceneMap, door: RoomDoor, feet: Point) {
  const reach = scene.player.interactionRadius * 1.4;
  const far = (p: Point) => Math.hypot(feet.x - p.x, feet.y - p.y) > reach;
  return (
    far(door) &&
    [door, ...(door.lanes ?? [])].every(
      (lane) => far(lane.inside) && far(lane.outside),
    )
  );
}

/** Cross a short, directed line on the accessible side of the surveyed sill.
 * Walking along the facade or standing at the return spawn cannot trigger it. */
export function crossedEntrance(scene: SceneMap, from: Point, to: Point) {
  const dx = to.x - from.x,
    dy = to.y - from.y;
  const travel = Math.hypot(dx, dy);
  if (!travel) return;
  for (const p of scene.portals) {
    if (p.kind !== "entrance" || !p.entrance) continue;
    const { toward, width } = p.entrance;
    const forward = dx * toward.x + dy * toward.y;
    if (forward < 0.45 * travel) continue;
    const along = (from.x - p.x) * toward.x + (from.y - p.y) * toward.y;
    const line = -scene.player.radius * 0.5;
    if (along > line || along + forward < line) continue;
    const t = (line - along) / forward;
    const across =
      (from.x + dx * t - p.x) * toward.y - (from.y + dy * t - p.y) * toward.x;
    if (Math.abs(across) <= width / 2 && hasLineOfSight(scene, to, p)) return p;
  }
}
