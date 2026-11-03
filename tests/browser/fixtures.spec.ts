import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import type { WorldMap } from "../../src/shared/world";
import { driveTo, position } from "./walking";

test("C7 F2 bookshelf stops the avatar; the adjoining aisle remains walkable", async ({
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
  const campus = world.scenes[0],
    entry = campus.portals.find((p) => p.buildingId === "C7")!;
  await driveTo(page, campus, entry);
  await page.locator(`[data-portal="${entry.id}"]`).click();
  const f1 = world.scenes.find((s) => s.id === "interior_c7")!;
  await expect(page.locator("main")).toHaveAttribute("data-scene", f1.id);
  const up = f1.portals.find(
    (p) => p.sourceRoadId === "488" && p.targetScene === "interior_library_f2",
  )!;
  await driveTo(page, f1, up);
  await page.locator(`[data-portal="${up.id}"]`).click();
  const f2 = world.scenes.find((s) => s.id === up.targetScene)!;
  await expect(page.locator("main")).toHaveAttribute("data-scene", f2.id);
  expect(f2.fixtureCollision?.sourceIds).toContain(143663);
  await driveTo(page, f2, { x: 94, y: 78 });
  const walk = async (key: string, ms: number) => {
    await page.keyboard.down(key);
    await page.clock.runFor(ms);
    await page.keyboard.up(key);
    await page.clock.runFor(150);
  };
  await walk("a", 700);
  const stopped = await position(page, "x");
  expect(stopped).toBeGreaterThanOrEqual(89);
  expect(stopped).toBeLessThan(92);
  await walk("a", 400);
  expect(await position(page, "x")).toBeCloseTo(stopped, 1);
  await page.screenshot({
    path: "test-results/library-f2-bookshelf-aisle.png",
  });
  await walk("d", 350);
  expect(await position(page, "x")).toBeGreaterThan(stopped + 5);
});
