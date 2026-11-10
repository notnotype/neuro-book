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

2026-11-10 完成，已合入 master（快进到 `de519d6f9`）。执行位置：worktree `.worktree/w00025-editor`，分支 `feat/w00025-editor`（从 master `25451818c` 拉出）。

- **计划审查**：fable 子代理（开发者指定本会话不用 omp），12 条：阻断 0、重要 5、建议 7，全部成立；10 条改进计划，其余进待确认清单。[报告](evidences/design-review-fable.txt)，[处理](evidences/design-review-disposition.txt)。
- **实现审查**：fable 子代理，审 `25451818c..436ee1660`，13 条：阻断 0、重要 4、建议 9；12 条改，1 条（焦点在内嵌页面里时切到别的程序可能不保存）记为未验证边界。[报告](evidences/impl-review-fable.txt)，[处理](evidences/impl-review-disposition.txt)。
- **提交**（分支上）：`8b52d05b2` 模型；`573762a56` 冲突用例；`7fcc3a83a` 设置与接线；`436ee1660` e2e；`5b60578e1` 实现审查的修正；`177c24e93` e2e 按审查改；`editor-area` 改在缺省模式下跑的一次提交。
- **Spec**：[`workbench/editor.md`](../../../../../docs/specs/workbench/editor.md) 输出 63、场景 35–39 已实现（master 上）。
- **验证**（[`evidences/verification.txt`](evidences/verification.txt)）：编辑器 Bun 测试 215 过；组件测试 135 过；typecheck、governance、docs 通过；合入前 e2e 10 个文件 166 例全过，审查修正后相关两个文件 19 例全过、`editor-area` 在缺省模式下全过；变异检查 13 处里 12 处被抓到，余下一处是等价变异。
- **未验证**：真实的操作系统窗口切换（e2e 派发事件模拟）；焦点在 HTML 预览的内嵌页面里时直接切到别的程序（“窗口失焦时”模式可能不保存，按浏览器事件模型推断）；触摸设备；只读（订阅结束）与“手动保存慢于延迟”两种情形没有单独用例。
- 待开发者追认的决定在 [待确认清单](../../pending-confirmations.md)（t04 八行；缺省值那一行补了 VS Code 网页版缺省是“停手后”的对照）。

## 下一步

完成。合入后在合并结果上补跑：nb-ui 组件与主题测试 523 例、typecheck、编辑器 Bun 测试 215 例、自动保存与源码右键的 e2e 22 例全过；`test:affected` 在负载 30 上下被 nb-story 命令行子进程用例的超时截停，同一文件在 master 上对照同样失败，分支没有改 nb-story。worktree `.worktree/w00025-editor` 与分支 `feat/w00025-editor` 已删。
