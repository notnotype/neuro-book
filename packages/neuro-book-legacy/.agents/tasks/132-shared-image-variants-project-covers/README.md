# 共享图片变体、Project 封面管理与原图预览

> 当前状态：Implemented locally / Repository-external Windows Product and Sharp smoke verified by Task 130 / Linux, macOS and GHCR CI pending / Manual browser acceptance pending。

## Relative documents refs

- [ADR 0006](../../adr/0006-image-variant-and-original-ownership.md)
- [图片原图与变体参考](../../../reference/media/image-variants.md)
- [Task 108](../108-agent-image-attachment-references/README.md)
- [Task 118](../118-project-catalog-snapshot-path-integration/README.md)
- [Task 125](../125-runtime-artifact-storage-lifecycle/README.md)
- [Task 129](../129-project-picker-and-session-entry/README.md)

## User Request / Topic

- 原图永远保存未经转换的 bytes，请求可以按参数或 preset 获取进入有界缓存的缩略图。
- 同一变体能力同时服务 Session Attachment、Project 封面和未来其它图片领域。
- Project 书架以封面为主，提供上传、替换、清除、原图预览和下载闭环；不能让 `/api/projects` 恢复全项目扫描。
- 不建立统一媒体库、远程代理、后台预生成或新数据库表。

## Goal

以“领域拥有原图、共享 Module 派生变体”为稳定边界，完成授权先行、固定 WebP、有界缓存、Project 封面事务和前端原图按需预览。验证必须覆盖 Module、路由、Lifecycle、前端源码合同和真实 Product 原生运行；跨平台 CI 没有运行前不得声称五平台已通过。

## Current State

- `ImageVariantModule` 已实现 preset/显式参数规范化、EXIF、静态 GIF 首帧、不放大、64 MP/2048² 限制、active 2/queue 64、single-flight 和有界磁盘缓存。cache v2 使用 WebP 内容 SHA-256 识别截断与同长度损坏，旧 v1 文件自动删除重建。
- Attachment GET 无参数仍返回原图；带变体参数先完成 Session locator 授权，再返回 immutable WebP。
- Project cover GET 只接收 `projectRoot`，先从轻量 snapshot 和 manifest 授权；`/api/projects` 不读取或生成图片。
- Project cover PUT/DELETE 使用内容寻址原图和 manifest 提交点，覆盖 known failure rollback、unknown commit 保留、旧托管文件清理和诊断。
- 书架使用 `project-cover`，附件网格与聊天分别使用 `attachment-grid`/`attachment-chat`；共享 Dialog 只在点击后挂载原图并提供下载。Chat Flow 的通用 Attachment 卡为非图片展示文件名、MIME、大小和原文件下载，不请求变体、不进入图片预览或 Composer。
- 浏览器未声明 MIME 时，真实 multipart 会把它传为 `application/octet-stream`。Agent 图片与 Project 封面都以魔数和完整解码为最终事实；其它具体 MIME 仍必须与 bytes 一致。
- raster image Module 统一导出 64 MP 输入像素上限和 Sharp 像素错误识别。Agent 上传、文件快照、`read(image)`、Project 封面与 Image Variant 不再各自维护魔法数字或错误正则。
- 封面 mutation 没有 HTTP response 时与 `committed: "unknown"` 使用同一恢复流程。门禁按 Project 隔离，任一次完整 snapshot 成功后刷新全部待恢复封面并解除门禁，不自动重放 mutation。
- Project 封面原图 GET 返回 manifest basename 对应的 UTF-8 filename；变体继续保持 WebP inline。
- `sharp` 已纳入 Nitro external 与 Product native island；五平台 Product、Windows Portable 和 GHCR 工作流已接入最终 Product command 的真实 smoke，等待相应 CI 实际运行。

## ADR / Decisions / Discussion

- 不新增 `MediaAsset` 表、统一原图 Store、引用计数或 `/api/media`。复用点是变体 Module，不是原图所有权。
- Cache 位于 `Cache Root/image-variants/`，默认 Cache Root 才位于 State Root 下；它不是 Project Runtime Artifact，不进入 Application State migration、备份、File Index 或 History。
- Project 封面原图进入 Project Workspace 下载/File Index/History；首页 mutation 不强制打开 Project。
- 输出固定 WebP，不做 Accept 协商、AVIF、裁剪坐标或质量设置页。
- 同步生成保留，使用严格并发与队列预算；当前 84 个 Project 的规模不值得增加后台任务。

