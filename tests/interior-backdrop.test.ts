import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import sharp from "sharp";
import {
  campusInInterior,
  exteriorPlacement,
} from "../scripts/interior-backdrop";
import type { WorldMap } from "../src/shared/world";
const w: WorldMap = JSON.parse(
  readFileSync(new URL("../public/maps/world.json", import.meta.url), "utf8"),
);
test("exterior scenery stays aligned to source coordinates and lowers with floor elevation", () => {
  const campus = w.scenes[0];
  for (const s of w.scenes.slice(1)) {
    const ratio =
      s.units.pixelsPerProjectedUnit / campus.units.pixelsPerProjectedUnit;
    const p = { x: campus.sourceOffset.x + 80, y: campus.sourceOffset.y + 120 };
    const mapped = campusInInterior(campus, s, p),
      t = exteriorPlacement(campus, s);
    assert.ok(Math.abs(mapped.x - (s.sourceOffset.x + 80 * ratio)) < 1e-7);
    const height =
      s.floor.elevation *
      s.units.pixelsPerProjectedUnit *
      s.units.heightProjection;
    assert.ok(
      Math.abs(mapped.y - (s.sourceOffset.y + 120 * ratio + height)) < 1e-7,
    );
    assert.equal(t.scale, 1.5);
  }
});
test("all 33 indoor floors have a varied outdoor backdrop instead of the former dark void", async () => {
  for (const s of w.scenes.slice(1)) {
    const layer = s.art.layers.find((l) => l.id === "base")!;
    assert.ok(layer, `${s.id} base layer`);
    const { data, info } = await sharp(
      new URL("../public/maps/" + layer.image, import.meta.url).pathname,
    )
      .resize(96, 96, { fit: "fill" })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const colors = new Set<string>();
    let darkVoid = 0;
    for (let i = 0; i < data.length; i += 4) {
      colors.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
      assert.equal(data[i + 3], 255);
      if (data[i] === 65 && data[i + 1] === 79 && data[i + 2] === 82)
        darkVoid++;
    }
    assert.ok(colors.size > 100, `${s.id} should show textured campus scenery`);
    assert.ok(darkVoid < info.width * info.height * 0.01);
  }
});
