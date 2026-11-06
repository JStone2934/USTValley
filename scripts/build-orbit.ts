import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { exportCampusOrbit } from "./export-campus-orbit.ts";
const root = resolve(import.meta.dirname, "..");
const sources = JSON.parse(
  await readFile(resolve(root, "data/maps/all-maps.json"), "utf8"),
);
const world = JSON.parse(
  await readFile(resolve(root, "public/maps/world.json"), "utf8"),
);
for (const [file, data] of await exportCampusOrbit(root, sources, world)) {
  await mkdir(resolve(root, file, ".."), { recursive: true });
  await writeFile(resolve(root, file), data);
  console.log(file, data.length);
}
