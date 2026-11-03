import Phaser from "phaser";
import type { SceneMap } from "../shared/world";

// Sample only the few texels occupied by the actor. Large HD floor plans stay
// in the image cache without allocating a second full-floor canvas or pixel array.
export function actorOcclusion(scene: Phaser.Scene, map: SceneMap) {
  if (!map.art.riseMap) return;
  const getImage = (key: string) =>
    scene.textures.get(key).getSourceImage() as HTMLImageElement;
  const height = getImage(map.art.riseMap),
    ground = getImage(map.art.ground);
  const ratio = map.art.pixelRatio ?? 1;
  const width = Math.ceil(map.player.width * ratio) + 2,
    rows = Math.ceil(map.player.height * ratio) + 2;
  const key = "actor-foreground",
    texture = scene.textures.createCanvas(key, width, rows)!;
  const scratch = document.createElement("canvas");
  scratch.width = width;
  scratch.height = rows;
  const ctx = scratch.getContext("2d", { willReadFrequently: true })!;
  function sample(image: HTMLImageElement, x: number, y: number) {
    ctx.clearRect(0, 0, width, rows);
    ctx.drawImage(image, x, y, width, rows, 0, 0, width, rows);
    return ctx.getImageData(0, 0, width, rows);
  }
  const sprite = scene.add
    .image(0, 0, key)
    .setOrigin(0)
    .setScale(1 / ratio);
  let lastX = Infinity,
    lastY = Infinity;
  return {
    update(footX: number, footY: number, depth: number) {
      const x0 = Math.floor(footX * ratio - width / 2),
        y0 = Math.round(footY * ratio) - rows + 1;
      if (lastX === x0 && lastY === y0) return;
      lastX = x0;
      lastY = y0;
      const heights = sample(height, x0, y0),
        colors = sample(ground, x0, y0);
      let any = false;
      for (let row = 0; row < rows; row++)
        for (let x = 0; x < width; x++) {
          const i = (row * width + x) * 4,
            rise = heights.data[i] / 8;
          if (rise < 0.5 || (y0 + row + 0.5) / ratio + rise <= footY + 0.2)
            colors.data[i + 3] = 0;
          else any = true;
        }
      sprite.setVisible(any);
      if (!any) return;
      texture.context.putImageData(colors, 0, 0);
      texture.refresh();
      sprite.setPosition(x0 / ratio, y0 / ratio).setDepth(depth + 0.02);
    },
    dispose() {
      sprite.destroy();
      scene.textures.remove(key);
    },
  };
}
