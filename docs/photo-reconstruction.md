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
“使用 $ustvalley-photo-rebuild 处理这份导出包，完成验证并提交审核分支。”

命令：

```sh
npm run photo-rebuild -- prepare --bundle /private/export.zip --repo /path/to/repo
npm run photo-rebuild -- verify --task /private/task
# 在隔离工作区提交验证过的修改
npm run photo-rebuild -- report --task /private/task
```

prepare 使用明确基线创建独立 worktree。任务目录和照片不进入 Git。review.json 的逐张观察与截图必须来自实际检查，工具不会替 agent 假造视觉通过。verify 重建地图并执行测试，会拒绝建筑结构或通行数据变化。report 绑定代码指纹和标注内容；提交后若代码变化必须重验。

管理员先标记批次处理中，完成后导入 receipt.json。待审核不等于已用于重建；合入后同步本地 main，再在资料库确认采用版本。不同照片可以分别为 applied、unchanged、needs-evidence、failed。

测试：npm run test:photos；npm run test:photos:e2e。服务端照片测试使用临时数据，不依赖真实私有照片。项目主页 README 继续聚焦地图展示。
