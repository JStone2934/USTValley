import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { doorCollision } from "../../src/shared/doors";
import type { WorldMap } from "../../src/shared/world";
import { driveTo, position, walkThroughEntrance } from "./walking";

const world: WorldMap = JSON.parse(
  readFileSync(
    new URL("../../public/maps/world.json", import.meta.url),
    "utf8",
  ),
);
const room = world.scenes.find((s) => s.id === "interior_c2")!;
const door = room.doors!.find(
  (d) => d.sourceId === 71686 && d.id.endsWith("_0"),
)!;
for (const touch of [false, true]) {
  test(`walk through a surveyed C2 office door in both directions using ${touch ? "the touch joystick" : "the keyboard"}`, async ({
    browser,
  }) => {
    test.setTimeout(180_000);
    const ctx = await browser.newContext(
      touch
        ? {
            viewport: { width: 844, height: 390 },
            hasTouch: true,
            isMobile: true,
          }
        : { viewport: { width: 1440, height: 960 } },
    );
    const page = await ctx.newPage();
    await page.clock.install();
    await page.goto("/");
    await expect.poll(() => position(page, "x")).toBeGreaterThan(0);
    await page.clock.pauseAt(new Date(Date.now() + 1000));
    const campus = world.scenes[0];
    await walkThroughEntrance(
      page,
      campus,
      campus.portals.find((p) => p.id === "enter_c2")!,
    );
    const main = page.locator("main"),
      action = page.locator(`[data-portal="${door.id}"]`);
    await driveTo(page, room, door.outside);
    const dx = Math.sign(door.inside.x - door.outside.x),
      dy = Math.sign(door.inside.y - door.outside.y);
    const key = (x: number, y: number) =>
      x > 0 ? "d" : x < 0 ? "a" : y > 0 ? "s" : "w";
    const travel = async (sign: number, ms: number) => {
      if (touch) {
        const box = (await page.getByLabel("移动摇杆").boundingBox())!;
        const session = await ctx.newCDPSession(page);
        await session.send("Input.dispatchTouchEvent", {
          type: "touchStart",
          touchPoints: [
            {
              x: box.x + box.width / 2 + dx * sign * 30,
              y: box.y + box.height / 2 + dy * sign * 30,
            },
          ],
        });
        await page.clock.runFor(ms);
        await session.send("Input.dispatchTouchEvent", {
          type: "touchEnd",
          touchPoints: [],
        });
        await session.detach();
      } else {
        const k = key(dx * sign, dy * sign);
        await page.keyboard.down(k);
        await page.clock.runFor(ms);
        await page.keyboard.up(k);
      }
      await page.clock.runFor(220);
    };
    await travel(1, 650);
    await expect(main).toHaveAttribute("data-open-doors", new RegExp(door.id));
    const advanced =
      ((await position(page, "x")) - door.outside.x) * dx +
      ((await position(page, "y")) - door.outside.y) * dy;
    expect(advanced).toBeGreaterThan(6);
    const open = doorCollision(room, new Set([door.id]));
    await driveTo(page, open, door.inside);
    await expect(action).toContainText("关门");
    await page.screenshot({
      path: `test-results/office-door-open-${touch ? "touch" : "desktop"}.png`,
    });
    await action.click();
    await expect(action).toContainText("开门");
    await page.clock.runFor(220);
    await page.screenshot({
      path: `test-results/office-door-closed-${touch ? "touch" : "desktop"}.png`,
    });
    await travel(-1, 650);
    expect(
      ((await position(page, "x")) - door.inside.x) * -dx +
        ((await position(page, "y")) - door.inside.y) * -dy,
    ).toBeGreaterThan(6);
    await driveTo(page, room, room.spawns[0]);
    await expect(main).not.toHaveAttribute(
      "data-open-doors",
      new RegExp(door.id),
    );
    await ctx.close();
  });
}
