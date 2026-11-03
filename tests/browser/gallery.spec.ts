import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import type { WorldMap } from "../../src/shared/world";
import { driveTo, position } from "./walking";

test("walk from the campus into C2, take a lift, and cross the F2 skybridge into the administration building and back", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.clock.install();
  await page.goto("/");
  await expect.poll(() => position(page, "x")).toBeGreaterThan(0);
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  const world: WorldMap = JSON.parse(
    readFileSync(
      new URL("../../public/maps/world.json", import.meta.url),
      "utf8",
    ),
  );
  const campus = world.scenes[0],
    entrance = campus.portals.find((p) => p.buildingId === "C2")!;
  const scene = (id: string) => world.scenes.find((s) => s.id === id)!;
  const f1 = scene(entrance.targetScene);
  await driveTo(page, campus, entrance);
  await page.keyboard.press("e");
  await expect(page.locator("main")).toHaveAttribute("data-scene", f1.id);
  const lift = f1.portals.find((p) => p.kind === "lift")!,
    f2 = scene(lift.targetScene);
  await driveTo(page, f1, lift);
  await page.locator(`[data-portal="${lift.id}"]`).click();
  await expect(page.locator("main")).toHaveAttribute("data-scene", f2.id);
  await page.locator(`[data-portal="${lift.targetPortal}"]`).click();
  await expect(page.locator("main")).toHaveAttribute("data-scene", f1.id);
  await page.locator(`[data-portal="${lift.id}"]`).click();
  await expect(page.locator("main")).toHaveAttribute("data-scene", f2.id);
  const gallery = f2.portals.find(
    (p) =>
      p.kind === "gallery" && p.targetScene === "interior_administration_f2",
  )!;
  const destination = scene(gallery.targetScene);
  // Walking into the seam crosses the two source sheets without an E press.
  await driveTo(page, f2, gallery, destination.id);
  await expect(page.locator("main")).toHaveAttribute("data-floor", "F2");
  await expect(page.locator(".topbar strong")).toContainText("行政办公楼");
  await page.clock.runFor(400);
  await expect(page.locator("main")).toHaveAttribute(
    "data-scene",
    destination.id,
  );
  await page.screenshot({
    path: "test-results/gallery-activity-administration.png",
  });
  const back = page.locator(`[data-portal="${gallery.targetPortal}"]`);
  await expect(back).toContainText("学生活动中心");
  await back.click();
  await expect(page.locator("main")).toHaveAttribute("data-scene", f2.id);
});
