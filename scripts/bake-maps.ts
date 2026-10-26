import sharp from "sharp";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import config from "../content/map-config.json";
import { project, type SceneMap, type WorldMap } from "../src/shared/world.ts";
import { getFeature, pathData, type Sources } from "./source-geometry.ts";
import { loadGlb, renderModel, primitives, campusPlacement } from "./gltf.ts";

export function terrainSvg(scene: SceneMap): string {
  const indoor = scene.id !== "campus_core",
    w = scene.width * 16,
    h = scene.height * 16;
  const order = indoor
    ? ["floor", "room", "water", "detail", "wall"]
    : ["road", "garden", "water", "crosswalk", "floor"];
  const body = order
    .map((kind) =>
      scene.surfaces
        .filter((s) => s.kind === kind)
        .map((s) =>
          s.line
            ? `<polyline points="${s.line.map((p) => `${p.x},${p.y}`).join(" ")}" fill="none" stroke="${s.color}" stroke-width="${s.strokeWidth}" stroke-linejoin="round" stroke-linecap="round"/>`
            : `<path d="${pathData(s.polygons)}" fill="${s.color}" fill-rule="evenodd" stroke="${kind === "wall" ? "#878d7e" : kind === "room" ? "#aaa997" : s.color}" stroke-width="${kind === "wall" ? 1.1 : 0.7}"/>`,
        )
        .join(""),
    )
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs><pattern id="paving" width="16" height="16" patternUnits="userSpaceOnUse"><rect width="16" height="16" fill="${indoor ? "#596a5b" : "#d1d2bf"}"/><path d="M0 0H16M0 0V16" stroke="${indoor ? "#5f705e" : "#caceb9"}" stroke-width="0.4"/></pattern></defs><rect width="100%" height="100%" fill="url(#paving)"/>${body}<rect x="2" y="2" width="${w - 4}" height="${h - 4}" fill="none" stroke="#526b50" stroke-width="4"/></svg>`;
}
export async function bakeMaps(
  root: string,
  sources: Sources,
  world: WorldMap,
  offset: { x: number; y: number },
) {
  const files = new Map<string, Uint8Array>(),
    models = [];
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
  return { files, models };
}
