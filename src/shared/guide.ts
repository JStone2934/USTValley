import {
  canStand,
  canTraverse,
  type Point,
  type SceneMap,
  type WorldMap,
} from "./world";
import { doorCollision } from "./doors";
import { crossedEntrance } from "./automatic-doors";
import { campusNpcs, type Progress } from "./journey";
import { sundialViewpoints } from "./sundial";

export type GuideTarget = {
  kind: "building" | "npc" | "chest" | "sundial";
  id: string;
};
export type GuideRoute = {
  target: GuideTarget;
  name: string;
  sceneId: string;
  points: Point[];
  instruction: string;
  status: "planning" | "walking" | "arrived" | "unavailable";
  meters: number;
  portalId?: string;
};
const distance = (a: Point, b: Point) => Math.hypot(a.x - b.x, a.y - b.y);
export function recommendedTarget(
  world: WorldMap,
  p: Progress,
  sceneId: string,
  task?: string,
): GuideTarget | undefined {
  if (task === "reading")
    return !p.talked.includes("yun")
      ? { kind: "npc", id: "yun" }
      : { kind: "building", id: "C7" };
  if (task === "sundial") return { kind: "sundial", id: "sundial" };
  if (task === "friends") {
    const n = campusNpcs(world).find((n) => !p.talked.includes(n.id));
    return n && { kind: "npc", id: n.id };
  }
  if (!task || task === "first_walk") {
    if (!p.talked.includes("lin")) return { kind: "npc", id: "lin" };
    if (!p.discovered.includes("C2")) return { kind: "building", id: "C2" };
  }
  if (
    task === "first_chest" ||
    ((!task || task === "first_walk") && !p.chestsOpened)
  ) {
    const scenes = [...world.scenes].sort(
      (a, b) => Number(b.id === sceneId) - Number(a.id === sceneId),
    );
    for (const s of scenes) {
      const chest = s.chests.find(
        (c) => (p.chestReadyAt[c.id] ?? 0) <= Date.now(),
      );
      if (chest) return { kind: "chest", id: chest.id };
    }
  }
  const b = world.buildings.find((b) => !p.discovered.includes(b.id));
  return b ? { kind: "building", id: b.id } : undefined;
}

function destination(world: WorldMap, target: GuideTarget) {
  if (target.kind === "npc") {
    const n = campusNpcs(world).find((n) => n.id === target.id);
    return (
      n && {
        sceneId: n.sceneId,
        point: n,
        name: n.name,
        reach: world.scenes.find((s) => s.id === n.sceneId)!.player
          .interactionRadius,
        instruction: "已到达，靠近朋友按 E 交谈",
      }
    );
  }
  for (const s of world.scenes) {
    if (target.kind === "building") {
      const z = s.exploration.find((z) => z.buildingId === target.id);
      if (z)
        return {
          sceneId: s.id,
          point: { x: z.x + z.width / 2, y: z.y + z.height / 2 },
          name: `${target.id} · ${world.buildings.find((b) => b.id === target.id)?.name ?? "建筑探索"}`,
          reach: Math.min(z.width, z.height) / 2 - 0.2,
          instruction: "已到达建筑探索区",
        };
    }
    if (target.kind === "chest") {
      const c = s.chests.find((c) => c.id === target.id);
      if (c)
        return {
          sceneId: s.id,
          point: c,
          name: "探索宝箱",
          reach: s.player.interactionRadius,
          instruction: "已到达，按 E 打开宝箱",
        };
    }
    if (target.kind === "sundial") {
      const p = sundialViewpoints(s)[0];
      if (p)
        return {
          sceneId: s.id,
          point: p,
          name: "红鸟日晷",
          reach: s.player.interactionRadius,
          instruction: "已到达，按 E 观察红鸟日晷",
        };
    }
  }
}

/** Four-connected A*, with swept body checks at every edge. Door leaves may open;
 * permanent walls, fixtures and automatic scene boundaries may not be crossed. */
