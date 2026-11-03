import type Phaser from "phaser";
import {
  hasLineOfSight,
  type Point,
  type Portal,
  type SceneMap,
} from "../shared/world";

/** Only entrances identified as glazed door panels in the source wall layer
 * get glass leaves. Each leaf slides behind the fixed pane on its own side. */
export function slidingEntrance(
  scene: Phaser.Scene,
  map: SceneMap,
  portal: Portal,
) {
  const opening = portal.entrance?.glazing;
  if (!opening) return;
  const a = opening.jambA,
    b = opening.jambB;
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const height = 2.1 * map.units.pixelsPerMeter * map.units.heightProjection;
  const g = scene.add
    .graphics()
    .setName("glass-entrance")
    .setDepth(6000 + (a.y + b.y) / 2);
  function draw(progress: number) {
    g.clear();
    for (const side of [-1, 1]) {
      const start = (side < 0 ? 0 : 0.5) + side * 0.5 * progress;
      const x = a.x + dx * start,
        y = a.y + dy * start;
      const endX = x + dx / 2,
        endY = y + dy / 2;
      g.fillStyle(0x8fb9ba, 0.53).fillPoints(
        [
          { x, y },
          { x: endX, y: endY },
          { x: endX, y: endY - height },
          { x, y: y - height },
        ],
        true,
      );
      g.lineStyle(0.45, 0x536e70, 0.95)
        .lineBetween(x, y, x, y - height)
        .lineBetween(x, y - height, endX, endY - height)
        .lineBetween(endX, endY - height, endX, endY);
      g.lineStyle(0.35, 0xe0e8d8, 0.92).lineBetween(
        x,
        y - height * 0.48,
        endX,
        endY - height * 0.48,
      );
    }
  }
  let progress = 0;
  draw(0);
  return (feet: Point, delta: number) => {
    const near =
      Math.hypot(feet.x - portal.x, feet.y - portal.y) <
      map.player.interactionRadius * 1.2;
    const target = near && hasLineOfSight(map, feet, portal) ? 1 : 0;
    if (progress === target) return;
    const step = Math.min(1, delta / 180);
    progress = target
      ? Math.min(1, progress + step)
      : Math.max(0, progress - step);
    draw(progress);
  };
}
