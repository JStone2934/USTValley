import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import sharp from "sharp";
import { canStand, type SceneMap, type WorldMap } from "../../src/shared/world";

import { driveTo, position, walkThroughEntrance } from "./walking";

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
  await walkThroughEntrance(page, outside, c2);
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
  await walkThroughEntrance(page, inside, inside.portals[0]);
  await page.clock.runFor(150);
  await expect(page.locator("main")).toHaveAttribute(
    "data-scene",
    "campus_core",
  );
  await page.screenshot({ path: "test-results/campus-desktop.png" });
  expect(errors).toEqual([]);
});
test("C2 source escalator reaches F2 and the reciprocal passage returns to F1", async ({
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
  const outside = world.scenes[0];
  await walkThroughEntrance(
    page,
    outside,
    outside.portals.find((p) => p.buildingId === "C2")!,
  );
  await page.clock.runFor(150);
  const f1 = world.scenes.find((s) => s.id === "interior_c2")!;
  const up = f1.portals.find((p) => p.kind === "escalator")!;
  await driveTo(page, f1, up);
  await page.locator(`[data-portal="${up.id}"]`).click();
  await page.clock.runFor(150);
  await expect(page.locator("main")).toHaveAttribute(
    "data-scene",
    up.targetScene,
  );
  await expect(page.locator(".topbar strong")).toContainText("F2");
  await page.screenshot({ path: "test-results/reconstructed-c2-f2.png" });
  const f2 = world.scenes.find((s) => s.id === up.targetScene)!;
  await assertAvatarScale(page, f2);
  await page.locator(`[data-portal="${up.targetPortal}"]`).click();
  await page.clock.runFor(150);
  await expect(page.locator("main")).toHaveAttribute(
    "data-scene",
    "interior_c2",
  );
  await page.keyboard.press("m");
  await expect(
    page.getByRole("heading", { name: "当前楼层地图 · F1" }),
  ).toBeVisible();
  await expect(
    page.getByRole("img", { name: `${f1.name}通道平面`, exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel("查看楼层平面")).toHaveCount(0);
  await expect(
    page.getByRole("img", { name: "源模型重建的核心校园总览" }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "关闭面板" }).click();
  await page.getByRole("button", { name: "回到广场 ↺" }).click();
  await expect(page.locator("main")).toHaveAttribute(
    "data-scene",
    "campus_core",
  );
  await page.keyboard.press("m");
  await page.getByRole("button", { name: "查看 C1", exact: true }).click();
  await page
    .getByLabel("查看楼层平面")
    .selectOption("interior_administration_f8");
  await expect(
    page.getByRole("img", { name: "行政办公楼 · F8通道平面", exact: true }),
  ).toBeVisible();
  const plan = page.getByRole("img", {
    name: "行政办公楼 · F8通道平面",
    exact: true,
  });
  await page.getByLabel("墙体", { exact: true }).uncheck();
  await expect(plan.locator('image[href$="-walls.png"]')).toHaveCount(0);
  await page.getByLabel("墙体", { exact: true }).check();
  await expect(plan.locator('image[href$="-walls.png"]')).toHaveCount(1);
  await page.screenshot({
    path: "test-results/reconstructed-floor-overview.png",
  });
  expect(errors).toEqual([]);
});
test("visible stairs walk up and down while gameplay and maps show only the occupied floor", async ({
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
  const outside = world.scenes[0];
  await walkThroughEntrance(
    page,
    outside,
    outside.portals.find((p) => p.buildingId === "C2")!,
  );
  await expect(page.locator("main")).toHaveAttribute(
    "data-scene",
    "interior_c2",
  );
  const f1 = world.scenes.find((s) => s.id === "interior_c2")!;
  const stairs = f1.portals.find((p) => p.kind === "stairs")!;
  await expect
    .poll(() =>
      page.locator("main").getAttribute("data-stair-markers").then(Number),
    )
    .toBeGreaterThan(0);
  await driveTo(page, f1, stairs);
  await expect(page.locator(`[data-portal="${stairs.id}"]`)).toHaveText(
    "楼梯 ↑ 上楼至 F2",
  );
  await page.screenshot({ path: "test-results/stairs-up-f1.png" });
  await page.keyboard.press("e");
  const f2 = world.scenes.find((s) => s.id === stairs.targetScene)!;
  await expect(page.locator("main")).toHaveAttribute("data-scene", f2.id);
  await expect(page.locator("main")).toHaveAttribute("data-floor", "F2");
  await expect(page.locator("main")).toHaveAttribute(
    "data-floor-images",
    JSON.stringify([f2.art.ground]),
  );
  await page.keyboard.press("m");
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", { name: "当前楼层地图 · F2" }),
  ).toBeVisible();
  const plan = dialog.getByRole("img", {
    name: `${f2.name}通道平面`,
    exact: true,
  });
  await expect(plan).toBeVisible();
  await expect(dialog.getByRole("img")).toHaveCount(1);
  await expect(dialog.getByLabel("查看楼层平面")).toHaveCount(0);
  await expect(plan.locator("image")).toHaveCount(f2.art.layers.length);
  const images = await plan
    .locator("image")
    .evaluateAll((items) => items.map((image) => image.getAttribute("href")));
  expect(images).toEqual(f2.art.layers.map((l) => `/maps/${l.image}`));
  await expect(plan.locator('[data-passage-kind="stairs"]')).not.toHaveCount(0);
  await page.screenshot({ path: "test-results/current-floor-f2.png" });
  await page.getByRole("button", { name: "关闭面板" }).click();
  const down = page.locator(`[data-portal="${stairs.targetPortal}"]`);
  await expect(down).toHaveText("楼梯 ↓ 下楼至 F1");
  await down.click();
  await expect(page.locator("main")).toHaveAttribute("data-scene", f1.id);
  await expect(page.locator("main")).toHaveAttribute(
    "data-floor-images",
    JSON.stringify([f1.art.ground]),
  );
  await page.keyboard.press("m");
  await expect(
    page.getByRole("heading", { name: "当前楼层地图 · F1" }),
  ).toBeVisible();
  await expect(
    page.getByRole("img", { name: `${f2.name}通道平面`, exact: true }),
  ).toHaveCount(0);
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
  await assertFraming(page, 0.075);
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

test("camera adapts to the rendered player and viewport with manual scale retained", async ({
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
  await expect(zoom).toHaveText("100%");
  await assertFraming(page, 0.0875);
  await expect(page.locator(".world-scale")).toHaveCount(0);
  await assertAvatarScale(page, scene);
  await page.screenshot({ path: "test-results/default-camera.png" });
  const maximum = await maximumFraming(page, scene);
  await expect(plus).toBeDisabled();
  await assertAvatarScale(page, scene);
  await page.screenshot({ path: "test-results/maximum-camera.png" });
  await page.getByRole("button", { name: /回到广场/ }).click();
  await expect(zoom).toHaveText(maximum);
  while (await minus.isEnabled()) await minus.click();
  await expect(zoom).toHaveText("12.5%");
  await expect(minus).toBeDisabled();
  await assertAvatarScale(page, scene);
});

/** Every enabled step changes the actual view. Compare the closest view to the
 * native PNG dimensions served to this browser, independently of art metadata. */
async function maximumFraming(page: Page, scene: SceneMap) {
  const plus = page.getByRole("button", { name: "放大视野" });
  const main = page.locator("main");
  let previous = Number(await main.getAttribute("data-camera-zoom"));
  for (let i = 0; i < 10 && (await plus.isEnabled()); i++) {
    await plus.click();
    const actual = Number(await main.getAttribute("data-camera-zoom"));
    expect(actual).toBeGreaterThan(previous);
    previous = actual;
  }
  await expect(plus).toBeDisabled();
  const label = await page.locator(".zoom-controls span").innerText();
  const maximum = parseFloat(label);
  expect(maximum).toBeGreaterThan(100);
  expect(maximum).toBeLessThanOrEqual(200);
  const naturalWidth = await page.evaluate(async (image) => {
    const native = new Image();
    native.src = `/maps/${image}`;
    await native.decode();
    return native.naturalWidth;
  }, scene.art.ground);
  const density = naturalWidth / (scene.width * scene.tileSize);
  expect(previous / density).toBeLessThanOrEqual(6.001);
  return label;
}

/** In these scenes the foot-follow camera is clear of the map edge. Measure the
 * rendered hairline above the camera center; foreground can cover the shoes. */
async function assertFraming(page: Page, fraction: number) {
  const canvas = page.locator(".canvas-host canvas");
  const main = page.locator("main");
  await expect
    .poll(async () => {
      const rect = await canvas.boundingBox();
      return (
        (Number(await main.getAttribute("data-avatar-height")) *
          Number(await main.getAttribute("data-camera-zoom"))) /
        (rect?.height ?? 1)
      );
    })
    .toBeCloseTo(fraction, 3);
  const { data, info } = await sharp(await canvas.screenshot())
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const foot = info.height / 2;
  const center = info.width / 2;
  let top = foot;
  for (let y = Math.floor(foot - info.height * 0.2); y < foot; y++) {
    for (
      let x = Math.floor(center - info.width * 0.025);
      x <= center + info.width * 0.025;
      x++
    ) {
      const k = (y * info.width + x) * 3;
      if (data[k] === 0x45 && data[k + 1] === 0x38 && data[k + 2] === 0x2c)
        top = Math.min(top, y);
    }
  }
  expect(top).toBeLessThan(foot);
  const actual = (foot - top) / info.height;
  expect(Math.abs(actual - fraction)).toBeLessThan(0.012);
}

test("manual framing follows the player indoors up to the native pixel detail limit", async ({
  page,
}) => {
  test.setTimeout(120_000);
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
  const campus = world.scenes[0],
    c2 = campus.portals.find((p) => p.buildingId === "C2")!;
  const plus = page.getByRole("button", { name: "放大视野" });
  await plus.click();
  await page.clock.runFor(160);
  await assertFraming(page, 0.0875 * 1.25);
  await walkThroughEntrance(page, campus, c2);
  await expect(page.locator("main")).toHaveAttribute(
    "data-scene",
    c2.targetScene,
  );
  await page.clock.runFor(150);
  await expect(page.locator(".zoom-controls span")).toHaveText("125%");
  await assertFraming(page, 0.0875 * 1.25);
  const indoor = world.scenes.find((s) => s.id === c2.targetScene)!;
  const maximum = await maximumFraming(page, indoor);
  await page.keyboard.press("m");
  await page.keyboard.press("Escape");
  await expect(page.locator(".zoom-controls span")).toHaveText(maximum);
});

test("resizing a live canvas recalculates the camera at the user's selected zoom", async ({
  page,
}) => {
  await page.goto("/");
  await expect.poll(() => position(page, "x")).toBeGreaterThan(0);
  await page.getByRole("button", { name: "放大视野" }).click();
  await page.setViewportSize({ width: 740, height: 410 });
  await expect
    .poll(async () => (await page.locator("canvas").boundingBox())!.height)
    .toBeLessThan(400);
  await assertFraming(page, 0.075 * 1.25);
});
