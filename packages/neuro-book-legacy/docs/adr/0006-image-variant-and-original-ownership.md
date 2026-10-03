# ADR 0006：图片原图归领域所有，变体由共享 Module 派生

- 状态：Accepted
- 日期：2026-07-28
- 关联任务：[Task 132](../../.agents/tasks/132-shared-image-variants-project-covers/README.md)、[Task 108](../../.agents/tasks/108-agent-image-attachment-references/README.md)、[Task 129](../../.agents/tasks/129-project-picker-and-session-entry/README.md)、[ADR 0010](0010-desktop-storage-loopback-shutdown.md)

## 背景

Agent Attachment 与 Project 封面都需要缩略图，但原图的身份、授权和生命周期不同。Attachment Store 使用内容哈希并由 Session entry 授权；Project 封面是 Project Workspace 普通内容，由 `project.yaml.cover` 引用并随项目归档。若为了缩略图建立统一 `MediaAsset` 表、复制原图或开放通用媒体路由，就必须再引入引用计数、跨领域授权和删除协调，复杂度超过当前需求。

同时，Project 列表已经从全项目扫描收口为轻量 Lifecycle snapshot。封面不能让 `/api/projects` 再次读取文件、生成图片或打开 Project Module。

## 决策

1. 原图继续由领域拥有。Attachment Store 与 Project Workspace 分别保存未经转码、未修改 metadata 的 canonical bytes；Image Variant Module 不拥有原图，不建立 `MediaAsset` 表。
2. 领域路由必须先完成授权，再向 Image Variant Module 传递不含文件路径的 `ImageVariantSource {identity, revision, read}`。Module 不理解 Session、Project、URL 或 manifest。
3. 不开放通用 `/api/media`。未来领域需要图片变体时新增自己的授权 Adapter，复用同一 Module。
4. HTTP 变体使用互斥的 preset 或显式 `{width, height, fit, quality}`。preset 最终解析成同一规格并共享缓存键；输出固定 WebP，不做 format 或 Accept 协商。
5. 变体应用 EXIF 方向、剥离 metadata、不放大小图；GIF 只派生静态首帧。源图上限 64 MP，输出上限 2048×2048。
6. Image Variant Cache 位于 `Cache Root/image-variants/`，是可删除、可重建且不迁移的运行缓存。受管安装的 Cache Root locator 由 ADR 0010 决定；只有 Source dev 与隔离测试未显式配置时才默认使用 `State Root/cache/`。缓存固定上限为 512 MiB、10000 项、每个 source 32 项；淘汰按生成时间，不宣称 LRU。
7. 缓存不进入 Application State migration、备份、Project Workspace Download Archive、Project Workspace File Index 或 History。缓存故障时进程关闭后续持久写入，但仍可返回当前内存结果。
8. `/api/projects` 只投影 manifest 中的可选 `cover` 字符串。封面 bytes 由独立 GET 懒加载；缓存命中也必须重新通过 Project 与 manifest 授权。
9. Project 封面上传原始 bytes 到内容寻址路径，再以原子 manifest 更新作为提交点。成功后只清理旧的应用托管封面，手工路径永不删除；提交未知时保留新旧文件。服务端明确返回 `committed: "unknown"` 或客户端没有收到任何 HTTP response 时，客户端都必须先刷新完整 Project snapshot，不自动重放 mutation。
10. `sharp` 是 Product 原生运行合同：Nitro 将其 external，Product vendor 必须携带 JS 包、`@img/colour` 和目标平台 `@img/sharp-*`/libvips 包，并在 Windows x64、Linux x64/ARM64、macOS x64/ARM64 与 GHCR amd64/arm64 执行真实生成和缓存命中 smoke。

## 原因

共享“派生变体”而不共享“原图所有权”，能复用最昂贵的解码、并发控制和缓存逻辑，同时保留现有领域授权与删除语义。capability 形态的 source 让 Image Variant Module 无法绕过调用方授权或接受客户端路径。

固定 WebP 与少量 preset 足够覆盖书架、附件网格和聊天显示，避免格式协商、裁剪焦点、预生成任务和设置项组成额外状态空间。同步生成配合 active=2、queue=64 的硬限制，符合当前 84 个 Project 的规模；没有必要引入后台任务系统。

## 后果

- 首次查看大量封面会产生受限转换延迟；后续请求命中磁盘缓存，且列表接口本身不承担图片成本。
- 变体 URL 不是授权凭证。Attachment 使用 immutable 缓存语义，Project 使用 must-revalidate；两者都先授权再命中缓存。
- 替换或清除 Project 封面会删除旧的应用托管原图，因此“永久保留原图”只指当前 canonical 图片不被转码，不代表保存所有历史封面。
- transport unknown 不提供 exactly-once 保证。刷新 snapshot 只用于重新取得 manifest 事实；同一 Project 在刷新成功前禁止再次修改封面，其它 Project 不受影响。
- `sharp` 增加 Product 体积和跨平台发布门禁，但换来一致的 PNG/JPEG/WebP/GIF、EXIF 与像素限制行为。

## 未采用方案

- 统一媒体库、`MediaAsset` 表和引用计数：当前两个领域的所有权不同，收益不足以覆盖迁移与 GC 复杂度。
- 把封面 bytes 或缩略图放进 `/api/projects`：会恢复列表的全项目 I/O 和首轮转换放大。
- 把变体写入 Project Workspace 或 Attachment Store：会混淆 canonical 原图与可重建缓存，并污染 History、File Index 和下载归档。
- 后台预生成、CDN、远程图片代理、AVIF、OCR、裁剪坐标和焦点检测：当前产品规模和离线部署不需要。
