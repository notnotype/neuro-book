# Agent Session 图片附件

本文定义 Agent Session 图片附件的稳定存储、Markdown、授权和前端交互合同。历史迁移过程见 Task 108 walkthrough；新代码不得恢复旧的 HTTP base64 图片输入。

## 真相源与物理存储

- Composer 正文是用户图片顺序的唯一真相源。
- 图片在正文中使用标准 Markdown：`![名称](目标)`。普通链接 `[名称](目标)` 只是文本引用，不会注入图片。
- 稳定图片目标固定为：

  ```text
  workspace/.nbook/agent/attachments/sha256/<2位>/<62位>
  ```

- 物理文件位于 Workspace Root `.nbook/agent/attachments/sha256/...`，由 Attachment Store 按 SHA-256 去重。
- JSONL、queue、RunFrame、公开事件和 trace 只保存 `AttachmentRef`，不保存 base64、Blob URL、绝对 blob 路径或存储后端细节。
- Windows 路径在 Markdown 中统一为 `/`；目标包含空格或括号时使用 CommonMark angle destination，例如 `![图](<C:/My Files/a.png>)`。

## Session 授权登记

上传或快照会追加不移动 active leaf 的 projection entry：

```typescript
type SessionAttachmentEntry = {
    type: "session_attachment";
    origin: "projection";
    attachment: AttachmentRef;
    name?: string;
    source: "upload" | "file_snapshot";
};
```

- `session_attachment` 不进入模型上下文、Chat Flow、Session Tree 或摘要。
- 该 entry 的附件读取 locator 固定使用 `contentIndex = 0`。
- Attachment ID 不是公开授权凭证。读取必须同时提供当前 Session、真实 entry ID 和 contentIndex。
- locator 授权成功后只返回绑定该引用的 `read()` capability；HTTP 原图与变体读取都消费该 capability。Harness 不公开原始 Attachment Store，工具上下文也只能使用图片 Codec。
- invoke admission 只接受当前 Session 目录中已登记或已经由历史 message/toolResult/custom_message 引用的 Attachment ID。
- 伪造其它 Session 的哈希目标、Project 图片路径、绝对路径或远程 URL 都不能直接作为图片发送；本地源文件必须先快照。

## HTTP 接口

- `POST /api/agent/sessions/:sessionId/attachments`
  - multipart 严格只接受一个名为 `file` 的 part。
  - 支持 PNG、JPEG、GIF、WebP；服务端以魔数确认 canonical MIME。
  - 消费 body 前执行快速 Session/Profile/Project/interaction preflight；blob 保存后在 Session mutation 临界区重新校验并登记。最终校验失败时允许留下未登记孤儿 blob，不放宽 Session 授权。
- `POST /api/agent/sessions/:sessionId/attachments/snapshot`
  - JSON：`{sourcePath: string; name?: string}`。
  - `sourcePath` 只接受完整 Project File Address、`workspace/.nbook/...` 或绝对路径。
  - Attachment Store 自身及其真实路径/链接目标不能作为快照源。
  - 稳定读取使用 `realpath -> stat -> open -> fstat` 身份校验，并以同一 FileHandle 有界读取；读取后 identity、size、mtime 或 ctime 变化时拒绝并要求重试。
- `POST /api/agent/sessions/:sessionId/attachments/resolve`
  - JSON：`{attachmentIds: AttachmentId[]}`，严格接受 1–8 个不重复 ID。
  - 返回顺序与请求一致；任一 ID 不属于当前 Session 时整体返回 400，不返回部分结果。
- `GET /api/agent/sessions/:sessionId/attachments`
  - `search?`、`offset?`、`limit?`；默认 40，最大 100。
  - 搜索名称、MIME 和 Attachment ID，按 `lastSeenAt DESC, attachmentId ASC` 排序。
- `GET /api/agent/sessions/:sessionId/entries/:entryId/attachments/:contentIndex`
  - 通过 Session entry locator 读取完整 bytes；支持 `session_attachment`、user/toolResult message 和 custom_message 中的附件。
  - 原图与变体都先完成 locator 授权；原图下载文件名使用统一 RFC 5987 `filename*` 编码。
- `GET /api/agent/sessions/:sessionId/entries/:entryId/user-content`
  - 按需返回历史用户消息的完整有序 Markdown，供公开预算截断后的编辑和复制。

