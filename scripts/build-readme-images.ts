import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";
import { terrainSvg } from "./bake-maps.ts";
import type { WorldMap } from "../src/shared/world.ts";

const root = resolve(import.meta.dirname, ".."),
  output = resolve(root, "docs/images");
const world = JSON.parse(
  await readFile(resolve(root, "public/maps/world.json"), "utf8"),
) as WorldMap;
await mkdir(output, { recursive: true });
const picture = async (input: string | Buffer, name: string, width: number) => {
  await sharp(input)
    .resize({ width, withoutEnlargement: true, kernel: "nearest" })
    .webp({ lossless: true, effort: 6 })
    .toFile(resolve(output, name));
};
await picture(
  resolve(root, "public/maps/campus-labeled.png"),
  "campus-overview.webp",
  1440,
);
for (const f of [2, 3]) {
  const scene = world.scenes.find((s) => s.id === `interior_academic_f${f}`)!;
  await picture(
    resolve(root, "public/maps", scene.art.ground),
    `academic-f${f}.webp`,
    1000,
  );
  if (f === 2) {
    const svg = terrainSvg(scene)
      .replaceAll("#596a5b", "#e7e9df")
      .replaceAll("#5f705e", "#e2e5da");
    await picture(Buffer.from(svg), "academic-plan.webp", 1000);
  }
}
const crop = async (
  sceneId: string,
  rect: { left: number; top: number; width: number; height: number },
  name: string,
  width: number,
) => {
  const s = world.scenes.find((s) => s.id === sceneId)!,
    ratio = s.art.pixelRatio ?? 1;
  const box = Object.fromEntries(
    Object.entries(rect).map(([k, v]) => [k, Math.round(v * ratio)]),
  ) as typeof rect;
  await sharp(resolve(root, "public/maps", s.art.ground))
    .extract(box)
    .resize({ width, kernel: "nearest" })
    .webp({ lossless: true, effort: 6 })
    .toFile(resolve(output, name));
};
await crop(
  "interior_academic_f2",
  { left: 375, top: 445, width: 110, height: 140 },
  "atrium-glass.webp",
  550,
);
await crop(
  "interior_academic_f2",
  { left: 385, top: 275, width: 110, height: 140 },
  "terrace-detail.webp",
  550,
);
const activity = world.scenes.find((s) => s.id === "interior_c2")!;
await picture(
  resolve(root, "public/maps", activity.art.ground),
  "activity-interior.webp",
  1280,
);
const library = world.scenes.find((s) => s.id === "interior_library_f3")!;
await picture(
  resolve(root, "public/maps", library.art.ground),
  "library-f3.webp",
  1280,
);
// docs/images/README.md also documents maintainer-supplied photo comparisons.
// Keep that provenance document intact when regenerating the eight map images.
console.log("Generated 8 README images from", world.mapVersion);
