import sharp from "sharp";
import { finishHubBridge } from "./hub-bridge-finish.ts";
import type { SceneMap, Surface } from "../src/shared/world.ts";
import { pathData } from "./source-geometry.ts";

const rect = (x: number, y: number, w: number, h: number, color: string) =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${color}"/>`;
function pattern(
  id: string,
  w: number,
  h: number,
  color: string,
  marks: string,
) {
  return `<pattern id="${id}" patternUnits="userSpaceOnUse" patternTransform="scale(${id === "asphalt" ? 0.4 : id === "pond" ? 0.8 : id === "lawn" ? 0.52 : 0.48})" width="${w}" height="${h}">${rect(0, 0, w, h, color)}${marks}</pattern>`;
}

// A little patch of lawn repeats at roughly thirty metres. Draw clusters rather than
// independent noisy pixels so tufts still have a lit blade and a shaded base at 4×.
function meadow() {
  let seed = 137;
  const pick = (range: number) => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return Math.floor((seed / 4294967296) * range);
  };
  const marks: string[] = [];
  for (let i = 0; i < 24; i++) {
    const x = pick(116),
      y = pick(124),
      tone = i % 2 ? "#9cbc71" : "#86ad62";
    marks.push(
      rect(x + 2, y, 7, 1, tone),
      rect(x, y + 1, 12, 2, tone),
      rect(x + 3, y + 3, 11, 1, tone),
    );
  }
  for (let row = 0; row < 13; row++) {
    for (let col = 0; col < 13; col++) {
      const x = col * 10 + pick(7),
        y = row * 10 + pick(7);
      const blade = pick(5);
      if (blade < 2) {
        marks.push(
          rect(x, y, 4, 1, "#92b66a"),
          rect(x + 1, y - 1, 2, 1, "#92b66a"),
        );
      } else {
        marks.push(
          rect(x, y, 3, 1, "#638b4d"),
          rect(x + 2, y - 1, 1, 1, "#638b4d"),
        );
        if (blade === 4) marks.push(rect(x - 1, y - 1, 1, 1, "#c5d88b"));
      }
    }
  }
  for (let i = 0; i < 18; i++) {
    const x = pick(124),
      y = pick(124);
    marks.push(
      rect(x, y, 3, 1, "#688c4d"),
      rect(x, y - 1, 1, 1, "#e3d495"),
      rect(x + 3, y - 2, 1, 1, "#c5cb88"),
      ...(i % 3 === 0
        ? [
            rect(x + 1, y - 2, 1, 2, "#edcfb1"),
            rect(x, y - 1, 3, 1, "#e9b49e"),
            rect(x + 1, y - 1, 1, 1, "#f6dfa0"),
          ]
        : []),
    );
  }
  return pattern("lawn", 130, 130, "#8eae65", marks.join(""));
}

function stonePaving(id: string, tones: string[]) {
  const rows = [
    [0, 12, 26, 39],
    [-6, 6, 21, 36],
    [-2, 9, 24, 37],
    [-8, 5, 18, 32],
  ];
  const marks: string[] = [];
  for (let row = 0; row < rows.length; row++) {
    const joints = rows[row];
    for (let j = 0; j < joints.length; j++) {
      const x = joints[j],
        y = row * 4;
      const length = (joints[j + 1] ?? joints[0] + 48) - x;
      const tone = tones[(row * 3 + j + (row === 2 ? 1 : 0)) % tones.length];
      // Repeat across the pattern boundary so a clipped slab keeps both halves.
      for (const shift of [0, 48]) {
        marks.push(rect(x + shift, y, length - 0.4, 3.6, tone));
        // Tiny top bevels and shaded lower joints give each slab a carved pixel edge.
        marks.push(rect(x + shift + 0.3, y + 0.2, length - 1, 0.3, tones[2]));
        marks.push(
          rect(x + shift + 0.3, y + 3.25, length - 1, 0.25, "#a6a68b"),
        );
        if ((row + j) % 3 === 0)
          marks.push(rect(x + shift + 2, y + 0.6, 2, 0.45, tones[2]));
      }
    }
  }
  return pattern(id, 48, 16, "#a5a98e", marks.join(""));
}