Project-bound Session 的目录、上传、快照和读取都执行 Project open gate。

## 图片完整解码边界

- `AgentAttachmentCodec` 是 Agent 图片进入 Attachment Store 前的唯一图片语义边界。Composer 上传、文件快照和 `read(image)` 都必须经过同一个 Codec；`ToolExecutionContext` 不暴露原始 Attachment Store。
- 图片必须通过魔数识别、声明 MIME 一致性检查和 Sharp 完整解码。空 MIME 与 `application/octet-stream` 只表示传输层未声明类型，不能替代 bytes 校验；其它具体 MIME 仍须与内容一致。
- 输入图片上限为 `64 * 1024 * 1024` 像素。Codec 在完整解码前向 Sharp 传入同一像素上限，并在取得有效宽高后再次检查乘积；超限稳定映射为 `limit_exceeded`，不得写入 Attachment Store。
- 单图 16 MiB 和单次请求合计 32 MiB 是字节预算，64 MP 是解码内存边界，两者必须同时成立。损坏、截断或无法完整解码的图片按 `invalid_input` 拒绝。
- Attachment Store 继续只负责原始 bytes、内容寻址和完整性，不理解图片格式、像素或变体。图片变体由授权后的 Image Variant Module 派生，不进入 Store、Provider 输入或 Session 持久化。

## Session 附件目录

`SessionAttachmentAuthority` 是目录、授权、canonical metadata、locator 和 Provider hydration 预检的统一边界。JSONL 是唯一持久化真相；Authority 只维护可丢弃的内存索引：

- 冷访问流式扫描 Session JSONL 的全部 branch 和 batch；每轮扫描都比较前后文件签名；
- 第一轮扫描期间签名变化时丢弃 candidate 并完整重扫，第二轮仍变化则 fail closed，不能提交 cache；
- 重建开始即失效旧 cache。构建期间暂存 `SessionWriteExecutor` after-write 增量并按 entry ID 去重；pending 只补偿内部 observer 写入，不能掩盖外部签名变化；
- 热索引使用文件 identity、size 和纳秒 mtime 签名检测外部改写，签名变化时重建；
- 不写数据库或持久化 sidecar。

扫描收集：

- `session_attachment`；
- user/toolResult message；
- custom_message 中的附件。

同一 Attachment ID 去重；名称和 locator 取最近有效引用，记录首次/末次出现时间和总引用次数。同一 ID 的 MIME 或 bytes 不一致时按损坏数据失败，禁止任选一份继续。

上传和快照只建立授权事实；当前不提供删除、引用回收或 GC。

## Session 交互能力

recovery、live state、Session summary、前端控件和后端 mutation gate 必须消费共享 `AgentSessionInteractionDto`，不能各自猜测 Session 是否可操作。

| Session 状态 | 用户可执行操作 |
| --- | --- |
| Idle 且 Profile 可运行 | 运行、上传、插入、历史重跑、设置、归档 |
| Running | steer/follow-up、上传、插入、停止 |
| Waiting User Input | 回答、停止、查看；禁止上传、插入和历史操作 |
| Profile 缺失/不可运行 | 查看、复制、归档 |
| Archived | 查看、复制、恢复 |

archive 只写当前 Session 的 `session_archived`，restore 只写 `session_restored`，都不会为附件或关系生成跨 Session detach。归档后仍可查看和读取已有附件，但不能上传、快照、发送、修改历史或设置；恢复后重新按当前 Profile 与运行状态计算能力。

## Session Mutation 边界

所有受 interaction policy 约束的 Session mutation 都必须通过 `withSessionMutation()` / `withSessionMutations()` 线性化“读取最新状态、准入、提交”：

