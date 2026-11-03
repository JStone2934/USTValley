import type { SceneMap } from "./world";

/** One logical pixel per sample, encoded as [y,x,length] row runs. */
export type FixtureCollision = { sourceIds: number[]; runs: number[] };
const cache = new WeakMap<FixtureCollision, Uint8Array>();

export function clearOfFixtures(
  scene: SceneMap,
  left: number,
  top: number,
  right: number,
  bottom: number,
) {
  const fixture = scene.fixtureCollision;
  if (!fixture) return true;
  const width = scene.width * scene.tileSize,
    height = scene.height * scene.tileSize;
  let mask = cache.get(fixture);
  if (!mask) {
    mask = new Uint8Array(width * height);
    for (let i = 0; i < fixture.runs.length; i += 3) {
      const offset = fixture.runs[i] * width + fixture.runs[i + 1];
      mask.fill(1, offset, offset + fixture.runs[i + 2]);
    }
    cache.set(fixture, mask);
  }
  for (
    let y = Math.max(0, Math.floor(top));
    y <= Math.min(height - 1, Math.floor(bottom));
    y++
  )
    for (
      let x = Math.max(0, Math.floor(left));
      x <= Math.min(width - 1, Math.floor(right));
      x++
    )
      if (mask[y * width + x]) return false;
  return true;
}
