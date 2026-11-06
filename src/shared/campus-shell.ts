import type { Point } from "./world";

export function exteriorRecess(pixelsPerMeter: number) {
  return {
    front: 2 * pixelsPerMeter,
    back: Math.max(1.5, 0.35 * pixelsPerMeter),
  };
}

/** Parametric intersection of a traced facade edge and the physical door recess.
 * Both tangent and normal limits matter at oblique walls and building corners. */
export function facadeDoorInterval(
  a: Point,
  b: Point,
  opening: { threshold: Point; toward: Point; width: number },
  pixelsPerMeter: number,
): [number, number] | undefined {
  const { threshold, toward, width } = opening;
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const x = a.x - threshold.x,
    y = a.y - threshold.y;
  const { front, back } = exteriorRecess(pixelsPerMeter);
  let lo = 0,
    hi = 1;
  for (const [start, delta, lower, upper] of [
    [x * toward.x + y * toward.y, dx * toward.x + dy * toward.y, -front, back],
    [
      y * toward.x - x * toward.y,
      dy * toward.x - dx * toward.y,
      -width / 2,
      width / 2,
    ],
  ]) {
    if (Math.abs(delta) < 1e-8) {
      if (start < lower || start > upper) return;
    } else {
      const t1 = (lower - start) / delta,
        t2 = (upper - start) / delta;
      lo = Math.max(lo, Math.min(t1, t2));
      hi = Math.min(hi, Math.max(t1, t2));
      if (lo >= hi) return;
    }
  }
  return [lo, hi];
}