const definitions = [
  meadow(),
  // Between the photographed plaza and C2, granite setts are roughly one footfall
  // wide and several footfalls long. Individual stones vary more than the grout.
  stonePaving("plaza", ["#d4c8a9", "#c7bd9f", "#eadcba", "#aeb39d", "#d8d0b1"]),
  stonePaving("path", ["#e0d2af", "#d2c7a8", "#f0e1be", "#b7bca3", "#ded6b8"]),
  pattern(
    "asphalt",
    29,
    19,
    "#a8a99f",
    rect(3, 4, 2, 1, "#b4b3a6") +
      rect(14, 11, 2, 1, "#9c9e99") +
      rect(24, 1, 1, 1, "#9c9e99"),
  ),
  pattern(
    "pond",
    83,
    49,
    "#448e95",
    '<path fill="#357d88" d="M0 9h13v1h6v1H7v-1H0zM29 31h16v1h5v1H37v-1h-8zM64 21h9v1h-9z"/>' +
      '<path fill="#74bfaf" d="M4 22h5v-1h5v1h-4v1H4zM43 7h8v-1h4v1h-3v1h-9zM66 38h7v-1h5v1h-3v1h-9z"/>' +
      rect(15, 19, 3, 1, "#bee6c6") +
      rect(51, 10, 2, 1, "#bee6c6"),
  ),
  pattern(
    "treads",
    8,
    4,
    "#bec0ae",
    rect(0, 0, 8, 1, "#879a91") + rect(0, 1, 8, 1, "#e0dfc7"),
  ),
].join("");

const material: Record<string, [string, string, number]> = {
  floor: ["#dfd7c4", "#b3b7a3", 1],
  garden: ["url(#lawn)", "#79976c", 2],
  road: ["url(#asphalt)", "#92998e", 2],
  parking: ["#a2a69e", "#e6e4cf", 0.9],
  crosswalk: ["#f6eacb", "#e4dbbc", 0.5],
  room: ["#cdbca2", "#a3a294", 1],
  corridor: ["url(#path)", "#c5b99d", 1],
  water: ["url(#pond)", "#397d80", 3],
  stairs: ["url(#treads)", "#8e9e94", 1],
  lift: ["#9eafb0", "#708987", 1],
  detail: ["#cebd9f", "#b1ac97", 1],
  wall: ["#b3af9b", "#858c82", 1],
};

function draw(s: Surface): string {
  const [fill, edge, width] = material[s.kind];
  if (s.line) {
    const pts = s.line.map((p) => `${p.x},${p.y}`).join(" ");
    const stroke = (ink: string, w: number) =>
      `<polyline points="${pts}" fill="none" stroke="${ink}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"/>`;
    return (
      stroke(edge, (s.strokeWidth ?? 1) + width) +
      stroke(fill, s.strokeWidth ?? 1)
    );
  }
  const d = pathData(s.polygons);
  const body = `<path d="${d}" fill="${fill}" fill-rule="evenodd" stroke="${edge}" stroke-width="${width * 0.6}" stroke-linejoin="round"/>`;
  // The inner bank follows the actual shoreline, including its islands.
  if (s.kind !== "water") return body;
  const clip = `shore-${s.sourceMap}-${s.sourceId}`;
  return `<defs><clipPath id="${clip}"><path d="${d}" clip-rule="evenodd"/></clipPath></defs>${body}<g clip-path="url(#${clip})"><path d="${d}" fill="none" stroke="#81b9a5" stroke-width="5"/><path d="${d}" fill="none" stroke="#bccea9" stroke-width="2"/></g>`;
}

export function campusLayerSvg(scene: SceneMap, layer: string) {
  const w = scene.width * scene.tileSize,
    h = scene.height * scene.tileSize;
  const shapes = scene.surfaces;
  const campusNav = (s: Surface) =>
    s.kind === "corridor" && s.sourceMap === scene.sourceMap;
  const kinds: Record<string, string[]> = {
    floor: ["floor"],
    terrain: ["road", "garden", "parking", "crosswalk"],
    rooms: ["room"],
    passages: ["corridor"],
    fixtures: ["water", "detail", "stairs", "lift"],
    walls: ["wall"],
  };
  // The outdoor navigation overlay is broader than the painted paths. Place it
  // below mapped lawns, road markings and water so it cannot erase these features.
  const body =
    layer === "base"
      ? rect(0, 0, w, h, "url(#plaza)") +
        shapes.filter(campusNav).map(draw).join("")
      : (kinds[layer] ?? [])
          .flatMap((k) =>
            shapes.filter((s) => s.kind === k && !campusNav(s)).map(draw),
          )
          .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" shape-rendering="crispEdges"><defs>${definitions}</defs>${body}</svg>`;
}

