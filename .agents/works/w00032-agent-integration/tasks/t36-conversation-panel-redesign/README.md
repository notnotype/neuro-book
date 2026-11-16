---
schema: nbook.task/v2
taskId: t36-conversation-panel-redesign
status: active
updated: 2026-11-16
---

# 对话面板改版：面板头、第一屏、子会话与子代理管理、模型不可用提示

## 目标与范围

[t29](../t29-ui-polish-after-t15/README.md) 评审板（[第 1 至 6 轮](../t29-ui-polish-after-t15/artifacts/review/index.html)）定下的对话面板改版，2026-11-16 从 t29 拆出。决定原文以 t29 的决定 5–11 为准：

- 面板头不写“对话”，居中写会话：左新建、中间 Profile 图标与会话标题（下拉）、右边子代理入口、更多与框架按钮；没选会话时写“新对话”。要工作台让视图画自己面板头的标题区（拖动与读屏名称不变），`workbench/views.md` 加一条。
- 子会话：面板头左边是返回（只有图标），中间是子代理图标与标题。
- 子代理管理：面板头右边的入口（图标加个数，等你批准或回答、出错未看时有红点），点开浮层列出当前会话派出的全部子代理与孙代理，点一行进子会话，运行中的悬停可停止；没有子代理时不显示。
- 没选会话的第一屏照旧应用 `AgentChatEmptyState`：欢迎、最近对话（3 张卡片，“查看全部”打开会话列表）、“试试这些”（Profile 声明的开场指令，主创带三条；没有就不显示这一块）；状态栏整行空着。
- 顶栏下、输入框上的两条横线去掉，消息在顶栏下淡出。
- 模型不可用的提示：压在输入框上沿的浮层提示卡，写明哪个角色或服务商，按钮直达对应的设置（模型角色页定位到这个角色、服务商页、密钥）；输入框占位写原因。

合同（改动见[计划](plan.md)的“Spec 与文档改动”）：[`workbench/views.md`](../../../../../docs/specs/workbench/views.md)、[`ui/workbench-layout.md`](../../../../../docs/specs/ui/workbench-layout.md)、[`ui/agent-conversation-view.md`](../../../../../docs/specs/ui/agent-conversation-view.md)、[`agent/conversation.md`](../../../../../docs/specs/agent/conversation.md)、[`agent/sessions.md`](../../../../../docs/specs/agent/sessions.md)、[`models/service.md`](../../../../../docs/specs/models/service.md)、[`agent/contributions.md`](../../../../../docs/specs/agent/contributions.md)、[`agent/builtin-profiles.md`](../../../../../docs/specs/agent/builtin-profiles.md)、[`settings/settings-window.md`](../../../../../docs/specs/settings/settings-window.md)、[`models/settings-pages.md`](../../../../../docs/specs/models/settings-pages.md)。

## 决定

| 编号 | 日期 | 决定 |
|---|---|---|
| 1 | 2026-11-16 | 开发者确认[计划](plan.md)，下面 2 到 7 按推荐 |
| 2 | 2026-11-16 | 内容区的读屏名称仍是视图标题“对话”；面板头的标题按钮写会话标题 |
| 3 | 2026-11-16 | “出错未看”的红点只在本窗口里记：打开子代理浮层或进入那个子会话算看过，刷新后旧的出错不再亮 |
| 4 | 2026-11-16 | 提示卡上的“这是什么？”不做：没有可链接的说明页 |
| 5 | 2026-11-16 | 开场指令至多 3 条（文字加可选图标）；有会话没消息时显示这个会话 Profile 的指令，没选会话时用新会话会用的 Profile 的 |
| 6 | 2026-11-16 | 视图的标题区先只给内置插件用，插件 SDK 不导出，等第二个用户出现再导出 |
| 7 | 2026-11-16 | 子代理管理里的停止只停这次运行，子会话保留，可以继续发消息 |
| 8 | 2026-11-16 | 设计审查（Claude Opus 代替额度用完的 omp，21 条：阻断 2、重要 11、建议 8）后修订计划。最大的改动：工作台的标题区改为视图用 `Teleport` 把自己的头送进面板头，标题按钮仍由工作台渲染。其余逐条见下面的“设计审查的处理”；产品上看得出的几处取舍列在“修订后的取舍” |
| 9 | 2026-11-16 | 开发者确认修订后的计划与下面“修订后的取舍”的 A 到 F 全部六处 |

## 设计审查的处理

报告：[evidences/design-review.txt](evidences/design-review.txt)。归类按 reviewing 的“处理结果”。

