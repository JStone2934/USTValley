import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { canStand, type WorldMap } from "../src/shared/world.ts";
import {
  libraryStudySet,
  libraryTerrace,
} from "../scripts/library-photo-art.ts";
import { interiorMaterials } from "../scripts/interior-materials.ts";
import { polygonMesh } from "../scripts/indoor-art.ts";
import { distanceSegment, inPolygon } from "../scripts/source-geometry.ts";

const world = JSON.parse(
  readFileSync(new URL("../public/maps/world.json", import.meta.url), "utf8"),
) as WorldMap;
const f3 = world.scenes.find((s) => s.id === "interior_library_f3")!;
const { id: ink } = interiorMaterials();
test("photo-informed table sets retain the two original furniture families and their physical bounds", () => {
  const fixture = libraryStudySet(
    f3,
    "04d099a5a0fc6453a2717e75723538a1.glb",
    144433,
    ink,
    polygonMesh,
  )!;
  assert.equal(fixture.filter((p) => p.node === "study-caster").length, 5);
  const paired = libraryStudySet(
    f3,
    "e98dc9bcfd9f2ad147bfd2bd329b0237.glb",
    143757,
    ink,
    polygonMesh,
  )!;
  assert.equal(paired.filter((p) => p.node === "study-caster").length, 3);
  assert.equal(
    libraryStudySet(f3, "unknown.glb", 0, ink, polygonMesh),
    undefined,
  );
  for (const v of fixture.flatMap((p) => p.vertices)) {
    assert.ok(
      Math.abs(v[0]) <= 1.51 &&
        Math.abs(v[1]) <= 1.51 &&
        v[2] >= 0 &&
        v[2] <= 1.2,
    );
  }
});
test("the cushioned tiers stay inside the surveyed crescent and the spiral stair is approachable", () => {
  const source = f3.surfaces.find((s) => s.sourceId === 143982)!;
  const polygon = source.polygons[0],
    ring = polygon[0];
  const parts = libraryTerrace(
    polygon,
    f3.units.pixelsPerProjectedUnit,
    ink,
    polygonMesh,
  );
  for (const [x, y] of parts.flatMap((part) => part.vertices)) {
    const p = { x, y };
    assert.ok(
      inPolygon(p, polygon) ||
        ring.slice(1).some((b, i) => distanceSegment(p, ring[i], b) < 0.01),
    );
  }
  assert.ok(f3.fixtureCollision?.sourceIds.includes(143982));
  assert.ok(canStand(f3, { x: 199, y: 120 }));
  assert.equal(canStand(f3, { x: 210, y: 120 }), false);
  assert.ok(
    f3.portals.filter((p) => p.kind === "stairs").every((p) => canStand(f3, p)),
  );
});
