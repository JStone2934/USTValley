import { readFile, mkdir, writeFile, readdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";
import { buildWorld } from "./map-builder.ts";
import { reachableWorld } from "../src/shared/world.ts";
import { terrainSvg } from "./bake-maps.ts";
const root = resolve(import.meta.dirname, ".."),
  bytes = await readFile(resolve(root, "data/maps/all-maps.json")),
  { world } = buildWorld(JSON.parse(bytes.toString()), bytes);
const folder = resolve(root, "data/unpacked/previews");
await mkdir(folder, { recursive: true });
const expected = new Set(
  world.scenes.slice(1).flatMap((scene) => {
    const name = scene.art.ground.replace(/\.png$/, "");
    return [`${name}.svg`, `${name}.png`, `collision-${name}.png`];
  }),
);
for (const name of await readdir(folder))
  if (/^(floor-|collision-)/.test(name) && !expected.has(name))
    await rm(resolve(folder, name));
const completed = new Set<string>();
const globalSpace = reachableWorld(world);
for (const scene of world.scenes.slice(1)) {
  if (completed.has(scene.art.ground)) continue;
  completed.add(scene.art.ground);
  const name = scene.art.ground.replace(/\.png$/, ""),
    svg = terrainSvg(scene);
  await writeFile(resolve(folder, `${name}.svg`), svg);
  await writeFile(
    resolve(folder, `${name}.png`),
    await readFile(resolve(root, "public/maps", scene.art.ground)),
  );
  const space = globalSpace.get(scene.id)!,
    w = scene.width * 4,
    h = scene.height * 4,
    mask = Buffer.alloc(w * h * 3);
  for (let i = 0; i < scene.collision.length; i++) {
    const color = scene.collision[i]
      ? [65, 65, 65]
      : space.has(i)
        ? [150, 210, 120]
        : [230, 170, 150];
    color.forEach((v, j) => (mask[i * 3 + j] = v));
  }
  await sharp(mask, { raw: { width: w, height: h, channels: 3 } })
    .resize(scene.width * 16, scene.height * 16, { kernel: "nearest" })
    .png()
    .toFile(resolve(folder, `collision-${name}.png`));
  console.log(
    name,
    `${scene.width}×${scene.height} tiles`,
    `${space.size} reachable cells`,
  );
}
