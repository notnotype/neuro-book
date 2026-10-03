# Agent Attachment 存储内核与图片引用

> 当前状态：Implemented locally / Manual browser acceptance pending。原子 Session mutation、Attachment Authority、invocation receipt/unknown 对账、可靠 follow-up、归档关系视图、Composer 图片事务与安全上传/快照入口均已接通；本轮未自动执行浏览器验收。

## 2026-07-29：图片解码边界与 live 工具附件收口

- Agent 图片完整解码上限统一为 64 MP。上传、文件快照和 `read(image)` 都经过 `AgentAttachmentCodec`，共享 Sharp 像素错误识别和稳定 `limit_exceeded` 映射；超限图片不会进入 Attachment Store。
- `ToolExecutionContext` 不再暴露原始 Attachment Store，只提供图片 Codec 能力。`read(image)` 保留读取前后 16 MiB 门禁、原图 bytes、MIME 真相和 Context Access 记账，同时不能绕过完整解码与像素限制。
- live 工具结果只要已有 Attachment metadata 就展示通用附件卡，不再等待 durable `resultEntryId` 才挂载整个区域。locator 未到达时不生成 URL、不请求变体也不轮询；durable entry 响应式补齐后，图片开始请求 `attachment-chat`，非图片出现原件下载地址。
- 聚焦回归覆盖低字节量超 64 MP JPEG、Store 零写入、`read(image)` 同合同、live → durable 图片与非图片 locator，以及两种 ToolBubble 渲染模式。浏览器验收仍未自动执行。

## 2026-07-28：共享图片变体与原图预览接入

- Attachment Store 与 Session locator 继续拥有原图与授权；Provider hydration、snapshot、上传、持久化和模型输入仍只读取原图。
- Attachment GET 无变体参数时保持原图语义；带参数时仍先完成 Session、entryId、contentIndex 授权，再把不含路径的 source capability 交给共享 Image Variant Module。
- Chat Flow 使用 `attachment-chat`，Session 附件面板使用 `attachment-grid`；点击缩略图后才挂载无参数原图请求，并共用下载原图 Dialog。Composer 现有正文派生图片条不额外引入变体请求。
- Attachment substrate 仍允许非图片。前端与服务端共用同一 raster MIME 规范化合同；非图片不请求变体、不进入图片预览或 Composer 图片节点，只保留原文件下载。Composer transaction 自身保留最终 MIME 门禁，不能依赖单个面板隐藏按钮。
- 浏览器 `File.type === ""` 经过 FormData/Busboy 后会成为 `application/octet-stream`。两者都只表示 MIME 未声明：Composer 允许进入服务端，Agent Codec 必须再用魔数和完整解码确认；`text/plain`、SVG 和其它具体 MIME 不能借此绕过。
- Chat Flow 已改用通用 Attachment 卡。用户历史与工具结果中的图片继续请求 `attachment-chat` 并按需打开原图；非图片展示文件名、MIME、大小和授权原件下载，locator 不可用时明确显示文件不可用。
- 变体响应固定 WebP、immutable ETag/cache-control；非图片 415、解码或像素超限 422、队列饱和 503。详细合同见 [ADR 0006](../../adr/0006-image-variant-and-original-ownership.md) 与 [Task 132](../132-shared-image-variants-project-covers/README.md)。
- 新路由测试锁定“locator 授权先于变体”、缓存命中不读 blob、非法参数/非图片失败；旧测试不再为每个用例重载整条 Agent 图。
- 本轮审查相邻回归为 13 files / 49 tests；其中 Agent Codec 使用真实可解码 PNG/JPEG/WebP/GIF，并锁定损坏魔数和具体非图片 MIME 均在写 Store 前拒绝。浏览器验收仍未自动执行。

## 2026-07-24：二次审查收口

本轮沿 prompt、steer、follow-up、Tree/history、上传、snapshot、归档、abort、SSE/recovery 和草稿切换重新走查，集中关闭 check-then-act 与迟到响应窗口，没有重写已经稳定的 Markdown、Provider hydration、follow-up durable drain 或 effective relation 设计：

- Harness 的 per-Session admission queue 深化为 `withSessionMutation()` / `withSessionMutations()`。invocation claim、terminal transition、Tree/history、runtime command、附件最终登记、archive/restore 和 abort 都在线性化边界内读取最新 policy 并提交；relation -> sorted Session -> sorted write executor 是固定锁顺序。
- invocation 拆分为锁内 admission/claim 与锁外 Provider 执行。`commitInvocationState()` 统一提交 waiting/end/error/aborted lifecycle、active state 和 queue 清理；已 claim 为 aborting 的 invocation 不能再落 waiting/end，public abort 与 signal abort 不再经过二次锁窗口。
- Tree 编辑/重跑在移动 active leaf 前完成 Profile、Project、附件和 interaction admission，成功后以显式 parent 写入目标分支；任何 preadmission 失败都不改变 leaf、branch 或 claim。
- 上传和 snapshot 保留 body/file 读取前快速 preflight，但只在文件处理完成后进入 Session mutation 临界区重新校验并登记。最终校验失败时可能留下内容寻址孤儿 blob，但不会产生 Session 授权 entry。
- `SessionAttachmentAuthority` 重建每轮比较前后签名：第一次变化丢弃 candidate 后完整重扫，第二次仍变化则 fail closed；重建开始即失效旧 cache，pending observer 增量只补偿内部写入，不能掩盖外部修改。
- `StableAttachmentSnapshotReader` 固定执行 `realpath -> stat -> open -> fstat` 身份校验，使用同一 FileHandle 读取最多 16 MiB + 1，并在读取后复核 bigint identity、size、mtime 和 ctime。Attachment Store 的逻辑路径、绝对路径和链接真实目标均拒绝。
- 前端建立共享 invocation reconciliation，HTTP receipt、SSE、queue 和 recovery 只按 `clientMessageId` 对账。无 receipt transport failure 为 `unknown`：不自动恢复、重试或回滚；保留 optimistic 与草稿，后续普通 durable 证据再收敛。该决策记录在 [ADR 0001](../../adr/0001-agent-input-transport-unknown.md)。
- 草稿上下文固定包含 workspace、Session、generation 和 revision。切换时同步 flush 旧 key、取消 debounce、dispose 图片事务再加载新上下文；acceptance compare-and-clear 只能删除原上下文中仍等于提交快照的草稿。
- Composer 图片 transaction 增加明确 metadata error 与批量 retry。pending、upload failure 和 metadata failure 在主 Composer 与历史编辑器中都阻止提交；旧 generation 或迟到请求不能覆盖当前 registry。
- Attachment v1 migration 在内存中组合 user identity migration，最终只发布一次 JSONL，原子补齐 ordered content、queue/user `clientMessageId` 和 explicit intent；runtime 不接受中间 schema，也没有复制 migration 规则。

实际实现与计划的出入：

- 按既定产品取舍，unknown attempt 不持久化，刷新页面只恢复纯文本草稿；没有增加 durable inbox/outbox、自动 retry、发送专用 recovery 或幂等执行。
- 附件最终登记失败后允许孤儿 blob；本任务仍不增加 GC 或 sidecar。
- snapshot 稳定性依靠生产不变量和 FileHandle 边界，没有为了制造 pathname 竞态加入测试专用生产 seam。
- Session 附件测试接入正式 `resetProjectSessionsForTest()` 清理，以符合 ProjectSession 进程内固定 Workspace Root 的运行时合同；没有放宽生产 singleton。
- 未修改 `CONTEXT.md`，也未处理文本附件、远程 URL、OCR、删除、Provider File API、缩略图转换或其它任务的改动。

验证结果：

- Task 108 聚焦集合：`20 files / 109 tests` 通过。
- Session Attachment Harness：`14/14` 通过。
- mutation/terminal/Tree/relation 定向 Harness：`13/13` 通过。
- Agent black-box：`25/25` 通过。
- 完整 Harness：`163/165` 通过。两条失败分别是既有“删除模型后 recovery 返回 `model: null`”期望差异，以及测试文件内其它用例遗留 ProjectSession Root；后者在独立进程复跑 `1/1` 通过，均未借 Task 108 修改业务代码。
- `bun run typecheck` 通过。
- 未自动执行浏览器验收。

实际验证命令：

```powershell
bun run test -- shared/agent/agent-image-markdown.test.ts shared/agent/session-interaction-policy.test.ts app/components/novel-ide/agent/useComposerImageTransaction.test.ts app/components/novel-ide/agent/agent-invocation-reconciliation.test.ts app/components/novel-ide/agent/agent-composer-draft.test.ts app/components/novel-ide/agent/agent-attachment.test.ts app/components/novel-ide/agent/agent-user-message-markdown.test.ts server/agent/messages/stored-user-markdown.test.ts server/agent/attachments/agent-attachment-codec.test.ts server/agent/attachments/attachment-store.test.ts server/agent/attachments/local-attachment-blob-adapter.test.ts server/agent/attachments/stable-attachment-snapshot-reader.test.ts server/agent/attachments/session-attachment-authority.test.ts 'server/api/agent/sessions/[sessionId]/attachments.post.test.ts' 'server/api/agent/sessions/[sessionId]/entries/[entryId]/attachments/[contentIndex].get.test.ts' server/agent/events/public-chat-entry-projection.test.ts server/agent/events/public-event-projection.test.ts server/agent/events/public-queue-projection.test.ts server/agent/session/session-user-identity-migration.test.ts server/agent/session/agent-attachment-migration.test.ts
bun run test -- server/agent/harness/session-attachment.test.ts
bun run test -- server/agent/harness/neuro-agent-harness.black-box.test.ts
bun run test -- server/agent/harness/neuro-agent-harness.test.ts -t 'waiting 状态 abort|abort clearQueue|模型错误结束|模型错误后暂停|running 状态 abort|provider error 会作为|模型前 harness 错误|compact command 失败|invocation preflight|Tree 编辑在附件|归档隐藏关系|create 与 archive|后端恢复 waiting 后 abort'
bun run test -- server/agent/harness/neuro-agent-harness.test.ts
bun run test -- server/agent/harness/neuro-agent-harness.test.ts -t 'Plan Mode 使用 Project Workspace .agent/plan 并支持 exit preview'
bun run typecheck
```

## 2026-07-24：第一次系统性收口

本轮不是在既有图片入口上继续增加条件分支，而是把附件授权、Session 交互、用户输入接收和前端上传生命周期分别收口到单一边界：

