# t28 实施计划：对话界面第二批

## Context

t17 第一版以“能真的用它写书”为标准，把分支树、上下文检查器、附件、草稿、触发符、Agent 模式拆到本 Task（[t17](../t17-conversation-ui/README.md) 的“第一版的范围”）。开发者 2026-11-06 上手体验后定：下一步做 t28，并提了几条反馈，其中和输入框、状态栏相关的并进本 Task（见 [README](README.md) 的“开发者体验反馈”），其余记到 [t29](../t29-ui-polish-after-t15/README.md)。

依据：[`ui/agent-conversation-view.md`](../../../../../docs/specs/ui/agent-conversation-view.md)、[`agent/conversation.md`](../../../../../docs/specs/agent/conversation.md)、[`agent/sessions.md`](../../../../../docs/specs/agent/sessions.md)、[`models/service.md`](../../../../../docs/specs/models/service.md)、[`harness/runtime.md`](../../../../../docs/specs/harness/runtime.md) 输出 35–37；决定见 t17 第 5、6、7、8、12 条，[t03](../t03-session-model/README.md) 决定 2，[t06](../t06-approval/README.md) 决定 2。

工作方式：一个分支 `feat/w00032-t28-conversation-ui`、一个 worktree，分批提交；每批合入 master（不 push）。主会话自己写。界面新东西先在 Lab 出静态稿（design-review），定了再写。

## 技术选型

无新的通用问题。差异显示用 t17 的 `DiffView`；树形展开用 nb-ui 现有的折叠与键盘导航做法；草稿存 `localStorage`，不引库。附件上传经 HTTP 路由，不走远程通道（单条消息有上限，16 MB 分段走通道要再造一套；开工时先看 `plugins/http` 的路由与鉴权做法）。

## 关键设计

### 模型状态与选择器（批 1）

- **角色绑定后不刷新的原因**：`session-host.ts` 的 `availability` 取 `meta.model`，它只来自打开时的快照；`plugin.ts` 订阅了 `modelsRemote.events.changed`，只刷新下拉的选项。改法：`models` 变化时宿主重读当前会话的 `snapshot`，只更新 `meta.model`，不重建对话。写一条宿主测试：未绑定 → 绑定后不刷新页面就能发送。
- **`nb-agent-ui/src/vue/composer/AgentModelPicker.vue`** 按旧应用 `novel-ide/model-picker/ModelPickerContent.vue`、`ModelPickerPopover.vue` 重写：上半是角色（梯度四档，专精角色可折叠），下半按服务商分组的模型库带搜索，能力标记、窗口与单价；思考档同一个面板。选角色不关面板，选模型关。旧组件的滑移动效不搬，先按现有弹层。
- **数据**：`composer` 加 `roles: {id, name, axis, modelLabel | null, unavailable?}[]`；`modelKey` 可取 `role:<id>`。触发器写“深度 · DeepSeek · 高”。
- **`plugins/models`**：`settings.model` 接受 `role:<id>`，模型端口解析时按角色走，未绑定得 `role-unbound`，不存在得 `unknown-model`（改 `models/service.md` 输出 8 的表）。内核不解析这个串，不用改内核。宿主的 `modelOptions` 同时给角色。

### 状态栏与缓存（批 1）

现在的缓存命中在 `AgentStatusBar` 右边明细里（`cachePercent`），但窄宽时明细整段让位、只留累计与费用；右栏默认就窄，所以等于看不到。改成窄宽时留缓存命中与费用，先让位输入、输出；累计也让。上下文圆环与缓存项都能点，打开上下文检查器。

### 上下文检查器（批 2）

- `nb-agent-ui/src/vue/panels/AgentContextInspector.vue`：弹窗，宿主给数据。内容：组成（`preview.tokens.byArea` 五块加工具，比例条）、扩展的槽（`slots`）、缓存（累计命中率、最近一次请求的命中率、读写量）、诊断（`diagnostics`）、系统提示词全文（折叠）、刷新。
- 打开时调远程 `preview`（已有，含分段读）；`preview-unavailable` 显示原因。缓存时间线与请求选择不做（t17 第 12 条）。
- 数据形状进 `ctx.panels.contextInspection`，动作用已有的 `context.refresh`。

### 回退、重试、编辑重发、分支（批 3）

- 视图已有消息操作与 `branch.switch`、`tree.activate`、`message.editSubmit`、`message.retry`、`message.branchFrom`；宿主现在 `canMutateHistory` 为假。这批把它打开，映射到已有的内核指令：
  - 重试：`rewindTargets` 找这轮的目标后 `rewind` 再 `start`（[`runtime.md`](../../../../../docs/specs/harness/runtime.md) 输出 36）；
  - 编辑重发：`rewind{to: 原消息之前, resend}`；
  - 从此处分支：`rewind{to}`，不发送；
  - 切换：`siblings` 取兄弟节点，填 `ctx.branches`，`switchBranch`；
  - `leafChanged` 已经按新路径重建（`agent/conversation.md` 输出 5）。
