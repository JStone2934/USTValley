# 科大谷：地图源数据本地备份

已保存本次定位到的完整地图数据包及其项目资源引用。

- 原始数据包：res/projects/xgkdgz_all/h4bjun8x.bin
- 全部解析数据：all-maps.json（9张地图，包含地图、路网、定位相关原始数据）
- 项目配置：project-config.json
- 70个GLB模型、54张图片和图标，保留原始资源路径。
- 下载清单：download-manifest.json（来源URL、字节数、SHA-256校验值）
- 模型外部依赖：external-dependencies.json（已检查，70个GLB均未引用外部buffer或image URI）

125项项目资源均下载成功。重新解码原始包并核对，与all-maps.json一致；全部下载文件通过SHA-256校验。

范围：地图配置与数据包内发现的项目资源；不包含地图引擎、运行授权脚本、小程序代码或服务端程序，不代表完整网站的离线镜像。此目录是本地开发源资料，不应直接整体放入公开网站目录。
