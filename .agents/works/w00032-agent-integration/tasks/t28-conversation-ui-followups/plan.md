# t28 实施计划：对话界面第二批

## Context

t17 第一版以“能真的用它写书”为标准，把分支树、上下文检查器、附件、草稿、触发符、Agent 模式拆到本 Task（[t17](../t17-conversation-ui/README.md) 的“第一版的范围”）。开发者 2026-11-06 上手体验后定：下一步做 t28，并提了几条反馈，其中和输入框、状态栏相关的并进本 Task（见 [README](README.md) 的“开发者体验反馈”），其余记到 [t29](../t29-ui-polish-after-t15/README.md)。

依据：[`ui/agent-conversation-view.md`](../../../../../docs/specs/ui/agent-conversation-view.md)、[`agent/conversation.md`](../../../../../docs/specs/agent/conversation.md)、[`agent/sessions.md`](../../../../../docs/specs/agent/sessions.md)、[`models/service.md`](../../../../../docs/specs/models/service.md)、[`harness/runtime.md`](../../../../../docs/specs/harness/runtime.md) 输出 35–37；决定见 t17 第 5、6、7、8、12 条，[t03](../t03-session-model/README.md) 决定 2，[t06](../t06-approval/README.md) 决定 2。

工作方式：一个分支 `feat/w00032-t28-conversation-ui`、一个 worktree，分批提交；每批合入 master（不 push）。主会话自己写。界面新东西先在 Lab 出静态稿（design-review），定了再写。

## 技术选型

无新的通用问题。差异显示用 t17 的 `DiffView`；树形展开用 nb-ui 现有的折叠与键盘导航做法；草稿存 `localStorage`，不引库。附件上传经 HTTP 路由，不走远程通道（单条消息有上限，16 MB 分段走通道要再造一套；开工时先看 `plugins/http` 的路由与鉴权做法）。

## 关键设计

设计审查（omp 14 条、Sonnet 16 条）后修订，处理见 [evidences/design-review-disposition.md](evidences/design-review-disposition.md)。

### 模型状态与选择器（批 1）

- **状态不跟着变的两条路径**：`meta.model` 只来自快照。`modelsRemote.events.changed` 只刷新下拉选项；`settingsChanged` 只合并 `meta.settings`。所以绑定角色后还显示未绑定，`model.set` 后思考档与上下文窗口也是旧的。
- **修法**：`KernelTranscript` 加 `setModel(model)`，只改这一个字段，不动运行状态、队列、乐观消息与路径（不能复用 `refresh`：`applyPath` 会清掉正在生成的那条）。宿主在模型库变化、`settingsChanged` 涉及 `core.model` 时读 `snapshot`，只取 `.model` 调它；按代次丢弃晚到的结果，换了会话的也丢。宿主依赖加 `onModelsChanged`，`plugin.ts` 已有订阅，转过去。
- **`plugins/models`**：解析入口严格拆 `role:<id>`，转到角色解析；角色不存在得 `unknown-model`，存在但没绑得 `role-unbound`（现在两者都是后者，一并改）；`role:` 后为空得 `unknown-model`。改 `models/service.md` 输出 8。
- **`AgentModelPicker`** 按旧 `ModelPickerContent`、`ModelPickerPopover` 重写，版式适配右栏：宽度与输入框相同（旧的 620 放不下），单列，高度不超过 440 与视图 60% 中较小的；上半角色（梯度四档两列，专精折叠），下半按服务商分组的模型库带搜索（能力标记、窗口、单价），思考档一行。选角色不关面板，选模型关。保留现有的“跟随默认”“管理模型…”、`unavailable`、`showImageSupport`。旧组件的滑移动效不搬。
- **数据**：`composer` 加 `roles: {id, name, axis, modelLabel: string | null, unavailable?: string}[]`，`modelKey` 可取 `role:<id>`。触发器写“深度 · DeepSeek · 高”。
- 会话模型解析失败（`profile-unavailable`）时选择器不能跟着禁用，否则用户在这里改不了：`runtimeDisabled` 不再看 `availability` 的这个状态。

### 状态栏与缓存（批 1）