- 后端新增 `SessionAttachmentAuthority`。JSONL 仍是唯一持久化真相；Authority 冷访问时流式扫描全部 branch/batch，热访问使用可重建内存索引，并由 `SessionWriteExecutor` after-write observer 增量维护。索引用文件 identity、size、mtime 纳秒签名识别外部修改；构建期间的写入通过 pending entries 补入并按 entry ID 去重。
- Authority 统一承担 list/search、批量 resolve、ownership、canonical metadata、locator 和 Provider hydration 预检。同一 Attachment ID 的 MIME/bytes 冲突会让目录、locator、continue/rerun 和 Provider hydration 全部 fail closed。
- 新增 `POST /attachments/resolve`，严格接受 1–8 个不重复 Attachment ID，按请求顺序返回；任一 ID 不属于当前 Session 时整体失败。`resolve([])` 仅作为内部 Authority 短路，不是合法 HTTP 请求。
- 新增共享 `sessionInteraction()`，recovery、live state、Session summary、前端控件和后端 mutation gate 消费同一能力矩阵。Waiting User Input 只允许回答、停止和查看；Profile 缺失/不可运行只允许查看、复制和归档；Archived 只允许查看、复制和恢复。
- prompt、steer、follow-up 和 Tree prompt 使用 `clientMessageId`；durable user entry、queue item、公开 Chat/Queue DTO 都暴露同一 ID。`InvokeAgentResult.acceptance` 明确区分 `not_accepted`、`queued` 和 `persisted`，前端不再按正文或字节数猜测乐观消息身份。
- durable user entry 新增明确 `intent: "normal" | "steer"`；`<user_steer>` 只保留为 Provider envelope，公开投影和前端不再通过正文正则判断 steer。一次性 Session migration 为既有 entry/queue item 写入身份与 intent，runtime 不保留兼容 decoder。
- follow-up drain 改为 peek → admission → durable user commit → queue ack。user entry 保存 `sourceQueueItemId`；commit 后 ack 失败时，恢复过程只补 ack，不重复运行；重新 admission 失败会保留队首并公开有界 `admission_error`。
- Tree 编辑/重跑在移动 leaf 前完成 Profile、Project、interaction 和附件 admission；预检失败不会改变 active path，成功的新 prompt 使用显式 parent 写入目标分支。
- archive 只向自身追加 `session_archived`，restore 追加 `session_restored`，都不跨 Session 写 detach。effective relation view 隐藏任一归档端；恢复后仍 linked 的关系自动重新显现，归档期间发生的显式 detach 仍是最终账本事实。
- 前端以编辑器 document 作为图片存在性与顺序的唯一真相，`useComposerImageTransaction` 只管理 File、AbortController、上传结果和失败状态。主 Composer 与历史编辑器共享同一 controller；Session generation 同时约束草稿、上传事务、debounce 和迟到响应。
- 上传路由在消费 body 前执行 Session/Profile/Project/interaction preflight，再由直接依赖的 `busboy` 流式限制 multipart。snapshot 使用同一个已打开 FileHandle 完成 `fstat`、最多 16 MiB + 1 的有界读取和二次稳定性检查，并拒绝 Attachment Store 的逻辑地址、绝对路径和链接真实目标。
- Markdown HTTP/草稿/历史边界统一使用直接依赖的 mdast parser/serializer；Composer 按键热路径直接投影 TipTap document，不重复解析全文。inline/reference image、title、angle destination、跨行 alt、blockquote、code 和 HTML `<pre>` 均有回归。

实际实现与计划的偏差：

- Busboy `partsLimit` 和 file `limit` 都会在达到阈值时触发。实现使用 `parts: 2` 来允许唯一合法 file part 并探测第二个 part，使用 `fileSize: 16 MiB + 1` 作为溢出哨兵；业务层仍严格拒绝第二个 part 和 `> 16 MiB`，因此公开合同没有放宽。
- Attachment Authority 在损坏数据上不持久化 sidecar，也不缓存伪造的空 metadata；扫描失败直接抛错，下一次访问仍从 JSONL 重建并 fail closed。
- snapshot 的读取前后 bigint `fstat` 已实现；自动测试覆盖稳定副本、大小边界和 Store 自引用拒绝，没有为了制造“读取中修改”而给生产实现增加测试专用 seam。
- 按计划未实现文本附件、远程 URL、OCR、删除、GC、Provider File API 或缩略图转换，也未自动执行浏览器验收。

当次验证（已由上方二次审查的最新结果取代）：Task 108 聚焦集合 `16 files / 107 tests` 通过；Agent black-box `25/25` 通过。完整 Harness 首轮审查暴露的 interaction、receipt、turn admission batch、Waiting queue 和 Tree 旧期望已经按新合同修正；当时还确认一条不属于本任务 diff 的模型 recovery 期望失败（删除模型后公开 `model` 为 `null` 还是保留旧 ID），未借 Task 108 修改。最终复跑随后被工作区另一组 Project resource registry 改动在收集阶段阻断（`registerProjectResourceOwner is not a function`），同一时点无 Harness 聚合入口的抽样仍为 `4 files / 25 tests` 通过，未虚报完整 Harness 全绿。`bun run typecheck` 同样被 Project Workspace/File Index 改动阻断，报错集中在缺失 project-history/plot/world-engine exports 与新增 `fileIndex` 参数，输出没有 Task 108 文件错误；浏览器验收未执行。

## 2026-07-23：Session 图片附件与 Composer 图片输入

本轮在既有 Attachment Store 上完成用户可见图片输入闭环：

- Composer 正文成为图片顺序的唯一真相源，统一 parser/serializer 只识别真实 Markdown 图片节点，忽略普通链接、转义、行内代码、fenced code 和缩进代码块。
- 新增 `session_attachment` projection entry，以及 multipart 上传、Project/Workspace Root `.nbook`/绝对路径快照、Session 全分支附件目录和完整历史 user-content 接口。
- invoke HTTP 合同硬切为 `{text}`；旧 `message.images` base64 ingress 由严格 schema 拒绝。prompt、steer、follow-up、payload 和 queue drain 全部消费同一有序 `StoredContent[]`。
- Composer 已支持拖拽、文件选择、剪贴板、`@` Session 附件、`@` Project 图片和 `@C:/...` 绝对路径图片；多图最多两个请求并发，pending 节点按唯一 ID 原位替换，失败可重试或移除。
- 头部附件面板覆盖 Session 全 branch/batch，支持搜索、分页和重新插入；面板搜索结果与 Composer 已知附件缓存分离，`@` 菜单按 query 直接查询服务端目录。
- 缩略图完全从正文图片节点派生；Session 切换会 abort 客户端 pending 请求并忽略迟到响应，已由服务端登记的附件继续保留在原 Session。
- 草稿按 `agent:composer-draft:v1:<workspaceKey>:<sessionId>` 保存纯 Markdown，300ms 防抖、256 KiB、最多 10 条、30 天清理，并拒绝 data/blob 图片目标。
- 乐观用户消息、历史复制/编辑和重新运行均保持文字与图片 contentIndex 顺序；公开正文被截断时按需读取完整 user-content。
- `EnabledModelOptionDto` 增加 `input`，缺省按纯文本模型处理；非视觉模型前端提示但允许发送，后端继续使用原位置文本占位且不读取 blob。

实际实现与计划的差异：

- `@` Session 附件菜单每次 query 取最近 20 项，完整翻页仍由附件面板承担，避免同步 trigger resolver 预加载整个大型目录。
- pending 节点以 ProseMirror node attr 中的唯一 upload ID 定位，没有建立第二套外部 transaction registry；乱序响应仍按 ID 原位替换。
- 草稿后台清理其它 Session 的坏记录时不逐条弹通知；只有当前 Session 恢复时发现记录被丢弃才提示，避免启动时通知风暴。
- 按计划未实现文本附件、远程 URL、OCR、删除或 GC，也未自动执行浏览器验证。

该阶段验证：聚焦回归 `17 files / 102 tests`，图片 follow-up / Provider 恢复 / Session snapshot 选择性 Harness `3 passed`，`bun run typecheck` 通过。最终收口结果以上方 2026-07-24 记录为准。

## 2026-07-19：Session Entry授权与Migration路径ownership

- Attachment route不再把content hash当授权凭证；Repository一次流式扫描同时返回Session metadata与目标entry，Project session先经过Project open gate，再校验公开Chat Flow locator。
- 路由只把locator缺失映射404；`ProjectNotOpenError`保留统一409，避免typed生命周期错误被裸catch吞掉。
- migration manifest中的source必须位于`.nbook/agent/sessions/**/*.jsonl`；backup/stage/rollback必须由run root与source确定性派生、互不重叠。
- load/write/checkpoint都会检查现有路径段的symlink/junction，损坏manifest不能指向其他Session、Global Config或Workspace Root外文件。
- Stored Message exact-key与Local Adapter锁/链接隔离复核通过。Migration的文件create/rename现在在POSIX同步父目录，补齐断电后的目录项持久性；Windows受Node目录句柄能力限制，继续依赖文件handle sync与原子rename。Migration、Repository、route与Harness聚焦回归通过。
- 本轮文件授权整合保持Attachment Store仍固定在全局Workspace Root `.nbook/agent/attachments`；source读取复用Task 109的Project身份/open gate，不把物理blob路径反推为Project。分页与公开事件协议未改变，公开Product和浏览器图片展示仍未重验。

## Relative documents refs

- [Agent Runtime Event OOM 与 SSE 内存边界](../107-agent-event-memory-boundaries/README.md)
- [Agent Chat Flow Snapshot 分页](../106-agent-chat-flow-pagination/README.md)
- [Agent Session Management](../15-agent-session-management/README.md)
- [Agent Turn Commit Boundary](../07-agent-turn-commit-boundary/README.md)
- [Workspace 标准术语](../../../reference/workspace/TERMS.md)

## Status

Implemented locally（2026-07-24：Session 图片附件、原子准入与 transport unknown 对账已完成；自动化验证见最新 walkthrough，浏览器人工验收由用户决定是否执行。）

## User Request / Topic

- 真实 session 中的 `read(image)` tool result 会把图片编码成 base64，随后原样进入运行态消息、append-only JSONL 和下一轮 Provider context。
- Task 107 已让公开 SSE / replay / Chat Flow DTO 不再直接返回图片 data，Task 106 已让 recovery/history 使用有界公开投影；两者都没有改变 durable session truth 中的内联图片。
- 本任务建立通用 Attachment 存储内核。图片是第一种消费者；后续用户在对话中上传的文本文件复用同一 `AttachmentRef`、Store 和 Adapter seam。
- 当前只实现本地存储 Adapter，但 Interface 必须允许未来接入 OSS 或数据库存储，且不能让存储细节进入 JSONL、消息类型或 Provider 层。
- Chat Flow 需要展示历史图片，因此本任务包含一个按 session entry 授权的完整附件读取接口；禁止提供只凭 content hash 任意读取的公开接口。

