import type Phaser from "phaser";
import type { SceneMap } from "../shared/world";

// Sample only the few texels occupied by the actor. Large HD floor plans stay
// in the image cache without allocating a second full-floor canvas or pixel array.
export function actorOcclusion(
  scene: Phaser.Scene,
  map: SceneMap,
  key = "actor-foreground",
) {
  const ratio = map.art.pixelRatio ?? 1;
  const layers = [
    ...(map.art.riseMap
      ? [{ x: 0, y: 0, image: map.art.ground, riseMap: map.art.riseMap }]
      : []),
    ...(map.art.landmarks ?? []).flatMap((l) =>
      l.riseMap ? [{ ...l, riseMap: l.riseMap }] : [],
    ),
  ].map((l) => ({
    x: Math.round(l.x * ratio),
    y: Math.round(l.y * ratio),
    ground: scene.textures.get(l.image).getSourceImage() as HTMLImageElement,
    height: scene.textures.get(l.riseMap).getSourceImage() as HTMLImageElement,
  }));
  if (!layers.length) return;
  const shadowBelowFeet = Math.ceil((map.player.groundDepth * ratio) / 2);
  const width = Math.ceil(map.player.width * ratio) + 2,
    rows = Math.ceil(map.player.height * ratio) + shadowBelowFeet + 2;
  const texture = scene.textures.createCanvas(key, width, rows)!;
  const scratch = document.createElement("canvas");
  scratch.width = width;
  scratch.height = rows;
  const ctx = scratch.getContext("2d", { willReadFrequently: true })!;
  function sample(image: HTMLImageElement, x: number, y: number) {
    ctx.clearRect(0, 0, width, rows);
    ctx.drawImage(image, x, y, width, rows, 0, 0, width, rows);
    return ctx.getImageData(0, 0, width, rows);
  }
  const overlay = ctx.createImageData(width, rows);
  const sprite = scene.add
    .image(0, 0, key)
    .setOrigin(0)
    .setScale(1 / ratio);
  let lastX = Infinity,
    lastY = Infinity;
  return {
    update(footX: number, footY: number, depth: number) {
      const x0 = Math.floor(footX * ratio - width / 2),
        y0 = Math.round(footY * ratio) - rows + shadowBelowFeet + 1;
      if (sprite.depth !== depth + 0.02) sprite.setDepth(depth + 0.02);
      if (lastX === x0 && lastY === y0) return;
      lastX = x0;
      lastY = y0;
      let any = false;
      overlay.data.fill(0);
      for (const layer of layers) {
        const x = x0 - layer.x,
          y = y0 - layer.y;
        if (
          x >= layer.ground.width ||
          y >= layer.ground.height ||
          x + width <= 0 ||
          y + rows <= 0
        )
          continue;
        const heights = sample(layer.height, x, y).data,
          colors = sample(layer.ground, x, y).data;
        for (let row = 0; row < rows; row++)
          for (let col = 0; col < width; col++) {
            const i = (row * width + col) * 4,
              rise = heights[i] / 8;
            if (
              rise < 0.5 ||
              !colors[i + 3] ||
              (y0 + row + 0.5) / ratio + rise <= footY + 0.2
            )
              continue;
            overlay.data.set(colors.subarray(i, i + 4), i);
            any = true;
          }
      }
      sprite.setVisible(any);
      if (!any) return;
      texture.context.putImageData(overlay, 0, 0);
      texture.refresh();
      sprite.setPosition(x0 / ratio, y0 / ratio);
    },
    dispose() {
      sprite.destroy();
      scene.textures.remove(key);
    },
  };
}
