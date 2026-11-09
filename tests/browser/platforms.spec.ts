import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { canStand, canTraverse, type WorldMap } from "../../src/shared/world";
import { supportHeightMeters } from "../../src/shared/w1-layout";
import { newProgress } from "../../src/shared/journey";
const world = JSON.parse(
  readFileSync(
    new URL("../../public/maps/world.json", import.meta.url),
    "utf8",
  ),
) as WorldMap;
for (const f of [4, 5, 6])
  test(`W1 F${f} automatically steps onto and off the 30 cm platform`, async ({
    page,
  }) => {
    const s = world.scenes.find((s) => s.id === `interior_west_f${f}`)!;
    let crossing: { x: number; y: number } | undefined;
    for (const platform of s.w1Layout!.platforms) {
      if (crossing) break;
      const vs = platform.polygons.flat(2),
        left = Math.min(...vs.map((v) => v.x)),
        right = Math.max(...vs.map((v) => v.x)),
        top = Math.min(...vs.map((v) => v.y)),
        bottom = Math.max(...vs.map((v) => v.y));
      for (let x = left + 3; x < right - 3 && !crossing; x += 2)
        for (let y = top + 3; y < bottom - 3 && !crossing; y += 2) {
          const inside = { x, y },
            outside = { x, y: y - 8 };
          if (
            supportHeightMeters(s, inside) === 0.3 &&
            supportHeightMeters(s, outside) === 0 &&
            canStand(s, inside) &&
            canStand(s, outside) &&
            canTraverse(s, outside, inside)
          )
            crossing = outside;
        }
    }
    expect(crossing).toBeTruthy();
    await page.clock.install();
    await page.addInitScript(
      (p) => localStorage.setItem("ustvalley.journey.v1", JSON.stringify(p)),
      {
        ...newProgress(),
        location: { sceneId: s.id, mapVersion: world.mapVersion, ...crossing! },
      },
    );
    await page.goto("/");
    await expect(page.locator("main")).toHaveAttribute("data-scene", s.id);
    await page.clock.pauseAt(new Date(Date.now() + 1000));
    await expect(page.locator("main")).toHaveAttribute(
      "data-support-height",
      "0",
    );
    await page.keyboard.down("s");
    let steps = 0;
    while (
      (await page.locator("main").getAttribute("data-support-height")) !==
        "0.3" &&
      steps++ < 50
    )
      await page.clock.runFor(50);
    await page.keyboard.up("s");
    await page.clock.runFor(100);
    await expect(page.locator("main")).toHaveAttribute(
      "data-support-height",
      "0.3",
    );
    const physical = Number(await page.locator("main").getAttribute("data-y")),
      visual = Number(
        await page.locator("main").getAttribute("data-avatar-foot-y"),
      );
    expect(physical - visual).toBeCloseTo(
      0.3 * s.units.pixelsPerMeter * s.units.heightProjection,
      0,
    );
    await page.screenshot({ path: `test-results/w1-f${f}-on-platform.png` });
    await page.keyboard.down("w");
    steps = 0;
    while (
      (await page.locator("main").getAttribute("data-support-height")) !==
        "0" &&
      steps++ < 50
    )
      await page.clock.runFor(50);
    await page.keyboard.up("w");
    await page.clock.runFor(100);
    await expect(page.locator("main")).toHaveAttribute(
      "data-support-height",
      "0",
    );
    const ground = Number(await page.locator("main").getAttribute("data-y")),
      foot = Number(
        await page.locator("main").getAttribute("data-avatar-foot-y"),
      );
    expect(Math.abs(ground - foot)).toBeLessThan(0.3);
  });
