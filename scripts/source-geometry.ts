import type { Point, Rect } from "../src/shared/world.ts";
export type Polygon = Point[][];
export type Feature = {
  type?: string;
  properties: Record<string, any>;
  geometry: { type: string; coordinates: any };
};
export type Layer = {
  name: string;
  type: string;
  layerStyle?: Record<string, any>;
  data?: { features: Feature[] };
};
export type SourceMap = {
  map: {
    mversion: number;
    mapinfo: {
      regions: {
        region: number;
        name: string;
        z: number;
        entries?: { in: Point & { z: number }; out: Point & { z: number } }[];
      }[];
    };
    mapdata: Record<string, Record<string, Layer>>;
  };
  road: {
    points: Record<string, Point & { region: number }>;
    roads: Record<
      string,
      Record<
        string,
        {
          geometry: string;
          mode: string[];
          vertexes: number[] | number[][];
          type?: string;
        }
      >
    >;
  };
};
export type Sources = Record<string, SourceMap>;
export const layers = (s: SourceMap, floor = "0") =>
  Object.values(s.map.mapdata[floor] ?? {});
export const features = (s: SourceMap, floor = "0") =>
  layers(s, floor).flatMap((l) => l.data?.features ?? []);
export function getFeature(s: SourceMap, id: number) {
  const found = features(s).filter((f) => f.properties.id === id);
  if (found.length !== 1)
    throw new Error(`Expected unique source feature ${id}`);
  return found[0];
}
export function coordinates(value: any): number[][] {
  if (!Array.isArray(value) || !value.length) return [];
  return typeof value[0] === "number" ? [value] : value.flatMap(coordinates);
}
export function polygons(
  f: Feature,
  convert: (p: number[]) => Point,
): Polygon[] {
  const g = f.geometry;
  if (g.type === "Polygon")
    return [g.coordinates.map((r: number[][]) => r.map(convert))];
  if (g.type === "MultiPolygon")
    return g.coordinates.map((p: number[][][]) => p.map((r) => r.map(convert)));
  return [];
}
export function bounds(points: Point[]): Rect {
  if (!points.length) throw new Error("Empty geometry");
  const x = Math.min(...points.map((p) => p.x)),
    y = Math.min(...points.map((p) => p.y));
  return {
    x,
    y,
    width: Math.max(...points.map((p) => p.x)) - x,
    height: Math.max(...points.map((p) => p.y)) - y,
  };
}
export function inRing(p: Point, ring: Point[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i],
      b = ring[j];
    if (
      a.y > p.y !== b.y > p.y &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x
    )
      inside = !inside;
  }
  return inside;
}
export function inPolygon(p: Point, polygon: Polygon): boolean {
  return inRing(p, polygon[0]) && !polygon.slice(1).some((r) => inRing(p, r));
}
export function pathData(polys: Polygon[]): string {
  return polys
    .map((p) =>
      p
        .map(
          (r) =>
            `M${r.map((q) => `${q.x.toFixed(2)},${q.y.toFixed(2)}`).join("L")}Z`,
        )
        .join(""),
    )
    .join("");
}
export function distanceSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x,
    dy = b.y - a.y,
    t = Math.max(
      0,
      Math.min(
        1,
        ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1),
      ),
    );
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}
export function bufferLine(line: Point[], width: number): Polygon[] {
  return line.slice(1).flatMap((b, i) => {
    const a = line[i],
      dx = b.x - a.x,
      dy = b.y - a.y,
      length = Math.hypot(dx, dy);
    if (!length) return [];
    const nx = ((-dy / length) * width) / 2,
      ny = ((dx / length) * width) / 2;
    return [
      [
        [
          { x: a.x + nx, y: a.y + ny },
          { x: b.x + nx, y: b.y + ny },
          { x: b.x - nx, y: b.y - ny },
          { x: a.x - nx, y: a.y - ny },
          { x: a.x + nx, y: a.y + ny },
        ],
      ],
    ];
  });
}

/** Source road polygons are rings (outer boundary followed by holes), not separate filled areas. */
export function walkPassages(
  source: SourceMap,
  floor: string,
  convert: (p: number[]) => Point,
) {
  return Object.entries(source.road.roads[floor] ?? {}).flatMap<{
    id: string;
    polygons: Polygon[];
    line?: Point[];
  }>(([id, road]) => {
    if (!road.mode.includes("walk")) return [];
    const point = (id: number) => {
      const p = source.road.points[id];
      if (!p) throw new Error(`Missing road vertex ${id}`);
      return convert([p.x, p.y]);
    };
    if (road.geometry === "line")
      return [
        {
          id,
          polygons: [] as Polygon[],
          line: (road.vertexes as number[]).map(point),
        },
      ];
    const rings =
      road.geometry === "polygon"
        ? [road.vertexes as number[]]
        : (road.vertexes as number[][]);
    if (!["polygon", "multi-polygon"].includes(road.geometry))
      throw new Error(`Unsupported road geometry ${road.geometry}`);
    return [
      { id, polygons: [rings.map((r) => r.map(point))], line: undefined },
    ];
  });
}
