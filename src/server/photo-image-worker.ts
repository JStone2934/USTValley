import { readFile, writeFile } from "node:fs/promises";
import sharp, { type Sharp } from "sharp";
import { photoLimits } from "../shared/photos";
const [input, output] = process.argv.slice(2);
try {
  const bytes = await readFile(input);
  let format: string, width: number, height: number;
  let image: Sharp;
  const heif =
    bytes.length > 12 &&
    bytes.toString("ascii", 4, 8) === "ftyp" &&
    /heic|heix|hevc|hevx|mif1/.test(bytes.toString("ascii", 8, 40));
  if (heif) {
    const { default: decode } = await import("heic-decode");
    const images = await decode.all({ buffer: bytes });
    try {
      const first = images[0];
      if (!first || first.width * first.height > photoLimits.pixels)
        throw new Error("照片像素超过上限");
      const data = await first.decode();
      width = data.width;
      height = data.height;
      format = "heic";
      image = sharp(data.data, { raw: { width, height, channels: 4 } });
    } finally {
      images.dispose();
    }
  } else {
    const source = sharp(bytes, {
      limitInputPixels: photoLimits.pixels,
      failOn: "error",
    });
    const meta = await source.metadata();
    if (
      !["jpeg", "png", "webp"].includes(meta.format ?? "") ||
      (meta.pages ?? 1) > 1
    )
      throw new Error("仅支持静态 JPG、PNG、WebP、HEIC 照片");
    format = meta.format!;
    width = meta.width!;
    height = meta.height!;
    image = source.autoOrient();
  }
  await image
    .resize({
      width: 1800,
      height: 1800,
      fit: "inside",
      withoutEnlargement: true,
    })
    .webp({ quality: 88 })
    .toFile(output);
  const out = await sharp(output).metadata();
  await writeFile(
    output + ".json",
    JSON.stringify({
      format,
      width,
      height,
      previewWidth: out.width,
      previewHeight: out.height,
    }),
  );
} catch (e) {
  process.stderr.write(e instanceof Error ? e.message : "图片处理失败");
  process.exitCode = 1;
}