## Confirmed Decisions

- [x] Attachment 根目录使用 Workspace Root `.nbook/agent/attachments/`。
- [x] Project 删除不删除 Attachment；Project session 归档后引用仍可解析。
- [x] 第一版不实现 GC、引用计数或自动删除；允许孤儿附件，避免误删仍被历史 session 引用的内容。
- [x] 第一版增加完整附件读取接口，供 Agent Chat Flow 展示图片。
- [x] 完整解除 NeuroBook stored/tool result 类型与 Pi `AgentToolResult` / `ToolResultMessage` 图片类型的持久化耦合，不采用 commit 前临时 normalize 的过渡方案。
- [x] 本次硬切新的 stored attachment 格式；提供一次性迁移脚本，不在 runtime 长期维护内联图片和引用图片两套格式。
- [x] Attachment 内核从第一天支持通用 MIME 与 bytes；第一版 Provider presentation 只实现图片，不实现文本提取、全文注入、摘要、OCR 或 Provider File API。
- [x] 用户图片 HTTP ingress 硬切为 Session multipart 上传/本地文件快照 + Composer Markdown 引用；`AgentUserMessageInputDto` 只接收 `{text}`，严格拒绝旧 `message.images` base64 请求。

## Goal

让 Agent session 的图片消息和图片 tool result 不再把 base64 内联到 JSONL、RunFrame、queue truth、公开事件和 trace context，同时满足：

- Provider 在真正需要图片时获得与原始内容等价的临时 Pi `ImageContent`。
- session 重启、retry、tree move、compaction 和归档后引用仍然稳定。
- Chat Flow 可以通过受 session/entry/content index 约束的接口展示完整图片。
- 相同二进制在同一 Workspace Root 内只存一份。
- Local/OSS/数据库只替换存储 Adapter，不改变 JSONL schema、消息类型或 Provider hydration。
- 类型系统禁止新的 raw Pi image 再次进入 stored session truth。

## Current State / Evidence

### 真实数据

扫描 `workspace/.nbook/agent/sessions`：

- 3 个 session 包含内联图片，均来自 `message / toolResult / read`。
- session 94：图片 base64 约 9.12 MiB；JSONL 约 10.30 MB，最大单行约 9.56 MB，原始图片约 7.17 MB。
- session 41、61：各约 1.24 MiB base64。
- 合计约 11.59 MiB。
- 将 session 94 模拟改为轻量引用后，JSONL 约 0.74 MB；30 次逐行 parse 平均约从 8.72 ms 降到 1.74 ms。

### 当前放大链路

1. `read(image)` 读取 Buffer 后调用 `buffer.toString("base64")`。
2. Pi `AgentToolResult.content` 只允许 text/image，图片必须携带 `data`。
3. `createToolResultFromResult()` 原样构造 Pi `ToolResultMessage`。
4. `RuntimeTurn`、`RunFrame`、`NeuroSessionContext` 和 `SessionEntry.message` 都直接使用 Pi message 类型。
5. `commitTurn()` 将 assistant/tool result 原样写入 JSONL。
6. `applySuccessfulTurn()` 将原始 tool result 再推入 RunFrame，下一轮继续持有 base64。
7. `createTurnSnapshot()` / `RuntimeTurn.snapshot` 当前持有 Provider messages；若在 snapshot 阶段提前 hydration，base64 会跟随慢工具执行继续存活。
8. follow-up queue truth 可把 `message.images` 作为 custom JSON 写入 JSONL；只在 turn commit 前转换无法覆盖 queue。
9. Provider trace 当前可能保存 hydrated context 或原生 provider payload，形成 JSONL 之外的第二条 base64 持久化旁路。

## Rejected Alternatives

### 继续内联 JSONL，只在 HTTP/SSE 省略

不采用。它只能减少网络返回，无法解决：

- `readSession()` 整文件读取和 JSON.parse。
- list/recovery/reduce/tree/fork/append 前的重复解析与复制。
- base64 固定约 33% 的体积膨胀。
- RunFrame、queue、compaction 与 Provider context 的长期引用。
- 跨 session 去重。
- 后续文本附件继续放大 JSONL。

### 压缩 JSONL 或压缩内联块

不采用。session 94 实测 gzip 约 4.68 MB、brotli 约 3.04 MB，但每次读取仍需完整解压和解析；同时破坏 append-only JSONL 的简单调试、手工修复和逐行迁移合同。PNG 本身已压缩，收益不稳定。

### per-session / per-entry sidecar

不采用。它把 blob 生命周期绑到单个 session/entry，增加 retry/fork/归档/迁移复杂度，也无法自然跨 session 去重。content-addressed Workspace Root Attachment 更符合现有 session repository 生命周期。

## Architecture

### 1. 三层 Module

#### AttachmentBlobAdapter

Adapter 只负责 opaque key 与 bytes，不理解 Attachment ID、MIME、图片、session 或 Provider。

```typescript
export interface AttachmentBlobAdapter {
    /**
     * 幂等确保 key 最终对应完全相同的 bytes。
     * 已存在相同内容时成功；已存在不同内容时失败。
     * 返回成功后，同一 Adapter/Store 的 get(key) 必须立即可见并返回完全相同的 bytes；
     * 最终一致存储必须在 Adapter 内部满足该 read-after-write 合同，不能把短暂不可见暴露给调用者。
     */
    put(key: string, bytes: Uint8Array): Promise<void>;

    /** 不存在时返回 null；存储故障应抛出稳定的 adapter error。 */
    get(key: string): Promise<Uint8Array | null>;
}
```

第一版不加入：

- `delete` / `list` / `exists` / `stat`
- `getUrl` / `signedUrl`
- 引用计数
- backend config/factory
- transaction
- stream/range API

当前真实图片约 7 MiB，`Uint8Array` 足够。出现真实超大文件需求后再升级 stream Interface，避免提前维护两套读写协议。

#### AttachmentStore

```typescript
export type AttachmentId = `sha256:${string}`;

export type AttachmentRef = {
    id: AttachmentId;
    mimeType: string;
    bytes: number;
};

export class AttachmentStore {
    constructor(adapter: AttachmentBlobAdapter);

    save(input: {
        bytes: Uint8Array;
        mimeType: string;
    }): Promise<AttachmentRef>;

    load(ref: AttachmentRef): Promise<Uint8Array>;
}
```

Store 负责：

- SHA-256 与 `sha256:<64 lowercase hex>` ID。
- Adapter key 派生。
- ID 格式、bytes 和 hash 校验。
- 幂等保存。
- 稳定错误分类。
- 防止调用者控制本地路径。

稳定错误：

- `invalid_reference`
- `not_found`
- `corrupt`
- `storage_failed`

错误文案不得暴露 Workspace Root 绝对路径。

#### AgentAttachmentCodec

Codec 负责 Agent 领域规则：

- raw Pi image / HTTP image ingress 转换为 stored attachment block。
- 图片魔数验证和 canonical MIME。
- stored message 转换为 Provider Pi message。
- 非视觉模型的 placeholder policy。
- public attachment metadata projection。
- trace-safe projection。

图片 MIME 不能只相信扩展名或请求声明；PNG、JPEG、GIF、WebP 必须使用魔数校验。通用 Store 不承担图片格式规则。

### 2. Local Adapter 布局与所有权

附件根由 `JsonlSessionRepository.rootWorkspace` 决定，不从单个 `SessionMetadata.workspaceRoot` 或 `projectPath` 推导：

```text
<Workspace Root>/.nbook/agent/attachments/sha256/<前2位>/<剩余62位>
```

JSONL 永远不存：

- 本地绝对路径
- Project Path
- `file://` URL
- OSS URL
- 扩展名
- bucket/table 名称

文件名属于消息中的使用场景，不属于 blob identity：

```typescript
export type StoredAttachmentContent = {
    type: "attachment";
    attachment: AttachmentRef;
    /** 用户上传名或工具读取文件的 basename；不参与内容寻址。 */
    name?: string;
};
```

### 3. Local Adapter 原子与并发合同

1. 在目标同目录创建 `pid + UUID` 唯一 temp。
2. 使用 `open(temp, "wx")`。
3. 完整写入、`FileHandle.sync()`、close。
4. rename 发布。
5. finally 清理 temp。
6. 同一进程按目标 key 加 keyed lock，使正常并发确定化。
7. Windows `EEXIST` / `EPERM` 或并发发布冲突时，读取目标并校验 hash/bytes；相同视为成功，不同报告 `corrupt`。
8. temp 与目标必须同目录同卷，不能跨卷 rename。
9. keyed lock entry 在最后一个等待者完成后必须于 `finally` 删除；成功、失败和 abort 都不能让 lock Map 随不同 hash 永久增长。

JSONL 只能在 `AttachmentStore.save()` 成功发布后 append。允许 blob 成功、JSONL 失败后留下孤儿；禁止 JSONL 已引用但 blob 尚未发布。

现有 JSONL append 没有 `fsync`，因此本任务不宣称跨断电事务。若未来需要更强 crash consistency，应单独治理整个 session repository，不能只在 Attachment 层制造虚假保证。

## Stored Message Contract

### 1. Stored 类型与 Pi 类型硬分层

Pi `ImageContent` 只能表达 `{type:"image", data, mimeType}`，不能承担 durable attachment 引用。JSONL、session reducer、RunFrame 和 queue 必须改用 NeuroBook stored 类型：

```typescript
export type StoredContent =
    | {
        type: "text";
        text: string;
    }
    | StoredAttachmentContent;

export type StoredUserMessage = Omit<UserMessage, "content"> & {
    content: string | StoredContent[];
};

export type StoredToolResultMessage = {
    role: "toolResult";
    toolCallId: string;
    toolName: string;
    content: StoredContent[];
    /** 工具 seam 已解析为可持久化 JSON；不存在时表示没有结构化 details。 */
    details?: JsonValue;
    isError: boolean;
    timestamp: number;
};

export type StoredAgentMessage =
    | StoredUserMessage
    | AssistantMessage
    | StoredToolResultMessage;
```

Assistant message 当前只含 text/thinking/toolCall，不需要 attachment block；若 Provider 未来支持 assistant attachment，必须显式扩展 stored schema，不能让 Pi 类型自动渗入。

以下位置必须使用 `StoredAgentMessage`：

