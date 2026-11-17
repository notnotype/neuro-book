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

## 实现审查（Sonnet，2026-11-17）

审 `master...HEAD`（合入 master 之后，含后端小改），20 条：阻断 0、重要 4、建议 16，报告在 [`evidences/impl-review.txt`](evidences/impl-review.txt)。

| 条 | 处理 | 怎么改、为什么 |
|---|---|---|
| 1 | 成立，要改 | 第一屏刷新的 `watch` 改成两个分别比较的源；getter 交回新数组时 ctx 每变一次都重取 |
| 2 | 成立，要改 | `profileKey()` 先读 `revision`，渲染函数读它时快照到了会重算；补 `session-host.test.ts`，变异检查过 |
| 3 | 成立，要改 | 一次打开里每次运行只试一次，关掉再开才再试；补 DOM 测试，变异检查过 |
| 4 | 成立，要改 | 只为完成与出错的行取结果 |
| 5 | 成立，要改 | `AgentConversationView.md` 补 `welcome`、第一屏与 `composer.fill` |
| 6 | 成立，要改 | 提示卡的去处都带 `layer: "user"`（模型两页只在用户标签下可用）；测试的期望跟着改 |
| 7 | 成立，要改 | 服务商页不能写时 `focus: "add"` 取走后不打开添加窗口 |
| 8 | 不成立 | 服务端只听回环地址（nb-host），浏览器与服务端在同一台机器，两个时刻是同一个时钟 |
| 9 | 成立，要改 | 没有悬停的设备上运行中的行常显停止 |
| 10 | 部分改 | 补“旧一代的标题区收不到位置与按下”的单元测试；“面板收着时按标题只展开”在外壳里，外壳没有 DOM 测试夹具，接受只靠 e2e 与代码 |
| 11 | 成立，要改 | 换代、拆上下文时旧标题区的位置清成 null |
| 12 | 成立，要改 | 打开设置失败写诊断 |
| 13 | 成立，但接受取舍 | 快照里没有父会话 id，要另加“祖先还没读到”的标记才能不画新建；这段只有一次请求的时间，读失败时点新建只是多建一个顶层会话 |
| 14 | 待开发者定 | 输入框只读时开场指令仍可点，见下面“待确认” |
| 15 | 不改 | 现有调用方都带 `section`，搜索中只给 `focus` 的情形没有入口 |
| 16 | 成立，要改 | 收口原因表只留卡片那一份，浮层引用它 |
| 17 | 成立，要改 | 后代都没了时浮层关掉；补 DOM 测试，变异检查过 |
| 18 | 待开发者定 | 400px 右栏里居中的标题偏窄，见下面“待确认” |
| 19 | 成立，要改 | 面板头的 DOM 测试改成等可观察的结果 |
| 20 | 成立，要改 | nb-harness 包内补“快照带 `role`、`provider`” |

待确认（实现审查带出的两处产品取舍）：

- 第 14 条：没选会话、一家服务商都没有时，第一屏的开场指令照样能点，点了把字填进只读的输入框。推荐：输入框不能用时指令块停用（仍显示），等提示卡的问题解决再能点。
- 第 18 条：标题按整行居中时，两侧各留较宽一侧的宽度；默认 400px 的右栏、有子代理入口时，审查者估算标题只剩四五个字（没量）。推荐：先在 Lab 里量一次；确实太窄时，放不下最小宽度就改成标题靠左占满剩下的宽度，放得下才居中。

## 当前状态

2026-11-16 开工，计划已确认；设计审查处理完，修订后的计划经开发者确认（决定 9），开始实施。草稿在 `.worktree/w00032-t29-drafts` 的 Lab 场景 `ConversationRound2Draft`、`ModelNoticeDraft`、`SubagentsDraft`；实现的 worktree 是 `.worktree/w00032-t36-impl`，分支 `feat/w00032-t36-conversation-panel`。

| 片 | 提交 | 验证 |
|---|---|---|
| 1 工作台的标题区与 `Popover` 的锚点 | `2d9bcdb66` | 单元与 DOM 测试；e2e 三个文件，负载高时的失败单独重跑通过 |
| 2 新顶栏与去线 | `4f787f9d3` | DOM 测试；e2e `agent-conversation`、`agent-subagents`、`lab-agent-ui` |
| 3 第一屏与开场指令 | `6dbff0d9f` | 三个配置的类型检查；单元与 DOM 测试；e2e 四个文件 55 条通过，`lab-scenes` 见下 |
| 3 的回归修正 | `2955167c2` | 状态栏的 DOM 测试按旧的“总画数据项”写、第一屏图标写了字面字号；片内只跑了改过的测试文件，之后每片跑所改包的全量 |
| 4 模型提示卡与设置定位 | `a6a1408bb` | 类型检查；nb-agent-ui 全量、neuro-book 相关 280 条、nb-models、nb-harness；变异检查（快照不带 `role`、占位不按原因优先）；e2e `agent-conversation`（含“去绑定”）、`models`、`settings` 43 条通过，`lab-scenes` 滤掉 404 后只剩下面那 31 个旧越界 |
| 漏的类型检查与 Lab 场景 | `45ed54cdf`、`cefd3eef7` | 状态栏新用例的类型错误；第 2 到 4 片新零件（顶栏、第一屏、提示卡）没有单独的 Lab 场景，Lab 的覆盖测试报出；顶栏根是两个节点，attrs 落不下 |
| 5 子代理管理 | `1b7971d94` | Spec conversation 输出 43（master `ff25ef9f4`）；纯函数 5 条、DOM 3 条、agent 插件全量 428 条；e2e `agent-subagents`（含新的“子代理管理”）、`agent-conversation` 通过（279 行那条第一次连假端点断开，单独重跑通过）；`lab-scenes` 只剩 31 个旧越界 |
| 6 宿主接线 | `0a730471a` | Spec conversation 输出 44（master）；类型检查与架构测试；agent 与 workbench 的 bun 957 条、vitest 184 条；e2e `agent-conversation`（新的“写在面板头上”）、`agent-subagents`、`workbench-views`、`lab-workbench-surface` 75 条通过 |
| 并入 master | `e4582a577` | 没有冲突；`bun install`；五个包的类型检查通过；`test:affected --since master` 只有 `src/sdk/sdk.test.ts` 两条失败，master 上同样失败（nb-ui 新增 `DateInput`、`TagInput` 没列进 SDK，w00025 的改动），与本 Task 无关 |
| 收口 | `663c05a2b`，合入 master `5dd6b0f3e` | 去重后的 9 个 e2e 文件合入后一次跑完 147 条，失败 3 条：`lab-scenes` 只剩 31 个旧越界；`agent-conversation` 356 行、`agent-subagents` 88 行都是测试连假端点控制口时被断开（`fetch failed: other side closed`），单独重跑通过。审查修正后重跑 `agent-conversation`、`agent-subagents`、`workbench-views` 59 条，356 行那条又断开一次、单独重跑通过 |

