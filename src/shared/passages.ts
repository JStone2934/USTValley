import {
  nearbyPortals,
  type Point,
  type Portal,
  type SceneMap,
  type WorldMap,
} from "./world";

/** A skybridge joins two map sheets at the same height. Arrival on its reverse
 * marker cannot retrigger it until the avatar walks away and comes back. */
export function crossedGallery(scene: SceneMap, from: Point, to: Point) {
  const radius = scene.collisionSize;
  if (from.x === to.x && from.y === to.y) return;
  return nearbyPortals(scene, to, radius).find(
    (p) =>
      p.kind === "gallery" && Math.hypot(p.x - from.x, p.y - from.y) > radius,
  );
}

export function passageLabel(
  world: WorldMap,
  scene: SceneMap,
  portal: Portal,
): string {
  if (portal.kind === "entrance" || portal.kind === "gallery")
    return portal.label;
  const target = world.scenes.find((s) => s.id === portal.targetScene)!;
  const up = target.floor.elevation > scene.floor.elevation;
  const kind = { stairs: "楼梯", lift: "电梯", escalator: "扶梯" }[portal.kind];
  return `${kind} ${up ? "↑ 上楼至" : "↓ 下楼至"} ${target.floor.name}`;
}

export type PassageMarker = Point & {
  kind: Exclude<Portal["kind"], "entrance">;
  portalIds: string[];
  label: string;
  destinations: string[];
};

/** Up and down links sharing a landing use one stair symbol with both destinations. */
export function passageMarkers(
  world: WorldMap,
  scene: SceneMap,
): PassageMarker[] {
  const groups = new Map<string, PassageMarker>();
  for (const portal of scene.portals) {
    if (portal.kind === "entrance") continue;
    const target = world.scenes.find((s) => s.id === portal.targetScene)!;
    if (portal.kind === "gallery") {
      groups.set(portal.id, {
        x: portal.x,
        y: portal.y,
        kind: "gallery",
        portalIds: [portal.id],
        destinations: [target.name],
        label: portal.label,
      });
      continue;
    }
    const destination = `${target.floor.elevation > scene.floor.elevation ? "↑" : "↓"} ${target.floor.name}`;
    const key = `${portal.kind}:${portal.x}:${portal.y}`;
    let marker = groups.get(key);
    if (!marker) {
      marker = {
        x: portal.x,
        y: portal.y,
        kind: portal.kind,
        portalIds: [],
        label: "",
        destinations: [],
      };
      groups.set(key, marker);
    }
    marker.portalIds.push(portal.id);
    if (!marker.destinations.includes(destination))
      marker.destinations.push(destination);
    marker.label = `${{ stairs: "楼梯", lift: "电梯", escalator: "扶梯" }[portal.kind]} ${marker.destinations.join(" / ")}`;
  }
  return [...groups.values()];
}

/** Indoor maps follow the avatar; outdoor overview may preview another building's floor. */
export function visibleFloorPlan(
  world: WorldMap,
  currentSceneId: string,
  previewSceneId: string,
): SceneMap {
  const current = world.scenes.find((s) => s.id === currentSceneId)!;
  return current.id === "campus_core"
    ? (world.scenes.find((s) => s.id === previewSceneId) ?? current)
    : current;
}
