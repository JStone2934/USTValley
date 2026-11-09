# README 展示图

## 基础地图图像

以下八张图由 `scripts/build-readme-images.ts` 从 main 的地图产物生成：

- `campus-overview.webp`：核心校园全景。
- `academic-f2.webp`、`academic-f3.webp`：学术研究中心二、三楼。
- `atrium-glass.webp`、`terrace-detail.webp`：玻璃幕墙与栏杆细节。
- `activity-interior.webp`、`library-f3.webp`：学生活动中心与图书馆室内。
- `academic-plan.webp`：从同一楼层保留的源几何重绘的平面示意，并非原地图网站截图。

全景、楼层与细节图只对已烘焙地图进行缩放或裁切。运行 `npx tsx scripts/build-readme-images.ts` 更新这八张图片；该命令保留本文及照片对照图片。

## 实景与 Agent 重建对照

维护者于 2026-11-09 提供照片与截图，并明确要求用于公开 README 对照。以下为压缩展示副本；原图未加入仓库。导出不保留 EXIF、XMP 或 IPTC。

| 图片 | 来源与处理 |
| --- | --- |
| `photo-rebuild/robotics-reference.webp` | 维护者提供的 W1 机器人区域实景照；按照片方向导出，宽度缩至 1200 像素，WebP 质量 86。 |
| `photo-rebuild/robotics-game.webp` | 维护者提供的 BUILD 0.6.1 早期游戏截图；裁取游戏画布，保留真实像素内容，以无损 WebP 存储。不是最新布局。 |
| `photo-rebuild/robotics-current.webp` | 审核分支 `layout/w1-open-floors` 的提交 `fb4349d08fcc62a60934318989b8739e2653b004` 中 `docs/images/w1-open-floors/f6-closeup.png`；裁取画布，无损 WebP。对应后来移至东侧 6-1、6-2 区域的设备。 |
| `photo-rebuild/campus-reference.webp` | 维护者提供的学术研究中心实景照；按照片方向导出，宽度缩至 1200 像素，WebP 质量 86。 |

两张游戏截图的原始尺寸均为 1440 × 960；裁切范围为 left=306、top=154、width=1098、height=698。没有使用生成图替代游戏截图，也没有修改画布中的物件。

实景与游戏画面不是同机位对齐图，用于展示物品识别和建筑材质转译。当前 README 同时展示 main 的基础地图与审核分支的照片重建成果，各自状态已在首页说明。

更新照片对照时，选用明确可公开的实景和对应游戏版本，保留来源与迭代说明，并重新检查导出文件不含原图元数据。普通上传照片仍默认私有，不因 README 展示而自动获得公开权限。其他参考资料见 [校园实景与地图物件对照](../campus-photo-references.md)。
