import { crossedEntrance } from "../../src/shared/automatic-doors";
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
    step = scene.portals.some(
      (p) =>
        p.kind === "stairs" && Math.hypot(p.x - target.x, p.y - target.y) < 1,
    )
      ? 1
      : scene.collisionSize,
    width = (scene.width * 16) / step;
  const offset = step === 1 ? 0 : 0.5;
  const index = (p: Point) =>
    (step === 1 ? Math.round(p.y) : Math.floor(p.y / step)) * width +
    (step === 1 ? Math.round(p.x) : Math.floor(p.x / step));
  const first = index(start),
    last = index(target),
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
        scene.portals.some((p) => {
          if (
            !p.entrance ||
            Math.hypot(target.x - p.x, target.y - p.y) <
              scene.player.interactionRadius
          )
            return false;
          const { threshold: t, toward: v, width: w } = p.entrance;
          const dx = (nx + offset) * step - t.x,
            dy = (ny + offset) * step - t.y;
          return (
            Math.abs(dx * v.y - dy * v.x) < w / 2 + scene.player.radius &&
            dx * v.x + dy * v.y > -scene.player.radius - 1 &&
            dx * v.x + dy * v.y < scene.player.radius + 1
          );
        }) ||
        (step === scene.collisionSize &&
          !clearFixtureStep(scene, x, y, nx, ny)) ||
        (!arriveScene &&
          crossedEntrance(
            scene,
            { x: (x + offset) * step, y: (y + offset) * step },
            { x: (nx + offset) * step, y: (ny + offset) * step },
          )) ||
        !canStand(
          scene,
          { x: (nx + offset) * step, y: (ny + offset) * step },
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
      x: ((i % width) + offset) * step,
      y: (Math.floor(i / width) + offset) * step,
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
      // Use the game's own sprint on long, clear straightaways. Corners and
      // door approaches still take ordinary walking steps with the real avatar.
      const sprint = Math.abs(delta) > 48;
      const speed = sprint ? scene.player.runSpeed : scene.player.speed;
      if (sprint) await page.keyboard.down("ShiftLeft");
      await page.keyboard.down(key);
      await page.clock.runFor(
        Math.max(16, Math.round((Math.abs(delta) / speed) * 1000)),
      );
      await page.keyboard.up(key);
      if (sprint) await page.keyboard.up("ShiftLeft");
      await page.clock.runFor(120);
      if (!arriveScene)
        expect(
          await page.locator("main").getAttribute("data-scene"),
          JSON.stringify({ target, p }),
        ).toBe(scene.id);
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

// Walk through the door deliberately, perpendicular enough to cross its trigger.
// Using real keyboard input also catches accidental transfers while walking along a facade.
export async function walkThroughEntrance(
  page: Page,
  scene: SceneMap,
  portal: import("../../src/shared/world").Portal,
) {
  const { threshold, toward } = portal.entrance!;
  await driveTo(page, scene, portal.spawn);
  // Grid navigation stops at a cell centre. Follow the last few metres with
  // ordinary eight-way input, correcting toward the physical sill each step.
  for (let i = 0; i < 40; i++) {
    if (
      (await page.locator("main").getAttribute("data-scene")) ===
      portal.targetScene
    )
      return;
    const x = await position(page, "x"),
      y = await position(page, "y");
    const dx = threshold.x + toward.x * scene.player.radius - x;
    const dy = threshold.y + toward.y * scene.player.radius - y;
    const limit = Math.max(Math.abs(dx), Math.abs(dy)) * 0.35;
    const keys = [
      ...(Math.abs(dx) > limit ? [dx > 0 ? "d" : "a"] : []),
      ...(Math.abs(dy) > limit ? [dy > 0 ? "s" : "w"] : []),
    ];
    for (const key of keys) await page.keyboard.down(key);
    await page.clock.runFor(90);
    for (const key of keys) await page.keyboard.up(key);
    await page.clock.runFor(120);
  }
  await expect(page.locator("main")).toHaveAttribute(
    "data-scene",
    portal.targetScene,
  );
}
