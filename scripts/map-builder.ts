import { createHash } from "node:crypto";
import config from "../content/map-config.json";
import {
  canStand,
  contains,
  project,
  reachable,
  tileIndex,
  type Point,
  type SceneMap,
  type WorldMap,
  type Building,
  type BuildingId,
  type Surface,
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
  bufferLine,
  type Feature,
  type Polygon,
  type Sources,
} from "./source-geometry.ts";
export type { Sources } from "./source-geometry.ts";
import { metricScale, scenePlayer } from "../src/shared/scale.ts";
const size = config.collisionSize;
export function gridPoint(scene: SceneMap, id: number): Point {
  const w = (scene.width * 16) / size;
  return { x: ((id % w) + 0.5) * size, y: (Math.floor(id / w) + 0.5) * size };
}
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
export function emptyScene(
  id: string,
  name: string,
  width: number,
  height: number,
  ground: string,
): SceneMap {
  const units = metricScale(
    config.transform.origin[1],
    id === "campus_core"
      ? config.transform.pixelsPerProjectedUnit
      : config.interiorScale,
    config.roofHeightFactor,
  );
  return {
    id,
    name,
    width,
    height,
    tileSize: 16,
    collisionSize: size,
    units,
    player: scenePlayer(units, config.human),
    ground: Array(width * height).fill(1),
    collision: Array((((width * 16) / size) * height * 16) / size).fill(
      id === "campus_core" ? 0 : 1,
    ),
    surfaces: [],
    art: { ground, roofs: [] },
    decoration: [],
    foreground: [],
    portals: [],
    exploration: [],
    note_zones: [],
    chests: [],
    spawns: [],
    buildings: [],
    sourceOutlines: [],
    sourceRoads: [],
    sourceEntries: [],
  };
}
function stamp(scene: SceneMap, poly: Polygon, value: number) {
  const b = bounds(poly.flat()),
    w = (scene.width * 16) / size,
    h = (scene.height * 16) / size;
  for (
    let y = Math.max(0, Math.floor(b.y / size));
    y < Math.min(h, Math.ceil((b.y + b.height) / size));
    y++
  )
    for (
      let x = Math.max(0, Math.floor(b.x / size));
      x < Math.min(w, Math.ceil((b.x + b.width) / size));
      x++
    )
      if (inPolygon({ x: x * size + size / 2, y: y * size + size / 2 }, poly))
        scene.collision[y * w + x] = value;
}
function border(scene: SceneMap) {
  const w = (scene.width * 16) / size,
    h = (scene.height * 16) / size;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (x < 4 || y < 4 || x >= w - 4 || y >= h - 4)
        scene.collision[y * w + x] = 1;
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
function surface(
  f: Feature,
  kind: string,
  color: string,
  convert: (p: number[]) => Point,
): Surface {
  return {
    sourceId: f.properties.id ?? -1,
    kind,
    color,
    polygons: polygons(f, convert),
  };
}
function floorFeatures(source: Sources[string]): Feature[] {
  return layers(source)
    .filter((l) => /^(floor|1_floor)/i.test(l.name))
    .flatMap((l) => l.data?.features ?? []);
}
function blocks(name: string): boolean {
  return /墙|实验室|办公室|房间|洗手间|电梯|其他/.test(name);
}
export function sourceFloor(
  scene: SceneMap,
  source: Sources[string],
  convert: (p: number[]) => Point,
  indoor: boolean,
) {
  for (const f of floorFeatures(source)) {
    const s = surface(f, "floor", "#deddd0", convert);
    scene.surfaces.push(s);
    if (indoor) s.polygons.forEach((p) => stamp(scene, p, 0));
  }
  for (const layer of layers(source)) {
    if (/^(floor|1_floor)|roof|focusPolygon/i.test(layer.name)) continue;
    const color = /墙/.test(layer.name)
      ? "#bdb8a9"
      : /实验室/.test(layer.name)
        ? "#cad8d8"
        : /办公室|房间/.test(layer.name)
          ? "#d9d0bb"
          : /池塘/.test(layer.name)
            ? "#83b8bc"
            : /绿化/.test(layer.name)
              ? "#95b18a"
              : /楼梯|电梯/.test(layer.name)
                ? "#acb7b0"
                : "#d2c8b4";
    for (const f of layer.data?.features ?? []) {
      const s = surface(
        f,
        /墙/.test(layer.name)
          ? "wall"
          : blocks(layer.name)
            ? "room"
            : /池塘/.test(layer.name)
              ? "water"
              : "detail",
        color,
        convert,
      );
      if (s.kind === "wall" && f.geometry.type === "LineString") {
        s.line = coordinates(f.geometry.coordinates).map(convert);
        s.strokeWidth = config.lineWallWidth;
        s.polygons = bufferLine(s.line, config.lineWallWidth);
      }
      if (
        (indoor || blocks(layer.name) || /池塘/.test(layer.name)) &&
        s.polygons.length
      )
        scene.surfaces.push(s);
      if (blocks(layer.name) || /池塘/.test(layer.name))
        s.polygons.forEach((p) => stamp(scene, p, 1));
    }
  }
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
  const intersects = (p: Polygon) => {
    const b = bounds(p.flat());
    return (
      b.x < width * 16 &&
      b.y < height * 16 &&
      b.x + b.width > 0 &&
      b.y + b.height > 0
    );
  };
  for (const layer of layers(campus)) {
    if (
      !["绿化", "池塘", "斑马线", "道路补充", "内部路", "道路"].includes(
        layer.name,
      )
    )
      continue;
    for (const f of layer.data?.features ?? []) {
      const kind =
          layer.name === "绿化"
            ? "garden"
            : layer.name === "池塘"
              ? "water"
              : layer.name === "斑马线"
                ? "crosswalk"
                : "road",
        s = surface(
          f,
          kind,
          {
            garden: "#97ad83",
            water: "#81adb2",
            crosswalk: "#eeead8",
            road: "#c7c8b9",
          }[kind],
          convert,
        );
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
  for (const road of Object.values(campus.road.roads["0"])) {
    if (road.geometry !== "line" || !road.mode.includes("walk")) continue;
    const points = road.vertexes.map((id) => campus.road.points[String(id)]);
    if (points.some((p) => !p)) throw new Error("Missing road vertex");
    const line = points.map((p) => convert([p.x, p.y]));
    if (
      line.every(
        (p) => p.x >= 0 && p.y >= 0 && p.x < width * 16 && p.y < height * 16,
      )
    )
      outdoor.sourceRoads.push(line);
  }
  const interiorGroups = new Map<
    string,
    { scene: SceneMap; convert: (p: number[]) => Point; space: Set<number> }
  >();
  for (const group of groups) {
    const source = sources[group.sourceMap];
    sourceFloor(outdoor, source, convert, false);
    const footprint = floorFeatures(source).flatMap((f) =>
      polygons(f, convert),
    );
    outdoor.sourceOutlines.push(
      ...footprint.map((p) => ({ group: group.key, points: p[0] })),
    );
    outdoor.sourceEntries.push(
      ...(group.feature.properties.entry ?? []).map(convert),
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
  border(outdoor);
  const outsideSpace = largestPublicSpace(outdoor),
    usedEntries = new Set<string>();
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
    const own = def.featureId
        ? getFeature(source, def.featureId).properties.entry
        : undefined,
      explicit = def.entryFeatureId
        ? getFeature(sources[def.entrySourceMap!], def.entryFeatureId)
        : undefined,
      candidates: number[][] = explicit
        ? [coordinates(explicit.geometry.coordinates)[0]]
        : own?.length
          ? own
          : group.feature.properties.entry;
    const ordered = candidates
      .map((p, index) => ({
        p,
        index,
        d: Math.hypot(p[0] - anchor[0], p[1] - anchor[1]),
      }))
      .sort((a, b) => a.d - b.d);

    const selected =
      ordered.find((c) => !usedEntries.has(`${group.key}:${c.index}`)) ??
      ordered[0];
    usedEntries.add(`${group.key}:${selected.index}`);
    const raw = convert(selected.p),
      entry = nearest(outdoor, outsideSpace, raw),
      displacement = Math.hypot(entry.x - raw.x, entry.y - raw.y);
    if (displacement > 48)
      throw new Error(
        `Source entrance ${def.id} displaced ${displacement.toFixed(1)}px`,
      );
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
    const originalTemplate = interiorGroups.get(`${group.key}:${floorIndex}`)!,
      innerRaw = originalTemplate.convert(selected.p),
      innerEntry = nearest(
        originalTemplate.scene,
        originalTemplate.space,
        innerRaw,
      ),
      innerDisplacement = Math.hypot(
        innerEntry.x - innerRaw.x,
        innerEntry.y - innerRaw.y,
      );
    if (innerDisplacement > 48)
      throw new Error(
        `Interior source entrance ${def.id} displaced ${innerDisplacement.toFixed(1)}px (wing ${floorIndex})`,
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
    const innerSpawn = nearest(
        scene,
        template.space,
        innerEntry,
        (p) =>
          Math.hypot(p.x - innerEntry.x, p.y - innerEntry.y) >= 20 &&
          Math.hypot(p.x - innerEntry.x, p.y - innerEntry.y) <= 32,
      ),
      outerSpawn = nearest(
        outdoor,
        outsideSpace,
        entry,
        (p) =>
          Math.hypot(p.x - entry.x, p.y - entry.y) >= 20 &&
          Math.hypot(p.x - entry.x, p.y - entry.y) <= 32,
      );
    outdoor.portals.push({
      ...entry,
      id: `enter_${id}`,
      buildingId: b.id,
      targetScene: scene.id,
      targetPortal: `exit_${id}`,
      spawn: outerSpawn,
    });
    scene.portals.push({
      ...innerEntry,
      id: `exit_${id}`,
      buildingId: b.id,
      targetScene: outdoor.id,
      targetPortal: `enter_${id}`,
      spawn: innerSpawn,
    });
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
      sourceEntry: selected.p,
      sourceEntryIndex: selected.index,
      entryFeatureId: def.entryFeatureId,
      entrySourceMap: def.entrySourceMap,
      sourceEntryCandidates: candidates,
      entry,
      entryDisplacement: displacement,
      innerEntryDisplacement: innerDisplacement,
      footprint: "F1 source polygons, no replacement rectangle",
      review: "pending",
      reason: "源几何已重建；入口关联自动选择且偏移受限，仍需现场对照确认",
      scene,
    };
  });
  const c2 = outdoor.portals.find((p) => p.buildingId === "C2")!,
    spawn = nearest(
      outdoor,
      outsideSpace,
      c2,
      (p) =>
        Math.hypot(p.x - c2.x, p.y - c2.y) >= 40 &&
        Math.hypot(p.x - c2.x, p.y - c2.y) <= 64,
    );
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
  const world: WorldMap = {
    mapVersion: config.mapVersion,
    protocolVersion: config.protocolVersion,
    human: config.human,
    chest: config.chest,
    status: "reconstructed",
    scenes: [outdoor, ...evidence.map((e) => e.scene)],
    buildings: outdoor.buildings,
  };
  validateWorld(world);
  const report = {
    mapVersion: world.mapVersion,
    status: "source-geometry-reconstructed",
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
    checks: {
      scenes: 16,
      pairedPortals: 15,
      chests: 12,
      reachability: "passed",
    },
    unresolved: [
      "入口与编号的自动关联仍需现场确认；最大安全吸附48像素，实际偏移逐个记录",
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
  if (world.scenes.length !== 16)
    throw new Error("Expected campus and 15 interiors");
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
    const budget = scene.id === "campus_core" ? 256 : 64;
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
    const visited = reachable(scene, scene.spawns[0], scene.player.radius),
      check = (p: Point) => {
        if (
          !canStand(scene, p, scene.player.radius) ||
          !visited.has(tileIndex(scene, p))
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
        reverse.buildingId !== portal.buildingId
      )
        throw new Error(`Unpaired portal: ${portal.id}`);
      check(portal.spawn);
    }
  }
}
export function tiledMap(scene: SceneMap, mapVersion: string) {
  let nextObject = 1;
  const objects = (items: (Point & Record<string, any>)[]) =>
    items.map((o) => ({
      id: nextObject++,
      name: String(o.id ?? o.buildingId ?? ""),
      x: o.x,
      y: o.y,
      width: o.width ?? 0,
      height: o.height ?? 0,
      ...(!("width" in o) ? { point: true } : {}),
      rotation: 0,
      visible: true,
      properties: Object.entries(o)
        .filter(([k]) => !["x", "y", "width", "height"].includes(k))
        .map(([name, value]) => ({
          name,
          type: typeof value === "number" ? "float" : "string",
          value: typeof value === "object" ? JSON.stringify(value) : value,
        })),
    }));
  const layers: any[] = [
    { name: "ground", type: "imagelayer", image: scene.art.ground },
    {
      name: "collision",
      type: "objectgroup",
      visible: false,
      objects: collisionRuns(scene).map((r) => ({
        id: nextObject++,
        name: "blocked",
        ...r,
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
    ...scene.art.roofs.map((r) => ({
      name: `model_${r.id}`,
      type: "imagelayer",
      image: r.image,
      offsetx: r.x,
      offsety: r.y,
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
        polygon: s.points,
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
    tilewidth: 16,
    tileheight: 16,
    nextlayerid: layers.length + 1,
    nextobjectid: nextObject,
    properties: [
      { name: "mapVersion", type: "string", value: mapVersion },
      { name: "sceneId", type: "string", value: scene.id },
      { name: "collisionResolution", type: "int", value: 4 },
      {
        name: "collisionSource",
        type: "string",
        value:
          "world.json (4px authoritative occupancy; polygon holes preserved)",
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
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}"><image href="terrain-campus.png" width="${w}" height="${h}"/>${scene.art.roofs.map((r) => `<image href="${r.image}" x="${r.x}" y="${r.y}" width="${r.width}" height="${r.height}"/>`).join("")}${world.buildings.map((b) => `<g><rect x="${b.label.x - 19}" y="${b.label.y - 17}" width="38" height="28" rx="4" fill="#f8efd7" stroke="#587e6b"/><text x="${b.label.x}" y="${b.label.y + 4}" font-family="sans-serif" font-size="19" text-anchor="middle" fill="#345846">${b.id}</text></g>`).join("")}</svg>\n`;
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