## Implementation Walkthrough

### 共享 Module 与路由

- 新增独立 contract/query/http/runtime 文件，使原图请求与冷启动不静态加载 `sharp`。
- H3/ufo 的原始 query 值允许递归数组和对象；query parser 把它视为外部未知输入，再统一收窄为单个字符串或有限数字。无值布尔参数、数组和对象均稳定返回 400，不在 HTTP Adapter 复制第三方递归类型。
- source capability 只携带 identity/revision/read。Project Adapter 在同一 FileHandle 上复核 stat fingerprint，避免授权后替换污染旧缓存键；Attachment 使用内容哈希作为稳定 revision。
- 缓存逻辑键包含版本、source identity/revision 与 canonical spec，持久文件名追加 WebP 内容摘要。启动清 temp、删除旧 v1 并建立 inventory；命中校验 MIME 与 SHA-256；损坏项无法删除、写入或回收失败后关闭本进程持久写入。
- Agent 图片写入也消费同一 64 MP 常量：Codec 向 Sharp 设置 `limitInputPixels`，取得有效宽高后再检查像素乘积，并保留既有 `AttachmentError`。`read(image)` 的工具上下文只暴露 Codec，不再提供可绕过图片语义的原始 Store。

### Project 封面事务

- 从 Attachment 上传路由提取严格单文件 multipart Module，两条上传链共用流式 fileSize 限制。
- 上传完整解码 PNG/JPEG/WebP 后保存原 bytes；Lifecycle `cover-update` 复用 metadata manifest transaction，不引入第二套写 manifest 路径。
- 返回既有 `ProjectMutationResponseDto`，前端原位更新 metadata 并增加该 Project 的图片 refresh key。
- 前端消费公开 `committed`：`true` 与 `unknown` 在再次 mutation 前都必须成功刷新 Project snapshot；刷新失败时 Dialog 保留持久门禁和显式重试。
- ofetch 没有 HTTP response 时同样归类为 transport unknown；有 response 的普通业务错误、畸形正文和其它 operation 不冒充提交状态。恢复记录按 `projectRoot` 保存，完整 snapshot 成功后统一清除并为全部命中 Project 增加 refresh key。
- snapshot 结算已提取为纯状态机，一次返回清空后的恢复记录、全部 cache-bust roots 和当前 Dialog 的 `none | unknown | committed | missing` 结果。页面只应用结果，因此迟到的 A 刷新不能写入已经切换到 B 的 Dialog。

### 前端

- Project Picker 保持单组件页面，但只新增单一职责封面 Dialog；没有扩成综合 Project 编辑器。
- 新增通用 `OriginalImagePreviewDialog`，由书架、聊天图片和 Session 附件面板复用。
- 前后端共享 raster MIME 字符串合同，服务端继续独占魔数识别与完整解码。空 `File.type` 和 multipart 的 `application/octet-stream` 只表示类型未声明；具体非图片 MIME 继续前后端 fail closed。
- `AgentAttachmentImage` 已收口为通用 `AgentAttachmentCard`，用户历史和工具结果共用同一展示；图片继续按需预览原图，非图片只生成无 preset 的授权原件下载链接。
- live 工具结果已有 Attachment metadata、尚无 durable entry locator 时也挂载通用卡片；此时不生成 URL、不请求变体也不轮询。durable `resultEntryId` 到达后同一卡片再启用图片预览或非图片下载。
- 触及的附件面板中文迁入中英文 i18n；全部普通界面颜色继续消费主题变量。

### Product runtime

- `sharp`、`@img/colour` 与当前平台 native package 进入 Product native island；构建时缺包直接失败。
- `product-image-variant-smoke.ts` 从显式 Application/State Root 运行，验证实际 WebP 生成、新 Module 实例缓存命中、source read 次数和缓存文件。
- POSIX archive verifier 同时检查 JS/native/libvips 包；Windows Portable 与 GHCR 在打包环境内执行 smoke。

## Verification / Test

截至 2026-07-28 已经通过：

