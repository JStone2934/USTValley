# 实景采集与照片重建

## 使用

校园工具中的「上传实景」提供角色当前位置和地图选点。点位代表拍摄者位置，箭头代表镜头方向；先放点，再标朝向，选择照片后上传预览并确认。照片只对当前浏览器和维护者可见。清除浏览器 Cookie 后无法自动找回匿名身份。

支持 JPG、PNG、WebP、HEIC/HEIF 主静态图，单张 25 MB、8000 万像素。HEIC 由受限子进程解码。原图保持不变，预览不保留 EXIF；原图中的拍摄信息仅随有权限的原图下载提供。拍摄时间可选填写，未知不使用提交时间代替。

维护者登录同一面板，可按场景、建筑、日期和状态筛选，查看点位、朝向和照片，下载原图、导出最多 20 张的 ZIP、导入重建回执。只有已合入并经管理员核对的 applied 记录标为已用于重建。

## 启动与管理员

使用 Node 24，安装依赖后：

```sh
npm ci
npm run build
npm run photos:admin -- campus_admin
npm run photos:serve
```

管理员初始化使用终端隐藏输入，不提供默认密码。非交互部署可通过受保护环境提供 USTVALLEY_ADMIN_PASSWORD；不要把值写入 shell 历史、仓库或公开日志。重复用户名不会覆盖已有账号。

照片服务默认 127.0.0.1:4320，提供 dist 页面和 API。Vite 开发及 preview 的 /api 默认代理到这个端口；部署必须将浏览器访问地址加入 USTVALLEY_ORIGINS（逗号分隔）。浏览器端始终同源请求，不将凭据放到 URL。

可配置：

- USTVALLEY_DATABASE：SQLite 路径，默认 data/server/campus.sqlite。
- USTVALLEY_PHOTOS：私有存储，默认 data/private-photos；目录不得被静态服务公开。
- USTVALLEY_PHOTO_PORT、USTVALLEY_HOST：监听端口与地址。
- USTVALLEY_ORIGINS：允许修改请求的浏览器来源。
- USTVALLEY_SECURE_COOKIES=true：HTTPS 部署使用安全 Cookie。

匿名身份和 IP 默认每天分别限制 100、500 次上传，可通过 USTVALLEY_PHOTO_OWNER_LIMIT / USTVALLEY_PHOTO_IP_LIMIT 配置。图片处理并发上限 2，单张超时 35 秒。草稿及临时文件 24 小时后清理。反向代理须允许至少 26 MB 请求，不能缓存 /api，不能把任意客户端提供的转发地址当作限流身份。

关闭服务后备份 SQLite 和整个私有照片目录，避免 WAL 活跃写入期间只复制主数据库。恢复时同时恢复数据库和照片；原目录 data/server 及既有账号结构保留。不要将真实数据用于公开测试样例。

## 交给 agent

skill 的源版本位于 skills/ustvalley-photo-rebuild。将该目录安装到执行端 ~/.codex/skills/ 后，可用：
“使用 $ustvalley-photo-rebuild 处理这份导出包，完成验证并汇入共享审核分支 photo-rebuild/review。”

命令：

```sh
npm run photo-rebuild -- prepare --bundle /private/export.zip --repo /path/to/repo
npm run photo-rebuild -- verify --task /private/task
# 在分离 HEAD 的隔离工作区提交验证过的修改
npm run photo-rebuild -- report --task /private/task --publish
```

prepare 拉取 origin/photo-rebuild/review，使用最新审核提交创建分离 HEAD 的独立 worktree，不为照片或批次新建分支。任务目录和照片不进入 Git。review.json 的逐张观察与截图必须来自实际检查，工具不会替 agent 假造视觉通过。verify 重建地图并执行测试，会拒绝建筑结构或通行数据变化。report 绑定代码指纹和标注内容；--publish 只把已验证提交快进到共享审核分支，不合入 main 或部署。提交后若代码变化必须重验。

管理员先标记批次处理中，完成后导入 receipt.json。待审核不等于已用于重建；合入后同步本地 main，再在资料库确认采用版本。不同照片可以分别为 applied、unchanged、needs-evidence、failed。

测试：npm run test:photos；npm run test:photos:e2e。服务端照片测试使用临时数据，不依赖真实私有照片。项目主页 README 展示真实地图和照片驱动重建。

若失败后只需复查环境，且代码、标注和截图均未改变，可使用 verify --task 路径 --resume。成功检查仅在指纹一致时复用，失败日志保留，每轮记录独立；最多三轮。修改任何内容后必须完整验证。

## 照片中的物品与装饰

重建范围包括建筑本身，以及可辨认的桌椅、花盆、灯具、柜架、垃圾桶、标识、雕塑、展示板和墙饰。优先保证物品可识别并出现在合理区域，不要求首次摆放精确；位置、尺寸和朝向可以估计，并在更多照片到来后逐步修正。

agent 会逐项记录物件清单，为每个实例保留稳定 objectId。近似落位可作为完成结果，不因缺少源地图编号或精确位置而搁置；新照片优先更新同一实例，避免重复。物件仍需正常落地或依附墙面、天花板、桌面，保持比例协调和通道畅通。细节规则见 skill 的 references/objects.md。

## 统一审核分支

统一入口为 photo-rebuild/review。每批照片保留自己的验证提交、回执与状态；多个批次进入同一审核队列，不再产生每张照片或每个批次的远程分支。

并发任务若遇到共享分支先行更新，交付会停止。用原 prepare 参数加 --refresh 更新任务基线；它会重放本批次提交，冲突时自动中止并保留原提交。刷新成功后重新采集对照截图并完整 verify，再 report --publish。禁止强推和用旧验证结果提交整合后的代码。

历史分支与回执继续保留用于追溯，新结果只汇入共享分支。已有 W1 重建结果已纳入此分支。管理员仍须在对应提交被 main 包含后逐批确认采用，不能因共享分支新增一个结果就把其他照片标为已用于重建。
