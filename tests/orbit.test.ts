import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseGlb, accessor } from "../scripts/gltf.ts";
import config from "../content/map-config.json";
const read = (file: string) =>
  readFileSync(new URL(`../public/${file}`, import.meta.url));
test("published orbit model contains real elevated meshes and no source coordinates or external resources", () => {
  const glb = parseGlb(read("orbit/campus.glb"));
  const manifest = JSON.parse(read("orbit/manifest.json").toString());
  assert.equal(glb.json.nodes.length, manifest.models);
  for (const group of config.groups)
    assert.ok(glb.json.nodes.some((n) => n.name === group.key));
  assert.doesNotMatch(
    JSON.stringify(glb.json),
    /tarray|\/res\/|data\/maps|uri|extras|extensions/,
  );
  let triangles = 0;
  for (const mesh of glb.json.meshes) {
    let minHeight = Infinity,
      maxHeight = -Infinity;
    for (const primitive of mesh.primitives) {
      const positions = accessor(glb, primitive.attributes.POSITION);
      assert.equal(
        accessor(glb, primitive.attributes.NORMAL).length,
        positions.length,
      );
      for (const [x, y, z] of positions) {
        assert.ok([x, y, z].every(Number.isFinite));
        assert.ok(
          Math.abs(x) < 5000 && Math.abs(z) < 5000 && Math.abs(y) < 1000,
        );
        minHeight = Math.min(minHeight, y);
        maxHeight = Math.max(maxHeight, y);
      }
      const indices = accessor(glb, primitive.indices!).flat();
      assert.equal(indices.length % 3, 0);
      assert.ok(
        indices.every(
          (i) => Number.isInteger(i) && i >= 0 && i < positions.length,
        ),
      );
      triangles += indices.length / 3;
    }
    assert.ok(
      maxHeight - minHeight > 1,
      "models must have vertical geometry, not flat sprites",
    );
  }
  assert.equal(triangles, manifest.triangles);
  assert.ok(triangles > 30000);
  for (const image of glb.json.images ?? []) {
    assert.ok(image.bufferView !== undefined);
    assert.ok(["image/png", "image/jpeg"].includes(image.mimeType!));
  }
});
