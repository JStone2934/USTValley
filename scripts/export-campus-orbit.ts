import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";
import { BufferGeometry, Float32BufferAttribute } from "three";
import config from "../content/map-config.json";
import { project, type WorldMap } from "../src/shared/world.ts";
import { getFeature, type Sources } from "./source-geometry.ts";
import { loadGlb, campusPlacement, primitives } from "./gltf.ts";

// Publish only derived local geometry and embedded materials, never source metadata.
export async function exportCampusOrbit(
  root: string,
  sources: Sources,
  world: WorldMap,
  baked?: Map<string, Uint8Array>,
) {
  const campus = world.scenes[0];
  const json: any = {
    asset: { version: "2.0", generator: "USTValley" },
    scene: 0,
    scenes: [{ nodes: [] }],
    nodes: [],
    meshes: [],
    accessors: [],
    bufferViews: [],
    buffers: [],
    materials: [],
    textures: [],
    images: [],
  };
  const chunks: Buffer[] = [];
  let length = 0,
    triangles = 0;
  const view = (data: Buffer) => {
    const index = json.bufferViews.length;
    json.bufferViews.push({
      buffer: 0,
      byteOffset: length,
      byteLength: data.length,
    });
    const padded = Buffer.alloc(Math.ceil(data.length / 4) * 4);
    data.copy(padded);
    chunks.push(padded);
    length += padded.length;
    return index;
  };
  const attribute = (values: number[], width: number, integers = false) => {
    const array = integers ? new Uint32Array(values) : new Float32Array(values);
    const entry: any = {
      bufferView: view(Buffer.from(array.buffer)),
      componentType: integers ? 5125 : 5126,
      count: values.length / width,
      type: ["", "SCALAR", "VEC2", "VEC3"][width],
    };
    if (width === 3) {
      entry.min = [Infinity, Infinity, Infinity];
      entry.max = [-Infinity, -Infinity, -Infinity];
      values.forEach((v, i) => {
        entry.min[i % 3] = Math.min(entry.min[i % 3], v);
        entry.max[i % 3] = Math.max(entry.max[i % 3], v);
      });
    }
    json.accessors.push(entry);
    return json.accessors.length - 1;
  };
  const models = [
    ...config.groups.map((g) => ({ id: g.featureId, name: g.key })),
    ...(campus.art.landmarks ?? []).map((l) => ({
      id: l.id,
      name: `landmark-${l.id}`,
    })),
  ];
  for (const model of models) {
    const f = getFeature(sources.xgkdgz_all, model.id).properties;
    const glb = await loadGlb(
      resolve(root, "data/maps", f.src.replace(/^\/res\/projects\//, "")),
    );
    const textureOffset = json.textures.length,
      materialOffset = json.materials.length;
    for (const texture of glb.json.textures ?? []) {
      const image = glb.json.images![texture.source];
      if (
        image.bufferView === undefined ||
        !["image/png", "image/jpeg"].includes(image.mimeType!)
      )
        throw new Error("Orbit texture must be embedded PNG/JPEG");
      const sourceView = glb.json.bufferViews[image.bufferView];
      const start = sourceView.byteOffset ?? 0;
      json.textures.push({ source: json.images.length });
      json.images.push({
        bufferView: view(
          glb.binary.subarray(start, start + sourceView.byteLength),
        ),
        mimeType: image.mimeType,
      });
    }
    for (const material of glb.json.materials ?? [{}]) {
      const pbr = material.pbrMetallicRoughness;
      json.materials.push({
        doubleSided: true,
        alphaMode: material.alphaMode ?? "OPAQUE",
        pbrMetallicRoughness: {
          baseColorFactor: pbr?.baseColorFactor ?? [0.8, 0.8, 0.75, 1],
          roughnessFactor: 0.85,
          metallicFactor: 0,
          ...(pbr?.baseColorTexture
            ? {
                baseColorTexture: {
                  index: textureOffset + pbr.baseColorTexture.index,
                },
              }
            : {}),
        },
      });
    }
    const meshParts = [];
    for (const part of primitives(
      glb,
      campusPlacement(glb, f.tarray, f.height),
    )) {
      const positions = part.vertices.flatMap((v) => {
        const p = project(v, config.transform);
        return [
          p.x + campus.sourceOffset.x,
          v[2] * config.transform.pixelsPerProjectedUnit,
          p.y + campus.sourceOffset.y,
        ];
      });
      const geometry = new BufferGeometry();
      geometry.setAttribute(
        "position",
        new Float32BufferAttribute(positions, 3),
      );
      geometry.setIndex(part.indices);
      geometry.computeVertexNormals();
      const attributes: Record<string, number> = {
        POSITION: attribute(positions, 3),
        NORMAL: attribute(Array.from(geometry.getAttribute("normal").array), 3),
      };
      if (part.uv.length) attributes.TEXCOORD_0 = attribute(part.uv.flat(), 2);
      meshParts.push({
        attributes,
        indices: attribute(part.indices, 1, true),
        material: materialOffset + Math.max(0, part.material),
      });
      triangles += part.indices.length / 3;
      geometry.dispose();
    }
    json.scenes[0].nodes.push(json.nodes.length);
    json.nodes.push({ name: model.name, mesh: json.meshes.length });
    json.meshes.push({ primitives: meshParts });
  }
  json.buffers.push({ byteLength: length });
  const rawJson = Buffer.from(JSON.stringify(json)),
    jsonChunk = Buffer.alloc(Math.ceil(rawJson.length / 4) * 4, 32);
  rawJson.copy(jsonChunk);
  const header = Buffer.alloc(20);
  header.write("glTF");
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(28 + jsonChunk.length + length, 8);
  header.writeUInt32LE(jsonChunk.length, 12);
  header.writeUInt32LE(0x4e4f534a, 16);
  const binaryHeader = Buffer.alloc(8);
  binaryHeader.writeUInt32LE(length);
  binaryHeader.writeUInt32LE(0x004e4942, 4);
  const glb = Buffer.concat([header, jsonChunk, binaryHeader, ...chunks]);
  const layers = await Promise.all(
    campus.art.layers
      .filter((l) => l.id !== "shadows")
      .map(async (l) => {
        const path = `public/maps/${l.image}`;
        return {
          input: Buffer.from(
            baked?.get(path) ?? (await readFile(resolve(root, path))),
          ),
        };
      }),
  );
  const size = await sharp(layers[0].input).metadata();
  const terrain = await sharp({
    create: {
      width: size.width!,
      height: size.height!,
      channels: 4,
      background: "#cdd8b8",
    },
  })
    .composite(layers)
    .png()
    .toBuffer();
  const texture = await sharp(terrain)
    .resize({
      width: 4096,
      height: 4096,
      fit: "inside",
      withoutEnlargement: true,
    })
    .png()
    .toBuffer();
  return new Map<string, Buffer>([
    ["public/orbit/campus.glb", glb],
    ["public/orbit/terrain.png", texture],
    [
      "public/orbit/manifest.json",
      Buffer.from(
        JSON.stringify({
          version: 1,
          models: models.length,
          triangles,
          width: campus.width * campus.tileSize,
          height: campus.height * campus.tileSize,
        }) + "\n",
      ),
    ],
  ]);
}
