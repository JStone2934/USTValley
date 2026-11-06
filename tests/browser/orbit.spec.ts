import { test, expect } from "@playwright/test";
const position = async (page: import("@playwright/test").Page) => ({
  x: Number(await page.locator("main").getAttribute("data-x")),
  y: Number(await page.locator("main").getAttribute("data-y")),
});
test("true 3D orbit rotates buildings, zooms and pans while the player keeps walking", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto("/");
  await expect.poll(async () => (await position(page)).x).toBeGreaterThan(0);
  await page.getByRole("button", { name: "3D 环视", exact: true }).click();
  const orbit = page.locator(".orbit-host");
  await expect(orbit).toHaveAttribute("data-ready", "true", { timeout: 45000 });
  const data = async (key: string) =>
    Number(
      await orbit.getAttribute(
        `data-${key.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase())}`,
      ),
    );
  expect(await data("triangles")).toBeGreaterThan(30000);
  await page.getByRole("button", { name: "校园全景", exact: true }).click();
  await page.screenshot({ path: "test-results/orbit-front.png" });
  const before = await position(page),
    yaw = await data("yaw");
  const b = (await orbit.boundingBox())!;
  await page.mouse.move(b.x + b.width * 0.6, b.y + b.height * 0.55);
  await page.mouse.down();
  await page.mouse.move(b.x + b.width * 0.2, b.y + b.height * 0.64, {
    steps: 15,
  });
  await page.mouse.up();
  await expect
    .poll(async () => Math.abs((await data("yaw")) - yaw))
    .toBeGreaterThan(1);
  await page.screenshot({ path: "test-results/orbit-back.png" });
  expect(await position(page)).toEqual(before);
  expect(await data("pitch")).toBeGreaterThan(0.25);
  expect(await data("pitch")).toBeLessThan(1.36);
  const distance = await data("distance");
  await page.mouse.wheel(0, -240);
  await expect.poll(() => data("distance")).toBeLessThan(distance);
  const target = await data("targetX");
  await page.mouse.down({ button: "right" });
  await page.mouse.move(b.x + b.width * 0.4, b.y + b.height * 0.55, {
    steps: 8,
  });
  await page.mouse.up({ button: "right" });
  await page.waitForTimeout(800);
  await expect
    .poll(async () => Math.abs((await data("targetX")) - target))
    .toBeGreaterThan(1);
  await page.keyboard.down("d");
  await page.waitForTimeout(900);
  await page.keyboard.up("d");
  await expect
    .poll(async () => {
      const p = await position(page);
      return Math.hypot(p.x - before.x, p.y - before.y);
    })
    .toBeGreaterThan(1);
  await page.getByLabel("定位建筑").selectOption("C2");
  expect(await data("distance")).toBeGreaterThan(700);
  expect(await data("distance")).toBeLessThan(1600);
  await page.screenshot({ path: "test-results/orbit-building.png" });
  await page.keyboard.press("m");
  await expect(page.getByRole("dialog")).toBeVisible();
  const pausedPosition = await position(page),
    pausedYaw = await data("yaw");
  await page.keyboard.down("d");
  await page.waitForTimeout(250);
  await page.keyboard.up("d");
  expect(await position(page)).toEqual(pausedPosition);
  expect(await data("yaw")).toBe(pausedYaw);
  await page.keyboard.press("Escape");
  await page.keyboard.press("c");
  await expect.poll(() => data("distance")).toBeCloseTo(110, -1);
  await page.getByRole("button", { name: "退出 3D 环视" }).click();
  await expect(orbit).toHaveCount(0);
  await expect(page.locator(".canvas-host canvas")).toBeVisible();
  await page.getByRole("button", { name: "3D 环视", exact: true }).click();
  await expect(page.locator(".orbit-host")).toHaveAttribute(
    "data-ready",
    "true",
    { timeout: 45000 },
  );
  await page.getByRole("button", { name: "退出 3D 环视" }).click();
  await expect(page.locator("canvas")).toHaveCount(1);
  expect(errors).toEqual([]);
});
test("failed 3D download can return to the existing walking view", async ({
  page,
}) => {
  await page.route("**/orbit/campus.glb", (route) => route.abort());
  await page.goto("/");
  await expect.poll(async () => (await position(page)).x).toBeGreaterThan(0);
  await page.getByRole("button", { name: "3D 环视", exact: true }).click();
  await expect(page.locator(".orbit-message")).toContainText("加载失败", {
    timeout: 45000,
  });
  await page.getByRole("button", { name: "返回漫游", exact: true }).click();
  await expect(page.locator(".orbit-host")).toHaveCount(0);
  const before = await position(page);
  await page.keyboard.down("d");
  await page.waitForTimeout(500);
  await page.keyboard.up("d");
  await expect
    .poll(async () => (await position(page)).x)
    .toBeGreaterThan(before.x);
});

