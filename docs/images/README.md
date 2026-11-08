# README 展示图

图片由 `scripts/build-readme-images.ts` 从当前地图产物生成，用于项目首页展示。

- 全景、楼层与细节图：对应 `public/maps/` 的已烘焙地图，仅缩放或裁切。
- `academic-plan.webp`：从同一楼层保留的源几何重新绘制的平面示意，并非校园地图网站截图。
- 未嵌入用户提供的实景照片。实景对照来源见 [校园实景与地图物件对照](../campus-photo-references.md)。

更新地图后，在仓库根目录运行 `npx tsx scripts/build-readme-images.ts` 同步这些展示图。
