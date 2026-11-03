/**
 * Built reference: KPF, HKUST(GZ) Academic and Research Hub
 * https://www.kpf.com/project/hkust-gz-academic-and-research-hub
 * Only paint the seven existing materials of campus feature 43543.
 */
type RGB = readonly [number, number, number];
const stone: RGB[] = [
  [170, 178, 176],
  [191, 198, 194],
  [204, 210, 204],
  [216, 220, 212],
  [230, 232, 221],
];
const glass: RGB[] = [
  [52, 72, 79],
  [70, 94, 102],
  [93, 119, 125],
  [121, 144, 145],
  [155, 174, 170],
  [193, 203, 193],
];
const silver: RGB[] = [
  [97, 115, 119],
  [132, 145, 145],
  [165, 176, 172],
  [196, 204, 195],
  [226, 230, 219],
];
const turf: RGB[] = [
  [88, 119, 76],
  [106, 135, 81],
  [122, 148, 85],
  [139, 158, 92],
];
const earth: RGB[] = [
  [148, 102, 91],
  [164, 116, 100],
  [177, 130, 110],
  [188, 142, 121],
];

const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));

function seed(x: number, y: number) {
  let bits = Math.imul(x + 47, 73856093) ^ Math.imul(y + 19, 19349663);
  bits = Math.imul(bits ^ (bits >>> 16), 0x45d9f3b);
  return (bits ^ (bits >>> 16)) >>> 0;
}

/** Deck and isolated pavilion roofs share one white GLB material. Only the continuous
 * concourse (the largest connected top face) gets the rectangular paving seen in photos. */
function walkingDeck(ids: Uint16Array, width: number, floorId: number) {
  const visited = new Uint8Array(ids.length),
    deck = new Uint8Array(ids.length);
  const queue = new Int32Array(ids.length);
  let largest = 0;
  for (let start = 0; start < ids.length; start++) {
    if (ids[start] !== floorId || visited[start]) continue;
    let end = 1;
    queue[0] = start;
    visited[start] = 1;
    for (let i = 0; i < end; i++) {
      const p = queue[i],
        x = p % width;
      const push = (n: number) => {
        if (ids[n] === floorId && !visited[n]) {
          visited[n] = 1;
          queue[end++] = n;
        }
      };
      if (x) push(p - 1);
      if (x + 1 < width) push(p + 1);
      push(p - width);
      push(p + width);
    }
    if (end > largest) {
      largest = end;
      deck.fill(0);
      for (let i = 0; i < end; i++) deck[queue[i]] = 1;
    }
  }
  return deck;
}

export function finishHubBridge(
  data: Buffer,
  width: number,
  height: number,
  surfaceIds: Uint16Array,
  names: readonly string[],
  pixelRatio: number,
) {
  const white = names.indexOf("楼面白色1") + 1,
    grass = names.indexOf("草地") + 1,
    soil = names.indexOf("土色") + 1,
    rail = names.indexOf("栏杆") + 1;
  const glazing = new Set(
    names.flatMap((name, i) => (name.includes("玻璃") ? [i + 1] : [])),
  );
  const deck = walkingDeck(surfaceIds, width, 0x8000 | white);
  const tileW = Math.max(6, Math.round(4.25 * pixelRatio)),
    tileH = Math.max(3, Math.round(2.1 * pixelRatio));
  const bladePitch = Math.max(5, Math.round(3.15 * pixelRatio));
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++) {
      const i = y * width + x,
        offset = i * 4,
        face = surfaceIds[i];
      if (!face || !data[offset + 3]) continue;
      const material = face & 0x7fff;
      const luma =
        data[offset] * 0.27 + data[offset + 1] * 0.55 + data[offset + 2] * 0.18;
      const upper = Boolean(face & 0x8000);
      let color: RGB,
        shade = 0;
      if (material === white && upper) {
        // The source's isolated oval caps remain smooth and read above the planted roof.
        color =
          stone[
            luma < 181
              ? 0
              : luma < 194
                ? 1
                : luma < 204
                  ? 2
                  : luma < 234
                    ? 3
                    : 4
          ];
        if (deck[i]) {
          const row = Math.floor(y / tileH);
          const xx = x + (row % 2) * Math.floor(tileW / 2),
            col = Math.floor(xx / tileW);
          const seam = xx % tileW === 0 || y % tileH === 0;
          shade = seam ? -8 : (seed(col, row) % 7) - 2;
        } else if ((surfaceIds[i + width] & 0x7fff) !== white) shade = 5;
      } else if (material === white) {
        // Round pillars and fascia use the same material; preserve the model's directional shade.
        color = silver[clamp(Math.floor((luma - 145) / 15), 0, 4)];
        if ((surfaceIds[i - width] & 0x7fff) !== white) shade = 8;
        else if ((surfaceIds[i + width] & 0x7fff) !== white) shade = -10;
      } else if (material === grass) {
        const cellX = Math.floor(x / bladePitch),
          cellY = Math.floor(y / bladePitch),
          h = seed(cellX, cellY);
        const localX = x % bladePitch,
          localY = y % bladePitch;
        const px = (h >>> 4) % (bladePitch - 2),
          py = (h >>> 12) % (bladePitch - 2);
        color = turf[luma < 88 ? 0 : luma < 102 ? 1 : luma < 148 ? 2 : 3];
        const swath =
          Math.sin((x + y * 0.4) / (28 * pixelRatio)) +
          0.55 * Math.sin((y - x * 0.15) / (13 * pixelRatio));
        shade = swath < -0.65 ? -4 : swath > 0.65 ? 4 : 0;
        // Paired, sparse blade clusters break up large fields without speckling every pixel.
        if (
          (localY === py + 1 && localX >= px && localX <= px + 2) ||
          (localX === px + 2 && localY === py)
        )
          shade += h % 3 === 0 ? 8 : -8;
        const fringe = Math.max(1, Math.round(1.15 * pixelRatio));
        const nearDeck =
          deck[i - width * fringe] ||
          deck[i + width * fringe] ||
          (x >= fringe && deck[i - fringe]) ||
          (x + fringe < width && deck[i + fringe]);
        if (nearDeck) {
          shade -= 9;
          // The photographed roof walk borders low flowering groundcover. Keep these
          // tiny occasional marks inside the planted surface, next to the mapped path.
          if (
            h % 5 === 0 &&
            Math.abs(localX - px) <= 1 &&
            Math.abs(localY - py) <= 1
          )
            color = [155, 138, 159];
        }
      } else if (material === soil) {
        const grain = seed(x >> 1, y >> 1);
        color = earth[clamp(Math.floor((luma - 175) / 9), 0, 3)];
        if (grain % 9 === 0) shade = -5;
        else if (grain % 13 === 0) shade = 5;
      } else if (glazing.has(material)) {
        // Existing texture mullions and reflections set the positions of window divisions.
        const band = clamp(Math.floor((luma - 112) / 18), 0, 5);
        color = glass[band];
        if ((surfaceIds[i - width] & 0x7fff) !== material) shade = -10;
      } else if (material === rail) {
        color = silver[clamp(Math.floor((luma - 115) / 19), 0, 4)];
        if ((surfaceIds[i - width] & 0x7fff) !== rail) shade = 12;
      } else continue;
      for (let c = 0; c < 3; c++)
        data[offset + c] = clamp(color[c] + shade, 0, 255);
    }
}
