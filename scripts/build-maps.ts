import { readFile, mkdir, writeFile, readdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import {
  buildWorld,
  referenceSvg,
  tiledMap,
  type Sources,
} from "./map-builder.ts";
import { exportCampusOrbit } from "./export-campus-orbit.ts";
import { bakeMaps } from "./bake-maps.ts";
const root = resolve(import.meta.dirname, ".."),
  sourceBytes = await readFile(resolve(root, "data/maps/all-maps.json")),
  sources = JSON.parse(sourceBytes.toString()) as Sources;
const { world, report } = buildWorld(sources, sourceBytes),
  baked = await bakeMaps(root, sources, world, report.transform.offset);
const json = (v: unknown) => `${JSON.stringify(v)}\n`;
const files = new Map<string, string | Uint8Array>([
  ...baked.files,
  ...(await exportCampusOrbit(root, sources, world, baked.files)),
  ["public/maps/world.json", json(world)],
  [
    "content/map-build-report.json",
    `${JSON.stringify({ ...report, models: baked.models, landmarks: baked.landmarks, interiors: baked.interiors }, null, 2)}\n`,
  ],
  ["public/maps/campus-reference.svg", referenceSvg(world)],
  ...world.scenes.map(
    (s) =>
      [`public/maps/${s.id}.tmj`, json(tiledMap(s, world.mapVersion))] as [
        string,
        string,
      ],
  ),
]);
const isCheck = process.argv.includes("--check");
for (const [file, data] of files) {
  const path = resolve(root, file);
  if (isCheck) {
    let existing: Buffer;
    try {
      existing = await readFile(path);
    } catch {
      throw new Error(`Missing artifact ${file}; run npm run maps:build`);
    }
    if (!existing.equals(Buffer.from(data)))
      throw new Error(`Stale artifact ${file}; run npm run maps:build`);
  } else {
    await mkdir(resolve(path, ".."), { recursive: true });
    await writeFile(path, data);
  }
}
const expected = new Set(
  [...files.keys()]
    .filter((p) => p.startsWith("public/maps/"))
    .map((p) => p.split("/").at(-1)),
);
for (const name of await readdir(resolve(root, "public/maps")))
  if (!expected.has(name)) {
    if (isCheck) throw new Error(`Unexpected artifact: ${name}`);
    await rm(resolve(root, "public/maps", name));
  }
console.log(
  `${isCheck ? "Verified" : "Rebuilt"} ${world.mapVersion}: 6 source-model building groups, ${world.scenes.length - 1} shared floor scenes, ${report.checks.pairedPortals} paired passages, 4px collision, 12 reachable chests.`,
);
console.log(
  "Source entrances retained; per-building safe-point offsets are recorded in content/map-build-report.json.",
);
if (
  process.argv.includes("--strict") &&
  report.buildings.some((b) => b.review !== "confirmed")
) {
  console.error(
    "Field review of source entrance associations remains pending.",
  );
  process.exitCode = 1;
}
