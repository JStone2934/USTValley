import { canStand, hasLineOfSight, type Point, type SceneMap } from "./world";

export const sundial = {
  id: "observe-sundial",
  featureId: 43597,
  action: "观察红鸟日晷",
  title: "红鸟日晷",
  note: "红鸟立在水池中央。脚下浅色石阶间的深色嵌条，沿着圆台排成一道道弧线。",
};

// Surveyed in the ground plane of the placed plaza mesh, relative to its center.
// The first two positions are on the NW stone crossing and SE steps. The last
// two are on the walkable north/south sides of the dial platform, outside the plinth.
const viewpointsInMeters = [
  [-11, -6],
  [11, 5],
  [0, -4.1],
  [0, 4.1],
] as const;

export function sundialViewpoints(scene: SceneMap): Point[] {
  if (scene.id !== "campus_core") return [];
  const landmark = scene.art.landmarks?.find((l) => l.id === sundial.featureId);
  if (!landmark) return [];
  const centerX = landmark.x + landmark.width / 2,
    centerY = landmark.frontY;
  const size = scene.collisionSize,
    ppm = scene.units.pixelsPerMeter;
  const snap = (v: number) => (Math.floor(v / size) + 0.5) * size;
  return viewpointsInMeters
    .map(([x, y]) => ({
      x: snap(centerX + x * ppm),
      y: snap(centerY + y * ppm),
    }))
    .filter((p) => canStand(scene, p));
}

export function canObserveSundial(scene: SceneMap, point: Point): boolean {
  if (scene.id !== "campus_core" || !canStand(scene, point)) return false;
  const near = (p: Point) =>
    Math.hypot(point.x - p.x, point.y - p.y) <=
      scene.player.interactionRadius && hasLineOfSight(scene, point, p);
  return !scene.chests.some(near) && sundialViewpoints(scene).some(near);
}

// The placed GLB sculpture (node 柱体) covers x=45.5–56.3% and y=26.7–49.4%
// of this image. A small margin keeps the clip valid at other bake densities.
export function sundialCrop(width: number, height: number) {
  const x = Math.floor(width * 0.43),
    y = Math.floor(height * 0.24);
  return {
    x,
    y,
    width: Math.ceil(width * 0.59) - x,
    height: Math.ceil(height * 0.53) - y,
  };
}

export function isSundialSculpturePixel(r: number, g: number, b: number) {
  // The two red source materials retain a red-dominant pigment. The silver
  // gnomon ramp has channel deltas (5,-2), distinct from stone and water.
  return (r > g && r > b) || (g - r === 5 && b - g === -2);
}
