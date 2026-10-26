import { readFile } from "node:fs/promises";
import sharp from "sharp";

export type Vec3 = [number, number, number];
export type Matrix = number[];
type Accessor = {
  bufferView?: number;
  byteOffset?: number;
  componentType: number;
  count: number;
  type: string;
  normalized?: boolean;
  sparse?: unknown;
};
export type Gltf = {
  asset: Record<string, unknown>;
  scene?: number;
  scenes: { nodes: number[] }[];
  nodes: {
    name?: string;
    mesh?: number;
    children?: number[];
    matrix?: number[];
    translation?: number[];
    rotation?: number[];
    scale?: number[];
  }[];
  meshes: {
    name?: string;
    primitives: {
      attributes: Record<string, number>;
      indices?: number;
      material?: number;
      mode?: number;
    }[];
  }[];
  accessors: Accessor[];
  bufferViews: {
    buffer: number;
    byteOffset?: number;
    byteLength: number;
    byteStride?: number;
  }[];
  buffers: { byteLength: number; uri?: string }[];
  materials?: {
    name?: string;
    alphaMode?: string;
    pbrMetallicRoughness?: {
      baseColorFactor?: number[];
      baseColorTexture?: { index: number };
    };
  }[];
  textures?: { source: number }[];
  images?: { bufferView?: number; mimeType?: string; uri?: string }[];
  extensionsRequired?: string[];
};
export type Glb = { json: Gltf; binary: Buffer; bytes: Buffer };
export const identity = (): Matrix => [
  1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1,
];
export function multiply(a: Matrix, b: Matrix): Matrix {
  return Array.from({ length: 16 }, (_, i) => {
    const row = i % 4,
      col = Math.floor(i / 4);
    return [0, 1, 2, 3].reduce(
      (sum, k) => sum + a[k * 4 + row] * b[col * 4 + k],
      0,
    );
  });
}
export function transformPoint(m: Matrix, v: number[]): Vec3 {
  return [0, 1, 2].map(
    (i) => m[i] * v[0] + m[i + 4] * v[1] + m[i + 8] * v[2] + m[i + 12],
  ) as Vec3;
}
export function nodeMatrix(node: Gltf["nodes"][number]): Matrix {
  if (node.matrix) return node.matrix;
  const [x, y, z, w] = node.rotation ?? [0, 0, 0, 1],
    [sx, sy, sz] = node.scale ?? [1, 1, 1],
    [tx, ty, tz] = node.translation ?? [0, 0, 0];
  return [
    (1 - 2 * (y * y + z * z)) * sx,
    2 * (x * y + z * w) * sx,
    2 * (x * z - y * w) * sx,
    0,
    2 * (x * y - z * w) * sy,
    (1 - 2 * (x * x + z * z)) * sy,
    2 * (y * z + x * w) * sy,
    0,
    2 * (x * z + y * w) * sz,
    2 * (y * z - x * w) * sz,
    (1 - 2 * (x * x + y * y)) * sz,
    0,
    tx,
    ty,
    tz,
    1,
  ];
}
export function parseGlb(bytes: Buffer): Glb {
  if (
    bytes.length < 20 ||
    bytes.toString("ascii", 0, 4) !== "glTF" ||
    bytes.readUInt32LE(4) !== 2 ||
    bytes.readUInt32LE(8) !== bytes.length
  )
    throw new Error("Invalid GLB header");
  let json: Gltf | undefined, binary: Buffer | undefined;
  for (let offset = 12; offset < bytes.length; ) {
    const length = bytes.readUInt32LE(offset),
      type = bytes.readUInt32LE(offset + 4);
    if (offset + 8 + length > bytes.length)
      throw new Error("Truncated GLB chunk");
    const chunk = bytes.subarray(offset + 8, offset + 8 + length);
    if (type === 0x4e4f534a) json = JSON.parse(chunk.toString("utf8").trim());
    if (type === 0x004e4942) binary = chunk;
    offset += 8 + length;
  }
  if (!json || !binary)
    throw new Error("GLB must contain JSON and binary chunks");
  if (json.extensionsRequired?.length)
    throw new Error(
      `Unsupported required GLB extensions: ${json.extensionsRequired}`,
    );
  if (json.buffers.some((b) => b.uri))
    throw new Error("External GLB buffers are not allowed");
  return { json, binary, bytes };
}
export const loadGlb = async (path: string) => parseGlb(await readFile(path));
export function campusPlacement(
  glb: Glb,
  source: Matrix,
  declaredHeight: number,
): Matrix {
  const vertices = primitives(glb).flatMap((p) => p.vertices),
    minimum = Math.min(...vertices.map((v) => v[2])),
    maximum = Math.max(...vertices.map((v) => v[2]));
  if (!(declaredHeight > 0) || maximum <= minimum)
    throw new Error("Invalid source model height");
  // The campus wrapper stores the intended world height separately from its XY tarray.
  // E.g. C1 is normalized to 1.475 local units but declared 38.637 projected units high.
  const placed = [...source];
  placed[10] = declaredHeight / (maximum - minimum);
  placed[14] = (source[14] ?? 0) - minimum * placed[10];
  return placed;
}
export function accessor(glb: Glb, index: number): number[][] {
  const a = glb.json.accessors[index];
  if (!a || a.sparse || a.bufferView === undefined)
    throw new Error(`Unsupported accessor ${index}`);
  const view = glb.json.bufferViews[a.bufferView],
    sizes: Record<number, number> = {
      5120: 1,
      5121: 1,
      5122: 2,
      5123: 2,
      5125: 4,
      5126: 4,
    };
  const widths: Record<string, number> = {
    SCALAR: 1,
    VEC2: 2,
    VEC3: 3,
    VEC4: 4,
    MAT4: 16,
  };
  const size = sizes[a.componentType],
    width = widths[a.type],
    stride = view.byteStride ?? width * size;
  if (!size || !width || view.buffer !== 0)
    throw new Error("Unsupported accessor type");
  const start = (view.byteOffset ?? 0) + (a.byteOffset ?? 0);
  if (
    start + (a.count - 1) * stride + width * size >
    (view.byteOffset ?? 0) + view.byteLength
  )
    throw new Error("Accessor exceeds buffer view");
  const read = (offset: number) => {
    switch (a.componentType) {
      case 5126:
        return glb.binary.readFloatLE(offset);
      case 5125:
        return glb.binary.readUInt32LE(offset);
      case 5123:
        return glb.binary.readUInt16LE(offset);
      case 5122:
        return glb.binary.readInt16LE(offset);
      case 5121:
        return glb.binary.readUInt8(offset);
      case 5120:
        return glb.binary.readInt8(offset);
      default:
        throw new Error("Unsupported component");
    }
  };
  return Array.from({ length: a.count }, (_, i) =>
    Array.from({ length: width }, (_, j) => {
      const value = read(start + i * stride + j * size);
      if (!a.normalized || a.componentType === 5126) return value;
      const signed = a.componentType === 5120 || a.componentType === 5122;
      return signed
        ? Math.max(-1, value / (2 ** (size * 8 - 1) - 1))
        : value / (2 ** (size * 8) - 1);
    }),
  );
}
type Texture = { data: Buffer; width: number; height: number };
export type Primitive = {
  node: string;
  vertices: Vec3[];
  uv: number[][];
  indices: number[];
  material: number;
};
export function primitives(glb: Glb, placement = identity()): Primitive[] {
  const result: Primitive[] = [],
    visited = new Set<number>();
  const walk = (id: number, parent: Matrix) => {
    if (visited.has(id)) throw new Error("Cyclic or multiply parented node");
    visited.add(id);
    const node = glb.json.nodes[id],
      matrix = multiply(parent, nodeMatrix(node));
    if (node.mesh !== undefined)
      for (const p of glb.json.meshes[node.mesh].primitives) {
        if ((p.mode ?? 4) !== 4)
          throw new Error("Only triangle GLB primitives are supported");
        const positions = accessor(glb, p.attributes.POSITION);
        const indices =
          p.indices === undefined
            ? positions.map((_, i) => i)
            : accessor(glb, p.indices).map((v) => v[0]);
        if (indices.some((i) => i >= positions.length) || indices.length % 3)
          throw new Error("Invalid triangle indices");
        result.push({
          node: node.name ?? String(id),
          vertices: positions.map((p) => transformPoint(matrix, p)),
          uv:
            p.attributes.TEXCOORD_0 === undefined
              ? positions.map(() => [0, 0])
              : accessor(glb, p.attributes.TEXCOORD_0),
          indices,
          material: p.material ?? -1,
        });
      }
    for (const child of node.children ?? []) walk(child, matrix);
  };
  for (const node of glb.json.scenes[glb.json.scene ?? 0].nodes)
    walk(node, placement);
  return result;
}
export async function textures(glb: Glb): Promise<Texture[]> {
  return Promise.all(
    (glb.json.images ?? []).map(async (image) => {
      if (image.uri || image.bufferView === undefined)
        throw new Error("Only embedded image buffer views are supported");
      const view = glb.json.bufferViews[image.bufferView];
      const data = glb.binary.subarray(
        view.byteOffset ?? 0,
        (view.byteOffset ?? 0) + view.byteLength,
      );
      const raw = await sharp(data)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      return { data: raw.data, width: raw.info.width, height: raw.info.height };
    }),
  );
}