export function walkingPath(
  scene: SceneMap,
  start: Point,
  goal: Point,
  grid = scene.collisionSize,
): Point[] | undefined {
  const walk = doorCollision(
    scene,
    new Set(scene.doors?.map((d) => d.id) ?? []),
  );
  const clear = (a: Point, b: Point) =>
    canTraverse(walk, a, b) &&
    !crossedEntrance(walk, a, b) &&
    !walk.portals.some((p) => {
      if (p.kind !== "gallery" || distance(a, p) <= walk.collisionSize)
        return false;
      const dx = b.x - a.x,
        dy = b.y - a.y,
        t = Math.max(
          0,
          Math.min(
            1,
            ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1),
          ),
        );
      return (
        distance(p, { x: a.x + dx * t, y: a.y + dy * t }) <= walk.collisionSize
      );
    });
  if (!canStand(walk, start) || !canStand(walk, goal)) return;
  if (clear(start, goal)) return [start, goal];
  const size = grid,
    w = (walk.width * walk.tileSize) / size,
    h = (walk.height * walk.tileSize) / size,
    total = w * h;
  const point = (i: number) => ({
    x: ((i % w) + 0.5) * size,
    y: (Math.floor(i / w) + 0.5) * size,
  });
  const scores = new Float64Array(total).fill(Infinity),
    parents = new Int32Array(total).fill(-2),
    closed = new Uint8Array(total);
  const standing = new Uint8Array(total);
  const valid = (i: number) => {
    if (!standing[i]) standing[i] = canStand(walk, point(i)) ? 1 : 2;
    return standing[i] === 1;
  };
  const heap: { i: number; f: number }[] = [];
  const push = (i: number, g: number) => {
    const item = { i, f: g + distance(point(i), goal) };
    let n = heap.length;
    heap.push(item);
    while (n) {
      const p = (n - 1) >> 1;
      if (heap[p].f <= item.f) break;
      heap[n] = heap[p];
      n = p;
    }
    heap[n] = item;
  };
  const pop = () => {
    const first = heap[0],
      last = heap.pop()!;
    if (heap.length) {
      let n = 0;
      while (n * 2 + 1 < heap.length) {
        let c = n * 2 + 1;
        if (c + 1 < heap.length && heap[c + 1].f < heap[c].f) c++;
        if (heap[c].f >= last.f) break;
        heap[n] = heap[c];
        n = c;
      }
      heap[n] = last;
    }
    return first.i;
  };
  const sx = Math.floor(start.x / size),
    sy = Math.floor(start.y / size);
  for (let y = sy - 1; y <= sy + 1; y++)
    for (let x = sx - 1; x <= sx + 1; x++) {
      const i = y * w + x;
      if (
        x < 0 ||
        y < 0 ||
        x >= w ||
        y >= h ||
        !valid(i) ||
        !clear(start, point(i))
      )
        continue;
      scores[i] = distance(start, point(i));
      parents[i] = -1;
      push(i, scores[i]);
    }
  let end = -1;
  while (heap.length) {
    const i = pop();
    if (closed[i]) continue;
    closed[i] = 1;
    const a = point(i);
    if (distance(a, goal) <= size * 1.5 && clear(a, goal)) {
      end = i;
      break;
    }
    const x = i % w,
      y = Math.floor(i / w);
    for (const [nx, ny] of [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1],
    ]) {
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const n = ny * w + nx;
      if (
        closed[n] ||
        scores[n] <= scores[i] + size ||
        !valid(n) ||
        !clear(a, point(n))
      )
        continue;
      scores[n] = scores[i] + size;
      parents[n] = i;
      push(n, scores[n]);
    }
  }
  if (end < 0) return grid > 1 ? walkingPath(scene, start, goal, 1) : undefined;
  const raw: Point[] = [goal];
  for (let i = end; i !== -1; i = parents[i]) raw.push(point(i));
  raw.push(start);
  raw.reverse();
  const result: Point[] = [start];
  for (let cursor = 0; cursor < raw.length - 1; ) {
    let next = Math.min(cursor + 40, raw.length - 1);
    while (next > cursor + 1 && !clear(raw[cursor], raw[next])) next--;
    result.push(raw[next]);
    cursor = next;
  }
  return result;
}

const pathCache = new WeakMap<SceneMap, Map<string, Point[] | undefined>>();
function cachedPath(scene: SceneMap, start: Point, goal: Point) {
  let cache = pathCache.get(scene);
  if (!cache) {
    cache = new Map();
    pathCache.set(scene, cache);
  }
  const key = `${start.x},${start.y}:${goal.x},${goal.y}`;
  if (cache.has(key)) return cache.get(key);
  const path = walkingPath(scene, start, goal);
  if (cache.size > 256) cache.clear();
  cache.set(key, path);
  return path;
}

