import { clearOfFixtures, type FixtureCollision } from "./fixtures.ts";
import type { HumanDimensions, MetricScale, ScenePlayer } from "./scale";
import type { RoomDoor } from "./doors";
export type Point = { x: number; y: number };
export type Rect = Point & { width: number; height: number };
export type BuildingId =
  | `E${1 | 2 | 3 | 4}`
  | `W${1 | 2 | 3 | 4}`
  | `C${1 | 2 | 3 | 4 | 5 | 6 | 7}`;
export type Portal = Point & {
  id: string;
  targetScene: string;
  targetPortal: string;
  spawn: Point;
  label: string;
  sourceRoadId?: string;
  entrance?: {
    threshold: Point;
    toward: Point;
    width: number;
    glazing?: { sourceId: number; jambA: Point; jambB: Point };
  };
} & (
    | {
        kind: "entrance" | "stairs" | "lift" | "escalator";
        buildingId: BuildingId;
      }
    | { kind: "gallery"; buildingId?: never }
  );
export type Building = Rect & {
  id: BuildingId;
  name: string;
  group: string;
  review: "pending";
  anchorMethod: string;
  label: Point;
};
export type Surface = {
  kind: string;
  color: string;
  polygons: Point[][][];
  sourceId: number;
  sourceLayer: string;
  sourceMap: string;
  sourceFloor: string;
  line?: Point[];
  strokeWidth?: number;
};
export type Roof = Rect & { id: string; image: string; footprint: Point[][][] };
export type SceneMap = {
  id: string;
  name: string;
  width: number;
  height: number;
  tileSize: number;
  ground: number[];
  collision: number[];
  collisionSize: number;
  units: MetricScale;
  player: ScenePlayer;
  surfaces: Surface[];
  sourceMap: string;
  sourceOffset: Point;
  floor: { key: string; name: string; elevation: number };
  art: {
    style: "pixel-3d";
    ground: string;
    pixelRatio?: number;
    riseMap?: string;
    landmarks?: (Rect & { id: number; image: string; frontY: number })[];
    layers: { id: string; image: string }[];
    roofs: Roof[];
  };
  decoration: Rect[];
  foreground: Rect[];
  portals: Portal[];
  doors?: RoomDoor[];
  pointFixtures?: import("./casework").SourcePointFixture[];
  fixtureCollision?: FixtureCollision;
  roomCasework?: import("./casework").RoomCasework[];
  exploration: (Rect & { buildingId: BuildingId })[];
  note_zones: Rect[];
  chests: (Point & { id: string })[];
  spawns: (Point & { id: string })[];
  buildings: Building[];
  sourceOutlines: { group: string; points: Point[] }[];
  sourceRoads: Point[][];
  sourceEntries: Point[];
};
export type WorldMap = {
  mapVersion: string;
  protocolVersion: number;
  human: HumanDimensions;
  chest: { widthMeters: number; heightMeters: number; depthMeters: number };
  status: "reconstructed";
  scenes: SceneMap[];
  buildings: Building[];
};
export type Transform = {
  origin: number[];
  rotationDegrees: number;
  pixelsPerProjectedUnit: number;
  flipY: boolean;
  padding: number;
};

export function project(point: number[], transform: Transform): Point {
  const angle = (transform.rotationDegrees * Math.PI) / 180;
  const x = point[0] - transform.origin[0],
    y = point[1] - transform.origin[1];
  return {
    x:
      (x * Math.cos(angle) - y * Math.sin(angle)) *
      transform.pixelsPerProjectedUnit,
    y:
      (x * Math.sin(angle) + y * Math.cos(angle)) *
      transform.pixelsPerProjectedUnit *
      (transform.flipY ? -1 : 1),
  };
}

export function tileIndex(scene: SceneMap, point: Point): number {
  const size = scene.collisionSize;
  return (
    Math.floor(point.y / size) * ((scene.width * scene.tileSize) / size) +
    Math.floor(point.x / size)
  );
}

export function canStand(
  scene: SceneMap,
  point: Point,
  radius = scene.player.radius,
): boolean {
  if (!Number.isFinite(point.x) || !Number.isFinite(point.y)) return false;
  if (
    point.x - radius < 0 ||
    point.y - radius < 0 ||
    point.x + radius >= scene.width * scene.tileSize ||
    point.y + radius >= scene.height * scene.tileSize
  )
    return false;
  const size = scene.collisionSize,
    w = (scene.width * scene.tileSize) / size;
  for (
    let y = Math.floor((point.y - radius) / size);
    y <= Math.floor((point.y + radius) / size);
    y++
  )
    for (
      let x = Math.floor((point.x - radius) / size);
      x <= Math.floor((point.x + radius) / size);
      x++
    )
      if (scene.collision[y * w + x] !== 0) return false;
  return clearOfFixtures(
    scene,
    point.x - radius,
    point.y - radius,
    point.x + radius,
    point.y + radius,
  );
}

