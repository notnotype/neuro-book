# w00043 待确认清单

autonomous-delivery 推进时照推荐做了、本该由开发者决定的点。开发者追认或改判后在“结果”一栏写明；改判需要的改动另建 Task 或并入下一个 Task。

| 日期 | Task | 类别 | 决定 | 理由 | 改回的代价 | 结果 |
|---|---|---|---|---|---|---|
| 2026-11-18 | t14 | 审查取舍 | 父 Agent 用 `queue` 或 `async` 给正在收口（例如只压缩）的子会话发话时立即以 `running` 交回，这次运行不登记任务，结果写明要从 `sessions://<子会话>/` 看；前台的照常等到被取走再登记（[subagents 输出 10](../../../docs/specs/agent/subagents.md)） | 窗口很窄（子会话只压缩、停止已受理或正在收口时）；后台补登记任务要在工具交回之后另挂一个等待，并处理子会话关闭、插件停止等收口，复杂度与收益不对等（[后端审查处理](tasks/t14-input-buffer-states/evidences/impl-review-backend-disposition.md)第 3 条） | 在 `afterLater` 的后台分支起一个分离的等待，取走后 `adopt` 登记任务，并在插件停止时放掉 | |
| 2026-11-18 | t14 | 接口形状 | 插件经 `agentKey` 建会话时给会话的 `caller` 得 `not-allowed`（Workflow 的照旧）；插件视图上的 `as` 换成会话身份抛错（[sessions 输出 21](../../../docs/specs/agent/sessions.md)） | 输出 21 只把会话身份给 `nbook.agent` 自己；带会话 `caller` 的会话会进那个会话的子代理树、被它停与续用（后端审查第 1、9 条）；仓库里没有插件这样用 | 去掉门面里的两处检查 | |
| 2026-11-18 | t14 | 外观 | 宿主（插件）排的话在排队区的标签用插件给的显示名，图标先统一用 `i-lucide-puzzle` | 宿主身份里只有 `plugin`、`label`，没有图标；第 6 片前没有插件图标的现成来源 | 宿主身份加图标字段，或按插件 id 查清单里的图标，改 `session-host.ts` 的 `authorOf` 一处 | |
| 2026-11-18 | t14 | 文案 | 合并留着的话发出的那一条在确认之前，头部写“前面还有 N 条”代替“发送中”（N 为 0 时仍是“发送中”）；英文 “N message(s) ahead” | 两者只差在有没有别人的话先跑；同时写两句会挤在头部一行里 | 改 `AgentConversationTurn.vue` 的 `pendingLabel` 一处 | |
| 2026-11-18 | t14 | 产品取舍 | 父 Agent 前台等一句排在子会话收口之后的话时被中止：这句话还没被取走就从子会话撤回（取消），不留着（[subagents 输出 10](../../../docs/specs/agent/subagents.md)） | 输出 16 要求父会话中止时前台等的跟着停；不撤回的话这句之后由父会话的身份开一次运行，没有任务、父 Agent 停不了它（[后端修正复审](tasks/t14-input-buffer-states/evidences/impl-review-backend-disposition.md)第 2 条） | 去掉 `afterLater` 中止分支里的取消，改成留着并写进已知限制 | |
| 2026-11-18 | t14 | 接口形状 | 对话视图的 `interaction` 加 `continuing`：宿主执行一次继续的几步之间只挡发送键与排队区的“继续”，编辑器照常可写 | 原先借 `canSend` 置假，整个输入框只读失焦（[前端审查处理](tasks/t14-input-buffer-states/evidences/impl-review-frontend-disposition.md)第 3 条） | 去掉字段、改回 `canSend`，宿主与输入框各改一处 | |
| 2026-11-18 | t14 | 界面 | 恢复方式在“运行可靠性”分区里自成一组“继续”，不放在“模型请求”组 | 它说的是继续时怎么发留着的话，与模型请求无关（前端审查第 12 条）；conversation 输出 47 只写了分区 | 设置项的 `group` 改回一处，删掉组的声明与文案 | |
| 2026-11-18 | t14 | 文案 | 英文占位文字缩短：“Enter sends the paused messages; or add one”“Interrupted, messages paused. Enter to continue” | 原句在 390 宽折成两行、被输入框裁掉（截图核对） | 改 `nb-agent-ui` 英文目录两行 | |
| 2026-11-26 | t19 | 界面 | 浮动窗里视图段的展开、收起按钮由视图画在视图段底段最下面（`data-messages-segment-toggle`，同右轨展开按钮的图标与可访问名） | Spec 输出 51 没写窗里怎么展开收起；右轨上的按钮是侧轨自己的，窗里没有侧轨（片 7 审查第 5 条） | 去掉这个按钮，改由宿主在顶格里画一个；组件一处、宿主一处 | |
| 2026-11-26 | t19 | 界面 | 被预算拒绝的展开请求在内存里记下，按钮标“窗口太窄”，窗口变宽后不自动展开、等再点 | Spec 输出 50 写被拒时给“窗口太窄”，但被拒不写意图，没有这一项按钮上看不出（第 C 段失败 3） | 去掉 `refusedRail`、`refusedFloatRail`，被拒时只回报结果 | |
