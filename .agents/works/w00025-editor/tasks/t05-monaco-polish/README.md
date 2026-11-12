---
schema: nbook.task/v2
taskId: t05-monaco-polish
status: done
updated: 2026-11-10
---

# Monaco 打磨：右键菜单与语法配色

## 目标与范围

- 右键菜单：关掉 Monaco 自己的菜单（在 shadow DOM 里，只能改颜色），换成应用的右键菜单（nb-ui `ContextMenu`），菜单项来自 Monaco 的动作，并给插件一个菜单位置。开发者 2026-10-15 同意。
- 语法配色：现在编辑器的背景、前景、行号、光标取自产品主题，语法着色仍是 Monaco 默认的 vs/vs-dark；把一套语法配色加进主题 token（[`theme/system.md`](../../../../../docs/specs/theme/system.md)），用户覆盖以后再做。

合同：[`workbench/editor.md`](../../../../../docs/specs/workbench/editor.md)、[`theme/system.md`](../../../../../docs/specs/theme/system.md)、[`workbench/menus.md`](../../../../../docs/specs/workbench/menus.md)。

实施计划：[plan.md](plan.md)。

## 当前状态

2026-11-10 完成，已合入 master（快进到 `de519d6f9`）。执行位置：worktree `.worktree/w00025-editor`，分支 `feat/w00025-editor`。

- **计划审查**：fable 子代理，17 条（阻断 2），全部成立，计划重写为第二稿。[报告](evidences/design-review-fable.txt)，[处理](evidences/design-review-disposition.txt)。
- **实现审查**：Sonnet 子代理（前端），9 条：阻断 0、重要 3、建议 6；8 条改，1 条审查者自己收窄。补的多语言用例查出括号仍按层数着色（独立版里那是模型的选项），已改。[报告](evidences/impl-review-sonnet.txt)，[处理](evidences/impl-review-disposition.txt)。
- **提交**（分支上）：`c919a0082` 语法变量与 Monaco 主题；`4c611eaba` 右键菜单、菜单位置、共用读剪贴板；`817dd6dfa` e2e 与查找框的修正；`aaa24dff0` 实现审查的修正。
- **Spec**：[`workbench/editor.md`](../../../../../docs/specs/workbench/editor.md) 输出 64、65，场景 40–43；[`workbench/menus.md`](../../../../../docs/specs/workbench/menus.md) 的位置表；[`theme/system.md`](../../../../../docs/specs/theme/system.md) 的语法变量，都已标为实现。
- **验证**（[`evidences/verification.txt`](evidences/verification.txt)，量色见 [`evidences/palette.txt`](evidences/palette.txt)）：Bun、nb-ui、组件测试与 typecheck 全过；e2e 合入前清单 133 例 131 过，负载降下来后重跑：`themes` 那例过；`lab-scenes` 走完全部场景，只剩主题编辑器两个场景的 404，在 master 上对照同样有，是原有问题；审查修正后相关 19 例全过，整行粘贴做过变异检查。
- **未验证**：真机的菜单键、Mac 的 Ctrl+点击、触摸长按；Safari、Firefox 的剪贴板权限。语法色截图在本地（四套主题的亮暗，TypeScript、JSON、CSS、HTML），没有做成报告产物。
- 待开发者追认的决定在 [待确认清单](../../pending-confirmations.md)（t05 五行）。

## 下一步

完成。合入后在合并结果上补跑：nb-ui 组件与主题测试 523 例、typecheck、编辑器 Bun 测试 215 例、自动保存与源码右键的 e2e 22 例全过；`test:affected` 在负载 30 上下被 nb-story 命令行子进程用例的超时截停，同一文件在 master 上对照同样失败，分支没有改 nb-story。worktree `.worktree/w00025-editor` 与分支 `feat/w00025-editor` 已删。
