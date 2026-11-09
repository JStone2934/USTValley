import { photoProps } from "../../src/shared/photo-props";
import { newProgress } from "../../src/shared/journey";
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

test("W1 F6 photo hoist blocks walking after open-plan relocation", async ({
  page,
}) => {
  const w = JSON.parse(
    readFileSync(
      new URL("../../public/maps/world.json", import.meta.url),
      "utf8",
    ),
  ) as WorldMap;
  const s = w.scenes.find((s) => s.id === "interior_west_f6")!,
    hoist = photoProps(s).find((p) => p.kind === "hoist")!;
  const start = { x: hoist.x, y: hoist.y + 14 };
  await page.clock.install();
  await page.addInitScript(
    (p) => localStorage.setItem("ustvalley.journey.v1", JSON.stringify(p)),
    {
      ...newProgress(),
      location: { sceneId: s.id, mapVersion: w.mapVersion, ...start },
    },
  );
  await page.goto("/");
  await expect(page.locator("main")).toHaveAttribute("data-scene", s.id);
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  const walk = async (key: string, ms: number) => {
    await page.keyboard.down(key);
    await page.clock.runFor(ms);
    await page.keyboard.up(key);
    await page.clock.runFor(150);
  };
  await walk("w", 1800);
  const stopped = await position(page, "y");
  expect(stopped).toBeGreaterThan(hoist.y + 4);
  expect(stopped).toBeLessThan(hoist.y + 13);
  await walk("w", 500);
  expect(await position(page, "y")).toBeCloseTo(stopped, 1);
  await page.screenshot({ path: "test-results/w1-f6-equipment-closeup.png" });
  await walk("s", 650);
  await walk("a", 900);
  expect(await position(page, "x")).toBeLessThan(start.x - 4);
});