- `SessionEntry.message`
- `CustomMessageSessionEntry.message`
- `NeuroSessionContext.messages`
- `RunFrame.messages`
- runtime-only / next-turn messages
- steer/follow-up queue truth
- `RuntimeTurn.toolResults`
- commit/reduce/retry/tree 输入
- `AgentRuntimeHookResult.runtimeMessages`、pending user message、turn hook model messages/tool results
- sidecar merge plan 的 runtime/persisted messages
- profile prepare/append/model-context message Interface

所有 hook/sidecar/profile ingress 必须直接使用 stored 类型；确实接收外部 Pi message 的单一显式 Adapter seam 才允许 normalize，不能在多个 hook 回调后补救。

Repository append 前和 `readSession()` JSON parse 后都增加 stored schema/assert：任何 durable message 都不得包含 raw `{type:"image", data}`。read-side 失败返回稳定的 `migration_required` 或 `corrupt`，不能把遗漏的旧 data cast 进 reduce/RunFrame。这是 fail-closed 防线，不替代入口 normalization。

### 2. NeuroBook 工具结果

```typescript
export type NeuroToolResult<TDetails extends JsonValue = JsonValue> = {
    content: StoredContent[];
    details: TDetails;
    terminate?: boolean;
};
```

`NeuroAgentTool` 不再继承 Pi `AgentTool`：

```typescript
export type ToolExecuteOptions<TDetails extends JsonValue = JsonValue> = {
    /** 用户输入暂停恢复后提交的数据；未发生用户输入时为空。 */
    userInput?: JsonValue;
    signal?: AbortSignal;
    onUpdate?: (partial: NeuroToolResult<TDetails>) => void;
};

export type NeuroAgentTool<TParameters extends TSchema, TDetails extends JsonValue = JsonValue> = {
    key: string;
    name: string;
    label: string;
    description: string;
    parameters: TParameters;
    validationSchema?: TSchema;
    approvalRequired?: boolean;
    mutatesWorkspace?: boolean;
    executionMode?: ToolExecutionMode;
    userInputRequest?: NeuroUserInputRequest;
    prepareArguments?: (args: unknown) => Static<TParameters>;
    execute: (
        context: ToolExecutionContext,
        toolCallId: string,
        params: Static<TParameters>,
        options: ToolExecuteOptions<TDetails>,
    ) => Promise<NeuroToolResult<TDetails>>;
};
```

该 Interface 必须保留当前 Harness 已依赖的写审批、Plan/Discuss mutation 标记、独立 validation schema、串并行调度、用户输入暂停和 profile schema override；本任务只解除 Pi result/content 耦合，不能顺手删除既有工具领域能力。

Provider 只需要工具 name/description/parameters。`AgentToolRegistry` 应将完整 NeuroBook 工具投影为 Provider schema，而不是把执行 Interface 传入 Provider。

工具 `onUpdate` 也必须使用受限的 NeuroBook partial result 类型，避免流式工具重新引入 Pi image。外部 unknown 结果必须在工具 seam 解析/投影为 `JsonValue`，不能把 `unknown/any` 带入 durable details。

`read(image)` 目标行为：直接将 Buffer 保存到 AttachmentStore，返回 attachment block；不得先构造 base64：

```typescript
const attachment = await context.attachments.save({
    bytes: buffer,
    mimeType,
});

return {
    content: [
        {type: "text", text: `Read image file [${mimeType}]`},
        {
            type: "attachment",
            attachment,
            name: basename(absolutePath),
        },
    ],
    details: {path: absolutePath},
};
```

## Write / Runtime Integration

### 用户图片

- `AgentUserMessageInputDto` 固定为 `{text: string}`，图片通过 Composer Markdown 中的稳定 Session Attachment 目标表达。
- 上传使用 session-scoped multipart 接口；Project File Address、Workspace Root `.nbook` 地址和绝对路径图片先经 snapshot 接口生成稳定副本。
- admission 解析 Markdown 后按 Session 目录校验 Attachment ID；Project/绝对路径、远程 URL和其它 Session 的哈希目标不能直接进入模型。
- queue truth 只保存 stored attachment ref，不能保存 base64。
- steer、follow-up 和 next-turn 都必须保留附件，不得静默丢弃。

### 工具图片

- `read(image)` 通过 `AgentAttachmentCodec.saveImage()` 保存并直接返回 Codec 生成的 attachment block；不能直接写 Attachment Store。
- 主 Harness 不保留“任意 Pi tool result 自动 normalize”的永久兼容分支。若未来接入外部 Pi Tool，必须通过独立、显式的 `PiToolAdapter` 转换为 `NeuroToolResult`，并在进入 Harness 前完成 attachment normalization。
- `applySuccessfulTurn()` 只能把 commit 后的 stored assistant/tool result 写入 RunFrame。
- runtime-only transcript 也要 normalize；V1 允许因此产生孤儿附件。
- `SessionWriteExecutor` 在所有 `message/custom_message` durable write 前执行最终 normalization/invariant。
- `NeuroAgentHarness` 持有单个 `AttachmentStore` 和基于它构造的 `AgentAttachmentCodec`；`ToolExecutionContext` 只暴露 Codec，不暴露 Store 或 Local/OSS/数据库 Adapter。
- Codec 是上传、文件快照和工具图片共享的图片语义边界，统一执行 MIME/魔数、完整解码、64 MP 像素上限与稳定错误映射；通用 Store 保持不理解图片。

## Provider Hydration

`TurnSnapshot` 只保留 stored `modelMessages`，不得保存 hydrated `providerMessages`。唯一普通 Provider hydration seam 位于 `streamAssistant()` 内、紧贴 `tracedStreamSimple()` 调用：

```typescript
const providerMessages = await attachmentCodec.hydrateForProvider(
    snapshot.modelMessages,
    model,
);

try {
    return await streamProvider(providerMessages);
} finally {
    // RuntimeTurn/snapshot 不保存 providerMessages；Provider 调用结束后即可释放临时 base64。
}
```

Hydrator 合同：

- 只 hydrate 当前 turn 真正可见的 attachment ref。
- 同一请求按 attachment ID dedupe load 和 base64 编码。
- load 时校验 ID、bytes、hash；图片再校验 canonical MIME。
- 视觉模型将图片 attachment 临时转换为 Pi `ImageContent`。
- 非视觉模型不读取 blob；每个 attachment block 在原位置一对一替换为统一 marker，例如 `[attachment omitted: image/png, 7170689 bytes]`，保持 block 顺序。
- hydration 结果不写回 JSONL、RunFrame 或 stored messages。
- `RuntimeTurn` 和其 snapshot 不得保留 hydrated Context/providerMessages；否则慢工具执行会继续 pin base64。
- Provider 请求结束后，临时 base64 生命周期结束。
- 缺失、损坏、MIME 不符时在 Provider 请求发出前明确失败，不能静默丢图继续生成。

Compaction 当前将消息整理成纯文本 summary prompt，不应为 compaction hydrate 图片。新增唯一 stored message presentation/estimation policy：非视觉 marker、compaction marker 和 token estimation 复用同一 formatter，不能维护三套字符串规则。它需要覆盖 harness、compaction、sidecar/context usage 的全部 estimator 调用点，而不是只替换主 turn：

- token estimator 对 attachment 使用固定/保守图片成本，不读取 blob；
- summary 文本保留同一轻量 marker；
- retry/tree/fork 只移动或复制 ref，下一次真实 Provider turn 再 hydrate。

## Trace Safety

Provider hydration 产生的 base64 只能活在 Provider 请求对象中，不能被 trace 再次持久化：

- 当前 `TraceCollector` 直接持有传给 Provider 的 hydrated `Context`，因此必须修改 traced-provider seam：`tracedStreamSimple/tracedCompleteSimple` 显式接收独立的 bounded `traceContext`；Collector 不得再默认保存 Provider Context 引用。
- `traceContext` 从 stored messages 生成，只记录 attachment metadata，不记录 hydrated `data`；Provider 仍接收单独的真实 hydrated Context。
- Collector 在调用时立即复制 bounded safe DTO，不持有调用方后续可能释放的 hydrated 对象引用。
- 本轮冻结单一路径：请求只要包含 attachment，即使全局 `capturePayload=true`，该次请求的 provider 原生 payload 也必须记为 omitted/undefined，并记录 `payloadOmittedReason="attachment"`；不实现递归 provider-specific payload 清洗分支。
- trace 中只记录 attachment ID、MIME、bytes、name 和 `dataOmitted=true`。
- 旧 trace 不迁移；新代码必须保证不再产生新的 attachment base64 trace。

Trace 安全必须通过 recorder 最终落盘内容断言，而不是只检查调用前对象；测试应扫描 trace JSON，不得出现原图片 base64 前缀、完整 data URL 或与原始 bytes 对应的大字符串。

## Public DTO and Chat Flow

统一公开 DTO：

```typescript
export type PublicAttachmentDto = {
    attachmentId: AttachmentId;
    mimeType: string;
    bytes: number;
    name?: string;
    dataOmitted: true;
};

export type AgentChatAttachmentDto = {
    /** attachment block 在所属 stored message content 中的稳定索引。 */
    contentIndex: number;
    attachment: PublicAttachmentDto;
};

export type AgentChatUserEntryDto = {
    id: string;
    timestamp: number;
    type: "user";
    blocks: AgentChatContentBlockDto[];
    omittedBlocks: number;
    textSummary: AgentChatTextSummaryDto;
    intent: "normal" | "steer";
};
```

公开投影合同：

- user entry 只使用按原 stored `contentIndex` 保序的 `blocks`；`textSummary`只记录总字节与省略状态，不复制正文。纯图片 user message 即使文本为空也必须形成可见 Chat Flow 节点。
- tool result 的 `PublicToolContentDto` 增加 attachment 判别分支，并为每个公开 block 保留原 stored `contentIndex`；projector 必须先记录源 index 再过滤未知 block，禁止 `map/filter` 后重新编号。
- 文本与附件按 stored content index 排序渲染；不能把所有文字聚合到顶部、所有图片聚合到底部后改变原消息语义。
- read tool result 的图片由 read 工具卡展示；未知工具附件由通用 tool result bubble 展示，不能建立 read-only 特判存储结构。
- queue item 尚未形成 durable entry，只返回 `PublicAttachmentDto` metadata，不生成可读取 locator。
- stable `session_entry` 到达后，live tool metadata 与 durable attachment locator 按 toolCall/entry 合并，不重复显示。
- 前端在只有 live metadata 时就渲染附件卡：图片和非图片分别显示对应的暂不可用状态，但不生成 URL、不请求变体也不轮询；durable entry ID 到达后再响应式启用预览或原件下载。

普通投影不得为每个 ref 调 `get/stat/has`，因此不增加 `available` 字段，避免 history/recovery N+1 I/O。

