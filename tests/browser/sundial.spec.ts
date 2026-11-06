import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { sundial, sundialViewpoints } from "../../src/shared/sundial";
import type { WorldMap } from "../../src/shared/world";
import { driveTo, position } from "./walking";

test.use({
  hasTouch: true,
  isMobile: true,
  viewport: { width: 844, height: 390 },
});

test("walk onto the real sundial crossing, read its field note with E and touch, and dismiss it", async ({
  page,
}) => {
  test.setTimeout(180_000);
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
    bridge = sundialViewpoints(scene)[0];
  const action = page.locator(".touch-controls > button");
  await expect(action).not.toHaveAccessibleName(sundial.action);
  await driveTo(page, scene, bridge, undefined, "smooth");
  await expect(action).toHaveAccessibleName(sundial.action);
  await page.keyboard.press("e");
  const note = page.getByRole("dialog", { name: sundial.title });
  await expect(note).toBeVisible();
  await expect(note).toContainText(sundial.note);
  const oldX = await position(page, "x");
  await page.keyboard.down("a");
  await page.clock.runFor(300);
  await page.keyboard.up("a");
  expect(await position(page, "x")).toBe(oldX);
  await page.keyboard.press("e");
  await expect(note).toBeHidden();
  await action.tap();
  await expect(note).toBeVisible();
  await page.screenshot({
    path: "test-results/red-bird-sundial-observation.png",
  });
  await note.getByRole("button", { name: "关闭面板" }).tap();
  await expect(note).toBeHidden();
  await page.keyboard.press("e");
  await expect(note).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(note).toBeHidden();
  await expect(page.locator("main")).toHaveAttribute("data-scene", scene.id);
});