export function planGuide(
  world: WorldMap,
  sceneId: string,
  start: Point,
  target: GuideTarget,
): GuideRoute {
  const dest = destination(world, target),
    scene = world.scenes.find((s) => s.id === sceneId);
  const base: GuideRoute = {
    target,
    name: dest?.name ?? "目的地",
    sceneId,
    points: [],
    meters: 0,
    status: "unavailable",
    instruction: "暂时找不到安全路线，请换一个位置后重试",
  };
  if (!dest || !scene) return base;
  const walk = doorCollision(
    scene,
    new Set(scene.doors?.map((d) => d.id) ?? []),
  );
  if (
    dest.sceneId === sceneId &&
    distance(start, dest.point) <= dest.reach &&
    canTraverse(walk, start, dest.point)
  )
    return { ...base, status: "arrived", instruction: dest.instruction };
  const hops = new Map([[dest.sceneId, 0]]),
    queue = [dest.sceneId];
  for (let i = 0; i < queue.length; i++)
    for (const s of world.scenes)
      if (
        !hops.has(s.id) &&
        s.portals.some((p) => p.targetScene === queue[i])
      ) {
        hops.set(s.id, hops.get(queue[i])! + 1);
        queue.push(s.id);
      }
  function approach(s: SceneMap, p: SceneMap["portals"][number]): Point {
    const opened = doorCollision(s, new Set(s.doors?.map((d) => d.id) ?? []));
    let point =
      p.kind === "entrance" || p.kind === "gallery"
        ? p.spawn
        : canStand(opened, p)
          ? p
          : p.spawn;
    if (p.entrance) {
      const { threshold: t, toward: n } = p.entrance,
        near = {
          x: t.x - n.x * s.player.radius * 1.1,
          y: t.y - n.y * s.player.radius * 1.1,
        };
      if (canTraverse(opened, p.spawn, near)) point = near;
    }
    return point;
  }
  type Leg = { points: Point[]; portal?: SceneMap["portals"][number] };
  type Edge = {
    scene: SceneMap;
    start: Point;
    portal: SceneMap["portals"][number];
    first?: Leg;
    score: number;
    cost: number;
  };
  const pending: Edge[] = [],
    visited = new Set<string>();
  const enqueue = (s: SceneMap, from: Point, cost: number, first?: Leg) => {
    for (const p of s.portals)
      if (!visited.has(`${p.targetScene}:${p.targetPortal}`))
        pending.push({
          scene: s,
          start: from,
          portal: p,
          first,
          cost,
          score:
            (hops.get(p.targetScene) ?? 100) * 100000 +
            cost +
            distance(from, p.spawn) / s.units.pixelsPerMeter,
        });
  };
  let chosen: Leg | undefined;
  if (dest.sceneId === sceneId) {
    const points = cachedPath(scene, start, dest.point);
    if (points) chosen = { points };
  }
  if (!chosen) enqueue(scene, start, 0);
  // Portal landings are distinct graph nodes: one scene can contain separate wings.
  while (!chosen && pending.length) {
    pending.sort((a, b) => a.score - b.score);
    const edge = pending.shift()!,
      p = edge.portal;
    const key = `${p.targetScene}:${p.targetPortal}`;
    if (visited.has(key)) continue;
    const points = cachedPath(edge.scene, edge.start, approach(edge.scene, p));
    if (!points) continue;
    visited.add(key);
    const next = world.scenes.find((s) => s.id === p.targetScene),
      landing = next?.portals.find((q) => q.id === p.targetPortal);
    if (!next || !landing) continue;
    const first = edge.first ?? { points, portal: p };
    if (
      next.id === dest.sceneId &&
      cachedPath(next, landing.spawn, dest.point)
    ) {
      chosen = first;
      break;
    }
    enqueue(
      next,
      landing.spawn,
      edge.cost +
        distance(edge.start, p.spawn) / edge.scene.units.pixelsPerMeter,
      first,
    );
  }
  if (chosen) {
    const { points, portal } = chosen;
    const meters =
      points.slice(1).reduce((d, p, i) => d + distance(points[i], p), 0) /
      scene.units.pixelsPerMeter;
    const instruction = portal
      ? portal.kind === "entrance"
        ? "沿路线走过门槛 · " + portal.label
        : portal.kind === "gallery"
          ? "沿连廊继续前进 · " + portal.label
          : "到标记处按 E · " + portal.label
      : "沿金色路标前进";
    return {
      ...base,
      status: "walking",
      points,
      meters,
      portalId: portal?.id,
      instruction,
    };
  }
  return base;
}

/** Evenly spaced paving marks, shared by the two renderers. */
export function routeDots(points: Point[], spacing = 3): Point[] {
  const dots: Point[] = [];
  let remaining = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1],
      b = points[i],
      length = distance(a, b);
    if (!length) continue;
    while (remaining <= length && dots.length < 1600) {
      const t = remaining / length;
      dots.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      remaining += spacing;
    }
    remaining -= length;
  }
  return dots;
}
