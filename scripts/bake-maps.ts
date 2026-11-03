import sharp from "sharp";
import { createIndoorBaker } from "./indoor-art.ts";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import config from "../content/map-config.json";
import { project, type SceneMap, type WorldMap } from "../src/shared/world.ts";
import { getFeature, pathData, type Sources } from "./source-geometry.ts";
import { loadGlb, renderModel, primitives, campusPlacement } from "./gltf.ts";

export const SURFACE_LAYERS = [
  { id: "floor", kinds: ["floor"] },
  { id: "terrain", kinds: ["road", "garden", "crosswalk"] },
  { id: "rooms", kinds: ["room"] },
  { id: "passages", kinds: ["corridor"] },
  { id: "fixtures", kinds: ["detail", "stairs", "lift", "water"] },
  { id: "walls", kinds: ["wall"] },
] as const;
export function terrainSvg(scene: SceneMap, layer?: string): string {
  const indoor = scene.id !== "campus_core",
    w = scene.width * 16,
    h = scene.height * 16;
  const body = SURFACE_LAYERS.filter((l) => !layer || l.id === layer)
    .map((l) =>
      scene.surfaces
        .filter((s) => (l.kinds as readonly string[]).includes(s.kind))
        .map((s) =>
          s.line
            ? `<polyline points="${s.line.map((p) => `${p.x},${p.y}`).join(" ")}" fill="none" stroke="${s.color}" stroke-width="${s.strokeWidth}" stroke-linejoin="round" stroke-linecap="round"/>`
            : `<path d="${pathData(s.polygons)}" fill="${s.kind === "stairs" ? "url(#steps)" : s.color}" fill-rule="evenodd" stroke="${s.kind === "wall" ? "#878d7e" : s.kind === "room" ? "#aaa997" : s.color}" stroke-width="${s.kind === "wall" ? 1.1 : 0.7}"/>`,
        )
        .join(""),
    )
    .join("");
  const base =
    !layer || layer === "base"
      ? `<rect width="100%" height="100%" fill="url(#paving)"/>`
      : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs><pattern id="paving" width="16" height="16" patternUnits="userSpaceOnUse"><rect width="16" height="16" fill="${indoor ? "#596a5b" : "#d1d2bf"}"/><path d="M0 0H16M0 0V16" stroke="${indoor ? "#5f705e" : "#caceb9"}" stroke-width="0.4"/></pattern><pattern id="steps" width="8" height="5" patternUnits="userSpaceOnUse"><rect width="8" height="5" fill="#acb7b0"/><path d="M0 0H8" stroke="#768c83" stroke-width="1"/></pattern></defs>${base}${body}</svg>`;
}
export async function bakeMaps(
  root: string,
  sources: Sources,
  world: WorldMap,
  offset: { x: number; y: number },
) {
  const files = new Map<string, Uint8Array>(),
    models = [];
  const interiors = [],
    bakeInterior = createIndoorBaker(root, sources);
  const convert = (p: number[]) => {
    const q = project(p, config.transform);
    return { x: q.x + offset.x, y: q.y + offset.y };
  };
  for (const group of config.groups) {
    const f = getFeature(sources.xgkdgz_all, group.featureId),
      path = resolve(
        root,
        "data/maps",
        f.properties.src.replace(/^\/res\/projects\//, ""),
      );
    const glb = await loadGlb(path),
      placement = campusPlacement(
        glb,
        f.properties.tarray,
        f.properties.height,
      ),
      baked = await renderModel(
        glb,
        placement,
        convert,
        config.transform.pixelsPerProjectedUnit,
        config.roofHeightFactor,
      );
    const roof = world.scenes[0].art.roofs.find((r) => r.id === group.key)!;
    Object.assign(roof, {
      x: baked.x,
      y: baked.y,
      width: baked.width,
      height: baked.height,
    });
    files.set(`public/maps/${roof.image}`, baked.png);
    const vertices = primitives(glb, placement).flatMap((p) => p.vertices);
    models.push({
      group: group.key,
      featureId: group.featureId,
      modelSha256: createHash("sha256").update(glb.bytes).digest("hex"),
      triangles: baked.triangleCount,
      meshParts: baked.meshParts,
      nodes: baked.nodes,
      placement,
      declaredHeight: f.properties.height,
      sourceWorldBounds: {
        min: [0, 1, 2].map((i) => Math.min(...vertices.map((v) => v[i]))),
        max: [0, 1, 2].map((i) => Math.max(...vertices.map((v) => v[i]))),
      },
      image: {
        x: baked.x,
        y: baked.y,
        width: baked.width,
        height: baked.height,
      },
      pixelSha256: createHash("sha256").update(baked.png).digest("hex"),
    });
  }
  for (const scene of world.scenes) {
    if (scene.id !== "campus_core") {
      const baked = await bakeInterior(scene);
      interiors.push(baked.report);
      files.set(`public/maps/${scene.art.ground}`, baked.ground);
      for (const layer of scene.art.layers)
        files.set(`public/maps/${layer.image}`, baked.layers.get(layer.id)!);
      continue;
    }
    for (const layer of scene.art.layers) {
      const path = `public/maps/${layer.image}`;
      if (!files.has(path))
        files.set(
          path,
          await sharp(Buffer.from(terrainSvg(scene, layer.id)))
            .png({ compressionLevel: 9 })
            .toBuffer(),
        );
    }
    const path = `public/maps/${scene.art.ground}`;
    if (files.has(path)) continue;
    const image = await sharp(Buffer.from(terrainSvg(scene)))
      .png({ compressionLevel: 9 })
      .toBuffer();
    files.set(path, image);
  }
  const campus = world.scenes[0],
    composite = await sharp(files.get("public/maps/terrain-campus.png")!)
      .ensureAlpha()
      .composite(
        campus.art.roofs.map((r) => ({
          input: Buffer.from(files.get(`public/maps/${r.image}`)!),
          left: r.x,
          top: r.y,
        })),
      )
      .png()
      .toBuffer();
  files.set("public/maps/campus-reconstruction.png", composite);
  const labels = `<svg xmlns="http://www.w3.org/2000/svg" width="${campus.width * 16}" height="${campus.height * 16}">${world.buildings.map((b) => `<g><rect x="${b.label.x - 20}" y="${b.label.y - 18}" width="40" height="30" rx="4" fill="#f9eed6" stroke="#456b55" stroke-width="1.5"/><text x="${b.label.x}" y="${b.label.y + 4}" fill="#2d503c" font-family="sans-serif" font-size="18" text-anchor="middle">${b.id}</text></g>`).join("")}</svg>`;
  files.set(
    "public/maps/campus-labeled.png",
    await sharp(composite)
      .composite([{ input: Buffer.from(labels) }])
      .png()
      .toBuffer(),
  );
  const indoorScenes = world.scenes.filter((s) => s.id !== "campus_core");
  const cellWidth = 252,
    cellHeight = 208,
    columns = 4;
  const cards = [];
  for (let i = 0; i < indoorScenes.length; i++) {
    const scene = indoorScenes[i],
      x = (i % columns) * cellWidth,
      y = Math.floor(i / columns) * cellHeight;
    const thumbnail = await sharp(files.get(`public/maps/${scene.art.ground}`)!)
      .resize(cellWidth - 16, cellHeight - 38, {
        fit: "contain",
        background: "#596a5b",
        kernel: "nearest",
      })
      .png()
      .toBuffer();
    const label = `${scene.id.replace("interior_", "").toUpperCase()} / ${scene.floor.name}`;
    const title = Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${cellWidth}" height="24"><text x="8" y="17" font-family="sans-serif" font-size="12" fill="#e8e4d4">${label}</text></svg>`,
    );
    cards.push(
      { input: title, left: x, top: y },
      { input: thumbnail, left: x + 8, top: y + 28 },
    );
  }
  files.set(
    "public/maps/interior-catalog.png",
    await sharp({
      create: {
        width: columns * cellWidth,
        height: Math.ceil(indoorScenes.length / columns) * cellHeight,
        channels: 4,
        background: "#46594c",
      },
    })
      .composite(cards)
      .png({ compressionLevel: 9 })
      .toBuffer(),
  );
  return { files, models, interiors };
}
