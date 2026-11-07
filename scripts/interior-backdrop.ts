import sharp from "sharp";
import type { SceneMap, Point } from "../src/shared/world";
import config from "../content/map-config.json";

/** Both scenes share the surveyed origin and rotation; only scale and crop differ.
 * A higher floor puts the distant ground below the current floor's zero height. */
export function exteriorPlacement(campus: SceneMap, indoor: SceneMap) {
  const scale =
    indoor.units.pixelsPerProjectedUnit / campus.units.pixelsPerProjectedUnit;
  return {
    scale,
    x: indoor.sourceOffset.x - campus.sourceOffset.x * scale,
    y:
      indoor.sourceOffset.y -
      campus.sourceOffset.y * scale +
      indoor.floor.elevation *
        indoor.units.pixelsPerProjectedUnit *
        indoor.units.heightProjection,
  };
}
export function campusInInterior(
  campus: SceneMap,
  indoor: SceneMap,
  p: Point,
): Point {
  const t = exteriorPlacement(campus, indoor);
  return { x: p.x * t.scale + t.x, y: p.y * t.scale + t.y };
}

export function createBackdropBaker(
  campus: SceneMap,
  files: Map<string, Uint8Array>,
) {
  const cache = new Map<string, Buffer>();
  return async (indoor: SceneMap) => {
    const own = config.groups.find(
      (g) => g.sourceMap === indoor.sourceMap,
    )?.key;
    let panorama = cache.get(indoor.sourceMap);
    const density = campus.art.pixelRatio ?? 1;
    if (!panorama) {
      // Keep the current building cut away; adjacent campus buildings remain visible.
      const objects = [
        ...(campus.art.landmarks ?? []),
        ...campus.art.roofs.filter((r) => r.id !== own),
      ];
      panorama = await sharp(files.get(`public/maps/${campus.art.ground}`)!)
        .composite(
          objects.map((r) => ({
            input: Buffer.from(files.get(`public/maps/${r.image}`)!),
            left: Math.round(r.x * density),
            top: Math.round(r.y * density),
          })),
        )
        .png()
        .toBuffer();
      cache.set(indoor.sourceMap, panorama);
    }
    const t = exteriorPlacement(campus, indoor),
      ratio = indoor.art.pixelRatio ?? 1,
      width = indoor.width * indoor.tileSize,
      height = indoor.height * indoor.tileSize;
    const left = Math.max(0, Math.floor((-t.x / t.scale) * density)),
      top = Math.max(0, Math.floor((-t.y / t.scale) * density));
    const right = Math.min(
        campus.width * campus.tileSize * density,
        Math.ceil(((width - t.x) / t.scale) * density),
      ),
      bottom = Math.min(
        campus.height * campus.tileSize * density,
        Math.ceil(((height - t.y) / t.scale) * density),
      );
    const haze = Math.min(
      0.28,
      0.07 + Math.max(0, indoor.floor.elevation) * 0.004,
    );
    let image = "";
    if (right > left && bottom > top) {
      const crop = await sharp(panorama)
        .extract({ left, top, width: right - left, height: bottom - top })
        .png()
        .toBuffer();
      image = `<image href="data:image/png;base64,${crop.toString("base64")}" x="${(left / density) * t.scale + t.x}" y="${(top / density) * t.scale + t.y}" width="${((right - left) / density) * t.scale}" height="${((bottom - top) / density) * t.scale}"/>`;
    }
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width * ratio}" height="${height * ratio}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="#b5c6a1"/>${image}<rect width="100%" height="100%" fill="#e4ead4" opacity="${haze}"/></svg>`;
    return sharp(Buffer.from(svg)).png({ compressionLevel: 6 }).toBuffer();
  };
}
