import config from "../content/map-config.json";
import { campusPlacement, parseGlb, primitives } from "../scripts/gltf.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  bounds,
  inPolygon,
  inRing,
  distanceSegment,
  getFeature,
  type Sources,
} from "../scripts/source-geometry.ts";
import {
  canStand,
  move,
  project,
  type Point,
  type WorldMap,
} from "../src/shared/world.ts";

const world = JSON.parse(
  readFileSync(new URL("../public/maps/world.json", import.meta.url), "utf8"),
) as WorldMap;
test("feet on every indoor floor are supported by a slab, tread or the paved source entrance paths", () => {
  for (const s of world.scenes.slice(1)) {
    const floors = s.surfaces
      .filter(
        (v) =>
          v.kind === "floor" ||
          v.kind === "stairs" ||
          (v.kind === "corridor" && v.line),
      )
      .flatMap((v) =>
        v.polygons.map((poly) => ({ poly, b: bounds(poly.flat()) })),
      );
    const size = s.collisionSize,
      width = (s.width * s.tileSize) / size;
    for (let i = 0; i < s.collision.length; i++) {
      if (s.collision[i]) continue;
      const p = {
        x: ((i % width) + 0.5) * size,
        y: (Math.floor(i / width) + 0.5) * size,
      };
      if (!canStand(s, p)) continue;
      const supported = floors.some(({ poly, b }) => {
        if (
          p.x < b.x - 1 ||
          p.x > b.x + b.width + 1 ||
          p.y < b.y - 1 ||
          p.y > b.y + b.height + 1
        )
          return false;
        return (
          inPolygon(p, poly) ||
          poly.some((r) =>
            r.some((a, j) => distanceSegment(p, a, r[(j + 1) % r.length]) < 1),
          )
        );
      });
      assert.ok(supported, `${s.id}: foot without a floor at ${p.x},${p.y}`);
    }
  }
});

test("each placed outdoor model has solid feet, with a real path through each canopy", () => {
  const scene = world.scenes[0];
  const sources = JSON.parse(
    readFileSync(
      new URL("../data/maps/all-maps.json", import.meta.url),
      "utf8",
    ),
  ) as Sources;
  const campus = sources.xgkdgz_all;
  const at = (p: number[]) => {
    const xy = project(p, config.transform);
    return { x: xy.x + scene.sourceOffset.x, y: xy.y + scene.sourceOffset.y };
  };
  // Foot positions inside each roof in campus coordinates with a measured open axis.
  const shelters = new Map<number, number[]>([
    [49275, [786.33, 318.79, 0, 1]],
    [49276, [804.06, 533.72, 0, 1]],
    [49277, [811.9, 408.78, 1, 0]],
    [49278, [794.1, 386.39, 1, 0]],
    [49279, [1023.82, 858.0, 0, 1]],
    [49280, [987.54, 999.99, 0, 1]],
    [49281, [798.11, 926.39, 1, 0]],
    [49282, [739.02, 1071.2, 1, 1]],
  ]);
  for (const id of [
    ...shelters.keys(),
    45972,
    45974,
    45975,
    48569,
    45779,
    45953,
    45955,
    50038,
    49640,
  ]) {
    const f = getFeature(campus, id).properties;
    const model = parseGlb(
      readFileSync(
        new URL(
          "../data/maps/" + f.src.replace(/^\/res\/projects\//, ""),
          import.meta.url,
        ),
      ),
    );
    const parts = primitives(model, campusPlacement(model, f.tarray, f.height));
    const material = (index: number) => model.json.materials![index].name!;
    const through = shelters.get(id);
    if (through) {
      const roof = parts.find((p) => material(p.material) === "网格")!,
        triangles: Point[][] = [];
      for (let i = 0; i < roof.indices.length; i += 3)
        triangles.push(
          roof.indices.slice(i, i + 3).map((j) => at(roof.vertices[j])),
        );
      const under = (p: Point) => triangles.some((t) => inRing(p, t));
      const [x, y, dx, dy] = through;
      assert.ok(
        under({ x, y }) && canStand(scene, { x, y }),
        `roof covers path in shelter ${id}`,
      );
      for (const sign of [-1, 1]) {
        let p = { x, y };
        for (let tick = 0; tick < 60 && under(p); tick++)
          p = move(scene, p, { x: dx * sign, y: dy * sign }, 0.05);
        assert.ok(!under(p), `cannot walk under ${id} towards ${sign}`);
      }
    }
    const low = parts
      .filter((p) =>
        through
          ? material(p.material) === "白"
          : !material(p.material).includes("树叶"),
      )
      .flatMap((p) =>
        p.vertices.filter((v) => v[2] < (through ? 0.1 : 0.76)).map(at),
      )
      .filter(
        (p) =>
          p.x >= 16 &&
          p.y >= 16 &&
          p.x < scene.width * scene.tileSize - 16 &&
          p.y < scene.height * scene.tileSize - 16,
      );
    // Only the high crowns of these two peripheral tree groups intersect the playable crop.
    if (id === 45953 || id === 45955) assert.equal(low.length, 0);
    else assert.ok(low.length > 0);
    for (const p of low)
      assert.equal(
        canStand(scene, p),
        false,
        `feet in model ${id} at ${p.x},${p.y}`,
      );
  }
});