### 完整附件读取接口

Chat Flow 通过归属路径读取完整附件：

```text
GET /api/agent/sessions/:sessionId/entries/:entryId/attachments/:contentIndex
```

接口必须：

1. 按现有 session 访问规则加载 session。
2. 验证 `entryId` 确实属于该 session。
3. 使用与 Task 106/107 相同的 Chat Flow eligibility/projector 规则，验证该 entry 确实能够公开，并且该 `contentIndex` 是 projector 实际生成的 durable locator。不得笼统允许任意 `custom_message`、queue truth、control/projection-only entry。
4. 从已验证 block 中取得 `AttachmentRef`，不能接受调用者直接传 hash/path；`entryId` 必须按 URL segment 编码，`contentIndex` 必须是有合理上限的非负整数。
5. 通过 AttachmentStore load 并校验 hash/bytes/MIME。
6. 返回 `Content-Type`、`Content-Length`、`X-Content-Type-Options: nosniff`。
7. 只有经图片 Codec 魔数验证的 PNG/JPEG/GIF/WebP 可以使用 `Content-Disposition: inline`；SVG、HTML、文本和其他通用 MIME 强制 `attachment`，不得在应用同源直接执行。文件名需要安全编码，不能直接拼 header。
8. 使用基于 attachment ID 的带引号 ETag 和 `Cache-Control: private, max-age=31536000, immutable`；处理 `If-None-Match`，授权和 locator 校验通过后命中应返回 304，且不发送 blob body。
9. not found/corrupt/非法归属返回稳定错误，不暴露本地路径。

不提供 `/attachments/:hash`。content hash 不是授权凭证。

只有上述 Chat Flow projector 明确公开的 durable block 才能生成 `AgentChatAttachmentDto`。route 必须复用同一公开资格规则重新验证 locator，不能把 content hash 当作授权凭证。

访问与缓存语义：

- archived session 和 off-active branch 中仍属于公开 durable Chat Flow entry 的附件可读，支持历史分支查看。
- Project 删除只归档 session，因此既有 URL 继续有效；若未来引入真正 session 删除或用户权限撤销，必须重新评估一年 immutable cache，并通过 URL/权限版本化避免旧缓存绕过新策略。
- session 不存在、entry 不公开、index 不匹配、blob 缺失或损坏都返回稳定错误；不能回退为按 hash 查找。

Chat Flow 图片 UI：

- 使用直接 route URL，不创建长期 object URL。
- 使用 lazy loading、稳定 loading placeholder 和最小高度，避免图片加载前节点高度为零。
- 第一版没有 width/height metadata，不提前引入图片解码依赖；加载完成后的尺寸变化必须接入 Chat Flow 现有滚动/锚点修正 seam。
- 向上 prepend history 时，图片迟到加载不能破坏 Task 106 的滚动锚点；session 切换或节点卸载后的迟到事件不得修改新 session 状态。
- 图片失败只显示对应节点的 metadata/局部错误，不触发整个 history recovery。

性能边界：每张图片 route 都需要验证 session/entry，但不得为一个 locator 建立新的全局持久化索引。本轮先提供 repository entry lookup seam 并记录 route timing；若实现仍需整份 `readSession()`，必须增加多图 session 集成基线和升级阈值，不能无记录地接受 N 张图触发 N 次长 JSONL 全量解析。

## Future Text Attachments

文本文件继续使用相同：

- `AttachmentRef`
- `StoredAttachmentContent`
- `AttachmentStore`
- `AttachmentBlobAdapter`
- 授权读取接口

后续文本附件任务再决定 Provider presentation policy：

- MIME/文件名识别
- 编码检测
- 按 token/byte 预算截取
- 摘要
- Provider File API
- 仅下载不注入模型

原始 bytes 不永久内联消息。上述策略不得进入 Store 或 Adapter。

## Migration

本次硬切，不维护 runtime legacy 双格式。迁移是部署新 invariant 前的必做步骤。

### 独占迁移门禁

- 使用 Workspace Root 级 sentinel，例如 `.nbook/agent/migrations/attachment-v1.lock`，内容包含 runId、PID、开始时间和 manifest 路径。
- 脚本必须以 exclusive create 取得 lock；已存在时默认拒绝，不能自动覆盖未知运行。
- runtime 启动和所有 session append 都必须检查该 lock：存在时拒绝启动 Agent runtime/拒绝写入，并返回明确维护状态。不能只依赖“用户已经关闭应用”的人工约定。
- lock 只在 manifest 表明全部 session 已完成、全库复扫通过后删除。异常中断保留 lock，下一次脚本按 manifest 恢复。

### 脚本 Interface

- 默认 `--dry-run`，只有显式 `--apply` 才允许写入。
- dry-run 对所有 session、queue truth 和目标 attachment 做完整预检；任一文件无法解析、MIME 不符或目标不可写时，apply 前零修改。
- 输出稳定退出码和 machine-readable report：runId、sessionId、源 JSONL hash、目标 JSONL hash、图片数、去重后 attachment 数、bytes、backup 路径和最终状态。
- backup 使用 repository 不会枚举为 session 的独立 migration 目录和唯一 runId，不覆盖既有 backup。
- migration-only old-format decoder 只存在于脚本目录，不进入 runtime import graph。
- 脚本重复执行必须幂等：已转换 ref 只校验，不再次转换；已完成 session 不重复发布。

### 可重入状态机

每个 session 在 manifest 中至少记录：

1. `pending`：尚未开始。
2. `backed_up`：原 JSONL 已复制到唯一 backup，并完成文件 hash 校验；原文件仍存在。
3. `attachments_written`：所有 blob 已保存并 load 校验。
4. `temp_verified`：临时 JSONL 已写完、重读、stored schema 校验、hydration smoke 和 raw image 复扫通过。
5. `publishing`：进入平台相关替换窗口。
6. `published`：新 JSONL 已成为 original，重新读取和 hash 校验通过。
7. `verified`：该 session 完成最终复扫。

脚本启动时必须根据 manifest 与磁盘实态恢复，明确处理 original/backup/temp/rollback 文件的每种组合。不能只在 catch 中执行一次“回滚”。

Windows 发布允许短暂的 `original → rollback`、`temp → original` 两步窗口，但 manifest 必须先进入 `publishing`；若两步之间崩溃，下次运行应从 rollback 恢复 original 或继续发布。rollback 仅在新 original 重读验证成功后删除。不得假设 rename 可以覆盖现有目标。

### 硬切发布顺序

1. 构建通用 Store、新 stored schema、迁移脚本和 migration-only old-format decoder。
2. 对整个 Workspace Root 执行 dry-run；不通过则停止发布。
3. 停止应用写入并取得 migration lock；runtime/append 通过 sentinel 做第二道排他检查。
4. 按 manifest 迁移全部 session；部分失败时保留 lock 和恢复材料，不允许启动硬切 runtime。
5. 全库复扫确认 session JSONL、follow-up queue truth 均不存在 raw image/data URL，并验证所有 refs 可 load。
6. manifest 标记 complete，删除 migration lock。
7. 启动只接受 stored attachment 的 runtime；Repository 对任何残留 raw image fail closed。

迁移脚本可以保留为显式维护工具，但 runtime 不保留旧格式解析分支。当前旧 trace 不迁移。

## Implementation Plan

### Phase 1：冻结通用 Attachment 与 stored message Interface

- 新增 `AttachmentId`、`AttachmentRef`、`StoredAttachmentContent`、`StoredAgentMessage`、`NeuroToolResult`。
- `SessionEntry`、RunFrame、queue、turn kernel、runtime hooks、sidecar 和 profile message Interface 切换到 stored 类型。
- Repository 建立 append/read 两侧 raw Pi image invariant 红灯测试；实现代码可以随本 phase 完成，但发布时必须等迁移门禁通过后才启动硬切 runtime。

退出条件：类型系统无法把 Pi `{type:"image", data}` 赋给 durable message。

### Phase 2：实现 AttachmentStore 与 Local Adapter

- content-addressed key。
- Windows temp/sync/rename/keyed lock。
- 同 hash 并发和冲突内容验证。
- put 成功后的 read-after-write 验证。
- keyed lock 成功/失败/abort 后释放。
- stable error。

退出条件：32 路相同内容并发只留下一个目标文件且无 temp；错误目标被识别为 corrupt。

### Phase 3：工具 Interface 解耦

- `NeuroAgentTool` 不再继承 Pi `AgentTool`。
- Registry 提供纯 Provider tool schema projection。
- Harness 工具执行、batch、event、turn 改用 `NeuroToolResult`。
- `onUpdate` 使用 stored partial result。

退出条件：`read(image)` 可以返回 attachment block，且任何正常工具路径不要求构造 Pi image。

### Phase 4：写入入口与 Runtime 集成

- `read(image)` 直接保存 Buffer。
- 若存在外部 Pi Tool，使用显式 `PiToolAdapter`；主 Harness 不保留 raw image fallback。
- user image 在 admission/queue 前 normalize。
- steer/follow-up/next-turn 保留 ref。
- commit 后 stored 结果进入 RunFrame。

退出条件：7 MiB PNG 从读取到 commit/下一 turn 的 RunFrame 中均不存在 base64。

### Phase 5：Provider hydration、token 与 trace

- `TurnSnapshot` 只保留 stored messages；`streamAssistant()` 在 Provider 调用前临时 hydration，调用结束不保留 providerMessages。
- 单 turn ID dedupe。
- vision/non-vision 一对一 marker policy。
- 唯一 stored message estimator/renderer，覆盖 compaction、context limit、session usage 和 sidecar limit。
- compaction marker，不 hydrate 图片。
- traced-provider 接收独立 bounded traceContext；含附件请求强制省略原生 payload。

退出条件：Provider 收到正确图片；JSONL、RunFrame 和 trace 均不含 data。

### Phase 6：Public DTO、读取接口与 Chat Flow

- Task 106/107 projector 统一输出 `PublicAttachmentDto`，durable Chat entry 保留原 stored contentIndex locator。
- 新增 session + entry + content index 授权读取 route，复用 Chat Flow eligibility，并落实 raster inline whitelist、ETag/304。
- Chat Flow 覆盖纯图片 user message、混合内容顺序、tool result 图片、stable placeholder、lazy load、迟到加载和滚动锚点。
- history/recovery 不做 attachment stat。

退出条件：刷新长 session 后图片能显示；接口无法凭 hash 越权读取其他 entry 的 attachment。

### Phase 7：迁移门禁与一次性硬切

