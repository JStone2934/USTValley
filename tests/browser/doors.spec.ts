import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { doorCollision } from "../../src/shared/doors";
import type { WorldMap } from "../../src/shared/world";
import { driveTo, position } from "./walking";

test("walk into the C2 knowledge-transfer office, close from inside, and walk back out", async ({
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
  const campus = world.scenes[0];
  await driveTo(
    page,
    campus,
    campus.portals.find((p) => p.buildingId === "C2")!,
  );
  await page.keyboard.press("e");
  const room = world.scenes.find((s) => s.id === "interior_c2")!;
  await expect(page.locator("main")).toHaveAttribute("data-scene", room.id);
  const door = room.doors!.find(
    (d) => d.sourceId === 71686 && d.id.endsWith("_0"),
  )!;
  const action = page.locator(`[data-portal="${door.id}"]`);
  await driveTo(page, room, door.outside);
  await expect(action).toContainText(`开门 · ${door.room}`);
  const key = door.inside.y > door.outside.y ? "s" : "w";
  await page.keyboard.down(key);
  await page.clock.runFor(600);
  await page.keyboard.up(key);
  await page.clock.runFor(150);
  expect(Math.abs((await position(page, "y")) - door.outside.y)).toBeLessThan(
    2,
  );
  await page.screenshot({ path: "test-results/c2-office-door-closed.png" });
  await page.keyboard.press("e");
  await expect(action).toContainText("关门");
  const open = doorCollision(room, new Set([door.id]));
  await driveTo(page, open, door.inside);
  expect(Math.abs((await position(page, "y")) - door.inside.y)).toBeLessThan(
    1.5,
  );
  await action.click();
  await expect(action).toContainText("开门");
  await action.click();
  await expect(action).toContainText("关门");
  await page.screenshot({ path: "test-results/c2-office-door-open.png" });
  await driveTo(page, open, door.outside);
  expect(Math.abs((await position(page, "y")) - door.outside.y)).toBeLessThan(
    1.5,
  );
  await page.keyboard.press("e");
  await expect(action).toContainText("开门");
});
