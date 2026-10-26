import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { metricScale, scenePlayer } from "../src/shared/scale.ts";
import { buildWorld } from "../scripts/map-builder.ts";
import config from "../content/map-config.json";

test("Web Mercator calibration uses local ground metres instead of projection units", () => {
  const equator = metricScale(0, 4, 0.55);
  assert.equal(equator.metersPerProjectedUnit, 1);
  assert.equal(equator.pixelsPerMeter, 4);
  const at60 = metricScale(
    6378137 * Math.log(Math.tan(Math.PI / 4 + Math.PI / 6)),
    4,
    0.55,
  );
  assert.ok(Math.abs(at60.referenceLatitudeDegrees - 60) < 1e-10);
  assert.ok(Math.abs(at60.pixelsPerMeter - 8) < 1e-10);
  const campus = metricScale(2618750, 4, 0.55);
  assert.ok(Math.abs(campus.referenceLatitudeDegrees - 22.8902366235) < 1e-8);
  assert.ok(Math.abs(campus.pixelsPerMeter - 4.3419187173) < 1e-8);
});
test("human display, speed, reach and foot size all represent the same metres indoors and outdoors", () => {
  const outside = metricScale(2618750, 4, 0.55),
    inside = metricScale(2618750, 6, 0.55);
  const a = scenePlayer(outside, config.human),
    b = scenePlayer(inside, config.human);
  for (const key of [
    "width",
    "height",
    "radius",
    "speed",
    "runSpeed",
    "interactionRadius",
  ] as const)
    assert.ok(Math.abs(b[key] / a[key] - 1.5) < 1e-10);
  assert.ok(Math.abs(a.width / outside.pixelsPerMeter - 0.5) < 1e-10);
  assert.ok(
    Math.abs(
      (a.height - a.groundDepth) /
        outside.pixelsPerMeter /
        outside.heightProjection -
        1.75,
    ) < 1e-10,
  );
  assert.ok(Math.abs(a.speed / outside.pixelsPerMeter - 2.8) < 1e-10);
  assert.ok(Math.abs(a.runSpeed / outside.pixelsPerMeter - 5.6) < 1e-10);
  assert.equal(a.runSpeed / a.speed, 2);
  assert.ok(
    Math.abs(a.interactionRadius / outside.pixelsPerMeter - 1.5) < 1e-10,
  );
  assert.ok(a.height < 6 && b.height < 9); // reject the previous 32px giant, including minimum-size clamps
});
test("every generated scene carries physical player calibration and auditable map extents", () => {
  const bytes = readFileSync(
      new URL("../data/maps/all-maps.json", import.meta.url),
    ),
    { world, report } = buildWorld(JSON.parse(bytes.toString()), bytes);
  for (const s of world.scenes) {
    assert.deepEqual(s.player, scenePlayer(s.units, world.human));
    assert.equal(
      s.units.pixelsPerProjectedUnit,
      s.id === "campus_core" ? 4 : 6,
    );
    assert.ok(s.player.radius < 2);
    const audit = report.scaleAudit.scenes.find((a) => a.id === s.id)!;
    assert.ok(
      Math.abs(audit.widthMeters - (s.width * 16) / s.units.pixelsPerMeter) <
        1e-10,
    );
  }
  const outside = report.scaleAudit.scenes[0];
  assert.ok(outside.widthMeters > 410 && outside.widthMeters < 420);
  assert.ok(outside.heightMeters > 400 && outside.heightMeters < 405);
});
