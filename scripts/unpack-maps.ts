import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { resolve, basename } from "node:path";
import { createHash } from "node:crypto";
import { loadGlb, primitives } from "./gltf.ts";
import { layers, type Sources } from "./source-geometry.ts";
const root = resolve(import.meta.dirname, ".."),
  input = resolve(root, "data/maps"),
  output = resolve(root, "data/unpacked");
const sources = JSON.parse(
  await readFile(resolve(input, "all-maps.json"), "utf8"),
) as Sources;
await mkdir(output, { recursive: true });
const manifest = JSON.parse(
  await readFile(resolve(input, "download-manifest.json"), "utf8"),
) as { file: string; sha256: string; bytes: number }[];
for (const entry of manifest) {
  const local = entry.file.replace(/^res\/projects\//, "");
  const bytes = await readFile(resolve(input, local));
  if (
    bytes.length !== entry.bytes ||
    createHash("sha256").update(bytes).digest("hex") !== entry.sha256
  )
    throw new Error(`Source hash mismatch: ${entry.file}`);
}
const maps = [];
for (const [code, source] of Object.entries(sources)) {
  const floors = [];
  for (const floor of Object.keys(source.map.mapdata)) {
    const inventory = [];
    const folder = resolve(output, "maps", code, floor);
    await mkdir(folder, { recursive: true });
    for (const [id, layer] of Object.entries(source.map.mapdata[floor])) {
      const fs = layer.data?.features ?? [];
      inventory.push({
        id,
        name: layer.name,
        type: layer.type,
        features: fs.length,
        style: layer.layerStyle,
        geometryTypes: [...new Set(fs.map((f) => f.geometry.type))],
      });
      await writeFile(
        resolve(folder, `${id}.geojson`),
        JSON.stringify(
          { type: "FeatureCollection", name: layer.name, features: fs },
          null,
          2,
        ),
      );
    }
    floors.push({ floor, layers: inventory });
  }
  maps.push({ code, mversion: source.map.mversion, floors });
}
const models = [];
const folder = resolve(input, "xgkdgz_all/mapres");
for (const filename of (await readdir(folder))
  .filter((f) => f.endsWith(".glb"))
  .sort()) {
  const glb = await loadGlb(resolve(folder, filename)),
    parts = primitives(glb),
    vertices = parts.flatMap((p) => p.vertices);
  const path = resolve(output, "models", basename(filename, ".glb"));
  await mkdir(path, { recursive: true });
  const json = structuredClone(glb.json);
  json.buffers[0].uri = "buffer.bin";
  for (let i = 0; i < (json.images?.length ?? 0); i++) {
    const image = json.images![i],
      view = glb.json.bufferViews[image.bufferView!],
      file = `image-${i}.${image.mimeType === "image/png" ? "png" : "jpg"}`;
    await writeFile(
      resolve(path, file),
      glb.binary.subarray(
        view.byteOffset ?? 0,
        (view.byteOffset ?? 0) + view.byteLength,
      ),
    );
    image.uri = file;
    delete image.bufferView;
  }
  await writeFile(resolve(path, "scene.gltf"), JSON.stringify(json, null, 2));
  await writeFile(resolve(path, "buffer.bin"), glb.binary);
  models.push({
    file: filename,
    sha256: createHash("sha256").update(glb.bytes).digest("hex"),
    nodes: glb.json.nodes.map((n) => ({
      name: n.name,
      mesh: n.mesh,
      matrix: n.matrix,
      translation: n.translation,
      rotation: n.rotation,
      scale: n.scale,
    })),
    meshes: glb.json.meshes.length,
    primitives: parts.length,
    triangles: parts.reduce((n, p) => n + p.indices.length / 3, 0),
    embeddedImages: glb.json.images?.length ?? 0,
    localBounds: {
      min: [0, 1, 2].map((i) => Math.min(...vertices.map((v) => v[i]))),
      max: [0, 1, 2].map((i) => Math.max(...vertices.map((v) => v[i]))),
    },
    materials: glb.json.materials?.map((m) => ({
      name: m.name,
      alphaMode: m.alphaMode,
      baseColor: m.pbrMetallicRoughness?.baseColorFactor,
      texture: m.pbrMetallicRoughness?.baseColorTexture?.index,
    })),
  });
}
const report = {
  version: 1,
  sourceManifestVerified: manifest.length,
  mapCount: maps.length,
  modelCount: models.length,
  maps,
  models,
  binaryEnvelope: {
    file: "xgkdgz_all/h4bjun8x.bin",
    sha256: manifest.find((e) => e.file.endsWith(".bin"))!.sha256,
    note: "保留原始封装与校验。本次几何解包以已有解析 all-maps.json 为输入；不声称重新解码未知封装。",
  },
  geometryConvention:
    "GLB 按节点层级 T*R*S，地图列主序 tarray 放置XY；本批模型局部XY为地面、Z为高度。烘焙时按源height恢复归一化模型的世界高度，详见构建报告。",
};
await writeFile(
  resolve(output, "inventory.json"),
  JSON.stringify(report, null, 2),
);
console.log(
  `Verified ${manifest.length} source assets; unpacked ${maps.length} maps, ${models.length} GLBs, ${models.reduce((n, m) => n + m.triangles, 0)} placed triangles.`,
);