- 现在缓存命中在明细里，窄宽时明细让位，右栏默认窄，等于看不到。分成左右两区：左区 `min-width: 0` 可省略；右区窄宽只留缓存命中与费用，累计、输入、输出进悬停明细。静态稿出 320 宽带两个警告的版本。
- 命中率 = `cacheRead / (input + cacheRead + cacheWrite)`（现在分母漏了写入）；累计读写都是 0 时不显示，不写 0%：有的服务商不报缓存。
- 圆环与缓存项变成按钮（`aria-haspopup="dialog"`），打开检查器。加能力位 `interaction.canInspectContext`：nb-story 也用 `AgentContextMeter`，它没有检查器，不可点。

### 面板宿主与上下文检查器（批 2）

- **面板宿主先做**：注册表的 `panels`、`headerActions` 现在没有渲染宿主。视图持有打开状态（Spec 定的纯界面状态），`AgentConversationView` 渲染顶栏菜单项与弹窗；打开时发 action，关掉后宿主释放数据。写进 `ui/agent-conversation-view.md`。
- `panels/AgentContextInspector.vue`，数据：`ctx.panels.contextInspection = {state: "idle" | "loading" | "ready" | "unavailable"; reason?; byArea: {area, tokens}[]; window; threshold; slots; diagnostics; cache: {total, last}; usage: {input, output, cacheRead, cacheWrite}}`，放在 `types.ts` 里有类型。打开发 `context.refresh`，宿主调 `preview`（含分段读）。
- 系统提示词走已有的 `systemPrompt.load {refresh}`，展开时才取，不常驻 `ctx`。
- “最近一次”取路径上最后一个回复的用量。槽与诊断比 t17 第 12 条多：开发者要看上下文详细情况，放折叠区。不做时间线与请求选择。

### 回退、重试、编辑重发、分支（批 3）

- **视图要新写**：`ctx.editing` 没有组件读，`editSubmit`、`editCancel` 没有组件发。就地编辑器（历史消息原文未加载时只读）；Spec 要求编辑时能用 `@` 和插图，这批先只改文字，`@` 随批 4，插图随批 5 接上。内置“编辑”加 `run.status` 判定，分支切换按钮传 `disabled`。
- **消息到目标的映射**：不靠 `inputText` 猜。`KernelTranscript` 扫路径时记下每条消息的锚点 `{turnId, modelParent?}`（`modelParent` 是产生这条回复的 `modelStarted.parent`，正是 `after-step` 目标的 id，见 `kernel/run/tree.ts`），加 `anchorOf(messageId)`。宿主取 `rewindTargets` 后精确匹配：
  - 重试助手消息：`modelParent` 对应的 `after-step`，`rewind` 后 `start`；重试用户消息：这轮第一个 `after-step`；
  - 编辑重发：这轮的 `before-turn`，`rewind{resend}`；
  - 从此处分支：用户消息取这轮第一个 `after-step`；助手消息取下一步的 `after-step`，最后一步取 `after-turn`；不发送；
  - 找不到目标显示失败，不选最近的。
- `canMutateHistory` = 可写且没有归档，运行中按钮禁用。
- **结构查询**（改内核一点）：新查询 `treeNodes({after})` 按页交回 `{id, parent, type, seq, label?}`，由内核从内存的 `byId` 算，不读事件全文，所以大事件不会断树；`label` 是文字前 80 字，经出站过滤，过滤掉的没有 `label`。每页按 512 KiB 约 2,500 个节点，10 万事件约 40 次调用。`branchPoints()` 只交回有多个孩子的节点 `{parent, children: {node, latestLeaf}[]}`，一次调用填 `ctx.branches`，`leafChanged` 与运行结束后重取；不逐条调 `siblings`。写进 `harness/runtime.md`、`agent/sessions.md`。
- **分支树** `panels/AgentSessionTree.vue`：两种视图（开发者定）：列表（竖着，线条树）与图（默认从上往下，方向可调）。算法在 `session-tree.ts`，用显式的栈不递归。nb-ui `Tree` 没有插槽，画不了缩进线，不用；长列表靠 `content-visibility`，图超过 1,500 个节点让用列表。搜索、折叠、键盘导航、复制 id、切换；过滤留“默认”“不含工具”“只看用户”“全部”，“带标签”不做。读取中显示进度，不挡对话。入口在顶栏菜单。

### 触发符、斜杠命令、草稿（批 4）

沿用 `compactCommand` 的草稿规则（先清，失败放回）：

| 命令 | 参数 | 成功 | 运行中 |
|---|---|---|---|
| `/new` | 无 | 新会话，草稿不带过去 | 可以 |
| `/fork` | 无 | 新会话打开；结果未知用同一 `commandId` 重发 | 菜单里灰掉 |
| `/rename` | 标题；空的时候打开改名 | `setTitle` | 可以 |
| `/model` | 第一版不解析参数 | 打开选择器，参数填进搜索 | 可以 |

