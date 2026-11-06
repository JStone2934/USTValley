import { expect, test } from "@playwright/test";
import type { Point, WorldMap } from "../../src/shared/world";
import { inPolygon } from "../../scripts/source-geometry";
import { driveTo, position, walkThroughEntrance } from "./walking";

test("C2 exterior stops a sprint, allows passing the door, and changes scene at the sill in both directions", async ({
  page,
}) => {
  test.setTimeout(120_000);
  const world: WorldMap = await (
    await page.request.get("/maps/world.json")
  ).json();
  const campus = world.scenes[0];
  const gate = campus.portals.find((p) => p.id === "enter_c2")!;
  const outline = campus.art.roofs.find(
    (roof) => roof.id === "activity",
  )!.footprint;
  const { threshold: sill, toward: n, width } = gate.entrance!;
  const ppm = campus.units.pixelsPerMeter;
  const at = (depth: number, side: number) => ({
    x: sill.x + n.x * depth - n.y * side,
    y: sill.y + n.y * depth + n.x * side,
  });
  const alongWall = (p: Point) => -(p.x - sill.x) * n.y + (p.y - sill.y) * n.x;
  await page.clock.install();
  await page.goto("/");
  await expect.poll(() => position(page, "x")).toBeGreaterThan(0);
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  const main = page.locator("main");
  const outside = async () => {
    expect(await main.getAttribute("data-scene")).toBe(campus.id);
    const p = { x: await position(page, "x"), y: await position(page, "y") };
    expect(
      outline.some((polygon) => inPolygon(p, polygon)),
      JSON.stringify(p),
    ).toBe(false);
    return p;
  };
  const walk = async (keys: string[], ms: number) => {
    for (const key of keys) await page.keyboard.down(key);
    await page.clock.runFor(ms);
    for (const key of keys) await page.keyboard.up(key);
    await page.clock.runFor(130);
    return outside();
  };

  // Run east at C2's long oblique west wall, several metres north of the door.
  await driveTo(page, campus, at(-2 * ppm, -3 * ppm));
  const start = await outside();
  await page.keyboard.down("ShiftLeft");
  await page.keyboard.down("d");
  await page.clock.runFor(650);
  const stop = await outside();
  expect(stop.x - start.x).toBeGreaterThan(ppm * 0.5);
  expect(
    Math.abs((stop.x - sill.x) * n.x + (stop.y - sill.y) * n.y),
  ).toBeLessThan(ppm);
  for (let i = 0; i < 4; i++) {
    await page.clock.runFor(250);
    expect(await outside()).toEqual(stop);
  }
  await page.keyboard.up("d");
  await page.keyboard.up("ShiftLeft");
  expect(alongWall(stop)).toBeLessThan(-width);
  await page.screenshot({ path: "test-results/c2-exterior-wall.png" });

  // Stay on the pavement. Alternating south-west and south follows the
  // diagonal facade, sweeping past the entire mouth without entering it.
  await walk(["a"], 300);
  let foot = stop;
  for (let i = 0; i < 8 && alongWall(foot) <= width; i++) {
    await walk(["a", "s"], 320);
    foot = await walk(["s"], 275);
  }
  expect(alongWall(foot)).toBeGreaterThan(width);
  await walkThroughEntrance(page, campus, gate);
  await expect(main).toHaveAttribute("data-scene", gate.targetScene);
  const floor = world.scenes.find((s) => s.id === gate.targetScene)!;
  await walkThroughEntrance(
    page,
    floor,
    floor.portals.find((p) => p.id === gate.targetPortal)!,
  );
  const returned = await outside();
  expect(
    Math.hypot(returned.x - gate.spawn.x, returned.y - gate.spawn.y),
  ).toBeLessThan(ppm);
});