- Image Variant query/module/RuntimePaths：3 files / 26 tests。
- Lifecycle/Session/Attachment multipart 既有回归：4 files / 122 passed / 1 skipped。
- Project cover mutation/upload/routes：3 files / 13 tests。
- **验证证据更正**：此前“前端合同收口”计数包含一份未被 Vitest include 收集的根目录测试，不能作为有效证据。include 已收口到完整 Novel IDE 测试树；本轮 cache v2、shared MIME、Project commit-state、Composer 门禁与前端合同聚焦为 5 files / 26 tests，真实收集并通过。
- shared MIME 的服务端消费者复核为 4 files / 23 tests：Attachment codec、Project cover upload、Attachment GET 与 Project cover GET 全部通过。
- Attachment/Project/Image Variant/主题相邻集合共 14 files / 85 tests；并行时两个 Lifecycle fixture 超过默认 5 秒，隔离复跑对应文件 5/5 通过，属于资源竞争而非断言失败。
- 恢复当前 Facade 的列表性能门禁：两个含真实 manifest/正文文件的 Project 连续读取 snapshot 100 次，database/history/file-index 启动均为 0，没有 ready Project Session，也未生成 Project/History SQLite；对应 `project-session` 1 file / 9 tests 单跑通过。
- 编译后的 Product `image-variant-smoke.mjs` 在 Windows x64 实跑：generated -> hit，source read 1，固定 WebP。该证据验证最终命令本身，不等同于完整 Product archive 验收。
- 本轮直接运行 source smoke 复核 cache v2：Windows x64 为 generated -> hit、source read 1、固定 WebP、1 个持久缓存项。
- Windows x64 `sharp` 运行闭包实测为 122 files / 20,358,239 bytes（约 19.41 MiB）。该数字是本平台当前闭包的逻辑大小，不外推为其它平台归档增量。
- 发布资产合同：1 file / 10 tests，锁定 Nitro external、五个平台 native package 映射，以及 POSIX、Windows Portable、GHCR 的最终命令接线。
- system assets 编译：14 profiles。
- 审查收口聚焦回归：9 files / 38 tests，覆盖真实空 MIME FormData → Busboy → Project 校验、Agent 完整解码、transport unknown、按 Project 恢复、通用 Attachment 卡和原图 filename。
- Image Variant、Project cover routes/Lifecycle 与 Attachment GET 相邻回归：10 files / 155 passed / 1 skipped。
- Attachment 上传、Store/Authority、Composer 与前端合同相邻回归：13 files / 49 tests。
- 2026-07-29 二次审查最终核心回归：6 files / 43 tests，覆盖统一 64 MP Codec、live/durable 工具 Attachment、纯封面恢复结算、Attachment URL/投影和 SFC 接线。
- `file-tools` 图片路径定向回归：5/5 通过；完整文件仍有一个与本轮无关的 Project-bound bash fixture 缺少 `project.yaml` 失败，未扩大范围修改。
- Image Variant、Project cover upload/mutation/routes 与 Attachment upload/get 相邻回归：10 files / 69 tests。

尚未完成或不能在本机替代：

- Task 130 已在仓库外 Windows Product 中完成 Sharp 生成/缓存命中、运行时依赖闭包和 State Root 生命周期 smoke；此前的 Windows artifact blocker 已解除，不再作为本任务 TODO。
- 2026-07-31 根 `bun run typecheck` 仍被本轮未修改的 Profile SDK、Session migration 与 llmlint 等在途错误阻断；按路径过滤，本轮 Catalog、Attachment、Project route 与测试 fixture 文件零命中。
- Linux x64/ARM64、macOS x64/ARM64 和 GHCR amd64/arm64 只能由对应 runner/容器提供真实 native 证据。
- 浏览器验收按仓库规则未自动执行。

## TODO / Follow-ups

- [ ] CI 实际运行 Linux x64/ARM64、macOS x64/ARM64 Product 与 GHCR amd64/arm64 smoke；Windows 仓库外 Product/Sharp smoke 已由 Task 130 完成。
- [ ] 用户授权后浏览器验收：空 MIME 封面/Composer 图片上传、上传响应丢失、两本书分别保留恢复门禁、封面上传/替换/清除、true/unknown 恢复、正确原图扩展名、图片原图预览、Chat 非图片原件下载、Sepia/Dark、390/1024/1440 视口。
- [ ] 发布后若真实首轮封面队列出现饱和，再基于 Server-Timing 数据调整 preset 或并发；当前不预建后台任务。

## 本轮实际结果与计划差异

