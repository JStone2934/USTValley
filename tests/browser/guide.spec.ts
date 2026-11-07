import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import type { WorldMap, Point } from "../../src/shared/world";
import { position, steerTo } from "./walking";
const world: WorldMap = JSON.parse(
  readFileSync(
    new URL("../../public/maps/world.json", import.meta.url),
    "utf8",
  ),
);
test("a player follows the visible guide into C2, continues indoors, then cancels without teleporting", async ({
  browser,
}) => {
  test.setTimeout(180000);
  const context = await browser.newContext({
    viewport: { width: 1280, height: 960 },
    hasTouch: true,
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.clock.install();
  await page.goto("/");
  await expect.poll(() => position(page, "x")).toBeGreaterThan(0);
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  await page.getByRole("button", { name: "手账", exact: true }).click();
  await page.getByRole("tab", { name: "建筑印记" }).click();
  const before = { x: await position(page, "x"), y: await position(page, "y") };
  await page.getByRole("button", { name: "步行前往 C2", exact: true }).click();
  const settle = async () => {
    await expect
      .poll(
        async () => {
          await page.clock.runFor(150);
          return page.locator("main").getAttribute("data-guide-status");
        },
        { timeout: 15000 },
      )
      .toMatch(/walking|arrived/);
  };
  await settle();
  expect({
    x: await position(page, "x"),
    y: await position(page, "y"),
  }).toEqual(before);
  await expect(page.locator(".walking-guide")).toContainText("C2");
  await page.screenshot({ path: "test-results/guide-outdoor.png" });
  const campus = world.scenes[0];
  let points: Point[] = JSON.parse(
    (await page.locator("main").getAttribute("data-guide-points"))!,
  );
  for (const p of points.slice(1)) await steerTo(page, campus, p);
  await page.keyboard.press("e");
  await expect
    .poll(
      async () => {
        await page.clock.runFor(150);
        return page.locator("main").getAttribute("data-scene");
      },
      { timeout: 15000 },
    )
    .toBe("interior_c2");
  await settle();
  await expect(page.locator("main")).toHaveAttribute("data-guide-target", "C2");
  const indoor = world.scenes.find((s) => s.id === "interior_c2")!;
  points = JSON.parse(
    (await page.locator("main").getAttribute("data-guide-points"))!,
  );
  for (const p of points.slice(1)) await steerTo(page, indoor, p);
  await page.clock.runFor(1300);
  await settle();
  await expect(page.locator("main")).toHaveAttribute(
    "data-guide-status",
    "arrived",
  );
  await expect(page.locator(".progress-card strong")).toHaveText("1 / 15");
  await page.getByRole("button", { name: "楼层全景", exact: true }).click();
  await page.clock.runFor(150);
  await page.screenshot({ path: "test-results/guide-indoor-exterior.png" });
  await page.getByRole("button", { name: "停止步行指引" }).click();
  await expect(page.locator("main")).toHaveAttribute(
    "data-guide-status",
    "off",
  );
  expect(errors).toEqual([]);
  await context.close();
});
test("mobile route tracking and 3D markers coexist with movement and the journal", async ({
  browser,
}) => {
  test.setTimeout(90000);
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  await page.goto("/");
  await expect.poll(() => position(page, "x")).toBeGreaterThan(0);
  await page.getByRole("button", { name: "手账", exact: true }).click();
  await page.getByRole("tab", { name: "建筑印记" }).click();
  await page.getByRole("button", { name: "步行前往 C7", exact: true }).click();
  await expect(page.locator("main")).toHaveAttribute(
    "data-guide-status",
    "walking",
    { timeout: 15000 },
  );
  await page.getByRole("button", { name: "3D 环视", exact: true }).click();
  await expect(page.locator(".orbit-host")).toHaveAttribute(
    "data-ready",
    "true",
    { timeout: 45000 },
  );
  await expect(page.getByLabel("移动摇杆")).toBeVisible();
  await page.screenshot({ path: "test-results/guide-mobile-orbit.png" });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.getByRole("button", { name: "手账", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.getByRole("button", { name: "关闭面板" }).click();
  await page.getByRole("button", { name: "停止步行指引" }).click();
  await expect(page.locator(".walking-guide")).toHaveCount(0);
  await context.close();
});
