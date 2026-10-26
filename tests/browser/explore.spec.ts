import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import {
  canStand,
  tileIndex,
  type SceneMap,
  type WorldMap,
  type Point,
} from "../../src/shared/world";

const position = (page: Page, axis: "x" | "y") =>
  page.locator("main").getAttribute(`data-${axis}`).then(Number);
async function walk(page: Page, key: string, ms: number) {
  await page.keyboard.down(key);
  await page.waitForTimeout(ms);
  await page.keyboard.up(key);
}
test("C2 exploration on the real F1 plan, paired return, dialog pause and blur", async ({
  page,
}) => {
  test.setTimeout(180_000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.clock.install();
  await page.goto("/");
  await expect.poll(() => position(page, "x")).toBeGreaterThan(0);
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  const world = JSON.parse(
    readFileSync(
      new URL("../../public/maps/world.json", import.meta.url),
      "utf8",
    ),
  ) as WorldMap;
  const outside = world.scenes[0],
    c2 = outside.portals.find((p) => p.buildingId === "C2")!;
  await assertAvatarScale(page, outside);
  await page.screenshot({ path: "test-results/human-scale-outdoor.png" });
  await driveTo(page, outside, c2);
  await page.keyboard.press("e");
  await page.clock.runFor(150);
  await expect(page.locator("main")).toHaveAttribute(
    "data-scene",
    "interior_c2",
  );
  const inside = world.scenes.find((s) => s.id === "interior_c2")!,
    zone = inside.exploration[0];
  await assertAvatarScale(page, inside);
  await page.screenshot({ path: "test-results/human-scale-indoor.png" });
  await driveTo(page, inside, {
    x: zone.x + zone.width / 2,
    y: zone.y + zone.height / 2,
  });
  await expect(page.locator(".progress-card strong")).toHaveText("1 / 15");
  await page.screenshot({ path: "test-results/reconstructed-interior-c2.png" });
  await page.getByRole("button", { name: /校园地图/ }).click();
  await page.clock.runFor(150);
  const y = await position(page, "y");
  await page.keyboard.down("s");
  await page.clock.runFor(400);
  await page.keyboard.up("s");
  expect(await position(page, "y")).toBe(y);
  await page.keyboard.press("Escape");
  await page.clock.runFor(150);
  await page.keyboard.down("s");
  await page.clock.runFor(100);
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await page.clock.runFor(150);
  const stopped = await position(page, "y");
  await page.clock.runFor(400);
  expect(await position(page, "y")).toBe(stopped);
  await page.keyboard.up("s");
  await driveTo(page, inside, inside.portals[0]);
  await page.keyboard.press("e");
  await page.clock.runFor(150);
  await expect(page.locator("main")).toHaveAttribute(
    "data-scene",
    "campus_core",
  );
  await page.screenshot({ path: "test-results/campus-desktop.png" });
  expect(errors).toEqual([]);
});
test("overview shows hall evidence and raw source data cannot be served", async ({
  page,
  request,
}) => {
  await page.goto("/");
  await expect(page.locator("canvas")).toBeVisible();
  await page.keyboard.press("m");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "查看 C3", exact: true }).click();
  await expect(page.locator(".map-detail")).toContainText("F1 演讲厅编号属性");
  await page.screenshot({ path: "test-results/campus-reference.png" });
  await page.getByRole("button", { name: "关闭面板" }).click();
  const response = await request.get("/data/maps/all-maps.json");
  expect(response.status()).toBe(403);
  const world = await request.get("/maps/world.json");
  const body = await world.text();
  expect(body).not.toMatch(/beacon|geoTransParams|\.glb|uuid/);
});
test("failed map download presents a working retry", async ({ page }) => {
  await page.route("**/maps/world.json", (route) =>
    route.fulfill({ status: 503 }),
  );
  await page.goto("/");
  await expect(page.getByText("地图加载失败 (503)")).toBeVisible();
  await page.unroute("**/maps/world.json");
  await page.getByRole("button", { name: "重新加载" }).click();
  await expect(page.locator("canvas")).toBeVisible();
});
test("failed tileset download presents a working retry without crashing", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/maps/terrain-campus.png", (route) =>
    route.fulfill({ status: 503 }),
  );
  await page.goto("/");
  await expect(page.getByText("地图图像加载失败，请重试")).toBeVisible();
  await page.unroute("**/maps/terrain-campus.png");
  await page.getByRole("button", { name: "重新加载" }).click();
  await expect(page.locator("canvas")).toBeVisible();
  await expect.poll(() => position(page, "y")).toBeGreaterThan(0);
  expect(errors).toEqual([]);
});
test("touch joystick stops on pointer cancellation and landscape UI fits", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 844, height: 390 },
    isMobile: true,
    hasTouch: true,
  });
  const page = await context.newPage();
  await page.goto("/");
  await expect(page.locator("canvas")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "地图", exact: true }),
  ).toBeVisible();
  const joystick = page.getByLabel("移动摇杆");
  await expect(joystick).toBeVisible();
  const bounds = await joystick.boundingBox();
  const y = await position(page, "y");
  await page.mouse.move(
    bounds!.x + bounds!.width / 2,
    bounds!.y + bounds!.height / 2 - 30,
  );
  await page.mouse.down();
  await page.waitForTimeout(400);
  await joystick.dispatchEvent("pointercancel", { pointerId: 1 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  const stopped = await position(page, "y");
  expect(stopped).toBeLessThan(y);
  await page.waitForTimeout(250);
  expect(await position(page, "y")).toBe(stopped);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({ path: "test-results/campus-mobile.png" });
  await context.close();
});

