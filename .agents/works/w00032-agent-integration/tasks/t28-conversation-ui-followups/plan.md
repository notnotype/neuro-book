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
- **分支树** `panels/AgentSessionTree.vue`：算法搬旧 `session-tree.ts`（拍平成行加导引线），nb-ui `Tree` 没有插槽，画不了导引线，长链也不适合递归，用虚拟滚动的列表。搜索、折叠、键盘导航、节点详情、复制 id、切换；过滤按旧应用留“默认”“不含工具”“只看用户”“全部”，“带标签”不做，没有标签。读取中显示进度，不挡对话。入口在顶栏菜单。

### 触发符、斜杠命令、草稿（批 4）

沿用 `compactCommand` 的草稿规则（先清，失败放回）：

| 命令 | 参数 | 成功 | 运行中 |
|---|---|---|---|
| `/new` | 无 | 新会话，草稿不带过去 | 可以 |
| `/fork` | 无 | 新会话打开；结果未知用同一 `commandId` 重发 | 菜单里灰掉 |
| `/rename` | 标题；空的时候打开改名 | `setTitle` | 可以 |
| `/model` | 第一版不解析参数 | 打开选择器，参数填进搜索 | 可以 |

- `/model` 由输入框自己处理（选择器的打开状态本来在它手里），不发 `command.run`，不加新的受控状态。
- `@`：编辑区没有文件查找可复用（快速打开的 Spec 不做文件检索）。`nbook.files` 加只读查询 `find({root, query, limit})`，服务端用 `pi-natives` 的 glob，宿主按 nb-story `createMentionSearch` 的写法接异步菜单。第一版列项目文件，内容文件夹里的条目（章节）显示标题；插入 `reference`。没有打开作品时菜单写原因。
- `$` 不做：等 t15。
- **草稿**：按规范不能裸用 `localStorage`，用 `nbook.storage` 记录（同 `agent.recent-session`）：每会话一条，10 条、30 天过期，写入防抖。宿主的 `draft` 改成按会话，切会话时先存后读；晚到的读取若用户已经打字就丢弃。发送后清。
- **输入历史**：上方向键取当前路径上 `intent` 为 `normal` 的用户消息文字，最新在前，去重，至多 50 条；命令不进历史。回退后旧分支的话不在里面，这个取舍写进 Spec。

### 附件（批 5）

这批动内核，开工前单独写一页设计给开发者看要点，再开 omp 审一次。

- **地址**：`sessions://<会话 id>/home/attachments/<SHA-256>.<扩展名>`，写全局地址，不写 `session://`：`fork` 只复制日志，单数地址到新会话就读不到了；全局地址任何会话都能读（t14 决定），`fork` 不用复制文件。删除会话会让引用它的 fork 读不到，按缺失处理。
- **内核**：`Resources.read` 只返回字符串，`format.user()` 不读附件，`computeRequest` 是同步的。`SessionEnv` 加 `attachments.read(uri): Promise<{data, mime, width?, height?} | null>`；进 `computeRequest` 之前先把路径上的附件解析好传进去（发请求、`preview`、压缩三处共用），按 uri 缓存、有总量上限。图片在文字里 uri 出现的位置切开，放图片块；文字里没有的放末尾；文件只给地址。读不到写一行文字占位。
- **规则对齐工具结果的图片**（`runtime.md` 输出 58–61）：估算按 宽 × 高 / 750；模型不支持图片时适配器换成一行文字（`userContent()` 要扩展，现在只收文字）；摘要写尺寸占位；回退到压缩前恢复原样。shake 不动用户的图。
- **发送形状**：文字里留 `![image #N](地址)`，`attachments` 另带列表。转录器文字里已有这个地址时不再生成附件块，否则气泡显示两次。
- **上传路由** `POST /agent/sessions/<id>/attachments`：Host/Origin 准入同 raw 路由；校验会话存在；用服务端文件接口（不用 `sessionResources` 的门面，它按 Agent 身份拒写 `attachments`）；边读边计数，超 16 MB 中止并丢弃暂存，不信 `Content-Length`；同哈希并发写的 `conflict` 算成功。
- **读取路由** `GET`、`HEAD` 同前缀，按扩展名给 MIME，`nosniff`，`ETag` 用哈希。不做缩略图：`variant` 都给原图，`<img loading="lazy">` 限尺寸，长会话慢了再说。
- **宿主**：没有会话时第一次加附件先建会话（`submit` 已有这个做法）；每条输入最多 8 个，多的标失败写原因。

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

每批开工先把行为写进 Spec，再在这里写编号映射。下面的场景必须有测试，都用真实内核加本机端点，断言码、事件或请求块；真实模型冒烟只作额外证据：

- 批 1：`role:<id>` 的绑定、未绑定、不存在、改绑；生成中模型库变化，正在生成的那条还在；快照晚到不倒退；`model.set` 后思考档跟着变。
- 批 3：一轮“回复、工具、再回复”里三种操作各选对目标；两条文字相同的用户消息；有 300 KiB 回复的会话树不断；切换分支。
- 批 4：`/fork` 结果未知重发只有一个新会话；切会话时晚到的草稿不盖新输入。
- 批 5：请求里真的有图片块；文字中间的图片位置；`fork` 后还读得到；压缩前后与回退；不支持图片的模型换文字；16 MB 边界（无 `Content-Length`）；同哈希并发上传；读取路由的 MIME。

## 验证

只跑受影响的测试与 e2e 文件（开发者 2026-11-05）。批 1 做完起开发服务给开发者试。真实模型冒烟放在批 5。没有验证的边界在每批收口时写进 README。

## 审查

设计审查已做，不再开第二轮；批 5 动内核，开工前单独写设计开 omp 审一次。实现审查：批 3、批 5 改了内核与后端，各开一次 omp；前端在 Task 收口时派一次 Sonnet。没把握的切片当场审。

## 不做与风险

- 不做：`$`（t15）、子代理卡片（t14）、收件箱与回退时撤回文件（t13）、缓存时间线、请求选择、附件面板、“关联 Agent”；可定制状态栏、缓存 TTL、五小时与七天限额（t29）。
- 风险：附件的内容哈希相同时不重复写，删除会话才清。
