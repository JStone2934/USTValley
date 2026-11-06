import { fitThinWalls } from "./indoor-wall-collision.ts";
import config from "../content/map-config.json";
import {
  canStand,
  type Point,
  type SceneMap,
  type Surface,
} from "../src/shared/world.ts";
import { metricScale, scenePlayer } from "../src/shared/scale.ts";
import {
  bounds,
  inPolygon,
  layers,
  polygons,
  bufferLine,
  walkPassages,
  type Feature,
  type Polygon,
  type Sources,
} from "./source-geometry.ts";
const size = config.collisionSize;
export function gridPoint(scene: SceneMap, id: number): Point {
  const w = (scene.width * 16) / size;
  return { x: ((id % w) + 0.5) * size, y: (Math.floor(id / w) + 0.5) * size };
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
    sourceMap: "xgkdgz_all",
    sourceOffset: { x: 0, y: 0 },
    floor: {
      key: "0",
      name: id === "campus_core" ? "室外" : "F1",
      elevation: 0,
    },
    art: { style: "pixel-3d", pixelRatio: 3, ground, layers: [], roofs: [] },
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
export function stamp(scene: SceneMap, poly: Polygon, value: number) {
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
export function border(scene: SceneMap) {
  const w = (scene.width * 16) / size,
    h = (scene.height * 16) / size;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (x < 4 || y < 4 || x >= w - 4 || y >= h - 4)
        scene.collision[y * w + x] = 1;
}
export function surface(
  f: Feature,
  kind: string,
  color: string,
  convert: (p: number[]) => Point,
): Surface {
  return {
    sourceId: f.properties.id ?? -1,
    sourceLayer: kind,
    sourceMap: "xgkdgz_all",
    sourceFloor: "0",
    kind,
    color,
    polygons: polygons(f, convert),
  };
}
export function floorFeatures(source: Sources[string], floor = "0"): Feature[] {
  return layers(source, floor)
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
  floor = "0",
  sourceMap = scene.sourceMap,
) {
  const ownSurfaces: Surface[] = [];
  for (const layer of layers(source, floor)) {
    if (/focusPolygon/i.test(layer.name)) continue;
    const kind = /roof/i.test(layer.name)
      ? "roof"
      : /^(floor|1_floor)|内地面|露天底面|路面/.test(layer.name)
        ? "floor"
        : /墙|围栏/.test(layer.name)
          ? "wall"
          : /池塘/.test(layer.name)
            ? "water"
            : /绿化/.test(layer.name)
              ? "garden"
              : /楼梯|扶梯/.test(layer.name)
                ? "stairs"
                : /电梯/.test(layer.name)
                  ? "lift"
                  : blocks(layer.name)
                    ? "room"
                    : "detail";
    const color = {
      roof: "#a7b995",
      floor: "#deddd0",
      wall: "#bdb8a9",
      water: "#83b8bc",
      garden: "#95b18a",
      stairs: "#acb7b0",
      lift: "#9caeb4",
      room: /实验室/.test(layer.name) ? "#cad8d8" : "#d9d0bb",
      detail: "#d2c8b4",
    }[kind];
    for (const f of layer.data?.features ?? []) {
      const s = {
        ...surface(f, kind, color, convert),
        sourceLayer: layer.name,
        sourceMap,
        sourceFloor: floor,
      };
      if (
        kind === "wall" &&
        ["LineString", "MultiLineString"].includes(f.geometry.type)
      ) {
        const lines =
          f.geometry.type === "LineString"
            ? [f.geometry.coordinates]
            : f.geometry.coordinates;
        s.polygons = lines.flatMap((line: number[][]) =>
          bufferLine(line.map(convert), config.lineWallWidth),
        );
        if (lines.length === 1) s.line = lines[0].map(convert);
        s.strokeWidth = config.lineWallWidth;
      }
      if (s.polygons.length) ownSurfaces.push(s);
    }
  }
  // Navigation polygons describe the actual public corridors, including courtyard holes.
  const passages = walkPassages(source, floor, convert).map(
    (p): Surface => ({
      sourceId: Number(p.id),
      sourceLayer: "walk-passages",
      sourceMap,
      sourceFloor: floor,
      kind: "corridor",
      color: "#e8e4cf",
      polygons: p.polygons,
      line: p.line,
      strokeWidth: scene.units.pixelsPerMeter * 1.2,
    }),
  );
  scene.sourceRoads.push(...passages.filter((p) => p.line).map((p) => p.line!));
  scene.surfaces.push(...ownSurfaces, ...passages);
  if (indoor)
    for (const s of ownSurfaces.filter((s) => s.kind === "floor"))
      s.polygons.forEach((p) => stamp(scene, p, 0));
  for (const s of ownSurfaces.filter(
    (s) =>
      ["room", "lift", "water"].includes(s.kind) ||
      (!indoor && s.kind === "wall"),
  ))
    s.polygons.forEach((p) => stamp(scene, p, 1));
  // A source passage may cross a room's broad functional polygon, but must never cut a wall.
  for (const s of passages) for (const p of s.polygons) stamp(scene, p, 0);
  for (const s of ownSurfaces.filter(
    (s) =>
      s.kind === "water" ||
      (s.kind === "wall" && (!indoor || s.sourceLayer === "玻璃外墙-门")),
  ))
    s.polygons.forEach((p) => stamp(scene, p, 1));
  // The fixed glazing is fitted after matching the six moving library bays.
  if (indoor)
    fitThinWalls(
      scene,
      ownSurfaces.filter((s) => s.sourceLayer !== "玻璃外墙-门"),
    );
}
