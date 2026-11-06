import { fixedGlazing } from "./doorway-art.ts";
import { fitThinWalls } from "./indoor-wall-collision.ts";
import { sealCampusBuildings } from "./campus-shell.ts";
import {
  exteriorGates,
  gateLanding,
  openSourceGlass,
  openSourceOffice,
  fitDoorApron,
} from "./exterior-entrances.ts";
import { fitEntranceSills } from "./entrance-sills.ts";
import { fitSourceFixtures } from "./fixture-collision.ts";
import { fitRoomCasework } from "./room-casework.ts";
import { fitRoomDoors } from "./room-doors.ts";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { campusPlacement, parseGlb, primitives } from "./gltf.ts";
import config from "../content/map-config.json";
import {
  canStand,
  contains,
  project,
  reachable,
  reachableWorld,
  tileIndex,
  type Point,
  type SceneMap,
  type WorldMap,
  type Building,
  type BuildingId,
} from "../src/shared/world.ts";
import {
  bounds,
  coordinates,
  features,
  getFeature,
  inPolygon,
  layers,
  polygons,
  distanceSegment,
  walkPassages,
  type Feature,
  type Polygon,
  type Sources,
} from "./source-geometry.ts";
export type { Sources } from "./source-geometry.ts";
import { scenePlayer } from "../src/shared/scale.ts";
import {
  emptyScene,
  gridPoint,
  stamp,
  border,
  surface,
  floorFeatures,
  sourceFloor,
} from "./scene-layers.ts";
export { emptyScene, gridPoint, sourceFloor } from "./scene-layers.ts";
import { stampRedBirdPlaza } from "./plaza-collision.ts";
import { reconstructFloors } from "./floor-topology.ts";
const size = config.collisionSize;
function median(values: number[]): number {
  const s = values.toSorted((a, b) => a - b),
    i = Math.floor(s.length / 2);
  if (!s.length) throw new Error("No source labels");
  return s.length % 2 ? s[i] : (s[i - 1] + s[i]) / 2;
}
function center(f: Feature): number[] {
  const p = coordinates(f.geometry.coordinates);
  return [0, 1].map((i) => p.reduce((n, v) => n + v[i], 0) / p.length);
}
export function largestPublicSpace(scene: SceneMap): Set<number> {
  const count = scene.collision.length,
    w = (scene.width * 16) / size,
    h = (scene.height * 16) / size,
    allowed = new Uint8Array(count),
    seen = new Uint8Array(count);
  for (let i = 0; i < count; i++)
    allowed[i] = Number(
      canStand(scene, gridPoint(scene, i), scene.player.radius),
    );
  let best: number[] = [];
  for (let seed = 0; seed < count; seed++) {
    if (!allowed[seed] || seen[seed]) continue;
    const queue = [seed];
    seen[seed] = 1;
    for (let head = 0; head < queue.length; head++) {
      const i = queue[head],
        x = i % w,
        y = Math.floor(i / w);
      for (const n of [
        x ? i - 1 : -1,
        x < w - 1 ? i + 1 : -1,
        y ? i - w : -1,
        y < h - 1 ? i + w : -1,
      ])
        if (n >= 0 && allowed[n] && !seen[n]) {
          seen[n] = 1;
          queue.push(n);
        }
    }
    if (queue.length > best.length) best = queue;
  }
  if (best.length < 20)
    throw new Error(`No public circulation area: ${scene.id}`);
  return new Set(best);
}
function nearest(
  scene: SceneMap,
  space: Set<number>,
  target: Point,
  predicate: (p: Point) => boolean = () => true,
): Point {
  let best: Point | undefined,
    distance = Infinity;
  for (const i of space) {
    const p = gridPoint(scene, i),
      d = (p.x - target.x) ** 2 + (p.y - target.y) ** 2;
    if (d < distance && predicate(p)) {
      best = p;
      distance = d;
    }
  }
  if (!best) throw new Error(`No safe point in ${scene.id}`);
  return best;
}
export function buildWorld(sources: Sources, sourceBytes: Uint8Array) {
  const campus = sources.xgkdgz_all,
    groups = config.groups.map((g) => ({
      ...g,
      feature: getFeature(campus, g.featureId),
    }));
  const projected = groups.flatMap((g) =>
      coordinates(g.feature.geometry.coordinates).map((p) =>
        project(p, config.transform),
      ),
    ),
    box = bounds(projected),
    offset = {
      x: config.transform.padding - box.x,
      y: config.transform.padding - box.y,
    };
  const convert = (p: number[]): Point => {
    const q = project(p, config.transform);
    return {
      x: Math.round((q.x + offset.x) * 100) / 100,
      y: Math.round((q.y + offset.y) * 100) / 100,
    };
  };
  const width = Math.ceil((box.width + config.transform.padding * 2) / 16),
    height = Math.ceil((box.height + config.transform.padding * 2) / 16),
    outdoor = emptyScene(
      "campus_core",
      "核心校园",
      width,
      height,
      "terrain-campus.png",
    );
  outdoor.sourceOffset = offset;
  const intersects = (p: Polygon) => {
    const b = bounds(p.flat());
    return (
      b.x < width * 16 &&
      b.y < height * 16 &&
      b.x + b.width > 0 &&
      b.y + b.height > 0
    );
  };
  const outdoorPaint = {
    绿化: ["garden", "#97ad83"],
    池塘: ["water", "#81adb2"],
    斑马线: ["crosswalk", "#eeead8"],
    外车位0: ["parking", "#a2a69e"],
    道路补充: ["road", "#c7c8b9"],
    内部路: ["road", "#c7c8b9"],
    道路: ["road", "#c7c8b9"],
  } as const;
  for (const layer of layers(campus)) {
    const paint = outdoorPaint[layer.name as keyof typeof outdoorPaint];
    if (!paint) continue;
    for (const f of layer.data?.features ?? []) {
      const [kind, color] = paint,
        s = surface(f, kind, color, convert);
      s.sourceLayer = layer.name;
      s.polygons = s.polygons.filter(intersects);
      if (s.polygons.length) {
        outdoor.surfaces.push(s);
        if (kind === "water") s.polygons.forEach((p) => stamp(outdoor, p, 1));
      }
      if (f.geometry.type === "LineString") {
        const line = (f.geometry.coordinates as number[][]).map(convert);
        if (
          line.some(
            (p) =>
              p.x >= 0 && p.y >= 0 && p.x < width * 16 && p.y < height * 16,
          )
        ) {
          outdoor.sourceRoads.push(line);
          outdoor.surfaces.push({
            ...s,
            line,
            strokeWidth:
              (f.properties.linewidth ?? 4) *
              config.transform.pixelsPerProjectedUnit,
          });
        }
      }
    }
  }
  for (const p of walkPassages(campus, "0", convert)) {
    const polygons = p.polygons.filter(intersects);
    if (p.line) outdoor.sourceRoads.push(p.line);
    if (polygons.length)
      outdoor.surfaces.push({
        sourceId: Number(p.id),
        sourceLayer: "walk-passages",
        sourceMap: "xgkdgz_all",
        sourceFloor: "0",
        kind: "corridor",
        color: "#dad7c5",
        polygons,
      });
  }
  const interiorGroups = new Map<
    string,
    { scene: SceneMap; convert: (p: number[]) => Point; space: Set<number> }
  >();
  for (const group of groups) {
    const source = sources[group.sourceMap];
    sourceFloor(outdoor, source, convert, false, "0", group.sourceMap);
    const footprint = floorFeatures(source).flatMap((f) =>
      polygons(f, convert),
    );
    outdoor.sourceOutlines.push(
      ...footprint.map((p) => ({ group: group.key, points: p[0] })),
    );
    outdoor.art.roofs.push({
      ...bounds(footprint.flat(2)),
      id: group.key,
      image: `building-${group.key}.png`,
      footprint,
    });
    const floorSets =
      group.key === "east" || group.key === "west"
        ? floorFeatures(source).map((f) => [f])
        : [floorFeatures(source)];
    for (let index = 0; index < floorSets.length; index++) {
      const scaled = (p: number[]) =>
          project(p, {
            ...config.transform,
            pixelsPerProjectedUnit: config.interiorScale,
          }),
        floorBox = bounds(
          floorSets[index].flatMap((f) =>
            coordinates(f.geometry.coordinates).map(scaled),
          ),
        );
      const innerConvert = (p: number[]) => {
        const q = scaled(p);
        return {
          x: Math.round((q.x - floorBox.x + 32) * 100) / 100,
          y: Math.round((q.y - floorBox.y + 32) * 100) / 100,
        };
      };
      const scene = emptyScene(
        `interior_${group.key}_${index}`,
        group.name,
        Math.ceil((floorBox.width + 64) / 16),
        Math.ceil((floorBox.height + 64) / 16),
        `floor-${group.key}-${index}.png`,
      );
      scene.sourceMap = group.sourceMap;
      scene.sourceOffset = { x: 32 - floorBox.x, y: 32 - floorBox.y };
      sourceFloor(scene, source, innerConvert, true);
      border(scene);
      const space = new Set(
        scene.collision.flatMap((_, i) =>
          canStand(scene, gridPoint(scene, i), scene.player.radius) ? [i] : [],
        ),
      );
      interiorGroups.set(`${group.key}:${index}`, {
        scene,
        convert: innerConvert,
        space,
      });
    }
  }
  const plazaCollision = stampRedBirdPlaza(outdoor, campus, convert);
  border(outdoor);
  const candidates = groups.flatMap((group) => {
    const source = sources[group.sourceMap],
      floors = floorFeatures(source);
    const sets =
      group.key === "east" || group.key === "west"
        ? floors.map((f) => [f])
        : [floors];
    const gates = exteriorGates(
      source,
      group.feature,
      sets.map((fs) => fs.flatMap((f) => polygons(f, convert))),
      convert,
    );
    return gates.map((gate) => {
      const templateKey = `${group.key}:${gate.wing}`,
        template = interiorGroups.get(templateKey)!;
      const outer = convert(gate.xy),
        inner = template.convert(gate.xy);
      const normal = gate.towardInterior,
        reverse = { x: -normal.x, y: -normal.y };
      const outerGlass = openSourceGlass(
        outdoor,
        group.sourceMap,
        outer,
        normal,
      );
      const innerGlass = openSourceGlass(
        template.scene,
        group.sourceMap,
        inner,
        reverse,
      );
      return {
        ...gate,
        group: group.key,
        templateKey,
        outer,
        inner,
        reverse,
        outerGlass,
        innerGlass,
      };
    });
  });
  // The confirmed leaf can occupy an otherwise blocked strip of library glazing.
  for (const key of new Set(
    candidates.filter((g) => g.innerGlass).map((g) => g.templateKey),
  )) {
    const template = interiorGroups.get(key)!;
    const glazing = candidates.flatMap((g) =>
      g.templateKey === key && g.innerGlass ? [g.innerGlass] : [],
    );
    fitThinWalls(
      template.scene,
      template.scene.surfaces
        .filter((s) => s.sourceLayer === "玻璃外墙-门")
        .map((s) => ({
          ...s,
          polygons: fixedGlazing(s, glazing),
        })),
    );
    template.space = new Set(
      template.scene.collision.flatMap((_, i) =>
        canStand(template.scene, gridPoint(template.scene, i)) ? [i] : [],
      ),
    );
  }
  sealCampusBuildings(outdoor, candidates, campus, convert);
  const outsideSpace = largestPublicSpace(outdoor);
  const gates = candidates.map((g) => {
    const template = interiorGroups.get(g.templateKey)!;
    const approachRoads = fitDoorApron(template.scene, g.inner, template.space);
    let outside = gateLanding(
      outdoor,
      outsideSpace,
      g.outer,
      g.towardInterior,
      g.outerGlass,
    );
    let inside = gateLanding(
      template.scene,
      template.space,
      g.inner,
      g.reverse,
      g.innerGlass,
    );
    const cost = (landing: typeof inside) =>
      landing
        ? Math.hypot(landing.point.x - g.inner.x, landing.point.y - g.inner.y)
        : Infinity;
    for (const id of approachRoads ?? []) {
      const edge = template.scene.surfaces.find(
        (s) => s.kind === "corridor" && s.sourceId === id,
      )!.line!;
      const end = edge.toSorted(
        (a, b) =>
          Math.hypot(b.x - g.inner.x, b.y - g.inner.y) -
          Math.hypot(a.x - g.inner.x, a.y - g.inner.y),
      )[0];
      const len = Math.hypot(end.x - g.inner.x, end.y - g.inner.y);
      const n = { x: (end.x - g.inner.x) / len, y: (end.y - g.inner.y) / len };
      const inner = gateLanding(template.scene, template.space, g.inner, {
        x: -n.x,
        y: -n.y,
      });
      const outer = gateLanding(outdoor, outsideSpace, g.outer, n);
      if (outer && inner && cost(inner) < cost(inside)) {
        outside = outer;
        inside = inner;
      }
    }
    const office =
      !inside && outside
        ? openSourceOffice(template.scene, g.inner, g.reverse, template.space)
        : undefined;
    if (office)
      inside = gateLanding(
        template.scene,
        template.space,
        g.inner,
        g.reverse,
        g.innerGlass,
      );
    return { ...g, outside, inside, office, approachRoads };
  });
  const usedEntries = new Set<string>();
  type Gate = (typeof gates)[number];
  const gateKey = (g: Gate) => `${g.group}:${g.regionIndex}`;
  const attach = (
    g: Gate,
    scene: SceneMap,
    id: string,
    building: BuildingId,
  ) => {
    const outer = g.outside!,
      inner = g.inside!;
    const named =
      g.group === "library"
        ? features(campus).find(
            (f) =>
              f.geometry.type === "Point" &&
              /图书馆.*一楼入口/.test(f.properties.name ?? "") &&
              Math.hypot(
                f.geometry.coordinates[0] - g.xy[0],
                f.geometry.coordinates[1] - g.xy[1],
              ) <= 1.2,
          )
        : undefined;
    const name = named ? `${building} · ${named.properties.name}` : building;
    outdoor.sourceEntries.push(outer.entrance.threshold);

    outdoor.portals.push({
      ...outer.point,
      id: `enter_${id}`,
      buildingId: building,
      kind: "entrance",
      label: `进入 ${name} · F1`,
      targetScene: scene.id,
      targetPortal: `exit_${id}`,
      spawn: outer.spawn,
      entrance: { ...outer.entrance, glazing: g.outerGlass },
    });
    scene.portals.push({
      ...inner.point,
      id: `exit_${id}`,
      buildingId: building,
      kind: "entrance",
      label: `返回校园 · ${name}`,
      targetScene: outdoor.id,
      targetPortal: `enter_${id}`,
      spawn: inner.spawn,
      entrance: { ...inner.entrance, glazing: g.innerGlass },
    });
    usedEntries.add(gateKey(g));
  };
  const evidence = config.buildings.map((def) => {
    const group = groups.find((g) => g.key === def.group)!,
      source = sources[group.sourceMap];
    let anchor: number[],
      sourceFeatureIds: number[] = [];
    if (def.anchor === "room-label-median") {
      const rooms = features(source).filter((f) => {
          const ids = new Set(
            String(f.properties.name ?? "").match(/[EW][1-4]/g) ?? [],
          );
          return ids.size === 1 && ids.has(def.id);
        }),
        centers = rooms.map(center);
      anchor = [
        median(centers.map((p) => p[0])),
        median(centers.map((p) => p[1])),
      ];
      sourceFeatureIds = rooms.map((f) => f.properties.id);
    } else if (def.anchor === "model-center") {
      anchor = group.feature.properties.tarray.slice(12, 14);
      sourceFeatureIds = [group.featureId];
    } else {
      const f = getFeature(source, def.featureId!);
      anchor = center(f);
      sourceFeatureIds = [def.featureId!];
    }
    const label = convert(anchor),
      roomPolygons = features(source)
        .filter((f) => sourceFeatureIds.includes(f.properties.id))
        .flatMap((f) => polygons(f, convert));
    const b: Building = {
      ...bounds(roomPolygons.length ? roomPolygons.flat(2) : [label]),
      id: def.id as BuildingId,
      name: def.name,
      group: def.group,
      label,
      review: "pending",
      anchorMethod: def.anchor,
    };
    outdoor.buildings.push(b);
    const floorIndex =
      group.key === "east" || group.key === "west"
        ? floorFeatures(source)
            .map((f, index) => ({ index, polys: polygons(f, convert) }))
            .map((v) => ({
              ...v,
              d: Math.min(
                ...v.polys.map((p) =>
                  inPolygon(label, p)
                    ? 0
                    : Math.min(
                        ...p[0]
                          .slice(1)
                          .map((b, i) => distanceSegment(label, p[0][i], b)),
                      ),
                ),
              ),
            }))
            .sort((a, b) => a.d - b.d)[0].index
        : 0;
    const templateKey = `${group.key}:${floorIndex}`;
    const all = gates.filter((g) => g.templateKey === templateKey);
    const hint = def.entryFeatureId
      ? coordinates(
          getFeature(sources[def.entrySourceMap!], def.entryFeatureId).geometry
            .coordinates,
        )[0]
      : anchor;
    const selected = all
      .filter((g) => g.outside && g.inside && !usedEntries.has(gateKey(g)))
      .sort(
        (a, b) =>
          Math.hypot(a.xy[0] - hint[0], a.xy[1] - hint[1]) -
          Math.hypot(b.xy[0] - hint[0], b.xy[1] - hint[1]),
      )[0];
    if (!selected)
      throw new Error(
        `No verified exterior opening for ${def.id}. ${JSON.stringify(all.map((g) => [g.regionIndex, !!g.outside, !!g.inside]))}`,
      );
    const originalTemplate = interiorGroups.get(templateKey)!;
    const entry = selected.outside!.point,
      innerEntry = selected.inside!.point;
    const displacement = Math.hypot(
        entry.x - selected.outer.x,
        entry.y - selected.outer.y,
      ),
      innerDisplacement = Math.hypot(
        innerEntry.x - selected.inner.x,
        innerEntry.y - selected.inner.y,
      );
    const template = {
      ...originalTemplate,
      space: reachable(
        originalTemplate.scene,
        innerEntry,
        originalTemplate.scene.player.radius,
      ),
    };
    const id = def.id.toLowerCase(),
      scene: SceneMap = {
        ...structuredClone(template.scene),
        id: `interior_${id}`,
        name: `${def.id} · ${def.name}`,
      };
    const innerSpawn = selected.inside!.spawn;
    attach(selected, scene, id, b.id);
    scene.spawns.push({ ...innerSpawn, id: `spawn_${id}` });
    const exploration = nearest(
      scene,
      template.space,
      template.convert(anchor),
      (p) =>
        Math.hypot(p.x - innerEntry.x, p.y - innerEntry.y) >= 60 &&
        canStand(scene, p, 12),
    );
    scene.exploration.push({
      x: exploration.x - 8,
      y: exploration.y - 8,
      width: 16,
      height: 16,
      buildingId: b.id,
    });
    const note = nearest(
      scene,
      template.space,
      exploration,
      (p) =>
        Math.hypot(p.x - innerEntry.x, p.y - innerEntry.y) > 64 &&
        Math.hypot(p.x - exploration.x, p.y - exploration.y) > 48 &&
        canStand(scene, p, 12),
    );
    scene.note_zones.push({
      x: note.x - 8,
      y: note.y - 8,
      width: 16,
      height: 16,
    });
    if (["C2", "C7", "E1", "W1"].includes(def.id)) {
      const chest = nearest(
        scene,
        template.space,
        exploration,
        (p) =>
          Math.hypot(p.x - innerEntry.x, p.y - innerEntry.y) > 64 &&
          Math.hypot(p.x - exploration.x, p.y - exploration.y) > 48 &&
          Math.hypot(p.x - note.x, p.y - note.y) > 32,
      );
      scene.chests.push({ ...chest, id: `chest_${id}` });
    }
    return {
      id: b.id,
      sourceMap: group.sourceMap,
      sourceFeatureIds,
      anchorMethod: def.anchor,
      sourceAnchor: anchor,
      label,
      sourceEntry: selected.xy,
      sourceEntryIndex: all.indexOf(selected),
      sourceRegionEntryIndex: selected.regionIndex,
      modelEntryIndices: selected.modelIndices,
      entryFeatureId: def.entryFeatureId,
      entrySourceMap: def.entrySourceMap,
      sourceEntryCandidates: all.map((g) => g.xy),
      entry,
      entryDisplacement: displacement,
      innerEntryDisplacement: innerDisplacement,
      footprint:
        "F1 source polygons; physical wings shared by their numbered buildings",
      review: "pending",
      reason:
        "室外模型入口与同栋 F1 通行交接点校合；共享翼楼编号按标签锚点与平面分区关联",
      templateKey: `${group.key}:${floorIndex}`,
      scene,
    };
  });
  for (const gate of gates) {
    if (!gate.outside || !gate.inside || usedEntries.has(gateKey(gate)))
      continue;
    const owners = evidence
      .filter((e) => e.templateKey === gate.templateKey)
      .sort(
        (a, b) =>
          Math.hypot(a.label.x - gate.outer.x, a.label.y - gate.outer.y) -
          Math.hypot(b.label.x - gate.outer.x, b.label.y - gate.outer.y),
      );
    const owner = owners[0];
    if (!owner) throw new Error(`No numbered F1 wing for ${gateKey(gate)}`);
    const suffix = `${owner.id.toLowerCase()}_r${gate.regionIndex}`;
    if (
      !owner.scene.spawns.some((p) =>
        reachable(owner.scene, p).has(
          tileIndex(owner.scene, gate.inside!.point),
        ),
      )
    )
      owner.scene.spawns.push({ ...gate.inside.spawn, id: `spawn_${suffix}` });
    attach(gate, owner.scene, suffix, owner.id);
  }
  const c2 = outdoor.portals.find((p) => p.buildingId === "C2")!;
  const approachDoor = nearest(outdoor, outsideSpace, c2.entrance!.threshold);
  const activity = outdoor.art.roofs.find((r) => r.id === "activity")!;
  const away = {
    x: approachDoor.x - (activity.x + activity.width / 2),
    y: approachDoor.y - (activity.y + activity.height / 2),
  };
  const distance = Math.hypot(away.x, away.y);
  const approach = {
    x: approachDoor.x + (away.x * 72) / distance,
    y: approachDoor.y + (away.y * 72) / distance,
  };
  const softscape = outdoor.surfaces
    .filter((s) => s.kind === "garden" || s.kind === "water")
    .flatMap((s) => s.polygons);
  // Build a separate visibility mask. Roof projections must not change where
  // the avatar can walk once it leaves the initial promenade.
  const clearRadius = 20,
    searchRadius = 80;
  const roofMask = {
    ...outdoor,
    collision: Array(outdoor.collision.length).fill(0),
  };
  const zScale =
    config.transform.pixelsPerProjectedUnit * config.roofHeightFactor;
  const envelopes = groups.map((group) => {
    const properties = group.feature.properties;
    const floor = outdoor.art.roofs.find((r) => r.id === group.key)!;
    // An upper gallery / canopy can extend well beyond its F1 polygon.
    // Project actual mesh faces in precisely the same direction as the bake.
    const glb = parseGlb(
      readFileSync(
        resolve(
          import.meta.dirname,
          "../data/maps",
          properties.src.replace(/^\/res\/projects\//, ""),
        ),
      ),
    );
    const matrix = campusPlacement(glb, properties.tarray, properties.height);
    const window = searchRadius + clearRadius + size;
    for (const part of primitives(glb, matrix)) {
      const points = part.vertices.map((v) => {
        const at = convert(v);
        return { x: at.x, y: at.y - v[2] * zScale };
      });
      for (let i = 0; i < part.indices.length; i += 3) {
        const tri = [
          points[part.indices[i]],
          points[part.indices[i + 1]],
          points[part.indices[i + 2]],
        ];
        if (
          tri.every((p) => p.x < approach.x - window) ||
          tri.every((p) => p.x > approach.x + window) ||
          tri.every((p) => p.y < approach.y - window) ||
          tri.every((p) => p.y > approach.y + window)
        )
          continue;
        stamp(roofMask, [tri], 1);
      }
    }
    return { floor, rise: properties.height * zScale };
  });
  const spawn = nearest(outdoor, outsideSpace, approach, (p) => {
    if (
      Math.hypot(p.x - approach.x, p.y - approach.y) > searchRadius ||
      !canStand(outdoor, p, 4) ||
      !canStand(roofMask, p, clearRadius)
    )
      return false;
    if (softscape.some((poly) => inPolygon(p, poly))) return false;
    return envelopes.every(({ floor, rise }) => {
      for (let dy = 0; dy <= rise + size; dy += size)
        if (
          floor.footprint.some((poly) =>
            inPolygon({ x: p.x, y: p.y + dy }, poly),
          )
        )
          return false;
      return true;
    });
  });
  outdoor.spawns.push({ ...spawn, id: "campus_spawn" });
  const excluded = (p: Point) =>
      outdoor.portals.some((q) => Math.hypot(p.x - q.x, p.y - q.y) < 64),
    note = nearest(
      outdoor,
      outsideSpace,
      spawn,
      (p) => !excluded(p) && canStand(outdoor, p, 12),
    );
  outdoor.note_zones.push({
    x: note.x - 8,
    y: note.y - 8,
    width: 16,
    height: 16,
  });
  const targets = groups.flatMap((g) => {
    const p = convert(g.feature.properties.tarray.slice(12, 14));
    return [
      { x: p.x - 120, y: p.y + 80 },
      { x: p.x + 120, y: p.y - 80 },
    ];
  });
  for (const target of targets) {
    if (outdoor.chests.length === 8) break;
    const p = nearest(
      outdoor,
      outsideSpace,
      target,
      (p) =>
        !excluded(p) &&
        !contains(outdoor.note_zones[0], p) &&
        outdoor.chests.every((c) => Math.hypot(p.x - c.x, p.y - c.y) > 120),
    );
    outdoor.chests.push({
      ...p,
      id: `chest_outdoor_${outdoor.chests.length + 1}`,
    });
  }
  const topology = reconstructFloors(
    sources,
    outdoor,
    evidence,
    interiorGroups,
  );
  for (const scene of topology.scenes)
    scene.sourceEntries = scene.portals.flatMap((p) =>
      p.entrance ? [p.entrance.threshold] : [],
    );
  const world: WorldMap = {
    mapVersion: config.mapVersion,
    protocolVersion: config.protocolVersion,
    human: config.human,
    chest: config.chest,
    status: "reconstructed",
    scenes: [outdoor, ...topology.scenes],
    buildings: outdoor.buildings,
  };
  for (const scene of world.scenes)
    scene.art.layers = [
      "base",
      "floor",
      "terrain",
      "rooms",
      "passages",
      "fixtures",
      "walls",
      ...(scene.id === "campus_core" ? ["shadows"] : []),
    ].map((id) => ({
      id,
      image: `${scene.art.ground.replace(/\.png$/, "")}-${id}.png`,
    }));
  const fixtureOccupancy = topology.scenes.map((scene) =>
    fitSourceFixtures(scene, sources[scene.sourceMap]),
  );
  const publicSpace = reachableWorld(world);
  for (const scene of topology.scenes)
    fitRoomDoors(scene, sources[scene.sourceMap], publicSpace.get(scene.id)!);
  for (const scene of topology.scenes)
    fitRoomCasework(scene, sources[scene.sourceMap]);
  for (const scene of world.scenes) fitEntranceSills(scene);
  validateWorld(world);
  const report = {
    mapVersion: world.mapVersion,
    status: "source-geometry-reconstructed",
    fixtureOccupancy,
    sourceSha256: createHash("sha256").update(sourceBytes).digest("hex"),
    sourceMapVersion: campus.map.mversion,
    transform: { ...config.transform, offset },
    dimensions: { width, height, tileSize: 16, collisionSize: size },
    adjustments: config.adjustments,
    scaleAudit: {
      human: config.human,
      projection: "EPSG:3857 local spherical scale",
      scenes: world.scenes.map((s) => ({
        id: s.id,
        units: s.units,
        player: s.player,
        widthMeters: (s.width * 16) / s.units.pixelsPerMeter,
        heightMeters: (s.height * 16) / s.units.pixelsPerMeter,
      })),
    },
    buildings: evidence.map(({ scene, ...e }) => e),
    connections: topology.connections,
    galleries: topology.galleryPairs,
    exteriorEntrances: gates.map((g) => ({
      group: g.group,
      modelIndices: g.modelIndices,
      regionIndex: g.regionIndex,
      sourceEntry: g.xy,
      matchDistance: g.match,
      templateKey: g.templateKey,
      accepted: usedEntries.has(gateKey(g)),
      office: g.office,
      approachRoads: g.approachRoads,
      outside: !!g.outside,
      inside: !!g.inside,
      outerGlass: g.outerGlass?.sourceId,
      innerGlass: g.innerGlass?.sourceId,
    })),
    plazaCollision,
    campusSpawn: {
      point: spawn,
      approachTo: c2.id,
      projectedRoofClearancePixels: clearRadius,
    },
    checks: {
      scenes: world.scenes.length,
      sourceFloors: new Set(
        world.scenes.map((s) => `${s.sourceMap}:${s.floor.key}`),
      ).size,
      pairedPortals: world.scenes.reduce((n, s) => n + s.portals.length, 0) / 2,
      chests: 12,
      reachability:
        "passed (walking components and cross-floor graph from campus spawn)",
    },
    unresolved: [
      "出入口坐标已由室外模型与 F1 独立校合；共享翼楼的编号归属按源房间/标签锚点就近关联",
      "六组核心区外边界仍采用有限包络",
      "这是依据源模型的低分辨率重建，尚未完成独立像素美术重绘",
    ],
  };
  return { world, report };
}
export function validateWorld(world: WorldMap): void {
  const unique = (ids: string[], label: string) => {
    if (new Set(ids).size !== ids.length) throw new Error(`Duplicate ${label}`);
  };
  unique(
    world.scenes.map((s) => s.id),
    "scene",
  );
  unique(
    world.buildings.map((b) => b.id),
    "building",
  );
  const expected = [
    "E1",
    "E2",
    "E3",
    "E4",
    "W1",
    "W2",
    "W3",
    "W4",
    "C1",
    "C2",
    "C3",
    "C4",
    "C5",
    "C6",
    "C7",
  ].sort();
  if (
    JSON.stringify(world.buildings.map((b) => b.id).sort()) !==
    JSON.stringify(expected)
  )
    throw new Error("Missing core building");
  if (world.scenes.length < 16)
    throw new Error("Missing reconstructed source floors");
  unique(
    world.scenes.flatMap((s) => s.portals.map((p) => p.id)),
    "portal",
  );
  unique(
    world.scenes.flatMap((s) => s.chests.map((c) => c.id)),
    "chest",
  );
  if (world.scenes.reduce((n, s) => n + s.chests.length, 0) !== 12)
    throw new Error("Expected 12 chests");
  const globalSpace = reachableWorld(world);
  for (const scene of world.scenes) {
    const expectedPlayer = scenePlayer(scene.units, world.human);
    if (
      Object.entries(expectedPlayer).some(
        ([key, value]) =>
          !Number.isFinite(scene.player[key as keyof typeof expectedPlayer]) ||
          Math.abs(scene.player[key as keyof typeof expectedPlayer] - value) >
            1e-9,
      )
    )
      throw new Error(`Invalid physical player scale: ${scene.id}`);
    const budget = scene.id === "campus_core" ? 256 : 128;
    if (
      !Number.isInteger(scene.width) ||
      !Number.isInteger(scene.height) ||
      scene.width < 1 ||
      scene.height < 1 ||
      scene.width > budget ||
      scene.height > budget ||
      scene.tileSize !== 16 ||
      scene.collisionSize !== 4
    )
      throw new Error(`Invalid dimensions: ${scene.id}`);
    if (
      scene.ground.length !== scene.width * scene.height ||
      scene.collision.length !== scene.width * scene.height * 16
    )
      throw new Error(`Invalid grids: ${scene.id}`);
    if (!scene.spawns.length) throw new Error(`Missing spawn: ${scene.id}`);
    const visited = new Set(
        scene.spawns.flatMap((p) => [
          ...reachable(scene, p, scene.player.radius),
        ]),
      ),
      check = (p: Point) => {
        if (
          !canStand(scene, p, scene.player.radius) ||
          !visited.has(tileIndex(scene, p)) ||
          !globalSpace.get(scene.id)?.has(tileIndex(scene, p))
        )
          throw new Error(`Unreachable point: ${scene.id} (${p.x},${p.y})`);
      };
    [...scene.spawns, ...scene.portals, ...scene.chests].forEach(check);
    for (const z of [...scene.exploration, ...scene.note_zones])
      for (let y = z.y + 4; y < z.y + z.height; y += 4)
        for (let x = z.x + 4; x < z.x + z.width; x += 4) check({ x, y });
    for (const c of scene.chests)
      if (
        scene.portals.some((p) => Math.hypot(p.x - c.x, p.y - c.y) < 48) ||
        [...scene.exploration, ...scene.note_zones].some((z) => contains(z, c))
      )
        throw new Error(`Reserved chest overlap: ${c.id}`);
    for (const z of scene.note_zones)
      if (
        scene.portals.some(
          (p) =>
            Math.hypot(p.x - z.x - z.width / 2, p.y - z.y - z.height / 2) < 48,
        ) ||
        scene.exploration.some(
          (e) =>
            z.x < e.x + e.width &&
            z.x + z.width > e.x &&
            z.y < e.y + e.height &&
            z.y + z.height > e.y,
        )
      )
        throw new Error(`Reserved note overlap: ${scene.id}`);
    for (const portal of scene.portals) {
      const target = world.scenes.find((s) => s.id === portal.targetScene),
        reverse = target?.portals.find((p) => p.id === portal.targetPortal);
      if (
        !reverse ||
        reverse.targetScene !== scene.id ||
        reverse.targetPortal !== portal.id ||
        reverse.kind !== portal.kind ||
        (portal.kind === "gallery" &&
          (target!.sourceMap === scene.sourceMap ||
            target!.floor.elevation !== scene.floor.elevation)) ||
        reverse.buildingId !== portal.buildingId
      )
        throw new Error(`Unpaired portal: ${portal.id}`);
      check(portal.spawn);
    }
  }
}
export function tiledMap(scene: SceneMap, mapVersion: string) {
  // Tiled image layers display PNGs at native size. Object positions, paths and
  // offsets therefore share the PNG pixel grid; world.json retains logical units.
  const ratio = scene.art.pixelRatio ?? 1;
  const imagePoint = ({ x, y }: Point): Point => ({
    x: x * ratio,
    y: y * ratio,
  });
  const ringProperty = (rings: Point[][]) =>
    JSON.stringify(rings.map((r) => r.map(imagePoint)));
  const imageProperty = (name: string, value: any) => {
    if (name === "entrance")
      return {
        ...value,
        threshold: imagePoint(value.threshold),
        width: value.width * ratio,
        glazing: value.glazing && {
          ...value.glazing,
          jambA: imagePoint(value.glazing.jambA),
          jambB: imagePoint(value.glazing.jambB),
        },
      };
    if (name === "lanes")
      return value.map((lane: { outside: Point; inside: Point }) => ({
        outside: imagePoint(lane.outside),
        inside: imagePoint(lane.inside),
      }));
    return value && typeof value.x === "number" && typeof value.y === "number"
      ? imagePoint(value)
      : value;
  };
  let nextObject = 1;
  const objects = (items: (Point & Record<string, any>)[]) =>
    items.map((o) => ({
      id: nextObject++,
      name: String(o.id ?? o.buildingId ?? ""),
      ...imagePoint(o),
      width: (o.width ?? 0) * ratio,
      height: (o.height ?? 0) * ratio,
      ...(!("width" in o) ? { point: true } : {}),
      rotation: 0,
      visible: true,
      properties: Object.entries(o)
        .filter(([k]) => !["x", "y", "width", "height"].includes(k))
        .map(([name, value]) => ({
          name,
          type: typeof value === "number" ? "float" : "string",
          value:
            typeof value === "object"
              ? JSON.stringify(imageProperty(name, value))
              : value,
        })),
    }));
  const layers: any[] = [
    ...scene.art.layers.map((l) => ({
      name: l.id === "base" ? "ground" : l.id,
      type: "imagelayer",
      image: l.image,
    })),
    {
      name: "collision",
      type: "objectgroup",
      visible: false,
      objects: collisionRuns(scene).map((r) => ({
        id: nextObject++,
        name: "blocked",
        ...imagePoint(r),
        width: r.width * ratio,
        height: r.height * ratio,
        rotation: 0,
        visible: true,
      })),
    },
    ...(
      [
        "decoration",
        "foreground",
        "portals",
        "exploration",
        "note_zones",
        "chests",
        "spawns",
      ] as const
    ).map((name) => ({
      name,
      type: "objectgroup",
      objects: objects(scene[name]),
    })),
    ...(scene.fixtureCollision
      ? [
          {
            name: "fixture_collision",
            properties: [
              {
                name: "blockedRowRuns",
                type: "string",
                value: JSON.stringify(
                  scene.fixtureCollision.runs.map((v) => v * ratio),
                ),
              },
              { name: "rowHeight", type: "int", value: ratio },
            ],
            type: "objectgroup",
            visible: false,
            objects: scene.surfaces
              .filter(
                (s) =>
                  s.kind === "detail" &&
                  scene.fixtureCollision!.sourceIds.includes(s.sourceId),
              )
              .flatMap((s) =>
                s.polygons.map((p) => ({
                  id: nextObject++,
                  name: String(s.sourceId),
                  x: 0,
                  y: 0,
                  polygon: p[0].map(imagePoint),
                  properties: [
                    {
                      name: "holes",
                      type: "string",
                      value: ringProperty(p.slice(1)),
                    },
                  ],
                })),
              ),
          },
        ]
      : []),
    ...(scene.roomCasework?.length
      ? [
          {
            name: "room_casework",
            type: "objectgroup",
            visible: false,
            objects: scene.roomCasework.map((f) => ({
              id: nextObject++,
              name: String(f.sourceId),
              x: 0,
              y: 0,
              polygon: f.footprint.map(imagePoint),
              properties: [
                { name: "kind", type: "string", value: f.kind },
                { name: "sourceId", type: "int", value: f.sourceId },
                {
                  name: "cells",
                  type: "string",
                  value: JSON.stringify(f.cells),
                },
              ],
            })),
          },
        ]
      : []),
    ...(scene.pointFixtures?.length
      ? [
          {
            name: "point_fixtures",
            type: "objectgroup",
            visible: false,
            objects: objects(
              scene.pointFixtures.map((f) => ({
                ...f,
                id: String(f.sourceId),
              })),
            ),
          },
        ]
      : []),
    ...(scene.doors?.length
      ? [{ name: "doors", type: "objectgroup", objects: objects(scene.doors) }]
      : []),
    ...[...(scene.art.landmarks ?? []), ...scene.art.roofs].map((r) => ({
      name: `model_${r.id}`,
      type: "imagelayer",
      image: r.image,
      offsetx: r.x * ratio,
      offsety: r.y * ratio,
    })),
    ...[
      ...new Set(
        scene.surfaces.map(
          (s) => `${s.sourceMap}:${s.sourceFloor}:${s.sourceLayer}`,
        ),
      ),
    ].map((key) => ({
      name: `source_${key}`,
      type: "objectgroup",
      visible: false,
      objects: scene.surfaces
        .filter(
          (s) => `${s.sourceMap}:${s.sourceFloor}:${s.sourceLayer}` === key,
        )
        .flatMap<any>((s) =>
          s.line
            ? [
                {
                  id: nextObject++,
                  name: String(s.sourceId),
                  x: 0,
                  y: 0,
                  polyline: s.line.map(imagePoint),
                  properties: [{ name: "kind", type: "string", value: s.kind }],
                },
              ]
            : s.polygons.map((p) => ({
                id: nextObject++,
                name: String(s.sourceId),
                x: 0,
                y: 0,
                polygon: p[0].map(imagePoint),
                properties: [
                  { name: "kind", type: "string", value: s.kind },
                  {
                    name: "holes",
                    type: "string",
                    value: ringProperty(p.slice(1)),
                  },
                ],
              })),
        ),
    })),
    {
      name: "source_footprints",
      type: "objectgroup",
      visible: false,
      objects: scene.sourceOutlines.map((s) => ({
        id: nextObject++,
        name: s.group,
        x: 0,
        y: 0,
        width: 0,
        height: 0,
        polygon: s.points.map(imagePoint),
      })),
    },
  ].map((l, i) => ({ visible: true, opacity: 1, x: 0, y: 0, ...l, id: i + 1 }));
  return {
    type: "map",
    version: "1.10",
    orientation: "orthogonal",
    renderorder: "right-down",
    infinite: false,
    width: scene.width,
    height: scene.height,
    tilewidth: scene.tileSize * ratio,
    tileheight: scene.tileSize * ratio,
    nextlayerid: layers.length + 1,
    nextobjectid: nextObject,
    properties: [
      { name: "mapVersion", type: "string", value: mapVersion },
      { name: "sceneId", type: "string", value: scene.id },
      { name: "sourceMap", type: "string", value: scene.sourceMap },
      { name: "floor", type: "string", value: scene.floor.name },
      { name: "artStyle", type: "string", value: scene.art.style },
      { name: "elevation", type: "float", value: scene.floor.elevation },
      { name: "imagePixelsPerWorldPixel", type: "int", value: ratio },
      { name: "logicalTileSize", type: "int", value: scene.tileSize },
      {
        name: "logicalCollisionResolution",
        type: "int",
        value: scene.collisionSize,
      },
      {
        name: "collisionResolution",
        type: "int",
        value: scene.collisionSize * ratio,
      },
      { name: "fixtureResolution", type: "int", value: ratio },
      {
        name: "coordinateSystem",
        type: "string",
        value:
          "All geometry and point properties are in baked image pixels. Divide by imagePixelsPerWorldPixel for world.json coordinates. Door cells are logical grid indices.",
      },
      {
        name: "collisionSource",
        type: "string",
        value:
          "world.json (structural and door cells at logicalCollisionResolution, imported fixtures at one world pixel; polygon holes preserved)",
      },
    ],
    tilesets: [],
    layers,
  };
}

export function referenceSvg(world: WorldMap): string {
  const scene = world.scenes[0],
    w = scene.width * 16,
    h = scene.height * 16;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><image href="terrain-campus.png" width="${w}" height="${h}"/>${[...(scene.art.landmarks ?? []), ...scene.art.roofs].map((r) => `<image href="${r.image}" x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}"/>`).join("")}${world.buildings.map((b) => `<g><rect x="${b.label.x - 19}" y="${b.label.y - 17}" width="38" height="28" rx="4" fill="#f8efd7" stroke="#587e6b"/><text x="${b.label.x}" y="${b.label.y + 4}" font-family="sans-serif" font-size="19" text-anchor="middle" fill="#345846">${b.id}</text></g>`).join("")}</svg>\n`;
}

function collisionRuns(
  scene: SceneMap,
): (Point & { width: number; height: number })[] {
  const runs: (Point & { width: number; height: number })[] = [],
    step = scene.collisionSize,
    width = (scene.width * 16) / step,
    height = (scene.height * 16) / step;
  for (let y = 0; y < height; y++) {
    let start = -1;
    for (let x = 0; x <= width; x++) {
      const blocked = x < width && scene.collision[y * width + x] === 1;
      if (blocked && start < 0) start = x;
      if (!blocked && start >= 0) {
        runs.push({
          x: start * step,
          y: y * step,
          width: (x - start) * step,
          height: step,
        });
        start = -1;
      }
    }
  }
  return runs;
}