- 运行中不能改树：沿用 `running` 失败，按钮按 `run.status` 禁用。
- **分支树** `panels/AgentSessionTree.vue`：按旧应用 `dialogs/session-tree` 与 `session-tree.ts`，从完整日志算（`log` 分页），搜索、折叠、键盘导航、节点详情、复制 id、切换。日志读完前显示进度，不阻塞对话。入口在顶栏菜单。

### 触发符、斜杠命令、草稿（批 4）

- `HOST_COMMANDS` 加 `new`、`fork`、`rename`、`model`，都映射到已有的指令；`/model` 打开选择器，`/fork` 新会话打开后切过去。`/plan`、`/mode` 随 t06。
- `@`：宿主实现 `resolveTriggerMenu`，第一版只列项目文件与章节，复用编辑区现有的文件查找（开工时先找“快速打开”的做法）；插入 `reference`，发出去是地址。没有打开作品时菜单写原因。
- `$` 不做：等 t15。
- 草稿：宿主按会话写 `localStorage`，10 条、30 天过期（t17 第 8 条）；切会话、刷新后还在，发送后清。上方向键调出的已发送内容取自日志（`composer` 已有这个字段，宿主补上）。

### 附件（批 5）

- 从代码推断内核只把 `attachments` 记进 `input` 事件，组请求时没有转成图片块（`kernel/session/preview.ts`、`helpers/turns.ts` 里都没有），开工先写一条真实内核的测试确认。要补：图片读 `uri` 转成图片块，文件给路径；压缩时图片写占位（`summary` 已有尺寸占位的规则）。写进 `harness/runtime.md`。
- 上传：`plugins/agent` 加 HTTP 路由，写进 `session://attachments/<内容哈希>`，经写入接口的 `stage`，`session://attachments/` 对 Agent 只读不变。最多 8 张、单张 16 MB（t17 第 6 条）。写进 `agent/sessions.md`。
- 视图的附件条、`composer.attachmentAdded/Retry/Removed`、`resolveAttachmentUrl`、粘贴分档已有，宿主接上。模型不支持图片时拒绝添加，已有规则。

### Agent 模式

范围变大（权限规则系统、shell 解析），移到 [t06 的计划](../t06-approval/plan.md)，紧接本 Task 做。本 Task 的模式菜单第一版仍只有审批模式。

## Spec 与文档改动

- `agent/conversation.md`：“不承诺”去掉这批做了的，加输出条目（标 planned，做完去掉）；`$` 留着。
- `ui/agent-conversation-view.md`：模型下拉改成选择器；窄宽状态栏的让位顺序；检查器的范围。
- `models/service.md`：`settings.model` 的 `role:<id>`。
- `agent/sessions.md`：附件上传。`harness/runtime.md`：附件进请求。

## 切片

| 批 | 内容 | 先出静态稿 | 验证 |
|---|---|---|---|
| 1 | 模型状态刷新、选择器、状态栏 | 选择器、状态栏窄宽 | `session-host.test.ts`、选择器组件测试、`agent-conversation` e2e |
| 2 | 上下文检查器 | 检查器 | 组件测试、宿主测试、e2e 一条 |
| 3 | 重试、编辑重发、分支、分支树 | 分支树 | 真实内核加本机端点的宿主测试、e2e |
| 4 | 斜杠命令、`@`、草稿、输入历史 | 无 | 组件与宿主测试、e2e |
| 5 | 附件 | 无（视图已有） | 内核测试、上传路由测试、e2e、图片进真实模型的冒烟 |

每批：写 Spec、实现、自跑受影响的测试，单独提交，合入 master。

## 验收映射

Spec 条目在每批开工时写好后补在这里；没有写进 Spec 的行为不算验收。

## 验证

只跑受影响的测试与 e2e 文件（开发者 2026-11-05）。批 1 做完起开发服务给开发者试。真实模型冒烟放在批 5。没有验证的边界在每批收口时写进 README。

## 审查

计划经开发者确认后交 omp 做设计审查（前端部分另派 Sonnet）。实现审查：批 5 改了内核与后端，开一次 omp；前端在 Task 收口时派一次 Sonnet。没把握的切片当场审。

## 不做与风险

- 不做：`$`（t15）、子代理卡片（t14）、收件箱与回退时撤回文件（t13）、缓存时间线、请求选择、附件面板、“关联 Agent”；可定制状态栏、缓存 TTL、五小时与七天限额（t29）。
- 风险：分支树读完整日志，长会话要分页很多次，按进度显示不阻塞。附件的内容哈希相同时不重复写，删除会话才清。
