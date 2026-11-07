import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import type { WorldMap } from "../../src/shared/world";
import { driveTo, position, walkThroughEntrance } from "./walking";
const world: WorldMap = JSON.parse(
  readFileSync(
    new URL("../../public/maps/world.json", import.meta.url),
    "utf8",
  ),
);
test("a real campus walk earns stamps and treasure, unlocks clothes, and survives reload", async ({
  page,
}) => {
  test.setTimeout(180000);
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.clock.install();
  await page.goto("/");
  await expect.poll(() => position(page, "x")).toBeGreaterThan(0);
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  await page.screenshot({ path: "test-results/journey-welcome.png" });
  await page.keyboard.press("e");
  await expect(page.getByRole("dialog")).toHaveAttribute("data-panel", "npc");
  await expect(page.locator(".npc-speech h3")).toHaveText("林同学");
  await page.screenshot({ path: "test-results/journey-dialogue.png" });
  const x = await position(page, "x");
  await page.keyboard.down("d");
  await page.clock.runFor(300);
  await page.keyboard.up("d");
  expect(await position(page, "x")).toBe(x);
  await page.getByRole("button", { name: "继续聊聊 →" }).click();
  await page.getByRole("button", { name: "这就去看看" }).click();
  await walkThroughEntrance(
    page,
    world.scenes[0],
    world.scenes[0].portals.find((p) => p.id === "enter_c2")!,
  );
  const inside = world.scenes.find((s) => s.id === "interior_c2")!,
    zone = inside.exploration[0];
  await driveTo(page, inside, {
    x: zone.x + zone.width / 2,
    y: zone.y + zone.height / 2,
  });
  await expect(page.locator("main")).toHaveAttribute("data-coins", "5");
  await driveTo(page, inside, inside.chests[0]);
  await page.clock.runFor(150);
  await page.getByRole("button", { name: /打开探索宝箱/ }).click();
  await page.clock.runFor(150);
  await expect(page.locator("main")).toHaveAttribute("data-coins", "30");
  await page.keyboard.press("e");
  await page.clock.runFor(150);
  await expect(page.locator("main")).toHaveAttribute("data-coins", "30");
  await page.screenshot({ path: "test-results/journey-interior.png" });
  await page.getByRole("button", { name: "衣橱", exact: true }).click();
  await page
    .getByRole("button", { name: "解锁 苔绿漫步", exact: true })
    .click();
  await page
    .getByRole("button", { name: "解锁 迎新鸭舌帽", exact: true })
    .click();
  await expect(page.locator("main")).toHaveAttribute("data-coins", "0");
  await expect(page.locator("main")).toHaveAttribute("data-outfit", "moss");
  await expect(page.locator("main")).toHaveAttribute("data-hat", "cap");
  await page.screenshot({ path: "test-results/journey-wardrobe.png" });
  await page.keyboard.press("Escape");
  await page.clock.runFor(150);
  await page.reload();
  await page.clock.runFor(1000);
  await expect
    .poll(
      async () => {
        await page.clock.runFor(150);
        return page.locator("main").getAttribute("data-scene");
      },
      { timeout: 15000 },
    )
    .toBe("interior_c2");
  await expect(page.locator("main")).toHaveAttribute("data-coins", "0");
  await expect(page.locator("main")).toHaveAttribute("data-outfit", "moss");
  await page.getByRole("button", { name: "手账", exact: true }).click();
  await expect(page.locator(".quest-card.complete")).toHaveCount(2);
  await page.screenshot({ path: "test-results/journey-journal.png" });
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "回到广场 ↺" }).click();
  await page.clock.runFor(500);
  await expect
    .poll(
      async () => {
        await page.clock.runFor(150);
        return page.locator("main").getAttribute("data-scene");
      },
      { timeout: 15000 },
    )
    .toBe("campus_core");
  await expect(page.locator(".progress-card strong")).toHaveText("1 / 15");
  await page.getByRole("button", { name: "3D 环视", exact: true }).click();
  await expect(page.locator(".orbit-host")).toHaveAttribute(
    "data-ready",
    "true",
    { timeout: 45000 },
  );
  await page.getByRole("button", { name: "回到角色", exact: true }).click();
  await page.clock.runFor(240);
  await page.screenshot({ path: "test-results/journey-orbit.png" });
  await expect(page.locator("main")).toHaveAttribute("data-outfit", "moss");
  await expect(page.locator("main")).toHaveAttribute("data-hat", "cap");
  expect(errors).toEqual([]);
});
test("mobile journal and wardrobe fit the screen, and blocked storage does not prevent play", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  await page.addInitScript(() => {
    Storage.prototype.setItem = function () {
      throw new Error("storage blocked");
    };
  });
  await page.goto("/");
  await expect.poll(() => position(page, "x")).toBeGreaterThan(0);
  await page.getByRole("button", { name: "手账", exact: true }).click();
  await page.getByRole("tab", { name: "建筑印记" }).click();
  await expect(page.locator(".building-stamp")).toHaveCount(15);
  await page.screenshot({ path: "test-results/journey-mobile-journal.png" });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(390);
  await page.getByRole("button", { name: "关闭面板" }).click();
  await page.getByRole("button", { name: "衣橱", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "解锁 苔绿漫步", exact: true }),
  ).toBeDisabled();
  await page.screenshot({ path: "test-results/journey-mobile-wardrobe.png" });
  await page.getByRole("button", { name: "关闭面板" }).click();
  await expect(page.getByLabel("移动摇杆")).toBeVisible();
  await context.close();
});
