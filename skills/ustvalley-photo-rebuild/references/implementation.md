# 项目实现入口与验收

先读当前实现，不机械照搬旧照片结论。以下入口用于缩小搜索范围：

- scripts/academic-envelope.ts：C3–C6 幕墙和外栏杆沿原始边线分段构造。边线索引依赖源几何；调整前核对 sourceId 和顶点序列。不得将合并多边形整体替换成栏杆。
- scripts/indoor-art.ts、scripts/interior-materials.ts：室内几何构件、铺装、材质及像素烘焙。
- scripts/library-photo-art.ts、scripts/room-casework.ts：图书馆设施和家具，可复用其构件与像素表达补充照片中的陈设。
- scripts/campus-landmarks.ts、scripts/gltf.ts：室外源模型、材质和渲染。
- src/shared/fixtures.ts、src/shared/world.ts：设施碰撞、落地及可达性；不要绕过门墙检查。
- scripts/build-maps.ts：生成世界、层图、遮挡及环视资源。生成器会清理 public/maps 中未声明文件，不在此目录放照片或临时对照图。

## 当前已知场景

C3–C6 F2 中央椭圆对应源特征 44821，已有“连续玻璃、无花带、无栏杆”的实现和回归。F3 中央开口是白色栏杆，无花。当前代码可能已经正确：实拍验证一致时输出 unchanged。

相关已有测试包括 academic-envelope、indoor-art、indoor-walls、fixtures、doors、passages、ground-support、library-photo-art。浏览器 facade、fixtures、doors、orbit 覆盖入口、室内设施及室外三维查看。

## 最低检查

- 材质：源边线正确、玻璃分格比例合理、墙体与人物遮挡一致，近景不退化为粗糙色块。
- 物品与装饰：逐项检查是否被纳入，近似位置足以验收；轮廓、主色和关键部件应能识别，稳定 objectId 避免多张照片重复添加。
- 依附与碰撞：地面物件底面落在所在楼层，壁饰、吊灯、桌面物品分别依附墙面、天花板和桌面；需要实体碰撞时同步局部碰撞，不能只放一张看得见却可穿过的贴图。
- 通行：既有门户配对、门洞、楼梯、角色落点及建筑碰撞不变，入口与通路仍能通过。
- 对照：固定相机及缩放，至少有全景和改变区域近景；室外改变补充适用的环视角度。
- 公开资料：只提交代码、生成地图和不含实景照片的验证图。未经单独授权，不发布用户原图或照片对照板。

需要新增通行结构的照片，输出明确的目标特征、依据、建议改动和需要的额外拍摄视角，留待后续结构任务。
