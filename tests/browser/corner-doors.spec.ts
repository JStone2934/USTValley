import { readFileSync } from "node:fs";
import { test, expect } from "@playwright/test";
import { doorCollision } from "../../src/shared/doors";
import type { Point, WorldMap } from "../../src/shared/world";
import { driveTo, position, steerTo, walkThroughEntrance } from "./walking";

const world: WorldMap = JSON.parse(
  readFileSync(
    new URL("../../public/maps/world.json", import.meta.url),
    "utf8",
  ),
);
test.use({ hasTouch: true });
test("walk from campus through both E3 F4 meeting-room doors into 403 and return", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await page.clock.install();
  await page.goto("/");
  await expect.poll(() => position(page, "x")).toBeGreaterThan(0);
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  const scene = (id: string) => world.scenes.find((s) => s.id === id)!;
  const campus = scene("campus_core"),
    main = page.locator("main");
  await walkThroughEntrance(
    page,
    campus,
    campus.portals.find((p) => p.id === "enter_e1")!,
  );
  for (const [id, portal] of [
    ["interior_e1", "connector_east_2431_0"],
    ["interior_east_f2", "connector_east_4234_0"],
  ]) {
    const s = scene(id),
      p = s.portals.find((p) => p.id === portal)!;
    await driveTo(page, s, p);
    await page.locator(`[data-portal="${p.id}"]`).click();
    await expect(main).toHaveAttribute("data-scene", p.targetScene);
  }
  const s = scene("interior_east_f4");
  const east = s.doors!.find((d) => d.id === "door_interior_east_f4_382479_1")!;
  const west = s.doors!.find((d) => d.id === "door_interior_east_f4_382479_0")!;
  const office = s.doors!.find((d) => d.sourceId === 382471)!;
  const open = doorCollision(s, new Set([east.id, west.id, office.id]));
  const steer = (target: Point) => steerTo(page, s, target);
  await driveTo(page, s, east.outside, undefined, true);
  await steer(east.outside);
  for (const [door, from, to] of [
    [east, east.outside, east.inside],
    [west, west.inside, west.outside],
    [office, office.outside, office.inside],
  ] as const) {
    await driveTo(page, open, from, undefined, true);
    await steer(from);
    await steer(to);
    await expect(main).toHaveAttribute("data-open-doors", new RegExp(door.id));
  }
  await page.screenshot({ path: "test-results/e3-f4-403-open.png" });
  for (const [door, from, to] of [
    [office, office.inside, office.outside],
    [west, west.outside, west.inside],
    [east, east.inside, east.outside],
  ] as const) {
    await driveTo(page, open, from, undefined, true);
    await steer(from);
    await steer(to);
    await expect(main).toHaveAttribute("data-open-doors", new RegExp(door.id));
  }
  await expect(main).toHaveAttribute("data-scene", s.id);
});
