import type Phaser from "phaser";
import { isSundialSculpturePixel, sundialCrop } from "../shared/sundial";
import type { SceneMap } from "../shared/world";

/** Keep the original stone deck under the avatar. Only the sculpture can pass in
 * front of someone on the far side of its plinth. Both sprites use the baked PNG. */
export function addSundialForeground(
  scene: Phaser.Scene,
  landmark: NonNullable<SceneMap["art"]["landmarks"]>[number],
) {
  const img = scene.textures
    .get(landmark.image)
    .getSourceImage() as HTMLImageElement;
  const crop = sundialCrop(img.width, img.height);
  const key = "red-bird-sculpture";
  if (!scene.textures.exists(key)) {
    const mask = scene.textures.createCanvas(key, crop.width, crop.height)!;
    mask.context.drawImage(
      img,
      crop.x,
      crop.y,
      crop.width,
      crop.height,
      0,
      0,
      crop.width,
      crop.height,
    );
    const pixels = mask.context.getImageData(0, 0, crop.width, crop.height);
    for (let k = 0; k < pixels.data.length; k += 4)
      if (
        !isSundialSculpturePixel(
          pixels.data[k],
          pixels.data[k + 1],
          pixels.data[k + 2],
        )
      )
        pixels.data[k + 3] = 0;
    mask.context.putImageData(pixels, 0, 0);
    mask.refresh();
  }
  const scaleX = landmark.width / img.width,
    scaleY = landmark.height / img.height;
  scene.add
    .image(landmark.x + crop.x * scaleX, landmark.y + crop.y * scaleY, key)
    .setName("sundial-sculpture")
    .setOrigin(0)
    .setScale(scaleX, scaleY)
    .setDepth(6000 + landmark.frontY);
}
