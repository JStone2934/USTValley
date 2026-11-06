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

/** The grid marker is used for routing. Only the survey sill itself transfers
 * the player, in either scene, including a shallow diagonal approach. */
export function crossedEntrance(scene: SceneMap, from: Point, to: Point) {
  const dx = to.x - from.x,
    dy = to.y - from.y;
  for (const p of scene.portals) {
    if (p.kind !== "entrance" || !p.entrance) continue;
    const { threshold, toward, width } = p.entrance;
    const forward = dx * toward.x + dy * toward.y;
    if (forward <= 1e-7) continue;
    const along =
      (from.x - threshold.x) * toward.x + (from.y - threshold.y) * toward.y;
    // Front of the feet meets the sill immediately before the body centre.
    const line = -scene.player.radius * 0.5;
    if (along > line || along + forward < line) continue;
    const t = (line - along) / forward;
    const across =
      (from.x + dx * t - threshold.x) * toward.y -
      (from.y + dy * t - threshold.y) * toward.x;
    // Movement already checked the full footprint against both jambs. Every
    // physically reachable crossing between them must enter, even at an edge.
    if (Math.abs(across) <= width / 2 + 1e-7) return p;
  }
}

/** Manual entry is available directly in front of an opening. A nearby point
 * beside the jamb or behind another wall is not an entrance. */
export function facesEntrance(
  scene: SceneMap,
  feet: Point,
  p: SceneMap["portals"][number],
) {
  if (p.kind !== "entrance" || !p.entrance) return true;
  const { threshold, toward: n, width } = p.entrance;
  const dx = feet.x - threshold.x,
    dy = feet.y - threshold.y;
  const depth = -(dx * n.x + dy * n.y);
  return (
    depth >= -scene.player.radius &&
    depth <= scene.player.interactionRadius &&
    Math.abs(dx * n.y - dy * n.x) <= width / 2 - scene.player.radius &&
    hasLineOfSight(scene, feet, threshold)
  );
}
