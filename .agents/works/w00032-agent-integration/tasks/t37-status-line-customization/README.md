---
schema: nbook.task/v2
taskId: t37-status-line-customization
status: done
updated: 2026-11-17
---

# 对话状态栏的自定义

## 目标与范围

[t29](../t29-ui-polish-after-t15/README.md) 评审板（[第 1 轮](../t29-ui-polish-after-t15/artifacts/review/index.html)）定下的状态栏自定义，2026-11-16 从 t29 拆出。决定原文以 t29 的决定 2、4、5 为准：

- 右键状态栏弹勾选菜单改显隐，菜单最后“状态栏设置…”；设置里“状态栏”一组分左边、右边两组，拖动或上移下移排序；全局一份，存用户设置。
- 可选的项：上下文用量、用量与缓存命中（累计、输入、输出、缓存命中合成一项）、费用、模型与推理档、缓存倒计时（只给缓存时长明确的服务商，过期写“已过期”），以及插件经贡献点加的项（标“插件”）。缺省与现在一样。
- 提醒类总显示、不能关：运行阶段与用时、等你处理、等重发、费用超过告警线、“全部放行”警告、断线。
- 右栏窄时右边按顺序从前往后收进悬停，费用最后收。
- 不做 Claude Code 那种配一条命令；5 小时与 7 天限额留到做订阅登录时。

计划：[plan.md](plan.md)。合同：[`agent/conversation.md`](../../../../../docs/specs/agent/conversation.md) 输出 15 到 18 与新输出、[`ui/agent-conversation-view.md`](../../../../../docs/specs/ui/agent-conversation-view.md) 的“状态栏”、[`agent/contributions.md`](../../../../../docs/specs/agent/contributions.md) 的新贡献点 `agent.statusItems`；写 Spec 在计划确认之后。

## 决定

| 编号 | 日期 | 决定 |
|---|---|---|
| 1 | 2026-11-17 | 评审板 `review` v1 的 `drag-sort`：设置里排序用原生拖动加上移、下移按钮 |
| 2 | 2026-11-17 | 同板 `cache-ttl`：这一版不做缓存倒计时（目录里只有上下文、用量、费用、模型四项加插件的项）。开发者的批注：这个计数器能不能让用户自己写代码实现，他现在用的 Claude Code 的 statusline 就是自己写的 |
| 3 | 2026-11-17 | 对批注的答复：插件经 `agent.statusItems` 加的项拿到完整的 `ctx`（最近回复的时间、模型、缓存读写量都在里面），自己算倒计时够用，不用我们内置。像 Claude Code 那样配一条命令（用户脚本）t29 决定 4 排除过，仍不做；要不要另加一条“用户脚本”路径待开发者定 |
| 4 | 2026-11-18 | 开发者按推荐：“用户脚本”那条路径不做，状态栏的自定义项仍走插件的 `agent.statusItems` |
| 5 | 2026-11-18 | 开发者按推荐：nb-ui 的 `ContextMenu` 改成挂上时也量位置，另建 [t39](../t39-context-menu-measure-on-mount/README.md) |

## 当前状态

2026-11-17 完成并合入 master（四片：目录与解算与窄时收项的纯逻辑、状态栏按设置显示与右键菜单、设置项与贡献点与设置页、Lab 场景与 e2e）。Spec 条目已晋升（conversation.md 输出 15、45、46，agent-conversation-view.md 的“状态栏”，contributions.md 输出 22），按 2026-11-17 起的规矩不用审批。

实现审查（Sonnet，前端）：13 条，重要 6、建议 7，证据 [`evidences/impl-review.txt`](evidences/impl-review.txt)。处理：

- 成立、已改（重要 6 条与几条建议）：量到宽度 0 的项挡住整个右边的收起；最后一项也放不下时右边不收、把左边提醒挤没（改成全收）；宿主项渲染抛错整条状态栏挂不上（包了 `RenderGuard`），异步加载失败后永远 0 宽（`fail()`）；预览里右键弹出点了没用的菜单（预览整块 `inert`）；右键勾选写失败的通知文案借了“发送失败”（改用设置页同一个失败文案）；右键菜单关闭后焦点没还；向下拖的落点线画在上沿；上移下移连点同一项丢步（改成相对 `shift`）；收起的槽没贴左缘可能撑出横向滚动；左边宿主项没有包装元素；`openSettings` 两条路径合一；`.md` 与过期的 e2e 标题跟上。
- 接受取舍、未改：上移下移后焦点在 Chromium 下可能丢（从代码推断，未在真实浏览器验证，不加焦点管理与播报机制）；`order` 里残留的已卸载插件 id 满 64 项会被 schema 拒（几乎不会发生，记为已知限制）；插件项变化时整份注册表重建（没有证据显示下游缓存受影响）；`hostScene` 拼 input 的写法。
- 没做：SDK 的 `agentStatusItem` 助手（计划里写了，第三方现在手写清单）；插件经真实运行时发布 `agent.statusItems` 的端到端用例（接收者与撤回有用例，校验有用例）。

另：最终形态与 Spec 一致，内置四项（上下文、用量、费用、模型）内联在 `AgentStatusBar`；`AgentStatusBar` 现在是 nb-agent-ui 的公开组件（设置页预览复用它）。

## 下一步

无。“用户脚本”不做（决定 4）；`ContextMenu` 挂上即量在 t39 做（决定 5）。
