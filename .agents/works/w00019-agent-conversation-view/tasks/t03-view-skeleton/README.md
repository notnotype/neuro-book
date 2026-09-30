---
schema: nbook.task/v2
taskId: t03-view-skeleton
---

# 视图骨架与分轮规则

## 目标

实现切片 S1：在 `packages/neuro-book/app/components/agent/` 建立视图合同与最小可挂载的 `AgentConversationView`，让后续切片都在同一套类型和 Lab 场景上推进。

## 合同

[ui.agent-conversation-view](../../../../../docs/specs/ui/agent-conversation-view.md)（planned）中的输入、注册表、分轮规则与失败语义。

## 范围

- 视图类型：ctx、消息、服务、注册表、action 联合类型。
- 注册表构造：同一扩展点重复 `id` 时报错。
- 分轮规则（纯逻辑）：轮次边界、开场轮次、最终回复、探查工具分组、关键结果与摘要指标；单元测试覆盖 steer、提问后继续、出错、被停止、历史不完整等边界。
- `AgentConversationView` 最小壳：顶栏、消息流（先用最简呈现）、输入框占位；同名 `.md` 先于 `.vue` 编写。
- Lab：登记 fixture 与至少一个多轮长对话场景。

## 非目标

- 视觉外壳与最终样式（S2）、完整渲染器（S4）、输入框行为（S5）、面板与弹窗（S6）、时间线回放（S7）。
- 不修改旧目录 `app/components/novel-ide/agent/`，也不 import 它。

## 当前状态（2026-09-28）：已完成

新目录 `packages/neuro-book/app/components/agent/`：

- `agent-view.types.ts`：ctx、消息、服务、action 联合类型。
- `agent-view-registry.ts`：十个扩展点的登记项类型、`createAgentViewRegistry`（重复 `id` 抛 `AgentViewRegistryConflictError`）。
- `builtin-tools.ts`：内置工具的类别、名称、单行摘要与文件影响（edit、write、apply_patch 的增删行统计）。
- `conversation-turns.ts`：分轮规则纯函数 `buildTurns` 与默认展开规则 `defaultTurnExpanded`。
- `AgentConversationView.md` / `.vue`：最小壳（顶栏与溢出菜单、分轮与原始两种消息流、输入框占位）。

Lab：`AgentConversationView` 登记三个场景：`long-conversation`（4 轮，含 12 次工具调用的 ReAct、steer、系统提醒、上下文压缩、出错轮次）、`running`（带“时间 +10 秒”“运行结束”的模拟宿主控件）和 `no-session`。

范围外的配套改动：`vitest.config.ts` 的 include 增加新目录；`component-index.ts` 把组件登记为全高视口；两份 locale 新增 `agentView` 文案。

## 实现中确定、需要在 Spec 晋升时回写的细节

- 注册表只暴露 `list(point)` 与 `resolveTool(name)` 两个查询方法，不暴露内部数组。登记项里有函数和组件，它是运行期能力而不是数据；这样 Lab 的类型检查也不会把它当成必须在场景里登记的 JSON prop。
- `ToolCallView.args` 的字段名与工具自己的参数一致；长字符串可能只是预览。
- `composer.submit` 的 `images` 是输入框内图片的 `localId` 列表。
- “读取文件数”和“改动文件数”按去重后的路径计，只算成功的调用；验收场景 1 的“读 8 个文件”要求 8 次读取的路径各不相同。
- edit 的增删行按替换片段行数近似统计，片段内未变的行也会计入；write 的删除行数未知。
- 用时从本轮第一条消息的时间算到最后一条消息的开始时间；运行中算到 `ctx.now`；开头不完整的轮次不显示用时。
- 默认展开：“从历史加载则折叠”只用于较早的轮次，最新一轮出错或被停止时仍展开。
- 思考与系统提醒夹在两次探查之间时并入工具组，不打断分组；只有一次探查时不成组。
- 最终回复之后发生的压缩与分支摘要显示在最终回复下方（`trailingDividers`），不归入过程。

## 验证

- `bunx vitest run app/components/agent`：2 个文件 28 个用例通过，覆盖轮次边界、开场轮次、steer、提问后继续、出错与中断、被停止、历史不完整、探查分组、插件工具并组、指标与关键结果、注册表冲突与排序。
- `fixtures/index.test.ts`、`component-index.test.ts`：通过。
- `bun run typecheck`：新目录与新 fixture 无错误。仍有 32 个错误，都在本 Task 没有改动的文件里：`server/api/workspace-files/batch.post.ts`、`server/workspace-history/tracked-workspace-files.ts`，以及旧组件 AgentModeSessionSidebar、AgentSidebarView 的 Lab 场景。
- `bun run docs:check`：failures 为 0，本 Task 没有 warning。
- Lab（`127.0.0.1:3002`，手机预设 390 宽）：三个场景都没有横向滚动，也没有控制台错误，顶栏标题区 306px。交互验证了三处：点击摘要行展开过程；从溢出菜单切到原始视图后逐条显示 21 条消息；“运行结束”后最新一轮自动折叠。截图按 t01 记录的方法复现，不入库。

## 观察（留给后续切片）

- 390 宽时摘要行的六项指标会折成两行（费用单独落到第二行），窄屏取舍在 S3 定。
- 运行中不会自动吸底，S3 实现。