- 实现 migration lock、manifest、dry-run/apply 和可重入状态机。
- 实现只属于脚本的 old-format decoder，不进入 runtime import graph。
- 迁移当前 3 个真实 session。
- 验证 backup hash、中断恢复、部分失败、重复执行、全库复扫和 hydration。
- 全部 session verified 后删除 lock，再启动启用 read/write fail-closed invariant 的 runtime。

退出条件：session JSONL 不再存在旧图片 base64，runtime 不包含 legacy 分支。

### Phase 8：回归与文档收口

- Task 106 pagination/history。
- Task 107 public projection/replay memory boundaries。
- session repository/reduce/retry/tree。
- queue admission/drain。
- Harness + black-box。
- provider trace。
- `bun run typecheck`。
- 更新 walkthrough 与 `PROJECT-STATUS.md`，记录实际结果与计划偏差。

## Verification / Acceptance

### Storage

- [x] `AttachmentId` 只接受 `sha256:<64 lowercase hex>`。
- [x] 同图片重复/并发保存只生成一个 blob。
- [x] target 已存在相同 bytes 时成功，不同 bytes 时报告 corrupt。
- [x] temp 在成功、失败和冲突后均清理。
- [x] put 返回成功后立即 get 可见且 bytes 完全相同。
- [x] keyed lock entry 在成功、失败、abort 和大量不同 hash 后均释放。
- [x] save 失败时不 append JSONL；append 失败只产生孤儿，不产生 dangling ref。
- [x] Store 重建后仍能 load 并验证 hash/bytes。

### Stored/runtime

- [x] 7 MiB PNG 的 JSONL entry 只包含轻量 attachment ref。
- [x] RunFrame、follow-up queue truth 和 runtime-only message 不含 base64。
- [x] runtime hooks、sidecar、profile message ingress 不接受 raw Pi image。
- [x] Repository append 和 readSession 两侧都拒绝 raw Pi image，并区分 migration_required/corrupt。
- [x] tool update/event 不重新构造 base64。

### Provider/trace

- [x] session 重启后 hydration 得到原始 bytes/MIME 等价的 Pi image。
- [x] 同一 turn 相同 attachment 只读取/编码一次。
- [x] `RuntimeTurn.snapshot` 不保存 hydrated providerMessages；慢工具执行期间不再 pin 图片 base64。
- [x] 非视觉模型不读取 blob，每个 attachment 在原 block 位置生成统一 marker。
- [x] 缺失、损坏、MIME 不符在 Provider 请求前失败。
- [x] compaction 不 hydrate 图片，所有 context/usage/sidecar token estimate 复用 stored estimator 且不读取 blob。
- [x] trace 使用独立 safe context；含附件请求的原生 payload 被明确省略，最终 trace JSON 不含 base64/data URL。

### Public/Chat Flow

- [x] recovery/history/SSE 只返回 attachment metadata。
- [x] history/recovery 对附件没有 N+1 stat/load。
- [x] user/tool result projector 在过滤前保存原 stored contentIndex；纯图片 user message仍可见，混合内容顺序不变。
- [x] Chat Flow 能通过授权 route 显示 raster 图片；非 raster MIME 不可 inline。
- [x] route 只接受 projector 实际公开的 durable locator；queue/internal custom entry、错误 session/entry/content index/hash 无法读取附件。
- [x] `If-None-Match` 命中返回 304 且不发送 blob body。
- [x] 多图 route timing 有基线；实现不得无记录地接受每图一次长 session 全量解析。
- [x] 图片迟到加载不破坏 history prepend 锚点或切换后的新 session 状态。
- [x] 图片加载失败不破坏整个 history/recovery 状态。
- [x] Task 107 event hard budget 继续成立。

### Migration

- [x] 当前三个真实 session 成功迁移并保留 backup。
- [x] 迁移覆盖 message tool result 和 follow-up custom queue schema。
- [x] dry-run 失败零修改；apply 需要独占 lock；runtime/append 在 lock 存在时拒绝运行。
- [x] manifest 覆盖所有状态，original/backup/temp/rollback 的中断组合可恢复，重复执行幂等。
- [x] 临时文件重读、hydration、Windows 发布窗口和全库零 raw image 复扫通过。
- [x] 迁移后 runtime 无 legacy 双格式分支。

## Out of Scope

- Attachment GC、引用计数和自动删除。
- OSS/数据库 Adapter 的具体实现。
- 用户文本文件上传 UI；当前 multipart endpoint 只接受图片。
- 文本提取、全文注入、摘要、OCR、服务端缩略图生成或格式转换。
- Provider File API。
- Project zip 携带全局 Agent session/Attachment。
- 旧 trace 迁移。
- 自动浏览器验证；实现完成后由用户决定是否授权。

## Walkthrough Notes

## Implementation Update (2026-07-15)

已完成并验证的实现切片：

- Local Attachment Store/Adapter、content-addressed SHA-256 引用、并发写入冲突校验、read-after-write、Windows 临时文件发布和锁释放。
- stored attachment message/codec：图片在 JSONL、queue、RunFrame 和公开事件中只保留 ref；Provider 调用前按模型临时 hydration，trace 对含附件请求省略原生 payload。
- Chat Flow projector、纯图片/混合内容顺序、工具结果附件 metadata、session/entry/contentIndex 授权读取 route、raster inline 白名单、ETag/304；route 聚焦回归 9 tests 通过。
- 一次性迁移 CLI：dry-run/apply/resume、legacy decoder、manifest/journal、backup/stage/rollback、发布窗口恢复和全库复扫；迁移与 runtime lease 聚焦回归通过。
- runtime 使用与迁移共用 Workspace Root proper-lockfile lease，sentinel 仍作为 JSONL 写入的第二道 fail-closed 门禁；Nitro close 会释放 HTTP Harness lease。
- compaction、上下文 token、sidecar 与对话正文统一复用 stored attachment marker/estimator；相关聚焦回归 5 files / 17 tests 通过。
- 对默认 Workspace Root 执行只读 dry-run：扫描 526 个 session，确认仅 3 个需要迁移，共 3 个内联图片、2 个唯一 attachment、9,116,863 bytes；未写入 blob、backup、manifest 或 JSONL。
- 将上述 526 个真实 session 复制到隔离临时 Workspace 后执行完整 `--apply`：`status=complete`，3 个 session verified，生成 3 个 backup、3 个 attachment refs，最终扫描无 raw `type=image`、migration lock 已释放；真实 Workspace Root 仍未修改。
- 用户授权后已对真实 Workspace Root 执行 `bun run migrate:agent-attachments -- --apply`：run `edfe5b08-f863-4193-98b5-b4354b0e07b6` complete，526 sessions 全部 verified，其中 3 个 session 被改写；生成 3 个 backup、2 个 content-addressed blob、3 个 attachment refs。迁移后全库 raw image 文件数为 0，migration sentinel 已释放；`runtime.lease` 目标文件按 proper-lockfile 设计保留，锁目录已释放。

### Completion Audit（2026-07-15）

- Phase 1 stored 类型硬切已真正闭合：`SessionEntry`、`CustomMessageSessionEntry`、`NeuroSessionContext`、RunFrame、TurnSnapshot、runtime hook、sidecar 和 profile message plan 全部使用 `StoredAgentMessage`。`repo.reduce()` 保留 attachment ref；删除了按 role/timestamp 回捞引用的 `restoreStoredMessageRefs()` 和 `commitTurn` 的 SessionEntry 强转。
- `RuntimeToolResult` 使用 stored/event 双边界；hook/ingest 消费 stored truth，Pi event 只消费有界 marker。`NeuroToolResult.details` 已收口为 `JsonValue`，外部 unknown 在各工具 seam 显式 normalize。
- Repository invariant 现在返回稳定 `migration_required` / `corrupt`，并验证 role、content block 与 attachment ref。`readEntry()` 改为逐行流式读取，命中后立即停止；附件 route 返回 locator/blob/total `Server-Timing`，不再为每张图构造或切分整份 session JSONL。
- Trace black-box 使用隔离 profile roots 后通过，确认之前的 timeout/waiting 是测试冷加载级联，不是 Attachment 行为回归。

验证结果：

- Attachment Store/Codec、migration、trace、公开投影和前端图片链：14 files / 71 tests passed。
- stored/session/compaction/profile prompt/Harness black-box：16 files / 117 tests passed。
- 工具 JSON details、file tools、Repository 与附件 route：7 files / 104 tests passed。
- 完整 `neuro-agent-harness.test.ts`：168 / 169 passed；唯一失败是既有 Plan Mode 工作目录期望 `.agent/plan` vs `alpha/.agent/plan`，与 Task 108 无关。
- `bun run typecheck` passed。
- 真实 Workspace Root 已完成硬切迁移；浏览器验证按用户约束未执行。

- 设计阶段原目标是“图片引用”，用户确认后升级为通用 Attachment substrate，图片是第一种 Provider presentation。
- 相比初版新增了 Local/OSS/数据库 Adapter seam、stored message 与 Pi message 硬分层、NeuroAgentTool 解耦、queue admission、trace side-channel、Chat Flow 授权读取接口和一次性硬切迁移。
- 整体审查后补齐：hydration 从 snapshot 移到紧贴 Provider 调用、完整工具领域能力、hook/sidecar stored ingress、read-side invariant、统一 estimator/marker、trace-safe context 单一路径、Chat Flow locator/纯图片渲染、raster inline 白名单、ETag 304、滚动锚点，以及带独占 lock/manifest/崩溃恢复的迁移发布门禁。
- 没有引入 GC、stream、signed URL、backend factory、事务或文本 presentation policy，避免在没有真实需求前扩大 Interface。
- 当前已修改业务代码、测试、迁移 CLI、任务文档与真实旧 session JSONL；迁移 backup/manifest/journal 已保留，未执行浏览器验证或 Git 操作。

### Integration Audit（2026-07-16）

并行 Task 109 合并前的再次审查发现，上一轮 walkthrough 的“stored codec 已闭合”早于真实代码状态：`stored-types.ts` 已删除旧 assert，但 `stored-message-codec.ts`、Repository 和 follow-up queue 仍引用旧 API，并保留 `filter() + as unknown as` 的宽松读回。当前已完成以下系统性收口：

