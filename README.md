# 科大谷 USTValley

按 [v1.0 设计](docs/USTValley-v1.0-design.md) 实施。当前版本 **0.2.2：源几何重建与角色真实比例校正**，已替换第一版的统一方块建筑、自动网格步道和通用大厅。

![核心校园重建总览](public/maps/campus-labeled.png)

室外采用六组真实建筑 GLB 的节点、轮廓、材质与高度，保留弧形科研楼、中央连廊与庭院、C1 半环建筑、C2 曲面屋顶及 C7 图书馆；地形来自原道路、绿化和水体。15 个逻辑室内采用真实 F1 平面，E/W 按实际分离翼楼裁取，保留墙体、房间、孔洞和公共走廊。碰撞来自同一几何，精度为 4 逻辑像素。

角色按 1.75m 身高、0.50m 体宽标定，结合校园纬度校正地图投影比例，室内外分别换算显示尺寸、碰撞体、2.8m/s 基础速度、按住 Shift 的 5.6m/s 奔跑速度与 1.5m 交互范围。默认视角放大 4 倍，可在 1—10 倍间调整。详见 [角色比例说明](docs/character-scale.md)。

这仍是单机探索预览；账号、联机、存档、宝箱奖励、纸条与商店尚未实现。当前建筑图像为原始模型的低分辨率烘焙，尚未完成独立像素美术重绘。

## 启动

需要 Node.js 24，版本及依赖已锁定：

```bash
npm ci
npm run dev
```

打开 `http://localhost:3000`。同一局域网可访问 `http://<本机局域网IPv4>:3000`，各浏览器当前为独立单机预览。

这台机器的 Node 24.22.1 在 `$HOME/.local/share/ustvalley-node/bin`，可直接使用启动脚本：

```bash
./scripts/dev.sh
./scripts/dev.sh --port 3001  # 如需其他端口
```

WASD／方向键移动，按住 Shift 奔跑（基础速度的 2 倍），松开恢复基础速度，E 进入或退出，M 打开真实校园总览，Esc 关闭面板；手机使用摇杆和交互键。靠近建筑时屋顶淡化，便于看见角色与真实入口。场景入口使用源坐标并吸附到邻近安全点，不再统一放到建筑南侧。

## 解包与重建

```bash
npm run maps:unpack   # 校验125项下载，拆出9图所有图层和70个GLB
npm run maps:build    # 从几何重建规则、碰撞、模型图像及Tiled产物
npm run maps:inspect  # 导出实际F1平面和公共通行碰撞检查图
npm run maps:verify  # 重建并逐字节检查现有产物
```

完整方法、源数据统计、坐标和高度处理、入口误差及限制见 [详细解包与重建报告](docs/map-reconstruction-report.md)。

| 产物                                              | 用途                                                 |
| ------------------------------------------------- | ---------------------------------------------------- |
| `data/unpacked/inventory.json`                    | 9 张地图、34 个楼层键、471 层、70 个模型的详细清单   |
| `data/unpacked/maps/<地图>/<楼层>/<图层>.geojson` | 保留源属性及孔洞的逐层几何，供本地核对               |
| `data/unpacked/models/<模型哈希>/scene.gltf`      | 可单独打开的解包模型，同目录含 buffer 与独立贴图     |
| `data/unpacked/previews/`                         | 实际 F1 平面及碰撞连通检查图                         |
| `content/map-config.json`                         | 坐标变换、编号依据、显式入口及重建参数               |
| `content/map-build-report.json`                   | 源 SHA-256、模型变换、实际高度、烘焙信息及逐入口误差 |
| `public/maps/campus-labeled.png`                  | 带 15 个编号的完整重建图                             |
| `public/maps/campus-reconstruction.png`           | 无标注重建图                                         |
| `public/maps/building-*.png`                      | 六组实际模型的透明背景烘焙                           |
| `public/maps/floor-*.png`                         | 按真实 F1／翼楼裁取的室内图                          |
| `public/maps/world.json`                          | 共享规则、源几何和 4px 碰撞产物                      |
| `public/maps/*.tmj`                               | 16 个 Tiled 地图；图像层与精确 4px 碰撞矩形对象      |

`data/unpacked` 为可重新生成的本地资料，不纳入源码和网站发布。原 `.bin` 封装保留并校验，本次没有重新解码其未知封装；几何解包使用仓库已有的 `all-maps.json`，详见报告。

前端只发布整理后的规则和烘焙 PNG，不公开原始 GLB、源贴图文件、定位信标和下载清单。开发服务也拒绝访问整个 `data`。不要使用无访问限制的仓库根目录静态服务器。

`.tmj` 当前是生成产物，手工修改会被覆盖。地图内容变化须更新 `mapVersion`。`maps:release` 仍保留正式阶段检查：建筑已依据源数据重建，但自动关联的编号入口仍需现场核实，未确认前该命令按预期失败。

## 验证与构建

```bash
npm run typecheck
npm test
npx playwright install chromium
npm run test:e2e
npm run build
npm run preview
```

`preview` 提供静态构建，默认端口 3000，不要与开发服务占用同一端口。浏览器测试使用端口 4317。

测试覆盖全部 70 个模型的解码、节点实例及负缩放、Accessor 偏移与步长、高度恢复、Polygon 孔洞、入口可达性、精确 Tiled 碰撞导出，以及真实 C2 平面上的探索往返、暂停、失焦、触摸取消和图像重试。截图生成在 `test-results/`。真机和多人验收尚未执行。

实现状态见 [实施记录](docs/implementation-status.md)，素材来源见 `content/assets.json`。
