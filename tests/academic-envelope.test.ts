import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { academicEnvelope } from "../scripts/academic-envelope.ts";
import { polygonMesh } from "../scripts/indoor-art.ts";
import { interiorMaterials } from "../scripts/interior-materials.ts";
import { inPolygon } from "../scripts/source-geometry.ts";
import type { WorldMap } from "../src/shared/world.ts";
const world = JSON.parse(
  readFileSync(new URL("../public/maps/world.json", import.meta.url), "utf8"),
) as WorldMap;
const { id: ink } = interiorMaterials();
test("academic F2 central oval is continuous glazing with no flowers or pickets", () => {
  const s = world.scenes.find((s) => s.id === "interior_academic_f2")!;
  const envelope = academicEnvelope(s, ink, polygonMesh)!;
  const oval = s.surfaces.find((s) => s.sourceId === 44821)!;
  const parts = envelope.decorate(oval, oval.polygons[0])!;
  assert.ok(parts.length);
  assert.ok(parts.every((p) => p.material === ink.campusGlass));
  const points = oval.polygons[0][0],
    minX = Math.min(...points.map((p) => p.x)) - 3,
    maxX = Math.max(...points.map((p) => p.x)) + 3,
    minY = Math.min(...points.map((p) => p.y)) - 3,
    maxY = Math.max(...points.map((p) => p.y)) + 3;
  const decoration = envelope.extras.filter((p) =>
    p.vertices.some(
      ([x, y]) => x >= minX && x <= maxX && y >= minY && y <= maxY,
    ),
  );
  assert.ok(decoration.some((p) => p.node === "glass-mullion"));
  assert.ok(decoration.every((p) => p.node.startsWith("glass-")));
});
test("academic facade trim leaves every existing door center open and does not change movement data", () => {
  for (const id of ["interior_academic_f2", "interior_academic_f3"]) {
    const scene = world.scenes.find((s) => s.id === id)!,
      before = JSON.stringify(scene);
    const envelope = academicEnvelope(scene, ink, polygonMesh)!;
    const tops = envelope.extras.filter((p) =>
      p.vertices.every((v) => v[2] === p.vertices[0][2]),
    );
    for (const d of scene.doors ?? [])
      for (const p of tops) {
        const ring = p.vertices.map(([x, y]) => ({ x, y }));
        assert.ok(!inPolygon(d, [ring]), `${id}: ${p.node} crosses ${d.id}`);
      }
    assert.equal(JSON.stringify(scene), before);
  }
});
