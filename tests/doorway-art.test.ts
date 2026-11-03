import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { buildWorld } from "../scripts/map-builder.ts";
import {
  entranceOpeningArt,
  fixedGlazing,
  inferredDoorReturns,
  measuredGlassBay,
  roomOpeningArt,
} from "../scripts/doorway-art.ts";
import { polygonMesh } from "../scripts/indoor-art.ts";
import { interiorMaterials } from "../scripts/interior-materials.ts";
import { distanceSegment, inPolygon } from "../scripts/source-geometry.ts";
import type { Point } from "../src/shared/world.ts";

const bytes = readFileSync(
  new URL("../data/maps/all-maps.json", import.meta.url),
);
const { world } = buildWorld(JSON.parse(bytes.toString()), bytes);
const ink = interiorMaterials().id;
const mix = (a: Point, b: Point, t: number) => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});

test("each library glass entry removes only its active bay from the source curtain wall", () => {
  const lib = world.scenes.find((s) => s.id === "interior_c7")!;
  const entries = lib.portals.flatMap((p) =>
    p.entrance?.glazing ? [p.entrance] : [],
  );
  assert.equal(entries.length, 6);
  for (const entry of entries) {
    const bay = entry.glazing!,
      wall = lib.surfaces.find(
        (s) => s.sourceId === bay.sourceId && s.sourceLayer === "玻璃外墙-门",
      )!;
    const mid = mix(bay.jambA, bay.jambB, 0.5);
    const measured = measuredGlassBay(lib, mid, entry.toward);
    assert.ok(measured);
    assert.equal(measured.sourceId, bay.sourceId);
    for (const end of ["jambA", "jambB"] as const) {
      assert.ok(
        Math.hypot(measured[end].x - bay[end].x, measured[end].y - bay[end].y) <
          1e-8,
      );
    }
    assert.equal(
      measuredGlassBay(lib, mid, { x: -entry.toward.y, y: entry.toward.x }),
      undefined,
    );
    assert.ok(wall.polygons.some((p) => inPolygon(mid, p)));
    const cut = fixedGlazing(wall, [bay]),
      contains = (q: Point) => cut.some((p) => inPolygon(q, p));
    for (const t of [0.1, 0.5, 0.9])
      assert.equal(contains(mix(bay.jambA, bay.jambB, t)), false);
    // Walk the original line. Even small fixed sidelights at the ends must survive.
    const line = wall.line!;
    let left = 0,
      right = 0;
    for (let i = 1; i < line.length; i++)
      for (let j = 1; j < 250; j++) {
        const p = mix(line[i - 1], line[i], j / 250);
        if (distanceSegment(p, bay.jambA, bay.jambB) < 0.001) continue;
        if (!wall.polygons.some((poly) => inPolygon(p, poly))) continue;
        assert.ok(contains(p), String(bay.sourceId));
        if (
          Math.hypot(p.x - bay.jambA.x, p.y - bay.jambA.y) <
          Math.hypot(p.x - bay.jambB.x, p.y - bay.jambB.y)
        )
          left++;
        else right++;
      }
    assert.ok(left > 0 && right > 0);
  }
});

test("static room and entrance jamb faces stay outside the leaf's entire clear interval", () => {
  let tested = 0;
  for (const s of world.scenes.slice(1)) {
    const ppm = s.units.pixelsPerMeter;
    const openings = [
      ...(s.doors ?? []).map((d) => ({
        a: d.hinge!,
        b: d.latch!,
        parts: roomOpeningArt(d, ppm, ink, polygonMesh),
      })),
      ...s.portals.flatMap((p) =>
        p.entrance?.glazing
          ? [
              {
                a: p.entrance.glazing.jambA,
                b: p.entrance.glazing.jambB,
                parts: entranceOpeningArt(p.entrance, ppm, ink, polygonMesh),
              },
            ]
          : [],
      ),
    ];
    for (const { a, b, parts } of openings) {
      const dx = b.x - a.x,
        dy = b.y - a.y,
        width = Math.hypot(dx, dy);
      assert.ok(parts.floor.length && parts.walls.length);
      for (const piece of parts.walls) {
        const span = piece.vertices.map(
          ([x, y]) => ((x - a.x) * dx + (y - a.y) * dy) / width,
        );
        assert.ok(Math.max(...span) < 1e-7 || Math.min(...span) > width - 1e-7);
      }
      assert.ok(
        parts.floor.every((p) => p.vertices.every(([, , z]) => z < 0.02 * ppm)),
      );
      tested++;
    }
  }
  assert.ok(tested > 800);
});

test("reconstructed solid returns leave all primary and secondary walking lines clear", () => {
  let returns = 0;
  for (const s of world.scenes.slice(1)) {
    const walls = inferredDoorReturns(s);
    returns += walls.length;
    for (const door of s.doors ?? [])
      for (const lane of [door, ...(door.lanes ?? [])]) {
        for (let j = 0; j <= 20; j++) {
          const p = mix(lane.outside, lane.inside, j / 20);
          assert.ok(!walls.some((poly) => inPolygon(p, poly)), door.id);
        }
      }
  }
  assert.ok(returns > 0);
});