async function driveTo(page: Page, scene: SceneMap, target: Point) {
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
  const actual = { x: await position(page, "x"), y: await position(page, "y") };
  expect(
    Math.hypot(actual.x - target.x, actual.y - target.y),
    JSON.stringify({ actual, target }),
  ).toBeLessThan(6);
}

async function assertAvatarScale(page: Page, scene: SceneMap) {
  const width = Number(
    await page.locator("main").getAttribute("data-avatar-width"),
  );
  const height = Number(
    await page.locator("main").getAttribute("data-avatar-height"),
  );
  expect(width).toBeCloseTo(scene.player.width, 6);
  expect(height).toBeCloseTo(scene.player.height, 6);
  expect(width / scene.units.pixelsPerMeter).toBeCloseTo(0.5, 6);
  expect(
    (height / scene.units.pixelsPerMeter - 0.28) / scene.units.heightProjection,
  ).toBeCloseTo(1.75, 6);
}

test("Shift runs at twice the new base speed, releases correctly and clears on blur", async ({
  page,
}) => {
  await page.clock.install();
  await page.goto("/");
  await expect.poll(() => position(page, "x")).toBeGreaterThan(0);
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  const world = JSON.parse(
    readFileSync(
      new URL("../../public/maps/world.json", import.meta.url),
      "utf8",
    ),
  ) as WorldMap;
  const scene = world.scenes[0],
    start = scene.spawns[0];
  const direction = [
    { key: "w", x: 0, y: -1 },
    { key: "s", x: 0, y: 1 },
    { key: "a", x: -1, y: 0 },
    { key: "d", x: 1, y: 0 },
  ].find((d) =>
    Array.from({ length: 75 }, (_, i) => ({
      x: start.x + d.x * i,
      y: start.y + d.y * i,
    })).every((p) => canStand(scene, p)),
  );
  expect(
    direction,
    "a clear path must be available for measuring real movement",
  ).toBeTruthy();
  const reset = async () => {
    await page.getByRole("button", { name: /回到广场/ }).click();
    await page.clock.runFor(150);
  };
  const point = async () => ({
    x: await position(page, "x"),
    y: await position(page, "y"),
  });
  const measure = async () => {
    const before = await point();
    await page.keyboard.down(direction!.key);
    await page.clock.runFor(1000);
    await page.keyboard.up(direction!.key);
    await page.clock.runFor(150);
    const after = await point();
    return Math.hypot(after.x - before.x, after.y - before.y);
  };
  await reset();
  const walk = await measure();
  expect(Math.abs(walk - scene.player.speed)).toBeLessThan(2);
  await reset();
  await page.keyboard.down("ShiftLeft");
  const run = await measure();
  expect(Math.abs(run - scene.player.runSpeed)).toBeLessThan(2);
  expect(Math.abs(run - 2 * walk)).toBeLessThan(2);
  await page.keyboard.up("ShiftLeft");
  const released = await measure();
  expect(Math.abs(released - scene.player.speed)).toBeLessThan(2);
  await reset();
  await page.keyboard.down("ShiftLeft");
  await page.keyboard.down("ShiftRight");
  await page.keyboard.up("ShiftLeft");
  expect(Math.abs((await measure()) - scene.player.runSpeed)).toBeLessThan(2);
  await page.keyboard.up("ShiftRight");
  await reset();
  await page.keyboard.down("ShiftLeft");
  await page.keyboard.down(direction!.key);
  await page.clock.runFor(400);
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await page.clock.runFor(150);
  const stopped = await point();
  await page.clock.runFor(500);
  expect(await point()).toEqual(stopped);
  await page.keyboard.up(direction!.key);
  await page.keyboard.up("ShiftLeft");
  expect(Math.abs((await measure()) - scene.player.speed)).toBeLessThan(2);
});

test("camera defaults to 4x, supports 1–10x, and has no scale bar", async ({
  page,
}) => {
  await page.goto("/");
  await expect.poll(() => position(page, "x")).toBeGreaterThan(0);
  const world = JSON.parse(
      readFileSync(
        new URL("../../public/maps/world.json", import.meta.url),
        "utf8",
      ),
    ) as WorldMap,
    scene = world.scenes[0];
  const zoom = page.locator(".zoom-controls span"),
    plus = page.getByRole("button", { name: "放大视野" }),
    minus = page.getByRole("button", { name: "缩小视野" });
  await expect(zoom).toHaveText("4×");
  await expect(page.locator(".world-scale")).toHaveCount(0);
  await assertAvatarScale(page, scene);
  await page.screenshot({ path: "test-results/default-zoom-4x.png" });
  for (let i = 0; i < 6; i++) await plus.click();
  await expect(zoom).toHaveText("10×");
  await expect(plus).toBeDisabled();
  await assertAvatarScale(page, scene);
  await page.screenshot({ path: "test-results/maximum-zoom-10x.png" });
  await page.getByRole("button", { name: /回到广场/ }).click();
  await expect(zoom).toHaveText("10×");
  for (let i = 0; i < 9; i++) await minus.click();
  await expect(zoom).toHaveText("1×");
  await expect(minus).toBeDisabled();
  await assertAvatarScale(page, scene);
});
