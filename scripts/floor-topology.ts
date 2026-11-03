import config from "../content/map-config.json";
import {
  canStand,
  contains,
  project,
  reachable,
  tileIndex,
  type BuildingId,
  type Point,
  type SceneMap,
} from "../src/shared/world.ts";
import {
  bounds,
  coordinates,
  layers,
  type Sources,
} from "./source-geometry.ts";
import { emptyScene, gridPoint, sourceFloor } from "./scene-layers.ts";

type Template = {
  scene: SceneMap;
  convert: (p: number[]) => Point;
  space: Set<number>;
};
type Evidence = { id: BuildingId; templateKey: string; scene: SceneMap };

function nearest(
  scene: SceneMap,
  space: Set<number>,
  target: Point,
  accept = (_: Point) => true,
) {
  let best: Point | undefined,
    distance = Infinity;
  for (const i of space) {
    const p = gridPoint(scene, i),
      d = Math.hypot(p.x - target.x, p.y - target.y);
    if (d < distance && accept(p)) {
      best = p;
      distance = d;
    }
  }
  if (!best) throw new Error(`No public point: ${scene.id}`);
  return { point: best, distance };
}

/** One physical F1 wing is shared by its building numbers; upper floors retain the full connected gallery. */
export function reconstructFloors(
  sources: Sources,
  outdoor: SceneMap,
  evidence: Evidence[],
  templates: Map<string, Template>,
) {
  const scenes: SceneMap[] = [],
    byTemplate = new Map<string, SceneMap>();
  for (const e of evidence) {
    const existing = byTemplate.get(e.templateKey);
    if (existing) {
      for (const p of outdoor.portals.filter(
        (p) => p.targetScene === e.scene.id,
      ))
        p.targetScene = existing.id;
      existing.portals.push(...e.scene.portals);
      existing.exploration.push(...e.scene.exploration);
      existing.chests.push(...e.scene.chests);
      e.scene = existing;
    } else {
      byTemplate.set(e.templateKey, e.scene);
      scenes.push(e.scene);
    }
  }
  const placed: {
    scene: SceneMap;
    convert: Template["convert"];
    group: string;
  }[] = [];
  for (const [key, scene] of byTemplate) {
    scene.name = `${evidence
      .filter((e) => e.scene === scene)
      .map((e) => e.id)
      .join(
        " / ",
      )} · ${config.groups.find((g) => g.key === key.split(":")[0])!.name} · F1`;
    placed.push({
      scene,
      convert: templates.get(key)!.convert,
      group: key.split(":")[0],
    });
  }
  for (const group of config.groups) {
    const source = sources[group.sourceMap];
    for (const floor of Object.keys(source.map.mapdata).filter(
      (f) => f !== "0",
    )) {
      const fs = layers(source, floor)
        .filter((l) => /^(floor|1_floor)/i.test(l.name))
        .flatMap((l) => l.data?.features ?? []);
      const scaled = (p: number[]) =>
        project(p, {
          ...config.transform,
          pixelsPerProjectedUnit: config.interiorScale,
        });
      const box = bounds(
        fs.flatMap((f) => coordinates(f.geometry.coordinates).map(scaled)),
      );
      const convert = (p: number[]) => {
        const q = scaled(p);
        return {
          x: Math.round((q.x - box.x + 32) * 100) / 100,
          y: Math.round((q.y - box.y + 32) * 100) / 100,
        };
      };
      const region = source.map.mapinfo.regions.find(
        (r) => String(r.region) === floor,
      );
      if (!region)
        throw new Error(`Missing source floor metadata ${group.key}:${floor}`);
      const scene = emptyScene(
        `interior_${group.key}_f${Number(floor) + 1}`,
        `${group.name} · ${region.name}`,
        Math.ceil((box.width + 64) / 16),
        Math.ceil((box.height + 64) / 16),
        `floor-${group.key}-f${Number(floor) + 1}.png`,
      );
      scene.sourceMap = group.sourceMap;
      scene.sourceOffset = { x: 32 - box.x, y: 32 - box.y };
      scene.floor = { key: floor, name: region.name, elevation: region.z };
      sourceFloor(scene, source, convert, true, floor);
      placed.push({ scene, convert, group: group.key });
      scenes.push(scene);
    }
  }
  // Precompute individual public components: cross-floor links can legitimately land in
  // separate wings. Never move a source landing to an unrelated largest component.
  const spaces = new Map(
    scenes.map((s) => [
      s.id,
      new Set(
        s.collision.flatMap((_, i) =>
          canStand(s, gridPoint(s, i)) ? [i] : [],
        ),
      ),
    ]),
  );
  const connections: {
    sourceMap: string;
    roadId: string;
    kind: string;
    fromFloor: string;
    toFloor: string;
    accepted: boolean;
    offsets?: number[];
    reason?: string;
  }[] = [];
  for (const group of config.groups) {
    const source = sources[group.sourceMap];
    for (const [roadId, road] of Object.entries(
      source.road.roads["-10000"] ?? {},
    )) {
      if (
        !road.mode.includes("walk") ||
        road.geometry !== "line" ||
        !(road.vertexes as number[]).length
      )
        continue;
      const points = (road.vertexes as number[]).map(
        (id) => source.road.points[id],
      );
      if (points.some((p) => !p))
        throw new Error(`Missing connector vertex ${roadId}`);
      const from = points[0],
        to = points.at(-1)!;
      if (from.region === to.region) continue;
      const kind = road.type ?? "stairs";
      if (!["stairs", "lift", "escalator"].includes(kind))
        throw new Error(`Unknown connector ${kind}`);
      const land = (p: typeof from) =>
        placed
          .filter(
            (s) =>
              s.group === group.key && s.scene.floor.key === String(p.region),
          )
          .map((s) => {
            const raw = s.convert([p.x, p.y]);
            return { ...s, ...nearest(s.scene, spaces.get(s.scene.id)!, raw) };
          })
          .sort((a, b) => a.distance - b.distance)[0];
      const a = land(from),
        b = land(to);
      const record = {
        sourceMap: group.sourceMap,
        roadId,
        kind,
        fromFloor: String(from.region),
        toFloor: String(to.region),
        accepted: Boolean(a && b && a.distance <= 24 && b.distance <= 24),
        offsets: [a?.distance ?? -1, b?.distance ?? -1],
      };
      connections.push(record);
      if (!record.accepted) {
        Object.assign(record, {
          reason: "源落点距安全公共通道超过24px，保留平面但不创建推测通道",
        });
        continue;
      }
      const owner = config.buildings.find((d) => d.group === group.key)!
        .id as BuildingId;
      const typeName = { stairs: "楼梯", lift: "电梯", escalator: "扶梯" }[
        kind as "stairs" | "lift" | "escalator"
      ];
      const pair = [a, b];
      pair.forEach((end, i) => {
        const other = pair[1 - i],
          id = `connector_${group.key}_${roadId}_${i}`;
        end.scene.portals.push({
          ...end.point,
          id,
          buildingId: owner,
          kind: kind as "stairs" | "lift" | "escalator",
          label: `${typeName} → ${other.scene.floor.name}`,
          sourceRoadId: roadId,
          targetScene: other.scene.id,
          targetPortal: `connector_${group.key}_${roadId}_${1 - i}`,
          spawn: end.point,
        });
      });
    }
  }
  // The source splits skybridges between separate building maps. Match both survey
  // records in projected coordinates, never floor names or overlap of map extents.
  const boundaries = placed.flatMap(({ scene, convert, group }) => {
    const floor = sources[scene.sourceMap].map.mapinfo.regions.find(
      (r) => String(r.region) === scene.floor.key,
    )!;
    if (floor.z <= 0) return [];
    return (floor.entries ?? []).flatMap((entry, index) =>
      entry.in.z === floor.z && entry.out.z === floor.z
        ? [
            {
              scene,
              convert,
              group,
              entry,
              index,
              id: `gallery_${group}_${floor.region}_${index}`,
            },
          ]
        : [],
    );
  });
  const galleryPairs: {
    from: string;
    to: string;
    sourceEntries: number[];
    elevation: number;
    matchMeters: number;
    landingOffsets: number[];
  }[] = [];
  type Boundary = (typeof boundaries)[number];
  const separation = (a: Boundary, b: Boundary) =>
    Math.max(
      Math.hypot(a.entry.out.x - b.entry.in.x, a.entry.out.y - b.entry.in.y),
      Math.hypot(b.entry.out.x - a.entry.in.x, b.entry.out.y - a.entry.in.y),
    ) * a.scene.units.metersPerProjectedUnit;
  const counterparts = boundaries.map((a) =>
    boundaries.filter(
      (b) =>
        a.scene.sourceMap !== b.scene.sourceMap &&
        a.scene.floor.elevation === b.scene.floor.elevation &&
        separation(a, b) <= 0.75,
    ),
  );
  const circulation = new Map<string, Set<number>>();
  const landing = (end: Boundary) => {
    let component = circulation.get(end.scene.id);
    if (!component) {
      component = new Set<number>();
      for (const p of end.scene.portals) {
        if (p.kind !== "gallery" && !component.has(tileIndex(end.scene, p)))
          for (const i of reachable(end.scene, p)) component.add(i);
      }
      circulation.set(end.scene.id, component);
    }
    const at = end.convert([end.entry.in.x, end.entry.in.y]);
    const safe = nearest(end.scene, component, at);
    if (safe.distance > end.scene.units.pixelsPerMeter * 1.5)
      throw new Error(`Gallery outside its local walking component: ${end.id}`);
    return safe;
  };
  for (const [i, a] of boundaries.entries()) {
    const matches = counterparts[i];
    if (matches.length !== 1) continue;
    const b = matches[0],
      j = boundaries.indexOf(b);
    if (i >= j || counterparts[j].length !== 1) continue;
    const pa = landing(a),
      pb = landing(b);
    for (const [from, to, point] of [
      [a, b, pa.point],
      [b, a, pb.point],
    ] as const) {
      from.scene.portals.push({
        ...point,
        id: from.id,
        kind: "gallery",
        label: `穿过连廊至${to.scene.name}`,
        targetScene: to.scene.id,
        targetPortal: to.id,
        spawn: point,
      });
    }
    galleryPairs.push({
      from: a.scene.id,
      to: b.scene.id,
      sourceEntries: [a.index, b.index],
      elevation: a.scene.floor.elevation,
      matchMeters: separation(a, b),
      landingOffsets: [pa.distance, pb.distance],
    });
  }
  // Each incoming landing establishes a reachable component. Keep original F1 content
  // reachable and require every retained portal to have an actual local walkable landing.
  for (const scene of scenes) {
    const covered = new Set<number>();
    scene.spawns.forEach((p) =>
      reachable(scene, p).forEach((i) => covered.add(i)),
    );
    for (const p of scene.portals)
      if (!covered.has(tileIndex(scene, p))) {
        scene.spawns.push({ ...p.spawn, id: `landing_${p.id}` });
        reachable(scene, p).forEach((i) => covered.add(i));
      }
    if (!scene.spawns.length)
      throw new Error(`Floor has no source connection: ${scene.id}`);
    // Regenerate reserved content after entrances and shared wings have been assembled.
    if (scene.floor.key === "0") {
      const space = reachable(scene, scene.spawns[0]);
      const safe = (p: Point) =>
        scene.portals.every((q) => Math.hypot(q.x - p.x, q.y - p.y) >= 48) &&
        scene.exploration.every(
          (z) => Math.hypot(z.x + 8 - p.x, z.y + 8 - p.y) >= 32,
        );
      const note = nearest(
        scene,
        space,
        scene.note_zones[0] ?? scene.spawns[0],
        (p) => safe(p) && canStand(scene, p, 12),
      ).point;
      scene.note_zones = [
        { x: note.x - 8, y: note.y - 8, width: 16, height: 16 },
      ];
      for (const chest of scene.chests)
        Object.assign(
          chest,
          nearest(
            scene,
            space,
            chest,
            (p) => safe(p) && !contains(scene.note_zones[0], p),
          ).point,
        );
    }
  }
  return { scenes, connections, galleryPairs };
}