- 计划中的 cache v2、shared MIME、Attachment 分流、Project 事务恢复、测试收集、列表性能门禁与 Windows source smoke 均已完成。
- 审查补充发现真实浏览器空 MIME 会被 Busboy 表示为 `application/octet-stream`，以及无 HTTP response、跨 Project 恢复状态、Chat 非图片和原图 filename 四条消费链遗漏；均在既有边界内补齐，没有修改 Image Variant Module、Lifecycle 提交算法、Attachment Store 或列表性能路径。
- 二次审查继续发现 Agent Codec 缺少 64 MP 门禁、`read(image)` 可直写 Store、live 工具附件被 durable locator 条件整体隐藏，以及封面恢复复杂状态只有页面内副作用。当前分别通过共享 Codec 常量、工具能力收窄、nullable locator 卡片和纯结算状态机闭合；没有增加全局解码调度器、状态 store、路由或持久化结构。
- 相邻 14 文件集合中的两个 Lifecycle 用例只在并行资源竞争下超过默认 5 秒，隔离文件 5/5 通过；没有放宽测试超时。
- 全量 typecheck 到达未触及的 web-tools 第三方声明错误，本轮文件零错误；Nuxt build 的既有重验仍为超时，完整 Product 与跨平台 runner 按原 TODO 保留。
- 按仓库规则未自动执行浏览器验证。

### 2026-07-31 Project Catalog、删除事务与外围边界收口

- Image Variant 核心、缓存预算和原图所有权未改。本轮把外围状态拉回既有架构：Project Catalog 由 Store 唯一发布，封面/create/delete 的 transport unknown 都先刷新完整 snapshot，direct-open 不再依赖列表成员关系。
- 封面恢复、Picker create/delete 恢复都使用单调 attempt。snapshot 只清除请求开始时捕获且返回时仍匹配的记录，关闭了同一 Project attempt 1/2 的 ABA 窗口；不同 Project 仍可独立操作。
- 删除 route 恢复 Lifecycle 唯一事务链与 `{revision, projectRoot}` 响应。旧目录删除实现已移除，tombstone、rollback、unknown commit 与 snapshot publication 继续由 Lifecycle 负责。
- Attachment locator 返回授权读取 capability，Harness 原始 Store 不再公开；四处 `filename*` 使用同一个 RFC 5987 编码函数。真实图片测试 helper 替代假 PNG 文件头，并增加 snapshot 64 MP 零写入和归档最终门禁回归。
- Catalog publication 的最后一处分支已经删除：封面 mutation 成功后 Store 始终回读完整 Lifecycle snapshot，书架顺序不再由客户端 upsert 决定；服务端封面、变体缓存和 mutation 提交算法均未改变。
- 当前验证：Store/删除 17 tests；Picker/World Engine/恢复/Session snapshot 5 files / 27 tests；Project/封面/Attachment/RFC 相邻集合 13 files / 150 passed / 1 skipped；完整 file-tools 49/49。两份 Harness 共 200 项中 198 通过，两个失败位于未修改的模型恢复与 Variable SDK；根 typecheck 未命中本轮文件，但被其它 Profile SDK、Session migration 与 llmlint 在途错误阻断。
- 本轮补充最终合并验证为 Settings/Catalog/direct-open/Preview/删除/ProjectSession 等 13 files / 77 tests；连续 100 次列表读取仍只消费轻量 snapshot。没有重复执行 Sharp/native Product smoke。
- Task 130 已提供仓库外 Windows Product/Sharp smoke。本轮未重复五平台 native smoke，也未自动执行浏览器验收；Linux、macOS、GHCR 与人工浏览器清单保持未完成。

### 2026-07-31 Settings 与 Preview 相邻链收口

- 本轮没有修改 Image Variant、Attachment、封面恢复 attempt、Project Lifecycle 或删除事务。相邻审查只移除了 Settings 的 Catalog/跨 Project selector，并把 World Engine Preview 创建交错抽成页面专用可测试 utility。
- Preview 的普通失败、已提交后 Catalog 失败、transport unknown、恢复重试和 activation false 现在由行为测试约束；恢复函数不具备 POST 能力，不会重放创建。
- 最终合并回归 13 files / 77 tests，通过封面恢复、Catalog、ProjectSession 与连续 100 次列表门禁；根 typecheck 本轮路径零命中，既有 Skill 声明、Session migration 和 llmlint fixture 错误仍在。浏览器与跨平台 Sharp 清单不变。
