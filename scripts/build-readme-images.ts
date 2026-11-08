import { mkdir, readFile, writeFile } from "node:fs/promises";
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
await writeFile(
  resolve(output, "README.md"),
  `# README 展示图\n\n图片由 \`scripts/build-readme-images.ts\` 从当前地图产物生成，用于项目首页展示。\n\n- 全景、楼层与细节图：对应 \`public/maps/\` 的已烘焙地图，仅缩放或裁切。\n- \`academic-plan.webp\`：从同一楼层保留的源几何重新绘制的平面示意，并非校园地图网站截图。\n- 未嵌入用户提供的实景照片。实景对照来源见 [校园实景与地图物件对照](../campus-photo-references.md)。\n\n更新地图后，在仓库根目录运行 \`npx tsx scripts/build-readme-images.ts\` 同步这些展示图。\n`,
);
console.log("Generated 8 README images from", world.mapVersion);
