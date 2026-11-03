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
  outside: Point;
  inside: Point;
  cells: number[];
};

export function nearbyDoors(scene: SceneMap, point: Point): RoomDoor[] {
  const range = scene.player.interactionRadius;
  return (scene.doors ?? []).filter((door) => {
    if (Math.hypot(point.x - door.x, point.y - door.y) > range) return false;
    return [door.outside, door.inside].some(
      (side) =>
        Math.hypot(side.x - point.x, side.y - point.y) <= range &&
        hasLineOfSight(scene, point, side),
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
  for (const cell of door.cells) scene.collision[cell] = wasOpen ? 1 : 0;
  if (wasOpen && !canStand(scene, player)) {
    for (const cell of door.cells) scene.collision[cell] = 0;
    return false;
  }
  if (wasOpen) open.delete(door.id);
  else open.add(door.id);
  return true;
}
