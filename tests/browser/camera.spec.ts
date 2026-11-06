import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import type { WorldMap } from "../../src/shared/world";
import { position, walkThroughEntrance } from "./walking";
const world: WorldMap = JSON.parse(
  readFileSync(
    new URL("../../public/maps/world.json", import.meta.url),
    "utf8",
  ),
);
const value = (page: Page, key: string) =>
  page.locator("main").getAttribute(`data-${key}`).then(Number);
async function ready(page: Page) {
  await page.clock.install();
  await page.goto("/");
  await expect.poll(() => position(page, "x")).toBeGreaterThan(0);
  await page.clock.pauseAt(new Date(Date.now() + 1000));
}
async function drag(page: Page, dx: number, dy: number) {
  const b = (await page.locator("canvas").boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + dx, b.y + b.height / 2 + dy, {
    steps: 6,
  });
  await page.mouse.up();
  await page.clock.runFor(150);
}
test("mouse wheel, anchored free-view zoom, bounded drag and return leave the avatar safe", async ({
  page,
}) => {
  await ready(page);
  const main = page.locator("main"),
    zoom = page.locator(".zoom-controls span"),
    canvas = page.locator("canvas");
  const b = (await canvas.boundingBox())!;
  const feet = { x: await position(page, "x"), y: await position(page, "y") };
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.wheel(0, -120);
  await page.clock.runFor(150);
  await expect(zoom).toHaveText("125%");
  await expect(main).toHaveAttribute("data-camera-mode", "follow");
  const before = await value(page, "camera-x"),
    scale = await value(page, "camera-zoom");
  await drag(page, -180, -60);
  await expect(main).toHaveAttribute("data-camera-mode", "free");
  expect((await value(page, "camera-x")) - before).toBeCloseTo(180 / scale, 1);
  await page.keyboard.down("d");
  await page.clock.runFor(400);
  await page.keyboard.up("d");
  expect(await position(page, "x")).toBe(feet.x);
  expect(await position(page, "y")).toBe(feet.y);
  const px = b.width * 0.7,
    py = b.height * 0.4;
  const at = async () => ({
    x:
      (await value(page, "camera-x")) +
      (px - b.width / 2) / (await value(page, "camera-zoom")),
    y:
      (await value(page, "camera-y")) +
      (py - b.height / 2) / (await value(page, "camera-zoom")),
  });
  const anchor = await at();
  await page.mouse.move(b.x + px, b.y + py);
  await page.mouse.wheel(0, -120);
  await page.clock.runFor(150);
  await expect(zoom).toHaveText("150%");
  const after = await at();
  expect(Math.hypot(after.x - anchor.x, after.y - anchor.y)).toBeLessThan(0.2);
  await page.screenshot({ path: "test-results/free-camera.png" });
  const center = {
    x: await value(page, "camera-x"),
    y: await value(page, "camera-y"),
  };
  await page.setViewportSize({ width: 1200, height: 850 });
  await page.clock.runFor(200);
  expect(await value(page, "camera-x")).toBeCloseTo(center.x, 1);
  expect(await value(page, "camera-y")).toBeCloseTo(center.y, 1);
  await drag(page, -20000, -20000);
  expect(await value(page, "camera-x")).toBeLessThan(
    world.scenes[0].width * 16,
  );
  expect(await value(page, "camera-y")).toBeLessThan(
    world.scenes[0].height * 16,
  );
  await page.getByRole("button", { name: "回到角色", exact: true }).click();
  await page.clock.runFor(160);
  await expect(main).toHaveAttribute("data-camera-mode", "follow");
  await expect(zoom).toHaveText("150%");
  expect(await value(page, "camera-x")).toBeCloseTo(feet.x, 0);
  await page.getByRole("button", { name: "自由查看", exact: true }).click();
  await page.keyboard.press("c");
  await expect(main).toHaveAttribute("data-camera-mode", "follow");
  await page.keyboard.down("d");
  await page.clock.runFor(300);
  await page.keyboard.up("d");
  await page.clock.runFor(120);
  expect(await position(page, "x")).toBeGreaterThan(feet.x);
});
test("indoor free view preserves zoom and cancels a drag when a dialog opens", async ({
  page,
}) => {
  test.setTimeout(120000);
  await ready(page);
  await walkThroughEntrance(
    page,
    world.scenes[0],
    world.scenes[0].portals.find((p) => p.id === "enter_c2")!,
  );
  await drag(page, 100, 60);
  await expect(page.locator("main")).toHaveAttribute(
    "data-camera-mode",
    "free",
  );
  const b = (await page.locator("canvas").boundingBox())!;
  await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width / 2 + 50, b.y + b.height / 2);
  await page.keyboard.press("m");
  await expect(page.getByRole("dialog")).toBeVisible();
  const x = await value(page, "camera-x"),
    z = await value(page, "camera-zoom");
  await page.mouse.move(b.x + b.width / 2 + 120, b.y + b.height / 2);
  await page.mouse.wheel(0, -120);
  await page.mouse.up();
  await page.clock.runFor(180);
  expect(await value(page, "camera-x")).toBe(x);
  expect(await value(page, "camera-zoom")).toBe(z);
  await page.keyboard.press("Escape");
  await page.keyboard.press("c");
  await page.clock.runFor(150);
  await expect(page.locator("main")).toHaveAttribute(
    "data-camera-mode",
    "follow",
  );
  await expect(page.locator("main")).toHaveAttribute(
    "data-scene",
    "interior_c2",
  );
});
test("touch map drag cancels cleanly and does not steal the walking joystick", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 844, height: 390 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  await ready(page);
  const session = await context.newCDPSession(page),
    b = (await page.locator("canvas").boundingBox())!;
  const point = { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [point],
  });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: point.x + 100, y: point.y + 30 }],
  });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchCancel",
    touchPoints: [],
  });
  await page.clock.runFor(150);
  await expect(page.locator("main")).toHaveAttribute(
    "data-camera-mode",
    "free",
  );
  await expect(page.getByLabel("移动摇杆")).toBeHidden();
  const camera = await value(page, "camera-x");
  await page.mouse.move(point.x - 50, point.y);
  await page.clock.runFor(150);
  expect(await value(page, "camera-x")).toBe(camera);
  await page.getByRole("button", { name: "回到角色", exact: true }).tap();
  await expect(page.getByLabel("移动摇杆")).toBeVisible();
  const joystick = (await page.getByLabel("移动摇杆").boundingBox())!,
    x = await position(page, "x");
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [
      {
        x: joystick.x + joystick.width / 2 + 30,
        y: joystick.y + joystick.height / 2,
      },
    ],
  });
  await page.clock.runFor(300);
  await session.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await page.clock.runFor(150);
  await expect(page.locator("main")).toHaveAttribute(
    "data-camera-mode",
    "follow",
  );
  expect(await position(page, "x")).toBeGreaterThan(x);
  await context.close();
});
