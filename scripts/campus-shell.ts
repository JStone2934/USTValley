import { stampLandmarkFeet } from "./landmark-collision.ts";
import { exteriorRecess } from "../src/shared/campus-shell.ts";
import { exteriorOpening } from "./exterior-entrances.ts";
import type { Point, SceneMap } from "../src/shared/world.ts";
import { bounds, inPolygon, type SourceMap } from "./source-geometry.ts";

type Sill = {
  outer: Point;
  towardInterior: Point;
  outerGlass?: { jambA: Point; jambB: Point; sourceId: number };
};

/** The campus and F1 are separate walkable spaces. Seal the actual ground-floor
 * volumes in the campus scene, leaving the recess just deep enough to reach each
 * surveyed sill. Upper roofs and overhanging bridges do not define the footprint. */
export function sealCampusBuildings(
  scene: SceneMap,
  sills: Sill[],
  source: SourceMap,
  convert: (v: number[]) => Point,
) {
  const width = scene.width * scene.tileSize,
    height = scene.height * scene.tileSize,
    grid = scene.collisionSize,
    ppm = scene.units.pixelsPerMeter;
  const blocks = new Uint8Array(width * height);
  for (const roof of scene.art.roofs)
    for (const polygon of roof.footprint) {
      const b = bounds(polygon.flat());
      for (
        let y = Math.max(0, Math.floor(b.y));
        y < Math.min(height, Math.ceil(b.y + b.height));
        y++
      )
        for (
          let x = Math.max(0, Math.floor(b.x));
          x < Math.min(width, Math.ceil(b.x + b.width));
          x++
        )
          if (inPolygon({ x: x + 0.5, y: y + 0.5 }, polygon))
            blocks[y * width + x] = 1;
    }
  for (const sill of sills) {
    const {
      threshold: center,
      toward: normal,
      width: opening,
    } = exteriorOpening(
      scene,
      sill.outer,
      sill.towardInterior,
      sill.outerGlass,
    );
    // Some survey markers sit just inside the traced F1 floor. Connect only
    // this door width to the approach, with a solid stop immediately behind it.
    const { front, back } = exteriorRecess(ppm);
    const span = Math.ceil(front + opening / 2);
    for (
      let y = Math.max(0, Math.floor(center.y - span));
      y < Math.min(height, center.y + span);
      y++
    )
      for (
        let x = Math.max(0, Math.floor(center.x - span));
        x < Math.min(width, center.x + span);
        x++
      ) {
        const dx = x + 0.5 - center.x,
          dy = y + 0.5 - center.y,
          depth = dx * normal.x + dy * normal.y,
          side = dy * normal.x - dx * normal.y;
        if (depth >= -front && depth <= back && Math.abs(side) <= opening / 2)
          blocks[y * width + x] = 0;
      }
  }
  stampLandmarkFeet(blocks, scene, source, convert);
  // A fully covered structural cell is solid. Partly covered cells retain their
  // individual pixels so the foot can follow a diagonal facade to its doorway.
  const runs = [...(scene.fixtureCollision?.runs ?? [])];
  const coverage = new Uint8Array(scene.collision.length);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; ) {
      if (!blocks[y * width + x]) {
        x++;
        continue;
      }
      const start = x;
      while (x < width && blocks[y * width + x]) {
        const i = Math.floor(y / grid) * (width / grid) + Math.floor(x / grid);
        if (++coverage[i] === grid * grid) scene.collision[i] = 1;
        x++;
      }
      runs.push(y, start, x - start);
    }
  scene.fixtureCollision = {
    sourceIds: scene.fixtureCollision?.sourceIds ?? [],
    runs,
  };
}
