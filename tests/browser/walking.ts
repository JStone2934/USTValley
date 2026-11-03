import { expect, type Page } from "@playwright/test";
import {
  canStand,
  clearFixtureStep,
  tileIndex,
  type SceneMap,
  type Point,
} from "../../src/shared/world";

export const position = (page: Page, axis: "x" | "y") =>
  page.locator("main").getAttribute(`data-${axis}`).then(Number);

export async function driveTo(
  page: Page,
  scene: SceneMap,
  target: Point,
  arriveScene?: string,
) {
  const start = { x: await position(page, "x"), y: await position(page, "y") },
    step = scene.collisionSize,
    width = (scene.width * 16) / step;
  const first = tileIndex(scene, start),
    last = tileIndex(scene, target),
    parents = new Map<number, number>([[first, -1]]),
    queue = [first];
  for (let head = 0; head < queue.length && !parents.has(last); head++) {
    const i = queue[head],
      x = i % width,
      y = Math.floor(i / width);
    for (const [nx, ny] of [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1],
    ]) {
      if (nx < 0 || ny < 0 || nx >= width || ny >= (scene.height * 16) / step)
        continue;
      const n = ny * width + nx;
      if (
        parents.has(n) ||
        !clearFixtureStep(scene, x, y, nx, ny) ||
        !canStand(
          scene,
          { x: (nx + 0.5) * step, y: (ny + 0.5) * step },
          scene.player.radius,
        )
      )
        continue;
      parents.set(n, i);
      queue.push(n);
    }
  }
  expect(
    parents.has(last),
    "target must be reachable through actual source walls",
  ).toBe(true);
  const path: number[] = [];
  for (let i = last; i !== -1; i = parents.get(i)!) path.push(i);
  path.reverse();
  const waypoints = path
    .filter(
      (id, i) =>
        i === path.length - 1 ||
        (i > 0 && path[i + 1] - id !== id - path[i - 1]),
    )
    .map((i) => ({
      x: ((i % width) + 0.5) * step,
      y: (Math.floor(i / width) + 0.5) * step,
    }));
  for (const p of waypoints) {
    for (const axis of ["x", "y"] as const) {
      if (
        arriveScene &&
        (await page.locator("main").getAttribute("data-scene")) === arriveScene
      )
        return;
      const current = await position(page, axis),
        delta = p[axis] - current;
      if (Math.abs(delta) < 0.9) continue;
      const key =
        axis === "x" ? (delta > 0 ? "d" : "a") : delta > 0 ? "s" : "w";
      await page.keyboard.down(key);
      await page.clock.runFor(
        Math.max(16, Math.round((Math.abs(delta) / scene.player.speed) * 1000)),
      );
      await page.keyboard.up(key);
      await page.clock.runFor(120);
    }
  }
  if (arriveScene) {
    await expect(page.locator("main")).toHaveAttribute(
      "data-scene",
      arriveScene,
    );
    return;
  }
  const actual = { x: await position(page, "x"), y: await position(page, "y") };
  expect(
    Math.hypot(actual.x - target.x, actual.y - target.y),
    JSON.stringify({ actual, target }),
  ).toBeLessThan(6);
}