// Colour ramps keep the GLB's windows, grass roofs and warm stone recognizable,
// but group photographic noise into deliberate, legible planes of colour.
const masonry = [
  "#2d3e45",
  "#3a505a",
  "#4d6673",
  "#6a808b",
  "#899b99",
  "#a9b5aa",
  "#c2c8b2",
  "#dad7b9",
  "#eee1bc",
  "#fff0cc",
];
const roofGrass = [
  "#294c49",
  "#395f50",
  "#4f7756",
  "#65905f",
  "#82a46a",
  "#9bb879",
  "#b6cd8a",
  "#d3dda3",
];
const warm = [
  "#453d42",
  "#644e49",
  "#836455",
  "#a38269",
  "#c4a184",
  "#dbc2a4",
  "#edd8bb",
  "#f7e6cd",
];
const parse = (colors: string[]) =>
  colors.map((c) => [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16)));
const blueRamp = parse([
  "#254b59",
  "#396c79",
  "#508d95",
  "#6aa9a5",
  "#99cdbd",
  "#c0e0cb",
]);
const neutralRamp = parse(masonry),
  greenRamp = parse(roofGrass),
  warmRamp = parse(warm);

// C2's source UVs already locate the narrow panels, punched windows and mullions.
const bambooMetal = parse([
  "#504a3a",
  "#736343",
  "#89734c",
  "#9e8457",
  "#ad9363",
  "#bca476",
  "#cbb58b",
  "#d6c49d",
  "#dfceac",
]);
const activityGlazing = parse([
  "#29434a",
  "#324d55",
  "#3e5a60",
  "#4d676c",
  "#637d7d",
  "#8e9e96",
  "#bec6b4",
]);
function finishValue(
  ramp: number[][],
  value: number,
  low: number,
  high: number,
) {
  const t = Math.max(0, Math.min(1, (value - low) / (high - low)));
  return ramp[Math.round(t * (ramp.length - 1))];
}