- `/model` 由输入框自己处理（选择器的打开状态本来在它手里），不发 `command.run`，不加新的受控状态。
- `@`：编辑区没有文件查找可复用（快速打开的 Spec 不做文件检索）。`nbook.files` 加只读查询 `find({root, query, limit})`，服务端用 `pi-natives` 的 glob，宿主按 nb-story `createMentionSearch` 的写法接异步菜单。第一版列项目文件，内容文件夹里的条目（章节）显示标题；插入 `[名字](project://路径)`。没有打开作品时菜单写原因。
- `$` 不做：等 t15。
- **草稿**：按规范不能裸用 `localStorage`，用 `nbook.storage` 记录（同 `agent.recent-session`）：每会话一条，10 条、30 天过期，写入防抖。宿主的 `draft` 改成按会话，切会话时先存后读；晚到的读取若用户已经打字就丢弃。发送后清。
- **输入历史**：上方向键取当前路径上 `intent` 为 `normal` 的用户消息文字，最新在前，去重，至多 50 条；命令不进历史。回退后旧分支的话不在里面，这个取舍写进 Spec。

### 附件（批 5）

开发者 2026-11-06 确认的方向：模型现在看不到图，要补进请求；地址带会话 id；模型不支持图片时换一行文字，不报错；不做缩略图；第一次加附件就建会话；不限张数；单个文件 25 MB；发送时自动缩放（最长边 1568，目标 500 KB），原图保留；请求里超过 100 张时最旧的换占位。设计审查（omp 13 条）后按下面修订，处理见 [evidences/design-review-b5-disposition.md](evidences/design-review-b5-disposition.md)。

**核心形状：内核的请求里只放引用，真正发请求前才读字节。**