| 条 | 归类 | 处理 |
|---|---|---|
| 1 | 成立，要改 | 标题区用不进 SDK 的内部符号申请，`ViewImplementation`、`ViewContext` 的公开形状不变 |
| 2 | 成立，要改 | 新动作 `composer.fill`，宿主用 `setDraft` |
| 3 | 成立，要改 | 失败结果带 `role`、`provider`（nb-models 解析与 harness 快照），浏览器只查表；先判“一家服务商都没有” |
| 4 | 成立，要改 | 每个字段写明来源：任务用子会话标题，收口结果按需取 `runResult`；停止改走 `abort`，孙代理也能停；状态表与卡片共用 |
| 5 | 成立，要改 | 换成 `Teleport`，标题按钮不交给视图；面板收起时按标题只展开；下拉经 `Popover` 的 `anchor` 锚在按钮上 |
| 6 | 成立，要改 | 头在视图的错误边界之内，出错时面板头退回原样；拖动源始终是工作台的按钮 |
| 7 | 成立，要改 | 有标题区时面板头整行三列，框架按钮在右列 |
| 8 | 成立，要改 | `focus` 照 `fileLocation` 的做法：随离开确认、取走即清、已开也送达 |
| 9 | 成立，要改 | 第一屏另取一份顶层、未归档的列表（`recentSessions`），不受会话面板的过滤影响 |
| 10 | 成立，要改 | 只有 `profile-unavailable` 出卡，其余保留一行；卡片占原来那行的位置；占位定了优先级。没选会话时只判“没有服务商”，见取舍 C |
| 11 | 成立，要改 | `Teleport` 之后只有一份头，“⋯”的状态、注册表、注入都在视图树里 |
| 12 | 成立，要改 | 实例就绪才给容器，同一轮渲染里送进去，不跳；切换时组件不重建。焦点在头里时会丢，记为已知限制 |
| 13 | 成立，要改 | 只写标题的面板一律画隐藏的声明标题，`region` 指向它 |
| 14 | 成立，要改 | 没选会话时左右为空、图标用新会话的 Profile；指令截断加悬停全文与右侧提示；卡片写法；不翻译与用户级没有写进限制。图标颜色见取舍 B |
| 15 | 成立，要改 | 返回取 `path.at(-1)` |
| 16 | 成立，要改 | 已看过的出错记在插件作用域，两个宿主共用；基线是插件激活时刻；只认 `error` |
| 17 | 成立，要改 | 每片写明要同步改的测试与要跑的 e2e 文件 |
| 18 | 成立，要改 | Spec 改动逐条列出，旧条目原处改写 |
| 19 | 成立，要改 | 个数是全部行数；没选会话时状态栏不画数据项，提醒项照常（依 t29 决定 5，与审查建议的“只留断线”不同） |
| 20 | 成立，要改 | 不设条数上限，只显示前 3 条 |
| 21 | 第 1 点不再适用（只有一棵树），第 2 点成立 | 第 3、4 片补 Lab 场景 |

## 修订后的取舍（开发者已确认，决定 9）

计划修订后，这几处和定稿图或原计划有差别：

- A. 提示卡放在原来那行字的位置，占位，不像定稿图那样叠在消息末尾上（看起来一样，只是消息不从卡片底下透过去）。
- B. 开场指令的图标统一用强调色。定稿图是琥珀、天蓝、翠绿三色，主题里没有这类分类色，要加得改全部内置主题。
- C. 没选会话时只出“还没有可用的模型”这一张卡；角色没绑定、没有密钥，要建会话后才出。
- D. 子代理浮层每行：名字是 Profile 名，任务是子会话的标题（派发时的 prompt 首行拿不到）；完成、出错的结果文字在打开浮层时才取。
- E. 没选会话时状态栏仍显示提醒项（断线、全部放行、模式标记），平时这几项都不出现，看起来是空的。
- F. 点开场指令会替换输入框里已有的文字（旧应用也是这样）。

## 当前状态

2026-11-16 开工，计划已确认；设计审查处理完，修订后的计划经开发者确认（决定 9），开始实施。草稿在 `.worktree/w00032-t29-drafts` 的 Lab 场景 `ConversationRound2Draft`、`ModelNoticeDraft`、`SubagentsDraft`；实现的 worktree 是 `.worktree/w00032-t36-impl`，分支 `feat/w00032-t36-conversation-panel`。

| 片 | 提交 | 验证 |
|---|---|---|
| 1 工作台的标题区与 `Popover` 的锚点 | `2d9bcdb66` | 单元与 DOM 测试；e2e 三个文件，负载高时的失败单独重跑通过 |
| 2 新顶栏与去线 | `4f787f9d3` | DOM 测试；e2e `agent-conversation`、`agent-subagents`、`lab-agent-ui` |
| 3 第一屏与开场指令 | `6dbff0d9f` | 三个配置的类型检查；单元与 DOM 测试；e2e 四个文件 55 条通过，`lab-scenes` 见下 |

- 第 3 片把宿主给 `welcome`、`draftProfile` 与 `recentSessions` 的接线从第 6 片提前（plan.md 已改），第一屏的 e2e 才能端到端跑。
- 第 4 片的 Spec 已在 master（`57e2eac1f`）：conversation 输出 42、settings-window 输出 15 的 `focus`、settings-pages 输出 18。
- `lab-scenes.e2e.ts` 在 master 上一直失败：`ThemeEditor/scene-full`、`ThemeEditor/icons-empty` 加载时有 404，断言停在“没有控制台问题”，后面的布局基线比对从没跑到。本地临时滤掉这两条重跑，基线比对报出 31 个场景的新越界，全在 `SubagentCard`、`BackgroundCommandCard`、`AgentDock`、`ProfileSettingsPage`。原因在 fixture 根节点写死了宽度（例如 `SubagentCardFixture` 的 `w-[640px]`，手机画布上正好溢出 252px），与本 Task 无关。本 Task 新增的场景（`view-head`、对话视图的 `no-session`、`child-session`、`welcome-first`、`welcome-bare`）都没有越界。不在本 Task 修，交开发者另排。

## 下一步

第 4 片“模型提示卡与设置定位”：后端的 `role`、`provider` 与设置窗口的 `focus` 已写好未提交，`AgentNoticeCard` 与输入框已接上；剩宿主（`session-host.ts`）出四种卡、文案、Lab 场景与 e2e。