- invocation claim 与 terminal transition、Tree/history、runtime command、附件最终登记、archive/restore 和 abort 共用该边界；
- 固定锁顺序为 relation mutation lock -> 按 Session ID 排序的 Session mutation lock -> 按 Session ID 排序的 `SessionWriteExecutor` write lock；
- multipart 消费、snapshot 源文件读取、Provider blob 读取和模型执行必须在临界区外；
- invocation 在锁内完成最新 policy/Profile/Project/附件/branch admission 与 claim，Provider 在锁外执行，最终 lifecycle 和 queue 清理再由统一 terminal seam 在锁内提交；
- Tree preadmission 失败不得移动 active leaf，已经 claim 为 aborting 的 invocation 不得再提交 waiting/end。
- forced-abort 只有在 `INVOCATION_ABORT_GRACE_MS = 150` 到期且仍需维持 `300ms` 上界时，才使用窄化同步 control-plane fence：admission/claim 仍在该边界内完成，forced lifecycle 不重新取得可能被长写入占用的 mutation lock，而是同步占据同一 `SessionWriteExecutor` per-session queue；同步入队失败保留 aborting ownership 并可重试，物理失败由该 write queue 的 pending recovery 处理。该例外不适用于普通 Session mutation，也不允许直接 repository 写或第二套锁。

## Composer 与历史消息

- 拖拽按落点插入；文件选择、粘贴、附件面板和 `@` 菜单按当前光标插入。
- 多图保持用户文件顺序，同时最多发送两个上传/快照请求。
- pending 节点以唯一 upload ID 原位替换；上传中、上传失败或 metadata resolve 失败都会阻止发送和历史保存，并提供显式重试或移除。metadata 重试继续使用批量 resolve，旧 generation 响应不能覆盖新状态。
- 缩略图栏完全由正文中的 Markdown 图片派生；删除缩略图只删除正文标记，不删除 Session 登记。
- Session/Workspace 切换会同步 flush 旧草稿、取消旧 debounce、dispose 图片事务并增加 generation，再原子加载新上下文；旧 generation 的 emit、上传和 metadata 响应全部忽略。服务端已经成功登记的图片仍属于原 Session。
- `@` 菜单会查询当前 Session 全分支附件；Project/绝对路径图片先调用 snapshot，再插入稳定目标。
- 历史用户消息按 stored contentIndex 重建 Markdown；编辑、复制和重新运行都保持原文字/图片顺序。
- localStorage 草稿只保存 `{version: 1, text, updatedAt}`，不得保存 base64、Blob URL 或 pending File。acceptance 按原 `workspaceKey/sessionId/generation/revision/text` compare-and-clear，不能删除请求期间的新输入或当前切换后的草稿。

## 用户输入接收与乐观对账

- prompt、steer、follow-up 和 Tree prompt 必须携带 UUID `clientMessageId`；continue 禁止携带。
- durable user entry 与 queue item 保存同一 ID；用户 entry 还保存明确 `intent: "normal" | "steer"`。正文和 `<user_steer>` envelope 都不是身份来源。
- invocation 通过 `acceptance` 明确返回 `not_accepted`、`queued` 或 `persisted`。模型失败但用户 entry 已落盘时仍是 `persisted`；admission 前失败是 `not_accepted`。HTTP `status` 不能替代 acceptance。
- 前端只按 `clientMessageId` 对账 HTTP、SSE、分页与正常 recovery 中的乐观消息；durable 证据优先于 HTTP receipt。
- 无 receipt 的 transport failure 固定为 `unknown`：保留 optimistic 与草稿，不自动 recovery、retry 或 rollback。后续普通 SSE/recovery 可以按同一 ID 收敛；用户显式重发生成新 ID 并提示可能重复。
- unknown attempt 不持久化。页面刷新后只恢复纯文本草稿；该限制是明确产品语义，不是待补兼容层。
- follow-up 消费顺序固定为 peek → admission → durable user commit → queue ack；user entry 的 `sourceQueueItemId` 用于 commit/ack 间恢复，禁止重复运行。

完整 transport unknown 取舍见 [ADR 0001](../../../docs/adr/0001-agent-input-transport-unknown.md)。

## 模型与预算

- `EnabledModelOptionDto.input` 声明 `text` / `image`；缺省按 `["text"]` 处理。
- 未声明图片能力时，前端持续提示但允许发送；后端不读取 blob，而是在原位置使用文本占位。
- 每次 prompt、steer、follow-up 或 queue drain 都重新验证：最多 8 张、单图最多 16 MiB、合计最多 32 MiB。
- 重复引用按实际图片 block 数量和 Provider source bytes 计费与限额。

## 非目标

当前不实现文本附件输入、远程 URL 下载、OCR、删除、GC、引用计数回收或 Provider File API。服务端缩略图仅由共享 Image Variant Module 按授权 locator 派生；Agent Attachment Codec 不转码原图。