- **事件**：`UserInput.attachments` 是 `{kind, uri, name?, mime?, width?, height?, from?, to?}`。`from`、`to` 是文字里这个标签的范围，由宿主算（浏览器用 `nb-markdown` 的 `parsePromptText`，代码块、转义里的不算）；内核不解析 Markdown，只核对范围内的文字含这个 uri，对不上就当没有位置。尺寸在上传时量好，估算不用读文件。
- **块**：`RequestBlock` 加 `{kind: "imageRef", uri, mime?, width?, height?}`。`format.user` 按范围切文字，图片块放在原位，标签不进请求；没有位置的放这个事件的末尾；文件给一行 `[文件 名字：地址]`。Profile 自定义 `render` 只换文字时附件放末尾；返回 null 时连图一起隐藏。提交缓存里存的是引用，历史再长内存也不涨。
- **一个入口**：`kernel/run/` 加 `finalizeRequest(request, {resolve, signal})`：数全部图片（`imageRef` 与工具结果的 `image`），超过 100 张时从最旧的起换成一行占位；`resolve` 时把留下的 `imageRef` 换成 `image`。`callModel` 的 terminal 调它（`resolve: true`），所以拦截层、`modelCaller` 都走得到，也在现有的中止赛跑之内；`preview` 调它（`resolve: false`），交回的请求不带字节，大小不失控，`tokens` 按尺寸估算，和真实请求一致。不在 `computeRequest` 之前预解析：那样要在三处各扫一遍，还会漏掉只在预览里投影的排队输入。
- **端口**：`SessionEnv.attachments?.read(uri, {signal})`，交回 `{data, mime, width?, height?}`、`{missing: true}` 或 `{unusable: reason}`。没给端口、缺失、不能用的都换一行文字占位，后两种写诊断。内核按 uri 缓存，总量上限 64 MB（实际保留的字节），只存完成的结果，不存取消与瞬态失败；同一 uri 的并发读共用。关会话时放掉。
- **缩放**（`plugins/agent/backend`，端口的实现）：复用 `builtin/image.ts` 的 `prepareImage`（已处理 GIF 首帧、尺寸、透明、质量），按附件的目标调参，`read` 工具与附件共用。解不了的（未知格式、损坏、像素超限）按错误码交 `unusable`，不发原图：坏图发出去每轮都报错。结果与模型无关；WebP 的模型相关转换留在适配器，用户消息与工具消息都走，顺序固定为先标准化、后转换。
- **模型不支持图片**：`omp.ts` 的 `userContent()` 扩展成和工具结果一样，换一行文字。`AgentConversationComposer` 去掉“模型不支持图片时拒绝添加”（否则走不到这一步，角色与跟随默认也会被误拒），`supportsImages` 只作提示。改 `ui/agent-conversation-view.md` 里拒绝那条。
- **压缩**：压缩事件之前写下的用户消息，图片都换成带尺寸的占位（地址还在，模型要看可以 `read`），当前这一轮的输入也算。这样溢出后摘要加重试才真的省下图的量，`tokensAfter` 也对得上；回退到压缩前恢复原样，事件没变。`shake` 不动。**这是审查后新定的行为，开发者知悉。**
- **张数预算的代价**：超过 100 张后，每多一张新图，请求前缀从被换掉的那张旧图起变化，那之后的提示词缓存失效（设每张 1,600 token，失效约 15.8 万 token）。接受：压缩已把旧图换成占位，正常用到不了。只聊文字时集合不变，不失效。
- **出站过滤**：`mapEventContent` 同时处理 `attachments`：文字里这个地址被过滤掉了，附件也去掉；范围失效时去掉 `from`、`to`。
- **上传路由** `POST /agent/sessions/<id>/attachments`，体是文件字节，原名按百分号编码放 `X-Attachment-Name`：Host/Origin 准入同 raw 路由；校验会话存在；边读边计数，超 25 MB 立刻 413；读完在内存里算 SHA-256 与尺寸（`stage` 要先知道地址，流式写不进内容寻址的名字；本机单用户，25 MB 的缓冲可接受），再用服务端文件接口写 `sessions://<id>/home/attachments/<哈希>.<扩展名>`；已存在或并发撞上算成功。扩展名按 MIME 白名单定，不信原名。交回 `{uri, kind, name, mime, bytes, width?, height?}`。
- **读取路由** `GET`、`HEAD` 同前缀加 `/<文件名>`：同样的准入；文件名只接受 `<64 位十六进制>.<扩展名>`；所有响应带 `Content-Security-Policy: sandbox` 与 `nosniff`（SVG、HTML 不能在应用的源里运行），位图内联，别的 `Content-Disposition: attachment`（名字按 RFC 5987 编码），`ETag` 用哈希。
- **`sessions://` 全局地址**：`markdown/shared/targets.ts` 的分类认它，算附件；`read` 工具本来能读。
- **宿主**：`composer.attachmentAdded` 上传，`composer.attachments` 给状态；重试、移除接上。没有会话时“为当前草稿确保一个会话”：一次创建任务绑定草稿代次，用户切会话、新建、移除全部附件后不再自动打开、不投递就绪状态；已建的空会话留着。`create` 没有幂等键：失败或结果未知时这个附件标失败，不重试，免得多建。发送时按 `parsePromptText` 算范围带上。转录器按范围去重，不按子串。

### Agent 模式

在 [t06](../t06-approval/plan.md) 做，本 Task 不动模式。

## Spec 与文档改动

- `agent/conversation.md`：“不承诺”去掉这批做了的，加输出条目（标 planned，做完去掉）；`$` 留着。
- `ui/agent-conversation-view.md`：选择器；状态栏两区与 `canInspectContext`；面板宿主；检查器数据；编辑态；输入历史的取舍。
- `models/service.md`：`role:<id>` 与两个失败码的区分。
- `harness/runtime.md`：`treeNodes`、`branchPoints`、用户附件进请求。`agent/sessions.md`：这两个查询、上传与读取路由。`workspace/resources.md`：`find`。

## 切片

| 批 | 内容 | 先出静态稿 | 验证 |
|---|---|---|---|
| 1 | 模型状态刷新、选择器、状态栏 | 选择器、状态栏窄宽 | `session-host.test.ts`、选择器组件测试、`agent-conversation` e2e |
| 2 | 面板宿主、上下文检查器 | 检查器 | 组件测试、宿主测试、e2e 一条 |
| 3 | 就地编辑、重试、编辑重发、分支、结构查询、分支树 | 编辑态、分支树 | 真实内核加本机端点的宿主测试、e2e |
| 4 | 斜杠命令、`@`、草稿、输入历史 | 无 | 组件与宿主测试、e2e |
| 5 | 附件 | 无（视图已有） | 内核测试、上传路由测试、e2e、图片进真实模型的冒烟 |

每批：写 Spec、实现、自跑受影响的测试，单独提交，合入 master。

## 验收映射

