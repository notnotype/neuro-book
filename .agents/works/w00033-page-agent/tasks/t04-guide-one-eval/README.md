---
schema: nbook.task/v2
taskId: t04-guide-one-eval
status: planned
updated: 2026-11-27
---

# 引导一次走完：eval 文档、not-found 说明遮挡

## 目标与范围

让 Agent 先查一两次、再用一个 eval 走完整段引导。本 Task 只做不加新机制就能做的两件事：

1. **eval 文档**：`ui` 文档（`page-agent/plugin.ts` 的 `docs`）里“一步一次调用，按结局决定下一步”被模型读成每步一次 eval。改成：路径已知时在一段 eval 里循环走完（`back` 退一步），只在 `asked`、`dismissed`、`missed`、`gone`、报错或要读没见过的页面时交回；照 `find` 的 `path` 走不用先拍快照（路径已从没完成的那一步给起）；等用户时 eval 不计时，不用调大 eval 的时限。
2. **`not-found` 说明遮挡**：定位没命中与高亮等目标超时时，`details` 带当前的层（与快照表头的写法相同），目标其实在、被上面一层盖住时写明是哪一层。

效果由开发者自己在开发服务上测（2026-11-27：“到时候我自己来测就行了”），不搭自动评测。手测可以用这几个例子：在哪里添加表情包；配置 API Key（中途点开“添加服务商”）；在编辑器里插入表情；给某段话加批注；把一个文件发给 Agent；先在资源管理器找到指定文件再发；世界引擎怎么用。其中编辑器、资源管理器、`@` 的几条要等 [t05](../t05-guide-wait-targets/README.md)、[t06](../t06-guide-flows/README.md) 才可能一次走完。

另：[`agent/eval.md`](../../../../../docs/specs/agent/eval.md) 输出 14 里“嵌套工具经 `waitingForUser` 自报的等待”还标着（planned），t03 已实现（高亮用它），晋升时漏摘，本 Task 一并摘掉。

合同：[`agent/page-agent.md`](../../../../../docs/specs/agent/page-agent.md) 输出 12、13 与失败表的 `not-found`（`details` 的形状要写进 Spec）；`agent/eval.md` 输出 14 只摘标记。

## 来源

开发者 2026-11-27 在开发服务上实测 `ui`（会话“ui 工具是什么？”），让那个会话把结论与建议写成文件；本会话核对后给出逐条判断，开发者同意拆成 t04、t05、t06，“开始引导 / 结束引导”并进 [t02](../t02-ui-actions/README.md)。

- [那个会话写的报告](evidences/2026-11-27-agent-report.txt)（原样复制）；[会话的调用时间线](evidences/2026-11-27-session-timeline.txt)。
- 时间都花在模型往返上：每个 `ui` 调用 20 到 60 毫秒，两次 eval 之间 11 到 27 秒；表情包那次用了 6 次 eval。
- 配置 API Key 的第 2 步 `not-found`：快照里密码框照常是 `textbox "API 密钥"`，是用户在第 1 步打开的“添加服务商”弹窗盖住了表单；报错只有“等了 5 秒，目标仍没有出现”，模型又拍了两次快照（一次 7.9 KB 的全窗）才弄清。
- 报告的建议里不采纳的：`waitFor`、`snapshotScope` 参数（同一段 eval 里接着快照只要几十毫秒，省不掉模型读快照那一轮）；“误触时不撤说明框”（`missed` 后同一段代码可以马上重亮）；报告给后续 Agent 的经验里“调大 eval 时限”“偏离 3 次才退出”两条不对，不写进文档。

## 当前状态

2026-11-27 开工。范围小（文档一处、核心包的失败详情、两处 Spec），不写 plan.md。

- 上次 `not-found` 的机制：nb-ui 的模态对话框基于 reka-ui，打开时把对话框以外的元素都标成 `aria-hidden`，底下设置窗口里的密钥框按输出 3、5 不算画在页面上。判“被盖住”照这个：不计 `aria-hidden`、`inert` 时能命中、元素本身看得见，并且最上面有一层不包着它。

## 下一步

在 Work 分支上实现与验证，合入 master 后改 Spec。
