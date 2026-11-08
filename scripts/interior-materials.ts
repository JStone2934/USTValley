import type { RasterMaterial } from "./gltf.ts";

// Each 48-texel repeat covers 16 logical pixels (~2.45 metres indoors).
// Seams and inlaid highlights are authored at the native 3× raster density.
type Ink = [number, number, number];
type Swatch = [Ink, (x: number, y: number) => number];
const density = 48;
const offsets = [0, 11, 21, 7, 15, 2, 19, 9, 4, 16, 22, 12];
const wood = (x: number, y: number) => {
  // A course is 20 cm wide; shifted 1.2 m boards alternate a sawn edge
  // and a few long, broken fibres. No full-frame dither over the grain.
  const row = Math.floor(y / 4),
    lane = y % 4,
    u = (x + offsets[row]) % 24;
  const board = Math.floor((x + offsets[row]) / 24);
  const tone = (((row * 5 + board * 2) % 7) - 3) * 2;
  if (lane === 0) return tone - 23;
  if (u === 0) return tone - 20;
  if (lane === 1 && u > 2 && u < 19) return tone + 13;
  if (
    lane === 2 &&
    ((u > 6 && u < 15 && row % 3 === 1) || (u > 17 && u < 22 && row % 2 === 0))
  )
    return tone - 9;
  return tone;
};
const stone = (x: number, y: number) => {
  const row = Math.floor(y / 12),
    u = (x + (row % 2) * 12) % 24,
    v = y % 12;
  const shade =
    (((Math.floor((x + (row % 2) * 12) / 24) + row * 3) % 4) - 1) * 3;
  if (u === 0 || v === 0) return shade - 19;
  if (u === 1 || v === 1) return shade + 8;
  if (
    (v === 5 && (u === 7 || u === 8)) ||
    (v === 8 && u === 17 && row % 2 === 1)
  )
    return shade - 9;
  return shade;
};
const plaster = (x: number, y: number) =>
  (x === 8 && y === 12) || (x >= 31 && x <= 33 && y === 29) ? -7 : 0;
const stoneChip = (x: number, y: number) =>
  (x % 17 === 4 && y % 13 === 6) || (x % 23 === 7 && y % 17 === 11) ? -9 : 0;
const cloth = (x: number, y: number) =>
  (x === 0 || y === 0 ? -11 : 0) +
  (y % 6 === 1 && x % 8 >= 2 && x % 8 <= 4 ? 6 : 0) -
  (y % 6 === 4 && x % 8 >= 5 && x % 8 <= 7 ? 6 : 0);
const swatches = {
  // Original pixel finishes observed in the Guangzhou library's room photos.
  galleryStone: [
    [194, 195, 188],
    (x, y) => (x % 24 === 0 || y % 12 === 0 ? -15 : stoneChip(x, y)),
  ],
  darkCarpetPenumbra: [[109, 108, 109], cloth],
  darkCarpetContact: [[87, 91, 92], cloth],
  libraryCarpet: [[133, 133, 132], cloth],
  libraryFelt: [[188, 188, 183], cloth],
  libraryOchre: [[231, 177, 72], cloth],
  librarySand: [[208, 184, 143], cloth],
  libraryAsh: [[222, 182, 125], wood],
  librarySlats: [
    [196, 148, 90],
    (x, y) => (x % 4 === 0 ? -15 : y % 17 === 0 ? 6 : 0),
  ],
  librarySeat: [[176, 127, 111], cloth],
  libraryBerry: [[172, 86, 77], cloth],
  libraryDisplay: [
    [96, 115, 167],
    (x, y) =>
      (x + Math.floor(y / 3) * 3) % 22 < 6
        ? -23
        : (x + Math.floor(y / 4) * 7) % 29 < 5
          ? 32
          : 0,
  ],

  slab: [[193, 191, 166], stone],
  passage: [[233, 214, 175], stone],
  oak: [[189, 136, 83], wood],
  teaching: [[209, 162, 101], wood],
  office: [[149, 171, 177], cloth],
  laboratory: [
    [166, 197, 183],
    (x, y) =>
      x % 24 === 0 || y % 24 === 0
        ? -15
        : x % 24 === 1 && y % 24 < 15
          ? 6
          : stoneChip(x, y),
  ],
  washroom: [
    [151, 198, 202],
    (x, y) => {
      const u = x % 6,
        v = y % 6,
        tone = (((Math.floor(x / 6) + Math.floor(y / 6)) % 3) - 1) * 3;
      return u === 0 || v === 0
        ? -24
        : (u === 1 && v <= 3) || (v === 1 && u <= 3)
          ? 13
          : tone;
    },
  ],
  plant: [
    [150, 162, 164],
    (x, y) => {
      const u = x % 24,
        v = y % 24;
      if (!u || !v) return -22;
      if ((u === 2 || u === 22) && (v === 2 || v === 22)) return -26;
      return u === 1 || v === 1 ? 9 : stoneChip(x, y);
    },
  ],
  dining: [
    [217, 168, 131],
    (x, y) =>
      x % 12 === 0 || y % 12 === 0
        ? -19
        : (Math.floor(x / 12) + Math.floor(y / 12)) % 2
          ? 7
          : -2,
  ],
  archive: [[178, 144, 107], wood],
  studio: [[182, 159, 173], cloth],
  neutral: [
    [203, 194, 173],
    (x, y) => (x % 24 === 0 || y % 24 === 0 ? -12 : stoneChip(x, y)),
  ],
  grass: [
    [116, 157, 110],
    (x, y) =>
      (x % 16 === 5 && y % 16 >= 3 && y % 16 <= 5) ||
      (x % 16 === 6 && y % 16 === 5)
        ? 16
        : (x % 24 === 13 || x % 24 === 14) && y % 24 === 15
          ? -17
          : 0,
  ],
  water: [
    [93, 155, 166],
    (x, y) =>
      y % 24 === 4 && x % 24 >= 2 && x % 24 <= 8
        ? 25
        : y % 24 === 5 && x % 24 >= 7 && x % 24 <= 10
          ? 12
          : y % 24 === 16 && x % 24 >= 11 && x % 24 <= 17
            ? 15
            : 0,
  ],
  wallCap: [[250, 231, 194], (x, y) => (x % 24 === 0 ? -12 : plaster(x, y))],
  masonry: [[204, 196, 171], plaster],
  dado: [
    [111, 149, 130],
    (x, y) =>
      y % 11 === 0 || (x + Math.floor(y / 11) * 8) % 24 === 0
        ? -10
        : plaster(x, y),
  ],
  moulding: [[214, 184, 136], (x, y) => (y % 9 === 0 && x % 12 < 7 ? 7 : 0)],
  glass: [
    [151, 207, 211],
    (x, y) => ((x + y) % 24 < 2 ? 16 : (x + y) % 24 === 5 ? 8 : 0),
  ],
  railWhite: [[249, 250, 241], () => 0],
  campusGlass: [
    [108, 167, 175],
    (x, y) => {
      const reflection = (x + Math.floor(y * 0.35)) % 48;
      return reflection < 4 ? 31 : reflection < 9 ? 15 : y > 34 ? -13 : 0;
    },
  ],
  vineLeaf: [[73, 118, 73], (x, y) => ((x + y) % 7 < 2 ? 12 : 0)],
  flowerPink: [[217, 74, 146], (x, y) => ((x + y) % 5 < 2 ? 21 : 0)],
  flowerRose: [[184, 58, 119], (x, y) => ((x + y) % 5 < 2 ? 17 : 0)],
  riser: [[110, 130, 137], (x, y) => (y % 12 === 0 ? -12 : 0)],
  tread: [[209, 197, 167], stoneChip],
  books: [[170, 138, 106], () => 0],
  bindingTeal: [[99, 151, 145], cloth],
  bindingRust: [[179, 112, 86], cloth],
  bindingGold: [[204, 167, 102], cloth],
  blackboard: [
    [61, 107, 99],
    (x, y) => (y % 19 === 9 && x % 23 >= 3 && x % 23 <= 8 ? 8 : 0),
  ],
  pine: [[98, 139, 122], plaster],
  porcelain: [[242, 232, 201], () => 0],
  enamel: [[84, 109, 119], (x, y) => (x % 24 === 1 && y % 16 < 8 ? 9 : 0)],
  bronze: [[192, 143, 91], () => 0],
  contact: [[110, 126, 119], () => 0],
  shadow: [[155, 161, 147], () => 0],
} satisfies Record<string, Swatch>;

