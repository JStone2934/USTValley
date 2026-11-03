import {
  canStand,
  hasLineOfSight,
  type Point,
  type SceneMap,
} from "./world.ts";

export type RoomDoor = Point & {
  id: string;
  room: string;
  sourceId: number;
  sourceEntry: Point;
  /** Absolute jamb centres in logical map units. Older maps omit these fields. */
  hinge?: Point;
  latch?: Point;
  openingSource?: "wall-ends" | "room-edge";
  outside: Point;
  inside: Point;
  lanes?: { outside: Point; inside: Point }[];
  cells: number[];
};

export function distanceToLeaf(door: RoomDoor, point: Point) {
  const a = door.hinge ?? door,
    b = door.latch ?? door;
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const t = Math.max(
    0,
    Math.min(
      1,
      ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy || 1),
    ),
  );
  return Math.hypot(point.x - a.x - t * dx, point.y - a.y - t * dy);
}

export function nearbyDoors(scene: SceneMap, point: Point): RoomDoor[] {
  const range = scene.player.interactionRadius;
  return (scene.doors ?? []).filter((door) => {
    // A wide or oblique opening may put the grid's inside landing a step
    // beyond arm's reach of its midpoint. Keep either surveyed approach usable.
    if (distanceToLeaf(door, point) > range + scene.collisionSize) return false;
    const reachableSide = (side: Point) =>
      Math.hypot(side.x - point.x, side.y - point.y) <= range &&
      hasLineOfSight(scene, point, side);
    return [door, ...(door.lanes ?? [])].some(
      (lane) => reachableSide(lane.outside) || reachableSide(lane.inside),
    );
  });
}

/** A game-scene collision copy keeps the published map immutable between walks. */
export function doorCollision(scene: SceneMap, open: Set<string>): SceneMap {
  if (!scene.doors?.length) return scene;
  const walk = { ...scene, collision: scene.collision.slice() };
  for (const door of scene.doors)
    if (open.has(door.id))
      for (const cell of door.cells) walk.collision[cell] = 0;
  return walk;
}

export function toggleDoor(
  scene: SceneMap,
  door: RoomDoor,
  open: Set<string>,
  player: Point,
): boolean {
  const wasOpen = open.has(door.id);
  if (wasOpen && distanceToLeaf(door, player) <= scene.player.radius)
    return false;
  for (const cell of door.cells) scene.collision[cell] = wasOpen ? 1 : 0;
  if (wasOpen && !canStand(scene, player)) {
    for (const cell of door.cells) scene.collision[cell] = 0;
    return false;
  }
  if (wasOpen) open.delete(door.id);
  else open.add(door.id);
  return true;
}
