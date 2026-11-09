import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";
import clipping from "polygon-clipping";
import {
  canStand,
  canTraverse,
  reachable,
  tileIndex,
  type WorldMap,
} from "../src/shared/world.ts";
import { doorCollision } from "../src/shared/doors.ts";
import {
  insideLayoutPolygon,
  diagramPoint,
  layoutPropFootprint,
  supportHeightMeters,
  w1Floor,
} from "../src/shared/w1-layout.ts";
import { w1LayoutArt } from "../scripts/w1-layout-art.ts";
import { polygonMesh } from "../scripts/indoor-art.ts";
const world = JSON.parse(
  readFileSync(new URL("../public/maps/world.json", import.meta.url), "utf8"),
) as WorldMap;
const scenes = world.scenes.filter((s) => s.w1Layout);
const geom = (polys: { x: number; y: number }[][][]) =>
  polys.map((p) => p.map((r) => r.map((v) => [v.x, v.y] as [number, number])));
test("only W1 F4 F5 F6 receive floor-specific open diagrams, with no partition walls or gates in editable space", () => {
  assert.deepEqual(
    scenes.map((s) => s.id),
    ["interior_west_f4", "interior_west_f5", "interior_west_f6"],
  );
  for (const s of scenes) {
    const layout = s.w1Layout!;
    assert.ok(layout.removedDoorIds.length > 0);
    assert.equal(
      new Set(layout.zones.map((z) => z.id)).size,
      { 4: 8, 5: 4, 6: 10 }[w1Floor(s)!],
    );
    for (const d of s.doors ?? []) {
      assert.ok(!layout.removedDoorIds.includes(d.id));
      assert.ok(
        d.cells.every((i) => s.collision[i] === 1),
        d.id + " retained gate must have a closed threshold",
      );
    }
    for (const wall of s.surfaces.filter((s) => s.kind === "wall")) {
      const intersections = clipping.intersection(
        geom(wall.polygons),
        geom(layout.openArea),
      );
      const area = intersections.reduce(
        (n, p) =>
          n +
          p.reduce(
            (sum, r) =>
              sum +
              Math.abs(
                r.reduce((a, v, i) => {
                  const b = r[(i + 1) % r.length];
                  return a + v[0] * b[1] - b[0] * v[1];
                }, 0) / 2,
              ),
            0,
          ),
        0,
      );
      assert.ok(
        area < 0.01,
        `${s.id} wall ${wall.sourceId} intrudes into open area`,
      );
    }
  }
});
test("yellow and orange platforms are 0.30 m high and do not fill surveyed floor holes", () => {
  for (const s of scenes)
    for (const platform of s.w1Layout!.platforms) {
      assert.equal(platform.heightMeters, 0.3);
      const floors = s.surfaces
        .filter((s) => s.kind === "floor")
        .flatMap((s) => s.polygons);
      for (const p of platform.polygons)
        for (const r of p)
          for (const v of r) {
            const nearby = [
              v,
              { x: v.x + 0.02, y: v.y + 0.02 },
              { x: v.x - 0.02, y: v.y - 0.02 },
            ];
            assert.ok(
              nearby.some((q) => floors.some((f) => insideLayoutPolygon(q, f))),
            );
          }
    }
});
test("open zones and original floor connectors remain reachable", () => {
  for (const source of scenes) {
    const s = doorCollision(source, new Set(source.doors?.map((d) => d.id))),
      f = w1Floor(s)!;
    const start = diagramPoint(
      s,
      ...(
        { 4: [1000, 490], 5: [435, 245], 6: [450, 245] } as Record<
          number,
          [number, number]
        >
      )[f],
    );
    assert.ok(canStand(s, start), s.id + " common corridor");
    const reached = reachable(s, start);
    assert.ok(reached.size > 100);
    let crossings = 0;
    for (const d of s.w1Layout!.openedDoorways)
      if (canTraverse(s, d.inside, d.outside)) crossings++;
    assert.ok(crossings > 0, s.id + " no ghost wall after door removal");
    for (const z of s.w1Layout!.zones) {
      const ring = z.polygon[0],
        center = {
          x: ring.reduce((n, p) => n + p.x, 0) / ring.length,
          y: ring.reduce((n, p) => n + p.y, 0) / ring.length,
        };
      if (canStand(s, center))
        assert.ok(
          reached.has(tileIndex(s, center)),
          `${s.id} ${z.id} reachable`,
        );
    }
  }
});
test("stage furniture sits entirely on one level, renders from that level, and blocks the actor", () => {
  for (const s of scenes) {
    const parts = w1LayoutArt(s, [], polygonMesh).fixtures;
    assert.ok(s.w1Layout!.props.length >= 10);
    for (const p of s.w1Layout!.props) {
      const h = supportHeightMeters(s, p);
      for (const q of layoutPropFootprint(s, p))
        assert.equal(supportHeightMeters(s, q), h, p.id);
      const vs = parts
        .filter((q) => q.node.startsWith(p.id + ":"))
        .flatMap((q) => q.vertices);
      assert.ok(vs.length > 0);
      assert.ok(
        Math.abs(
          Math.min(...vs.map((v) => v[2])) - h * s.units.pixelsPerMeter,
        ) < 1e-6,
        p.id + " grounded",
      );
      assert.equal(canStand(s, p, 0.1), false, p.id + " solid");
    }
  }
});
test("Tiled exports the same walk platform heights used by the avatar", () => {
  for (const s of scenes) {
    const tiled = JSON.parse(
      readFileSync(
        new URL(`../public/maps/${s.id}.tmj`, import.meta.url),
        "utf8",
      ),
    );
    const layer = tiled.layers.find(
      (l: { name: string }) => l.name === "walk_platforms",
    );
    assert.ok(layer);
    assert.equal(
      layer.objects.length,
      s.w1Layout!.platforms.reduce((n, p) => n + p.polygons.length, 0),
    );
    for (const obj of layer.objects)
      assert.equal(
        obj.properties.find((p: { name: string }) => p.name === "heightMeters")
          .value,
        0.3,
      );
  }
});
