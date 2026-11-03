import type { SceneMap } from "../src/shared/world.ts";
import {
  bounds,
  inPolygon,
  layers,
  type SourceMap,
} from "./source-geometry.ts";

/** Generic model layers reuse exactly the same assets as labelled library chairs and floor-standing machines. */
const furniture =
  /书柜|书架|展柜|饮水机|储物柜|打印机|售卖机|售货机|静音舱|服务台|咨询台|自助借还机|还书箱|座位|座椅|桌椅/;

export function fitSourceFixtures(scene: SceneMap, source: SourceMap) {
  const labelledAssets = new Set(
    Object.keys(source.map.mapdata).flatMap((floor) =>
      layers(source, floor).flatMap((l) =>
        (l.data?.features ?? [])
          .filter(
            (f) =>
              furniture.test(l.name) || furniture.test(f.properties.name ?? ""),
          )
          .map((f) => f.properties.src)
          .filter(Boolean),
      ),
    ),
  );
  const records = new Map(
    layers(source, scene.floor.key).flatMap((l) =>
      (l.data?.features ?? []).map(
        (f) => [f.properties.id, f.properties] as const,
      ),
    ),
  );
  const w = scene.width * scene.tileSize,
    h = scene.height * scene.tileSize;
  const mask = new Uint8Array(w * h),
    sourceIds: number[] = [],
    conflicts: number[] = [];
  const mandatoryPoints = [
    ...scene.spawns,
    ...scene.chests,
    ...scene.portals,
    ...scene.portals.map((p) => p.spawn),
  ];
  for (const zone of [...scene.exploration, ...scene.note_zones])
    for (let y = zone.y + 4; y < zone.y + zone.height; y += 4)
      for (let x = zone.x + 4; x < zone.x + zone.width; x += 4)
        mandatoryPoints.push({ x, y });
  const protectedMask = new Uint8Array(w * h);
  for (const p of mandatoryPoints) {
    const r = scene.player.radius;
    for (
      let y = Math.max(0, Math.floor(p.y - r));
      y <= Math.min(h - 1, Math.floor(p.y + r));
      y++
    )
      for (
        let x = Math.max(0, Math.floor(p.x - r));
        x <= Math.min(w - 1, Math.floor(p.x + r));
        x++
      )
        protectedMask[y * w + x] = 1;
  }
  for (const s of scene.surfaces) {
    if (s.kind !== "detail") continue;
    const f = records.get(s.sourceId);
    if (
      !f ||
      !(
        furniture.test(s.sourceLayer) ||
        furniture.test(f.name ?? "") ||
        labelledAssets.has(f.src)
      )
    )
      continue;
    const pixels: number[] = [];
    for (const polygon of s.polygons) {
      const b = bounds(polygon.flat());
      for (
        let y = Math.max(0, Math.floor(b.y));
        y < Math.min(h, Math.ceil(b.y + b.height));
        y++
      )
        for (
          let x = Math.max(0, Math.floor(b.x));
          x < Math.min(w, Math.ceil(b.x + b.width));
          x++
        )
          if (inPolygon({ x: x + 0.5, y: y + 0.5 }, polygon))
            pixels.push(y * w + x);
    }
    if (!pixels.length) continue;
    if (pixels.some((i) => protectedMask[i])) {
      conflicts.push(s.sourceId);
      continue;
    }
    sourceIds.push(s.sourceId);
    for (const i of pixels) mask[i] = 1;
  }
  if (sourceIds.length) {
    const runs: number[] = [];
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; ) {
        if (!mask[y * w + x]) {
          x++;
          continue;
        }
        const start = x++;
        while (x < w && mask[y * w + x]) x++;
        runs.push(y, start, x - start);
      }
    scene.fixtureCollision = { sourceIds, runs };
  }
  return {
    sceneId: scene.id,
    installed: sourceIds.length,
    conflictingSourceIds: conflicts,
  };
}
