import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import type { WorldMap } from "../../src/shared/world";
import { driveTo, position, walkThroughEntrance } from "./walking";

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
  await walkThroughEntrance(page, campus, entry);
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

test("W1 F6 photo hoist blocks walking while the surrounding lab aisle remains open", async ({
  page,
}) => {
  await page.clock.install();
  await page.addInitScript(() =>
    localStorage.setItem(
      "ustvalley.journey.v1",
      JSON.stringify({
        schema: 1,
        coins: 0,
        discovered: [],
        talked: [],
        observations: [],
        completed: [],
        chestReadyAt: {},
        chestsOpened: 0,
        ownedOutfits: ["clay"],
        ownedHats: ["none"],
        outfit: "clay",
        hat: "none",
        location: {
          sceneId: "interior_west_f6",
          mapVersion: "core-pixel-3d-0.6.1",
          x: 605,
          y: 1125,
        },
      }),
    ),
  );
  await page.goto("/");
  await expect(page.locator("main")).toHaveAttribute(
    "data-scene",
    "interior_west_f6",
  );
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  const walk = async (key: string, ms: number) => {
    await page.keyboard.down(key);
    await page.clock.runFor(ms);
    await page.keyboard.up(key);
    await page.clock.runFor(150);
  };
  await walk("w", 1600);
  const stopped = await position(page, "y");
  expect(stopped).toBeGreaterThan(1112);
  expect(stopped).toBeLessThan(1122);
  await walk("w", 500);
  expect(await position(page, "y")).toBeCloseTo(stopped, 1);
  await walk("s", 600);
  await walk("a", 900);
  expect(await position(page, "x")).toBeLessThan(598);
});