批 1：`models/service.md` 输出 8 → `models.test.ts`“会话选角色”；`agent/conversation.md` 输出 7、22 → `session-host.test.ts`“选了没绑定的角色”“运行中模型库变了”、`kernel-transcript.test.ts`“setModel”、`agent-conversation.e2e.ts`“模型选择器”；输出 15 → 同一条 e2e（窄宽）；输出 23 → `session-host.test.ts`；`ui/agent-conversation-view.md` “带角色的选择器” → `AgentConversationComposer.dom.test.ts`“AgentRoleModelPicker”。

批 2：`agent/conversation.md` 输出 24 → `session-host.test.ts`“上下文详情”、`agent-conversation.e2e.ts`“上下文详情”；`ui/agent-conversation-view.md`“上下文检查器” → `AgentContextInspector.dom.test.ts`、`AgentStatusBar.dom.test.ts`“能点”；`agent/sessions.md` 输出 9 的 `preview` → `session-host.test.ts`“上下文详情”。

批 3（不含分支树界面）：`harness/runtime.md` 输出 80、81 → `tree.test.ts`；`agent/conversation.md` 输出 25、26 → `session-host.test.ts`“改写历史”、`agent-conversation.e2e.ts`“改写历史”；就地编辑 → `AgentMessageEditor.dom.test.ts`。

批 3（分支树）：`agent/conversation.md` 输出 27、`ui/agent-conversation-view.md`“分支树” → `session-tree.test.ts`、`AgentSessionTree.dom.test.ts`、`session-host.test.ts`“分支树”、`agent-conversation.e2e.ts`“分支树”。

批 4：`agent/conversation.md` 输出 28 → `drafts-mentions.test.ts`“@ 菜单”、`agent-conversation.e2e.ts`“输入框”；输出 29 → `drafts-mentions.test.ts`“草稿”、`session-host.test.ts`“草稿按会话”“输入历史”、同一条 e2e；输出 30 → `session-host.test.ts`“/new”“/fork 结果未知”、同一条 e2e；`workspace/resources.md`“找文件” → `files.test.ts`“找文件”。

批 5：`harness/runtime.md` 输出 61 → `omp.test.ts`“用户消息的图片”、`agent-conversation.e2e.ts`“附件”；输出 82–84 → `dispatch/attachments.test.ts`；`agent/sessions.md`“附件” → `agent-conversation.e2e.ts`“附件”；`agent/conversation.md` 输出 31 → `session-host.test.ts`“附件”、同一条 e2e。

每批开工先把行为写进 Spec，再在这里写编号映射。下面的场景必须有测试，都用真实内核加本机端点，断言码、事件或请求块；真实模型冒烟只作额外证据：

- 批 1：`role:<id>` 的绑定、未绑定、不存在、改绑；生成中模型库变化，正在生成的那条还在；快照晚到不倒退；`model.set` 后思考档跟着变。
- 批 3：一轮“回复、工具、再回复”里三种操作各选对目标；两条文字相同的用户消息；有 300 KiB 回复的会话树不断；切换分支。
- 批 4：`/fork` 结果未知重发只有一个新会话；切会话时晚到的草稿不盖新输入。
- 批 5：请求里真的有图片块；文字中间的图片位置与代码块里的不算；`fork` 后还读得到；压缩后换占位、回退恢复；同一轮的图撑爆窗口时溢出恢复；不支持图片的模型换文字且能添加；拦截层加图后仍不超 100；预览不带字节且 `tokens` 对；坏图与缺失；25 MB 边界（无 `Content-Length`）；同哈希并发上传；带脚本的 SVG 顶层打开被沙箱；切会话时迟到的创建不抢界面。

## 验证

只跑受影响的测试与 e2e 文件（开发者 2026-11-05）。批 1 做完起开发服务给开发者试。真实模型冒烟放在批 5。没有验证的边界在每批收口时写进 README。

## 审查

设计审查已做，不再开第二轮；批 5 动内核，开工前单独写设计开 omp 审一次。实现审查：批 3、批 5 改了内核与后端，各开一次 omp；前端在 Task 收口时派一次 Sonnet。没把握的切片当场审。

## 不做与风险

- 不做：`$`（t15）、子代理卡片（t14）、收件箱与回退时撤回文件（t13）、缓存时间线、请求选择、附件面板、“关联 Agent”；可定制状态栏、缓存 TTL、五小时与七天限额（t29）。
- 风险：附件的内容哈希相同时不重复写，删除会话才清。