const spines: Ink[] = [
  [163, 89, 70],
  [107, 143, 135],
  [191, 154, 97],
  [122, 110, 126],
  [182, 139, 104],
  [119, 137, 150],
  [159, 146, 91],
];
function bookPixel(x: number, y: number): Ink {
  const row = Math.floor(y / 9),
    v = y % 9,
    u = (x + row * 5) % 48;
  if (v === 0) return [107, 78, 65];
  if (v === 1) return [189, 153, 106];
  const book = Math.floor(u / 3),
    seam = u % 3;
  const base = spines[(book + row * 3) % spines.length];
  if (v === 6 && seam === 1 && book % 3 === 0) return [214, 196, 150];
  return base.map((c) => (seam === 0 ? c - 21 : c)) as Ink;
}

export type InteriorInk = keyof typeof swatches;
export function interiorMaterials() {
  const materials: RasterMaterial[] = [];
  const id = {} as Record<InteriorInk, number>;
  for (const key of Object.keys(swatches) as InteriorInk[]) {
    const [ink, shade] = swatches[key];
    const width = density,
      data = Buffer.alloc(width * width * 4, 255);
    for (let y = 0; y < width; y++)
      for (let x = 0; x < width; x++) {
        const light = shade(x, y);
        const color = key === "books" ? bookPixel(x, y) : ink;
        for (let c = 0; c < 3; c++)
          data[(y * width + x) * 4 + c] = color[c] + light;
      }
    id[key] =
      materials.push({
        factor: [1, 1, 1, 1],
        texture: { width, height: width, data },
      }) - 1;
  }
  return { materials, id };
}

export function roomFinish(
  layer: string,
  properties: Record<string, unknown>,
): InteriorInk {
  const label = [properties.name, properties.name_en, properties.info_en]
    .filter(Boolean)
    .join(" ");
  // The export stores lecture halls and classrooms on the office layer.
  // Match the location's own label before falling back to that broad layer.
  if (/洗手间|卫生间|盥洗|restroom|toilet/i.test(label)) return "washroom";
  if (/办公室|\boffice\b/i.test(label)) return "office";
  if (/讲厅|教室|讨论|研讨|会议|lecture|seminar|classroom|meeting/i.test(label))
    return "teaching";
  if (/书库|阅读|阅览|reading|stacks/i.test(label)) return "archive";
  if (/餐厅|餐饮|食堂|咖啡|canteen|café|dining|restaurant/i.test(label))
    return "dining";
  if (/制作室|排练|录音|演播|studio/i.test(label)) return "studio";
  if (
    /管井|强电|弱电|配电|变压器|水泵|空调|机房|数据中心|\bUPS\b|plant room/i.test(
      label,
    )
  )
    return "plant";
  if (/实验|laborator|\blab\b/i.test(label)) return "laboratory";
  if (/洗手间/.test(layer)) return "washroom";
  if (/实验室/.test(layer)) return "laboratory";
  if (/办公室/.test(layer)) return "office";
  return "neutral";
}