/** Deterministic orthographic z-buffer bake; the campus exporter uses Z as height. */
export async function renderModel(
  glb: Glb,
  placement: Matrix,
  project: (v: number[]) => { x: number; y: number },
  scale: number,
  rise = 0.55,
) {
  const parts = primitives(glb, placement),
    images = await textures(glb);
  const projected = parts.map((p) =>
    p.vertices.map((v) => {
      const q = project(v);
      return {
        x: q.x,
        y: q.y - v[2] * scale * rise,
        depth: v[2] * scale + q.y * rise,
      };
    }),
  );
  const all = projected.flat(),
    x = Math.floor(Math.min(...all.map((p) => p.x))) - 2,
    y = Math.floor(Math.min(...all.map((p) => p.y))) - 2;
  const width = Math.ceil(Math.max(...all.map((p) => p.x))) - x + 3,
    height = Math.ceil(Math.max(...all.map((p) => p.y))) - y + 3;
  const rgba = Buffer.alloc(width * height * 4),
    depth = new Float32Array(width * height).fill(-Infinity);
  let triangleCount = 0;
  parts.forEach((part, pi) => {
    const material = glb.json.materials?.[part.material],
      pbr = material?.pbrMetallicRoughness;
    const textureIndex = pbr?.baseColorTexture?.index,
      texture =
        textureIndex === undefined
          ? undefined
          : images[glb.json.textures![textureIndex].source];
    const factor = pbr?.baseColorFactor ?? [1, 1, 1, 1];
    for (let i = 0; i < part.indices.length; i += 3) {
      const ids = part.indices.slice(i, i + 3),
        [a, b, c] = ids.map((id) => projected[pi][id]);
      const area = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
      if (Math.abs(area) < 0.03) continue;
      triangleCount++;
      const [v0, v1, v2] = ids.map((id) => part.vertices[id]);
      const u = v1.map((n, j) => n - v0[j]),
        v = v2.map((n, j) => n - v0[j]);
      const normal = [
          u[1] * v[2] - u[2] * v[1],
          u[2] * v[0] - u[0] * v[2],
          u[0] * v[1] - u[1] * v[0],
        ],
        len = Math.hypot(...normal) || 1;
      const light =
        0.76 +
        0.24 *
          Math.abs(
            (-0.4 * normal[0] + 0.3 * normal[1] + 0.86 * normal[2]) / len,
          );
      const minX = Math.max(0, Math.floor(Math.min(a.x, b.x, c.x)) - x),
        maxX = Math.min(width - 1, Math.ceil(Math.max(a.x, b.x, c.x)) - x);
      const minY = Math.max(0, Math.floor(Math.min(a.y, b.y, c.y)) - y),
        maxY = Math.min(height - 1, Math.ceil(Math.max(a.y, b.y, c.y)) - y);
      for (let py = minY; py <= maxY; py++)
        for (let px = minX; px <= maxX; px++) {
          const sx = px + x + 0.5,
            sy = py + y + 0.5;
          const wb =
            ((sx - a.x) * (c.y - a.y) - (sy - a.y) * (c.x - a.x)) / area;
          const wc =
              ((b.x - a.x) * (sy - a.y) - (b.y - a.y) * (sx - a.x)) / area,
            wa = 1 - wb - wc;
          if (wa < -1e-6 || wb < -1e-6 || wc < -1e-6) continue;
          const z = wa * a.depth + wb * b.depth + wc * c.depth,
            index = py * width + px;
          if (z < depth[index] - 0.0001) continue;
          const uv = [0, 1].map(
            (j) =>
              wa * part.uv[ids[0]][j] +
              wb * part.uv[ids[1]][j] +
              wc * part.uv[ids[2]][j],
          );
          const tx = texture
            ? Math.min(
                texture.width - 1,
                Math.floor((((uv[0] % 1) + 1) % 1) * texture.width),
              )
            : 0;
          const ty = texture
            ? Math.min(
                texture.height - 1,
                Math.floor((((uv[1] % 1) + 1) % 1) * texture.height),
              )
            : 0;
          const offset = texture ? (ty * texture.width + tx) * 4 : 0,
            alpha = (texture ? texture.data[offset + 3] : 255) * factor[3];
          if (alpha < 100) continue;
          depth[index] = z;
          for (let channel = 0; channel < 3; channel++) {
            const raw =
              (texture ? texture.data[offset + channel] : 220) *
              factor[channel] *
              light;
            // Restrained warm grading, quantized to a small pixel palette.
            rgba[index * 4 + channel] = Math.min(
              248,
              Math.round((raw * 0.9 + [14, 12, 7][channel]) / 8) * 8,
            );
          }
          rgba[index * 4 + 3] = 255;
        }
    }
  });
  // A one-pixel contour makes the low-resolution roof profile readable.
  const copy = Buffer.from(rgba);
  for (let py = 1; py < height - 1; py++)
    for (let px = 1; px < width - 1; px++) {
      const i = py * width + px;
      if (!copy[i * 4 + 3]) continue;
      if ([i - 1, i + 1, i - width, i + width].some((j) => !copy[j * 4 + 3]))
        for (let c = 0; c < 3; c++)
          rgba[i * 4 + c] = Math.round(copy[i * 4 + c] * 0.73);
    }
  return {
    x,
    y,
    width,
    height,
    png: await sharp(rgba, { raw: { width, height, channels: 4 } })
      .png({ compressionLevel: 9 })
      .toBuffer(),
    triangleCount,
    meshParts: parts.length,
    nodes: parts.map((p) => p.node),
  };
}