/** Fixture footprints can be narrower than the structural grid. Validate the whole axis-aligned step. */
export function clearFixtureStep(
  scene: SceneMap,
  x: number,
  y: number,
  nx: number,
  ny: number,
  radius = scene.player.radius,
) {
  const s = scene.collisionSize;
  return clearOfFixtures(
    scene,
    (Math.min(x, nx) + 0.5) * s - radius,
    (Math.min(y, ny) + 0.5) * s - radius,
    (Math.max(x, nx) + 0.5) * s + radius,
    (Math.max(y, ny) + 0.5) * s + radius,
  );
}

export function move(
  scene: SceneMap,
  position: Point,
  input: Point,
  seconds: number,
  speed = scene.player.speed,
  radius = scene.player.radius,
): Point {
  if (
    ![input.x, input.y, seconds, speed].every(Number.isFinite) ||
    seconds <= 0
  )
    return { ...position };
  const length = Math.hypot(input.x, input.y);
  if (!length) return { ...position };
  const scale =
    (Math.min(seconds, 0.1) * Math.max(0, speed)) / Math.max(1, length);
  const dx = input.x * scale,
    dy = input.y * scale;
  const steps = Math.max(
    1,
    Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / Math.max(1, radius)),
  );
  const result = { ...position };
  for (let i = 0; i < steps; i++) {
    if (canStand(scene, { x: result.x + dx / steps, y: result.y }, radius))
      result.x += dx / steps;
    if (canStand(scene, { x: result.x, y: result.y + dy / steps }, radius))
      result.y += dy / steps;
  }
  return result;
}

export function contains(rect: Rect, p: Point): boolean {
  return (
    p.x >= rect.x &&
    p.y >= rect.y &&
    p.x < rect.x + rect.width &&
    p.y < rect.y + rect.height
  );
}

export function nearbyPortals(
  scene: SceneMap,
  point: Point,
  radius = scene.player.interactionRadius,
): Portal[] {
  return scene.portals
    .filter(
      (p) =>
        Math.hypot(p.x - point.x, p.y - point.y) <= radius &&
        hasLineOfSight(scene, point, p),
    )
    .sort(
      (a, b) =>
        Math.hypot(a.x - point.x, a.y - point.y) -
        Math.hypot(b.x - point.x, b.y - point.y),
    );
}
export function nearbyPortal(
  scene: SceneMap,
  point: Point,
  radius = scene.player.interactionRadius,
): Portal | undefined {
  return nearbyPortals(scene, point, radius)[0];
}

export function hasLineOfSight(
  scene: SceneMap,
  from: Point,
  to: Point,
): boolean {
  const steps = Math.max(
    1,
    Math.ceil(
      Math.hypot(to.x - from.x, to.y - from.y) /
        (scene.fixtureCollision ? 1 : 4),
    ),
  );
  for (let i = 0; i <= steps; i++) {
    if (
      !canStand(
        scene,
        {
          x: from.x + ((to.x - from.x) * i) / steps,
          y: from.y + ((to.y - from.y) * i) / steps,
        },
        0,
      )
    )
      return false;
  }
  return true;
}

/** Cardinal BFS uses the same avatar footprint as runtime collision. */
export function reachable(
  scene: SceneMap,
  start: Point,
  radius = scene.player.radius,
): Set<number> {
  const startIndex = tileIndex(scene, start),
    visited = new Set<number>();
  const size = scene.collisionSize,
    width = (scene.width * scene.tileSize) / size,
    height = (scene.height * scene.tileSize) / size;
  if (!canStand(scene, start, radius)) return visited;
  const queue = [startIndex];
  visited.add(startIndex);
  for (let head = 0; head < queue.length; head++) {
    const i = queue[head],
      x = i % width,
      y = Math.floor(i / width);
    for (const [nx, ny] of [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1],
    ]) {
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const n = ny * width + nx;
      if (
        visited.has(n) ||
        (scene.fixtureCollision &&
          !clearFixtureStep(scene, x, y, nx, ny, radius)) ||
        !canStand(scene, { x: (nx + 0.5) * size, y: (ny + 0.5) * size }, radius)
      )
        continue;
      visited.add(n);
      queue.push(n);
    }
  }
  return visited;
}

/** Follow physical walking components and reciprocal source connectors from the campus. */
export function reachableWorld(world: WorldMap): Map<string, Set<number>> {
  const visited = new Map(world.scenes.map((s) => [s.id, new Set<number>()]));
  const byId = new Map(world.scenes.map((s) => [s.id, s]));
  const campus = byId.get("campus_core")!;
  const queue: { scene: SceneMap; start: Point }[] = [
    { scene: campus, start: campus.spawns[0] },
  ];
  for (let head = 0; head < queue.length; head++) {
    const { scene, start } = queue[head],
      seen = visited.get(scene.id)!;
    if (seen.has(tileIndex(scene, start))) continue;
    const component = reachable(scene, start);
    component.forEach((i) => seen.add(i));
    for (const portal of scene.portals)
      if (component.has(tileIndex(scene, portal))) {
        const target = byId.get(portal.targetScene);
        const reverse = target?.portals.find(
          (p) => p.id === portal.targetPortal,
        );
        if (target && reverse)
          queue.push({ scene: target, start: reverse.spawn });
      }
  }
  return visited;
}