- `StoredMessageInvariantError` 与 `migration_required/corrupt` 由 canonical codec 唯一拥有；新增 `parseStoredMessage(s)`、`parseStoredInput`、`parseFollowUpQueue`、`encodeFollowUpQueue`，严格校验 role、必需字段、JsonValue、Attachment ref 和 queue 判别联合。
- Repository 的 message/custom_message 读写双侧、Harness follow-up custom state、Profile turn plan、runtime hook、sidecar merge、工具最终 stored result 与 Provider hydration 前门禁统一复用 canonical codec；坏 queue 不再静默过滤。
- migration-only legacy decoder 只负责旧 raw image 转换；转换后的 message、follow-up queue 与全库复扫复用 runtime canonical codec，不再维护第二套 stored schema 判断。
- raw image admission 的大输入校验从整串 RegExp 改为短 data URL header + 线性 base64 扫描。真实回归证明原实现处理 `16 MiB + 1 byte` fixture 会触发 `Maximum call stack size exceeded`，现在稳定返回 `limit_exceeded`，且在预算失败前不分配 decoded Buffer、不写 Store。
- 新增/补齐 8 张、单图 16 MiB、整批 32 MiB、HTTP 48 MiB、保存并发 2、Provider 16 blocks/64 MiB 的边界验证；覆盖 Content-Length/chunked 双入口、单图/整批 +1、顺序保持、超大 `read(image)`、跨 Project 来源归属和 Workspace Root 全局 blob 根。
- Attachment route 的 400/404/410 错误显式 `Cache-Control: no-store`；成功仍使用 private immutable + ETag/304。Chat Flow 图片失败增加单图显式重试，重试不改变 session/entry/contentIndex 授权 locator。
- 公开 user DTO 已硬切为 ordered `blocks + omittedBlocks + textSummary`，测试与 Harness locator 授权不再读取已删除的顶层 `content/attachments`；tool content 继续保留原 `contentIndex`。

本轮实际验证：

- Task 108 stored、Store/Adapter、admission、Repository、migration gate/WAL、file tools、HTTP/route、Task 106/107 public projection、Chat Flow state：`24 files / 212 tests passed`。
- Attachment/follow-up/stored/provider 聚焦 Harness black-box：通过。
- `bun run typecheck`：通过。
- 完整 Harness + black-box：`180 passed / 7 failed`。7 项均落在并行 Task 109 的 Project Path、Profile settings、Plan Mode 或外部 Project runtime root 链路；本任务未越界修改，需双方合并后串行执行 Product 门禁并重新确认。
- 未重复执行真实 Attachment migration；未执行浏览器验证。

相对原计划的实现偏差：原计划假设大 base64 预检已经安全，实际测试证明整串正则本身是大输入故障点；本轮改为与 migration decoder 同类的线性扫描。原计划也低估了 codec 所有权漂移，现已通过单一 parser/encoder seam 删除宽松断言和强转，而不是继续补兼容分支。

### Final Integration Closure（2026-07-16）

Task 108 与 Task 109 合并后完成最终串行复核：

- 文件工具不再从绝对路径反推 Project 归属。`read(image)` 保留统一 `ResolvedFileAddress` 中的 `projectPath` 与 `relativePath`，跨 Project 图片读取会记入正确 Project 的 context access，同时二进制仍写入全局 Workspace Root Attachment Store。
- 本地隔离 Product 在根 `node_modules` 不存在、Application Root 与 State Root 分离的条件下，完成外部绝对 Project 图片读取、Attachment blob 保存、JSONL attachment reference 持久化和旧 session 恢复。
- State Root 移动验收改为关闭旧 Harness 后启动全新 Bun 进程。旧 session 在新进程中按新的 State Root 解析文件；原 State Root 没有被日志、附件或 session 写入重新创建。
- 完整 Harness 与 black-box 从先前的 `180 passed / 7 failed` 恢复为 `2 files / 187 tests passed`。Task 109 的 Project Path、Profile settings、Plan Mode 与 runtime root 失败均已闭合。
- Task 108/109 Attachment 与 Path 聚焦组合为 `20 files / 153 tests passed`；`bun run typecheck` 通过。
- 未重复执行已经完成的真实 Attachment migration；真实 Workspace Root 仍保持已迁移状态。

### Release Migration Integration Closure（2026-07-16）

- Manager Install、Update和Start现在都通过Operation Journal执行Attachment hard cut。dry-run得到的`sourcePath/sourceHash/targetHash`在apply前持久化，apply报告再补`backupPath`；缺少Product migration脚本时fail closed。
- migration新增幂等rollback状态机。Operation恢复会先停止新Docker部署释放runtime lease，再撤销session格式，之后才恢复Product、SQLite和Compose；原生健康检查也会等待临时Product进程完全退出。
- journal为`applied`时只接受真实`rolled_back`报告；migration目录缺失返回`not_started`会拒绝恢复旧Product。只有journal仍为`planned`、apply可能尚未开始时允许`not_started`。
- Manager无参数`start`不再直接执行无journal迁移，而是先恢复中断operation，在install lock内提交maintenance journal，再在锁外前台启动应用。
- Product构建显式断言`migrate-agent-attachments.ts`存在。新增Product内真实migration smoke，构造旧Pi内联图片session并执行`dry-run -> apply -> rollback`，断言原session逐字节恢复。
- 本机Windows隔离Product与SSH Arch原生Product均通过migration smoke和State Root smoke；Arch Source Docker完成容器内frozen install/build，并在`/app`同根布局通过migration、五工具、Config/Profile/Variable、外部Project图片、全局Attachment与HTTP版本接口。

仍未完成的是公开Source/Product overlay、公开GHCR、Windows Portable和Manager新canary的发布后验证，以及浏览器图片展示人工验收。因此Task 108保持Public Release Pending，不把本地/Arch当前源码证据写成公开资产已通过。

### 2026-07-17 最终串行回归补漏

- 完整Harness回归暴露follow-up admission与terminal invocation之间的真实竞态：图片保存和队列持久化仍持有session admission锁时，旧完成路径可能先释放active invocation并检查到空队列，随后落盘的follow-up将永久滞留。terminal状态现在通过同一admission临界区提交；并发follow-up要么先完整入队并被下一轮消费，要么在invocation结束后明确拒绝。error与compact终态复用同一所有权入口。
- steer与图片follow-up black-box不再把已历史化的`tool_execution_start`当成“工具仍在执行”。测试使用受控工具闸门，入队完成后才释放工具；等待Session文本超时会直接失败，不再返回最后一次快照掩盖真实时序错误。
- Config默认Profile解析会创建持有Attachment runtime lease的HTTP Harness。`disposeAgentHarness()`现返回并等待异步释放，Nitro close hook与Config fixture都在删除State Root前显式await，修复proper-lockfile更新器访问已删除`runtime.lease.lock`的`ECOMPROMISED`。
- 本轮Task 108聚焦组合为`18 files / 155 tests`，完整Harness与black-box为`2 files / 187 tests`，Manager为`18 files / 63 tests`且pack审计仅5个文件、约0.35 MiB。根typecheck和Manager typecheck均通过。
- 基于上述最终源码重新完成Windows隔离Product build/stage。无根`node_modules`、Application/State Root分离条件下，Attachment真实CLI完成`dry-run -> apply -> rollback`并逐字节恢复旧Session；Agent/Config/Profile/Variable、外部Project图片、State Root新进程恢复和HTTP版本接口再次通过。未执行浏览器验证，也不把本地Product证据写成公开Release已通过。

### 2026-07-17 Product运行源码与Session污染收口

- 直接`bun test`会发现仓库内陈旧`product/server/**/*.test.ts`，旧Product测试仍可通过隐式Harness写入真实Workspace Root。根Bun测试配置现在忽略所有生成/staging目录；Product staging与Nitro runtime vendor共用测试源码清理Module，Release verifier禁止Windows/Linux overlay重新携带NeuroBook测试源码。
- Product Agent State Root smoke不再导入`server/agent/test/profile-tools`或`test-utils/faux-models`。最小Profile改用生产`toolset/builtin`，Faux Provider直接通过Pi公开API建立；因此Product可以删除测试目录而不削弱五工具、外部Project图片或State Root移动门禁。
- 新隔离Product中测试源码数量为0，根`node_modules`与影子`workspace/`均不存在。Attachment migration再次完成`planned -> complete -> rolled_back`并逐字节恢复旧Session；State Root smoke与HTTP版本接口通过，端口39279已释放。
- Attachment/Stored聚焦10文件56项、完整Harness/black-box 187项、Variables/包装聚焦23项、根与Manager typecheck、Manager 63项及npm pack审计均通过。公开npm canary与业务提交package/lock继续保持Manager `.14`，工作区干净后由release helper统一生成并发布`.15`；公开Product Bun、GHCR、Windows Portable和浏览器图片展示仍未验收。
- SSH Arch Source Docker最终在`/app`同根布局重新执行Product Agent smoke并通过，容器HTTP版本接口返回当前package版本；本轮测试容器、镜像、远端隔离目录和本地传输归档均已清理。该证据仍属于当前源码，不替代公开GHCR验证。
- 发布前完整Harness回归发现manual compact使用未登记的fire-and-forget任务：命令状态结束后仍可能继续drain follow-up，而服务或测试已经删除Session Root。Harness现在统一登记普通后台任务，`drainBackgroundTasks()`与`dispose()`都会等待compact和summarizer归零；compact回归由`started -> drain -> compaction committed`直接证明。同期将steer/follow-up并发测试改为显式工具/Provider闸门，完整Harness与black-box再次达到187/187且无未处理异步错误。

### 2026-07-17 Manager canary首次发布阻断

- Task 108的Attachment hard cut需要随新Manager公开；`.15`的bundle、typecheck、63项测试和pack本身在本机通过，但GitHub clean checkout在导入Task 109共享Runtime时被根Nuxt tsconfig的`.nuxt`依赖阻断，npm publish没有执行，公开`canary`仍为`.14`。
- 修复没有复制Attachment/State Integrity实现、没有mock共享Module，也没有让Manager workflow先运行Nuxt prepare。`server/runtime`改为独立可编译边界，release helper和workflow显式运行`runtime:typecheck`；无`.nuxt`隔离clone的Manager 18 files / 63 tests已通过。
- `.15`保留失败审计记录，下一次发布使用`.16`。公开Product Bun、GHCR、Windows Portable与浏览器图片展示仍未验收，因此本任务状态不提前改为完成。
- `.16` workflow `29556688067`已全绿，npm `canary`与全新Bun cache中的精确bunx均返回`0.1.0-canary.16`。Manager公开门禁已完成；仍需下一应用canary的Product Bun、GHCR、Windows Portable和图片展示验收。

### 2026-07-17 0.8.1公开资产预检阻断

- `0.8.1`的Windows/Linux Product尚未进入build，Task 108迁移与Attachment smoke也未执行；两个job都因根Vitest在clean checkout缺少预先生成的`.nuxt/tsconfig.json`而在setup转换阶段失败。Release保持零资产，不能把GHCR镜像build成功视为公开GHCR验收完成。
- Product路径门禁现统一走`test:agent-state-root = nuxt prepare + targeted vitest`，并把已不存在、会被Vitest静默忽略的旧Location测试路径替换为真实`workspace-root-ref.test.ts`。无`.nuxt`隔离clone已通过2 files / 7 tests；下一公开应用版本使用`0.8.2`，Task 108继续保持Public Release Pending。

