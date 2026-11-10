---
schema: nbook.task/v2
taskId: t04-autosave
status: active
updated: 2026-11-10
---

# 自动保存

## 目标与范围

自动保存做成设置项，模式参照 VS Code：关闭、停手若干毫秒后、失焦时、窗口失焦时。默认“失焦时保存”（开发者 2026-10-15 同意）。

合同：[`workbench/editor.md`](../../../../../docs/specs/workbench/editor.md)（改“不承诺”里的自动保存）。

实施计划：[plan.md](plan.md)。

## 当前状态

2026-11-10 实施完成，实现审查进行中（不阻塞，按 autonomous-delivery）。执行位置：worktree `.worktree/w00025-editor`，分支 `feat/w00025-editor`（从 master `25451818c` 拉出），未合入 master。

- **计划审查**：独立审查，一个 fable 子代理（开发者指定本会话不用 omp）。12 条：阻断 0、重要 5、建议 7，全部成立；10 条改进计划（第二稿），其余接受取舍、进待确认清单。报告 [`evidences/design-review-fable.txt`](evidences/design-review-fable.txt)，逐条处理 [`evidences/design-review-disposition.txt`](evidences/design-review-disposition.txt)。
- **提交**（分支上）：`8b52d05b2` 自动保存的模型（`web/auto-save.ts`，换标签算离开、关闭时不问、采纳磁盘内容时清掉保存失败）；`573762a56` 补一例冲突；`7fcc3a83a` 设置项与接线（控件的 `leave`、Markdown 控件的“还有没交出的输入”、窗口失焦、离开页面、“重试保存”）；`436ee1660` e2e。
- **Spec**：[`workbench/editor.md`](../../../../../docs/specs/workbench/editor.md) 输出 63、场景 35–39，已标为实现（master 上），输出 4、21、23、26、52 与“失败与恢复”“时序与寿命”一并改了。
- **验证**（[`evidences/verification.txt`](evidences/verification.txt)）：编辑器 Bun 测试 206 过；组件测试 135 过；全部 Bun 测试中本次引入的两例失败已修，另一例服务端超时与本次无关、单独重跑通过；typecheck、governance、docs 检查通过；合入前 e2e 10 个文件 166 例全过；变异检查 13 处里 12 处被抓到，余下一处是等价变异。
- **未验证**：真实的操作系统窗口切换（e2e 里派发事件模拟）；触摸设备上的失焦。
- 照推荐先做、等开发者追认的决定在 [待确认清单](../../pending-confirmations.md)（t04 八行）。

## 下一步

处理实现审查的报告（修正单独提交）；之后与 t05 一起合入 master。