export async function gradeCampusModel(
  input: Buffer,
  surfaceIds?: Uint16Array,
  names?: string[],
  featureId?: number,
  pixelRatio = 1,
) {
  const { data, info } = await sharp(input)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  if (featureId === 43543 && surfaceIds && names) {
    finishHubBridge(
      data,
      info.width,
      info.height,
      surfaceIds,
      names,
      pixelRatio,
    );
    return sharp(data, { raw: info }).png({ compressionLevel: 9 }).toBuffer();
  }
  const families = names?.map((name) =>
    /草地/.test(name) ? "grass" : /太阳能|光伏/.test(name) ? "solar" : "",
  );
  for (let i = 0; i < data.length; i += 4) {
    if (!data[i + 3]) continue;
    const r = data[i],
      g = data[i + 1],
      b = data[i + 2];
    const luma = (r * 0.28 + g * 0.53 + b * 0.19) / 255;
    // Preserve strongly coloured artwork, e.g. the red monument in the plaza.
    if (r > g + 40 && r > b + 40) continue;
    const ramp =
      g > r + 18 && b > r + 18
        ? blueRamp
        : g > b + 14 && g >= r - 5
          ? greenRamp
          : r > g + 11 && r > b + 16
            ? warmRamp
            : neutralRamp;
    const c =
      ramp[
        Math.round(
          Math.min(1, Math.max(0, (luma - 0.07) / 0.87)) * (ramp.length - 1),
        )
      ];
    const index = i / 4,
      x = index % info.width,
      y = Math.floor(index / info.width);
    const face = surfaceIds?.[index] ?? 0,
      family = families?.[(face & 0x7fff) - 1];
    let color = c,
      accent = 0;
    const sourceFinish = names?.[(face & 0x7fff) - 1];
    if (featureId === 43540 && sourceFinish === "学生活动中心外墙1") {
      // Keep the openings in the photographed cladding texture exactly where the
      // model's UVs put them. The cool inset panes read against warm bronze fins.
      color =
        b > r + 7
          ? finishValue(activityGlazing, luma, 0.4, 0.8)
          : finishValue(bambooMetal, luma, 0.49, 0.85);
    } else if (featureId === 43540 && sourceFinish === "窗户") {
      color = finishValue(activityGlazing, luma, 0.33, 0.83);
    } else if (family === "grass") {
      // Hand-sized clusters and occasional pairs of light blades on the actual
      // planted roof material, including its sloping faces.
      const hash =
        (Math.imul(x >> 2, 374761393) ^ Math.imul(y >> 2, 668265263)) >>> 0;
      if (featureId === 43540) {
        // The living roof has broad olive and ochre planting masses. Lay the
        // vegetation in low-contrast swaths, clipped by the two source roof meshes.
        const metresX = x / (pixelRatio * 4.34),
          metresY = y / (pixelRatio * 4.34);
        const bed =
          Math.sin(metresX * 0.2 + Math.sin(metresY * 0.14) * 2.2) +
          0.65 * Math.cos(metresY * 0.27 - metresX * 0.11);
        color = [
          c[0] * 0.8 + 15 + bed * 5,
          c[1] * 0.72 + 15 + bed * 2,
          c[2] * 0.63 + 8,
        ];
      }
      const u = x % 4,
        v = y % 4;
      if (hash % 7 < 2 && ((v === 2 && u < 3) || (v === 1 && u === 2)))
        accent = -11;
      if (hash % 19 === 4 && v === 1 && u < 2) accent = 12;
    } else if (family === "solar") {
      color = [
        Math.max(38, 0.65 * c[0]),
        Math.max(57, 0.8 * c[1]),
        Math.max(78, c[2]),
      ];
      if (x % 7 === 0 || y % 11 === 0) accent = 11;
    } else if (face & 0x8000 && ramp === neutralRamp && luma > 0.76) {
      const seam = x + 8 * Math.floor(y / 9);
      if (y % 9 === 0 || seam % 18 === 0) accent = -7;
      else if (y % 9 === 1 && seam % 18 < 6) accent = 5;
    }
    for (let ch = 0; ch < 3; ch++)
      data[i + ch] = Math.max(0, Math.min(255, Math.round(color[ch] + accent)));
  }
  return sharp(data, { raw: info }).png({ compressionLevel: 9 }).toBuffer();
}

// Project the actual mesh onto the ground along the sun vector. Using one SVG
// path avoids dark seams where triangles overlap. Courtyard holes stay sunlit.
export function castShadow(
  parts: import("./gltf.ts").Primitive[],
  convert: (v: number[]) => { x: number; y: number },
  scale: number,
) {
  const triangles: string[] = [];
  for (const part of parts) {
    const points = part.vertices.map((v) => {
      const p = convert(v),
        z = Math.max(0, v[2]) * scale;
      return { x: Math.round(p.x + z * 0.25), y: Math.round(p.y + z * 0.19) };
    });
    for (let i = 0; i < part.indices.length; i += 3) {
      const a = points[part.indices[i]],
        b = points[part.indices[i + 1]],
        c = points[part.indices[i + 2]];
      const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
      if (cross > 0)
        triangles.push(`M${a.x} ${a.y}L${b.x} ${b.y} ${c.x} ${c.y}Z`);
      else if (cross < 0)
        triangles.push(`M${a.x} ${a.y}L${c.x} ${c.y} ${b.x} ${b.y}Z`);
    }
  }
  return triangles.join("");
}
export function shadowSvg(scene: SceneMap, paths: string[]) {
  const w = scene.width * scene.tileSize,
    h = scene.height * scene.tileSize;
  const footprints = scene.art.roofs
    .map(
      (r) =>
        `<path d="${pathData(r.footprint)}" fill="black" fill-rule="evenodd"/>`,
    )
    .join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" shape-rendering="crispEdges"><defs><mask id="outdoors"><rect width="100%" height="100%" fill="white"/>${footprints}</mask></defs><path d="${paths.join("")}" fill="#314a4b" opacity=".30" mask="url(#outdoors)"/></svg>`;
}
