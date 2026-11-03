import { strict as assert } from "node:assert";
import { closeSync, openSync, readFileSync, readSync } from "node:fs";
import { test } from "node:test";
import { tiledMap } from "../scripts/map-builder.ts";
import type { Point, WorldMap } from "../src/shared/world.ts";

const maps = new URL("../public/maps/", import.meta.url);
const world = JSON.parse(
  readFileSync(new URL("world.json", maps), "utf8"),
) as WorldMap;
function pngSize(name: string) {
  const f = openSync(new URL(name, maps), "r");
  try {
    const header = Buffer.alloc(24);
    assert.equal(readSync(f, header, 0, 24, 0), 24);
    assert.equal(header.toString("ascii", 12, 16), "IHDR");
    return [header.readUInt32BE(16), header.readUInt32BE(20)];
  } finally {
    closeSync(f);
  }
}
test("every exported Tiled map aligns its baked PNGs, doors, models and source outlines in the same pixel space", () => {
  let holes = 0,
    doors = 0,
    models = 0;
  for (const scene of world.scenes) {
    const ratio = scene.art.pixelRatio ?? 1,
      point = (p: Point) => ({ x: p.x * ratio, y: p.y * ratio });
    const tiled = JSON.parse(
      readFileSync(new URL(`${scene.id}.tmj`, maps), "utf8"),
    ) as ReturnType<typeof tiledMap>;
    assert.equal(
      tiled.properties.find((p) => p.name === "imagePixelsPerWorldPixel")
        ?.value,
      ratio,
    );
    const fullSize = [
      tiled.width * tiled.tilewidth,
      tiled.height * tiled.tileheight,
    ];
    assert.deepEqual(fullSize, [
      scene.width * scene.tileSize * ratio,
      scene.height * scene.tileSize * ratio,
    ]);
    for (const layer of scene.art.layers)
      assert.deepEqual(pngSize(layer.image), fullSize, layer.image);
    for (const art of [...scene.art.roofs, ...(scene.art.landmarks ?? [])]) {
      const layer = tiled.layers.find((l) => l.name === `model_${art.id}`);
      assert.deepEqual(
        [layer.offsetx, layer.offsety],
        [art.x * ratio, art.y * ratio],
        art.image,
      );
      assert.deepEqual(
        pngSize(art.image),
        [art.width * ratio, art.height * ratio],
        art.image,
      );
      models++;
    }
    const cabinets =
      tiled.layers.find((l) => l.name === "room_casework")?.objects ?? [];
    assert.deepEqual(
      cabinets.map((c: { polygon: Point[] }) => c.polygon),
      (scene.roomCasework ?? []).map((c) => c.footprint.map(point)),
    );
    const pointFixtures =
      tiled.layers.find((l) => l.name === "point_fixtures")?.objects ?? [];
    assert.deepEqual(
      pointFixtures.map(({ x, y }: Point) => ({ x, y })),
      (scene.pointFixtures ?? []).map(point),
    );
    const portalLayer = tiled.layers.find((l) => l.name === "portals");
    for (const portal of scene.portals) {
      const o = portalLayer.objects.find(
        (o: { name: string }) => o.name === portal.id,
      );
      assert.deepEqual({ x: o.x, y: o.y }, point(portal));
      assert.deepEqual(
        JSON.parse(
          o.properties.find((p: { name: string }) => p.name === "spawn").value,
        ),
        point(portal.spawn),
      );
    }
    const doorLayer = tiled.layers.find((l) => l.name === "doors");
    for (const door of scene.doors ?? []) {
      const o = doorLayer.objects.find(
        (o: { name: string }) => o.name === door.id,
      );
      assert.deepEqual({ x: o.x, y: o.y }, point(door));
      for (const side of ["outside", "inside", "sourceEntry"] as const)
        assert.deepEqual(
          JSON.parse(
            o.properties.find((p: { name: string }) => p.name === side).value,
          ),
          point(door[side]),
        );
      assert.deepEqual(
        JSON.parse(
          o.properties.find((p: { name: string }) => p.name === "cells").value,
        ),
        door.cells,
      );
      doors++;
    }
    for (const s of scene.surfaces) {
      const polygon = s.polygons.find((p) => p.length > 1);
      if (!polygon || s.line) continue;
      const layer = tiled.layers.find(
        (l) =>
          l.name === `source_${s.sourceMap}:${s.sourceFloor}:${s.sourceLayer}`,
      );
      const o = layer.objects.find(
        (o: { name: string; polygon: Point[] }) =>
          o.name === String(s.sourceId) &&
          o.polygon?.[0].x === polygon[0][0].x * ratio &&
          o.polygon[0].y === polygon[0][0].y * ratio,
      );
      assert.ok(o);
      assert.deepEqual(o.polygon, polygon[0].map(point));
      assert.deepEqual(
        JSON.parse(
          o.properties.find((p: { name: string }) => p.name === "holes").value,
        ),
        polygon.slice(1).map((r) => r.map(point)),
      );
      holes++;
      break;
    }
  }
  assert.ok(models > 6 && doors > 0 && holes > 0);
});
