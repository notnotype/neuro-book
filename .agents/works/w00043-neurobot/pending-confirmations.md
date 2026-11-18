# w00043 待确认清单

autonomous-delivery 推进时照推荐做了、本该由开发者决定的点。开发者追认或改判后在“结果”一栏写明；改判需要的改动另建 Task 或并入下一个 Task。

| 日期 | Task | 类别 | 决定 | 理由 | 改回的代价 | 结果 |
|---|---|---|---|---|---|---|
| 2026-11-18 | t14 | 审查取舍 | 父 Agent 用 `queue` 或 `async` 给正在收口（例如只压缩）的子会话发话时立即以 `running` 交回，这次运行不登记任务，结果写明要从 `sessions://<子会话>/` 看；前台的照常等到被取走再登记（[subagents 输出 10](../../../docs/specs/agent/subagents.md)） | 窗口很窄（子会话只压缩、停止已受理或正在收口时）；后台补登记任务要在工具交回之后另挂一个等待，并处理子会话关闭、插件停止等收口，复杂度与收益不对等（[后端审查处理](tasks/t14-input-buffer-states/evidences/impl-review-backend-disposition.md)第 3 条） | 在 `afterLater` 的后台分支起一个分离的等待，取走后 `adopt` 登记任务，并在插件停止时放掉 | |
| 2026-11-18 | t14 | 接口形状 | 插件经 `agentKey` 建会话时给会话的 `caller` 得 `not-allowed`（Workflow 的照旧）；插件视图上的 `as` 换成会话身份抛错（[sessions 输出 21](../../../docs/specs/agent/sessions.md)） | 输出 21 只把会话身份给 `nbook.agent` 自己；带会话 `caller` 的会话会进那个会话的子代理树、被它停与续用（后端审查第 1、9 条）；仓库里没有插件这样用 | 去掉门面里的两处检查 | |
| 2026-11-18 | t14 | 外观 | 宿主（插件）排的话在排队区的标签用插件给的显示名，图标先统一用 `i-lucide-puzzle` | 宿主身份里只有 `plugin`、`label`，没有图标；第 6 片前没有插件图标的现成来源 | 宿主身份加图标字段，或按插件 id 查清单里的图标，改 `session-host.ts` 的 `authorOf` 一处 | |
| 2026-11-18 | t14 | 文案 | 合并留着的话发出的那一条在确认之前，头部写“前面还有 N 条”代替“发送中”（N 为 0 时仍是“发送中”）；英文 “N message(s) ahead” | 两者只差在有没有别人的话先跑；同时写两句会挤在头部一行里 | 改 `AgentConversationTurn.vue` 的 `pendingLabel` 一处 | |
