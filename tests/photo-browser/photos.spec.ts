import { test, expect } from "@playwright/test";
import sharp from "sharp";
test("anonymous capture, preview, private list, admin map and export", async ({
  page,
  browser,
}) => {
  await page.goto("/");
  await expect(page.locator("main")).not.toHaveAttribute("data-x", "0.000");
  const before = {
    x: await page.locator("main").getAttribute("data-x"),
    y: await page.locator("main").getAttribute("data-y"),
  };
  await page
    .getByRole("button", { name: "上传实景", exact: false })
    .first()
    .click();
  await expect(
    page.getByRole("heading", { name: "实景照片与重建" }),
  ).toBeVisible();
  await page.getByLabel("水平朝向", { exact: true }).fill("90");
  await page.getByLabel("选择实景照片").setInputFiles({
    name: "photo.jpg",
    mimeType: "image/jpeg",
    buffer: await sharp({
      create: { width: 240, height: 360, channels: 3, background: "#488c92" },
    })
      .jpeg()
      .toBuffer(),
  });
  await page.getByRole("checkbox", { name: /我确认可将此照片/ }).check();
  const warning = page.getByRole("checkbox", {
    name: /此处在当前地图中不可行走/,
  });
  if (await warning.count()) await warning.check();
  await page.getByRole("button", { name: "上传并预览" }).click();
  await expect(
    page.getByRole("heading", { name: "确认这张照片的拍摄标注" }),
  ).toBeVisible();
  await expect(page.getByAltText("待提交的实景照片预览")).toBeVisible();
  await page.screenshot({ path: "test-results/photos-preview.png" });
  await page.getByRole("button", { name: "确认提交", exact: true }).click();
  await expect(
    page.getByRole("status").filter({ hasText: "照片已保存" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "我的提交", exact: true }).click();
  await expect(page.locator(".photo-cards button")).toHaveCount(1);
  const imagePath = await page.locator(".photo-cards img").getAttribute("src");
  const stranger = await browser.newContext();
  expect(
    (await stranger.request.get("http://127.0.0.1:4322" + imagePath)).status(),
  ).toBe(401);
  await stranger.close();
  await page.getByRole("button", { name: "维护者资料库", exact: true }).click();
  await page.getByLabel("管理员用户名").fill("browser_admin");
  await page.getByLabel("管理员密码").fill("browser-test-password");
  await page.getByRole("button", { name: "登录资料库" }).click();
  await expect(page.locator(".photo-cards button")).toHaveCount(1);
  await page.locator(".photo-cards button").click();
  await expect(page.getByRole("link", { name: "下载原图" })).toBeVisible();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: /导出当前筛选/ }).click();
  expect((await download).suggestedFilename()).toMatch(/photos-.*zip/);
  await expect(page.locator(".photo-batch")).toHaveCount(1);
  await page.screenshot({ path: "test-results/photos-library.png" });
  await page.getByRole("button", { name: "关闭面板" }).click();
  await expect(page.locator("main")).toHaveAttribute("data-x", before.x!);
  await expect(page.locator("main")).toHaveAttribute("data-y", before.y!);
});
test("mobile manual point and heading with zoom does not move character", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.locator("main")).not.toHaveAttribute("data-x", "0.000");
  // The mobile toolbar also exposes the capture entry.
  await page
    .getByRole("button", { name: /上传实景/ })
    .first()
    .click();
  await page
    .getByRole("button", { name: "在地图上选位置", exact: true })
    .click();
  const map = page.getByRole("img", { name: "拍摄位置与朝向标注地图" });
  await map.click({ position: { x: 120, y: 160 } });
  await page.getByRole("button", { name: "放大标注地图" }).click();
  await page.getByRole("button", { name: "标记镜头朝向", exact: true }).click();
  await map.click({ position: { x: 200, y: 100 } });
  await expect(page.getByLabel("水平朝向", { exact: true })).not.toHaveValue(
    "",
  );
  await page.screenshot({ path: "test-results/photos-mobile.png" });
});