- 第 3 片把宿主给 `welcome`、`draftProfile` 与 `recentSessions` 的接线从第 6 片提前（plan.md 已改），第一屏的 e2e 才能端到端跑。
- 第 4 片的 Spec 已在 master（`57e2eac1f`）：conversation 输出 42、settings-window 输出 15 的 `focus`、settings-pages 输出 18。
- `lab-scenes.e2e.ts` 在 master 上一直失败：`ThemeEditor/scene-full`、`ThemeEditor/icons-empty` 加载时有 404，断言停在“没有控制台问题”，后面的布局基线比对从没跑到。本地临时滤掉这两条重跑，基线比对报出 31 个场景的新越界，全在 `SubagentCard`、`BackgroundCommandCard`、`AgentDock`、`ProfileSettingsPage`。原因在 fixture 根节点写死了宽度（例如 `SubagentCardFixture` 的 `w-[640px]`，手机画布上正好溢出 252px），与本 Task 无关。本 Task 新增的场景（`view-head`、对话视图的 `no-session`、`child-session`、`welcome-first`、`welcome-bare`）都没有越界。不在本 Task 修，交开发者另排。

## 下一步

已合入 master。等开发者：

1. 批准 Spec 晋升：本 Task 标 planned 的条目（views 输出 19、workbench-layout 输出 20、agent-conversation-view 的顶栏与第一屏与提示卡、conversation 输出 35 的返回与 41 到 44、settings-window 输出 15 的 `focus`、settings-pages 输出 18、harness/models、runtime 输出 77、models/service 输出 8、contributions 输出 21、builtin-profiles 输出 17）晋升 `implemented` 并补实现合同与证据。
2. 定实现审查带出的两处取舍（上面“待确认”的第 14、18 条）。

另外发现、不属于本 Task 的：

- `lab-scenes.e2e.ts` 在 master 上被 `ThemeEditor` 的 404 挡住，布局基线比对从没跑到，背后有 31 个场景的越界（见上文）。
- `src/sdk/sdk.test.ts` 在 master 上两条失败：nb-ui 新增的 `DateInput`、`TagInput` 没列进 SDK（w00025）。
- `agent-conversation.e2e.ts` 里两条“按状态换场景”（w00041 t14）在整个文件连着跑时偶发 `fetch failed: other side closed`，单独跑通过；推断是测试连假端点控制口的连接被断开后又被复用，未在 master 上单独验证。

实施时定下的细节：

- 提示卡的选法是纯函数 `agent/web/model-notice.ts`，上下文与按钮共用同一份输入，按钮去的地方与卡上写的一致；卡换了以后旧按钮不再有去处。
- 一家服务商都没有、而且没选会话时也出卡，发送不可用（没有模型可用）。
- 页面属性 `takeFocus` 写成函数类型，不写 `SettingsPageContext["takeFocus"]`：后者被 Vue 编译器按返回值生成运行时校验，开发模式下报类型不符（lab-scenes 抓到）。
- 出错看过没有按会话记“看到哪个时刻为止”（计划写的是按 `会话:运行` 记）：最近一次以错误收口、收口晚于它的算没看过，与按运行记的结果相同，少存一份集合；激活时刻是基线。切会话由插件看 `host.sessionId` 记，卡片、停靠区、浮层几条路都算。
- 浮层里的行是整行按钮，在滚动的列表里外扩光晕会被裁：用 `nb-ui-focus-ring-inset`。
- 浮层外框的宽度与内边距照顶栏会话列表的写法用 `:global(...)`：原子类在 Tailwind 的 utilities 层里，不分层的组件样式压得过它，不靠加载顺序。
- 标题区的取法（`VIEW_HEAD`、`ViewHead`、`viewHeadOf`）从工作台的 `web/contracts.ts`、`web/views/view-head.ts` 挪进 `shared/contracts.ts`：架构测试只许别的插件在运行时引对方的 `shared/contracts.ts`（ADR 0025），第 1 片放在 web 下，接线时才撞到。共用合同不带 DOM 类型，位置写成 `object`，对话的宿主用 `instanceof HTMLElement` 收；工作台自己用的形状改名 `PanelHeadSlots`。
- e2e 里“成了标签条”在浮动窗里造：右栏、侧栏的分节不会并成标签条，标签条只在浮动窗里有；只有一个标签的浮动窗按住标题拖的是整个窗，所以来源用侧栏里的会话分节，拖到对话窗的中间添加为标签。