### 2026-07-17 0.8.3候选验证范围与0.8.4后续门禁

- `0.8.3`候选在Linux已完成Attachment migration smoke和Agent State Root smoke，在Windows已完成Portable executables/doctor、Agent State Root与shadow workspace诊断。这些步骤证明候选内部的Task 108 migration与State Root链没有先行失败。
- Linux与Windows最终都在Product system Profile freshness预检退出，公开payload job因此未运行，GitHub Release保持零资产。该失败属于Task 109 Product编译上下文：manifest引用最终Product不存在的根`node_modules`，并非Attachment codec、Store、migration WAL或图片route回归。
- 修复后的本机Source ZIP + Windows Product ZIP隔离组装再次通过Agent State Root移动smoke；本轮没有重复执行真实用户Workspace的Attachment migration，也没有自动执行浏览器图片展示。
- Task 108继续保持Public Release Pending。`0.8.3`中已经通过的候选步骤可作为故障隔离证据，但不能替代`0.8.4`完整公开Product Bun、Portable、GHCR与payload验证。

### 2026-07-17 0.8.4公开首次安装发现空计划语义缺口

- `0.8.4` Release workflow已完整通过Attachment migration、Linux Product State Root、Windows Portable State Root与shadow workspace、真实启动、公开payload和GHCR digest复验；9个公开资产与Manifest均已发布。
- SSH Arch随后以真实用户方式从空目录运行公开Manager `.18`安装Product Bun。SQLite migration成功，但Attachment dry-run在没有任何历史session、也没有`workspace/.nbook/agent`目录时调用`access(agentRoot, W_OK)`并失败。
- 这不是历史数据损坏、权限不足或Product归档遗漏：最小回归在本机空Workspace Root稳定复现同一`ENOENT`；公开安装失败后的Operation Journal为`committed / rolled-back`，没有Attachment plan、Product、Manifest或State Root残留。
- migration preflight现在明确区分空计划与非空计划。0个session时直接返回空报告，保持dry-run零写入；存在session时仍检查Agent Root写权限、既有blob一致性、外部引用可读性和全部checksum。
- 新回归先确认修复前失败，再验证空Workspace Root不会创建`.nbook/agent`；完整migration suite为22/22，Manager migration/operation聚焦19项与根typecheck通过。
- Task 108仍保持Public Release Pending。修复将进入`0.8.5`，随后重新执行公开Product Bun与GHCR首次安装；不会重复迁移真实开发Workspace，也不把CI浏览器启动smoke写成人工图片展示验收。

### 2026-07-17 0.8.5公开Product通过与GHCR迁移命令阻断

- `0.8.5`公开Product Bun空目录安装已证明0-session dry-run返回null plan，安装operation直接成功提交；doctor healthy且Source/Product revision一致。
- 公开Product内置Attachment migration smoke完成`planned → complete → rolled_back`并逐字节恢复旧Pi图片Session；分离State Root的五工具、外部Project Attachment、Config/Profile/Variable和完整移动恢复通过。
- GHCR安装并未执行Attachment dry-run。Manager使用`compose run app bun ...`，但Product ENTRYPOINT忽略CMD并启动长期服务；容器inspect直接证明预期migration argv存在于Config.Cmd却未被执行。
- Manager Docker Adapter现用`--entrypoint bun`执行一次性命令，保持migration CLI、Operation Journal和Product ENTRYPOINT各自单一职责。测试固定完整Compose argv和空命令拒绝。
- 中止失败容器后journal完整回滚，无migration plan、Manifest、wrapper或容器残留。Manager18 files / 65 tests、typecheck和pack通过。
- Task 108继续保持Public Release Pending，等待Manager`.19`与应用`0.8.6`的公开GHCR migration/install复验；Product Bun公开证据已完成，不重复执行真实开发Workspace迁移。

### 2026-07-17 0.8.6公开GHCR最终闭环

- Manager `0.1.0-canary.19` workflow `29582201585`全绿，npm `canary`与SSH Arch精确`bunx`均返回`.19`。应用[`v0.8.6-canary.20260717.130406Z.a91a96f`](https://github.com/notnotype/neuro-book/releases/tag/v0.8.6-canary.20260717.130406Z.a91a96f) workflow `29582562773`完成Windows/Linux Product、Portable、GHCR、两端State Root、真实HTTP、公开payload和最终索引验证，9个资产全部公开。
- 公开Manifest的source revision为`00fd4fceebb18b08abd3324d19d0ea0f91e31261`，最低Manager为`.19`，GHCR固定digest为`sha256:c3e4dc5ae531e3316a61525e936b5dfaacffc10b2c76a514d2bc27a4a48bff64`；Source、Product与容器revision一致。
- SSH Arch从空目录使用公开Manager `.19`安装公开GHCR成功。Attachment dry-run one-off命令正常退出，Operation Journal最终为`committed / success`，Manifest v3与稳定wrapper均已提交；没有残留一次性容器，证明`--entrypoint`修复覆盖了真实用户链。
- 容器内正式Product脚本再次完成Attachment `dry-run -> apply -> rollback`并逐字节恢复旧图片Session；同根State Root runner完成Agent五工具、Config/Profile/Variable、外部Project图片与全局Attachment Store验证。`/app/.agent`始终不存在。
- Manager `doctor --json`为`healthy=true`且无fail check；停止Compose后通过`neuro-book start`重新拉起固定digest，HTTP返回精确`versionLabel`，State Root标记保持不变。测试容器、网络、镜像引用、隔离HOME与Installation Root均已清理。
- Task 108的Storage、Stored/runtime、Provider/trace、Public/Chat Flow与Migration验收项均已由自动化、Product和公开交付链证明完成。人工浏览器图片展示未执行，按本任务Out of Scope保留为用户可选验收，不再阻塞任务完成。

### 2026-07-18 补漏审查重新打开

- Local Attachment Adapter当前只校验opaque key segment，内部已有junction/symlink时仍可能把blob写到Attachment Store外；最小Windows junction复现已确认外部文件被创建。
- canonical Stored Message Codec只对Attachment block执行exact-key检查，user/toolResult/assistant顶层及普通content block仍接受未声明字段；严格stored schema合同尚未闭合。
- 本轮不迁移Session或Attachment数据，不增加base64字符串扫描；修复将收口到Local Adapter真实路径隔离和各判别结构的exact-key解析。
- Task状态恢复为Implementing。只有聚焦回归、完整Harness/Product和下一公开canary链路重新通过后，才恢复Verified。

### 2026-07-18 路径与健康合同并行实现结果

- Local Adapter链接隔离、Stored Codec exact-key、File Address canonicalization和managed Project根链接门禁已完成并通过本地聚焦回归；Attachment/Codec 37项、路径/文件工具62项、State Root 7项全绿。
- Manager `installation-health`已把离线完整性、容器/原生服务状态和结构化 doctor/status/import 合同统一起来；服务停止只产生warning，运行中镜像/HTTP/version错误才失败。Manager 22 files / 78 tests、typecheck、build、pack审计通过。
- 完整Harness/black-box现为Harness 169/169、black-box+payload 25/25；prompt payload错误返回、队列拒绝不污染和默认Workspace Root初始化均有回归。公开Product/canary与浏览器图片展示仍待重验。
- 本轮没有迁移真实Session/Attachment，也没有执行浏览器图片展示或公开canary；Task 108继续保持Implementing，不能把本地聚焦回归写成公开资产验收完成。

### 2026-07-31 Attachment capability 与真实图片基线收口

- `NeuroAgentHarness` 的原始 `AttachmentStore` 已改为 private；测试只保留构造注入 Adapter。Session locator 授权成功后返回 `{ref, name?, read}` capability，原图与变体 route 都只能调用该 capability，hash 仍不能单独授权读取。
- 上传、文件快照和 `read(image)` 继续统一经过 `AgentAttachmentCodec`。共享测试图片 helper 用 Sharp 生成可完整解码的 PNG/JPEG/WebP，并集中提供有效 GIF 与低字节 JPEG SOF 像素上限 fixture；Harness 测试不再用“只有 PNG 文件头”的假图片绕过完整解码。
- snapshot 端到端回归证明超过 64 MP 时返回 `limit_exceeded` 且注入 Adapter 零写入；归档竞态同时锁定 `invalid_input` 和“当前 Session 已归档，不能登记附件”，避免前置解码失败误通过。
- 完整 `file-tools.test.ts` 为 49/49；Session Attachment、Codec 与前端/路由相邻回归通过。完整 Harness 图片相关旧失败已归零，余下两个失败位于模型恢复与 Variable SDK 在途改动，不属于 Attachment。
- 没有增加 Attachment GC、统一媒体库、Provider 文本附件或浏览器自动验收。

### 2026-08-04 Composer 键盘附件门禁补漏

- 复查发现发送按钮已经按 pending、未解析稳定图片、metadata error 和预算超限阻止提交，但 Agent Composer 键盘入口只检查 pending 图片，违反本任务“metadata failure 阻止发送和历史保存”的既有合同。
- 修复后，按钮和键盘提交共用 Agent Composer 的消息门禁；解析 Session Attachment metadata 失败时，prompt、steer 和 followup 都在创建乐观消息及调用 Session 前通过统一通知出口返回。
- 本轮不修改 Attachment Authority、存储、DTO、图片 transaction 或 Provider hydration；不新增测试文件，沿用现有聚焦回归和根 typecheck，浏览器交互由用户验收。
- 验证：既有 `useComposerImageTransaction`、Agent invocation reconciliation 和 Composer draft 聚焦测试共 3 files / 16 tests 通过；SFC 编译探针与 `bun run typecheck` 通过。浏览器图片门禁仍待用户验收。

### 2026-08-04 Composer 附件迟到响应保护

- Composer 解析 Session Attachment metadata 时捕获当前 `sessionScopeKey`、Session ID 和附件缓存 generation；Session 切换、Workspace scope 重置或附件缓存失效后，旧请求的成功与失败结果都会被丢弃，不写入新缓存、不创建消息，也不发送过期错误通知。
- 当前 Session 的真实解析失败仍沿用既有 notification 出口；prompt、steer 和 followup 继续共享 `null` 提交终止语义。底层 HTTP 请求不取消，服务端仍以 Session Attachment Authority 的 fail-closed 合同为最终边界。