test("entering a real doorway exits orbit and keeps the indoor walking scene", async ({
  page,
}) => {
  test.setTimeout(120000);
  const { readFileSync } = await import("node:fs");
  const { walkThroughEntrance } = await import("./walking");
  const world = JSON.parse(
    readFileSync(
      new URL("../../public/maps/world.json", import.meta.url),
      "utf8",
    ),
  );
  await page.goto("/");
  await expect.poll(async () => (await position(page)).x).toBeGreaterThan(0);
  await page.getByRole("button", { name: "3D 环视", exact: true }).click();
  await expect(page.locator(".orbit-host")).toHaveAttribute(
    "data-ready",
    "true",
    { timeout: 45000 },
  );
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 100));
  const campus = world.scenes[0];
  await walkThroughEntrance(
    page,
    campus,
    campus.portals.find((p: { id: string }) => p.id === "enter_c2"),
  );
  await expect(page.locator("main")).toHaveAttribute(
    "data-scene",
    "interior_c2",
  );
  await expect(page.locator(".orbit-host")).toHaveCount(0);
  await page.clock.runFor(200);
  await expect(
    page.getByRole("button", { name: "楼层全景", exact: true }),
  ).toBeVisible();
});

test("portrait touch rotation, cancellation, zoom and joystick remain independent", async ({
  browser,
}) => {
  const context = await browser.newContext({
    viewport: { width: 390, height: 844 },
    hasTouch: true,
    isMobile: true,
  });
  const page = await context.newPage();
  await page.goto("/");
  await expect.poll(async () => (await position(page)).x).toBeGreaterThan(0);
  await page.getByRole("button", { name: "3D 环视", exact: true }).click();
  const orbit = page.locator(".orbit-host");
  await expect(orbit).toHaveAttribute("data-ready", "true", { timeout: 45000 });
  await page.getByRole("button", { name: "校园全景", exact: true }).click();
  const session = await context.newCDPSession(page),
    b = (await orbit.boundingBox())!;
  const point = { x: b.x + b.width * 0.5, y: b.y + b.height * 0.55 };
  const yaw = Number(await orbit.getAttribute("data-yaw"));
  const feet = await position(page);
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [point],
  });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [{ x: point.x + 80, y: point.y - 30 }],
  });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchCancel",
    touchPoints: [],
  });
  await expect
    .poll(async () =>
      Math.abs(Number(await orbit.getAttribute("data-yaw")) - yaw),
    )
    .toBeGreaterThan(0.3);
  expect(await position(page)).toEqual(feet);
  const distance = Number(await orbit.getAttribute("data-distance"));
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [
      { x: point.x - 25, y: point.y },
      { x: point.x + 25, y: point.y },
    ],
  });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchMove",
    touchPoints: [
      { x: point.x - 60, y: point.y },
      { x: point.x + 60, y: point.y },
    ],
  });
  await session.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect
    .poll(async () => Number(await orbit.getAttribute("data-distance")))
    .toBeLessThan(distance);
  const joystick = (await page.getByLabel("移动摇杆").boundingBox())!;
  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [
      {
        x: joystick.x + joystick.width / 2 + 26,
        y: joystick.y + joystick.height / 2,
      },
    ],
  });
  await page.waitForTimeout(600);
  await session.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  await expect
    .poll(async () => {
      const p = await position(page);
      return Math.hypot(p.x - feet.x, p.y - feet.y);
    })
    .toBeGreaterThan(1);
  await page.getByRole("button", { name: "校园全景", exact: true }).click();
  await page.screenshot({ path: "test-results/orbit-portrait.png" });
  await page.getByRole("button", { name: "退出 3D 环视" }).click();
  await expect(orbit).toHaveCount(0);
  await context.close();
});
