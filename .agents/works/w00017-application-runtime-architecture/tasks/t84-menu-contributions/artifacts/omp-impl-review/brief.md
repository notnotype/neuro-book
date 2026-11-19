# 任务：只读实现审查 w00017 t84（菜单贡献点）

你在 `/tmp/claude-1000/-home-<user>-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/review-t84-impl/wt`（detached，提交 `734e3a5cb`）。这是 NeuroBook v2 新应用（`packages/neuro-book`：前端 Vue，后端 Bun，插件化工作台，内核在 `packages/nb-runtime`）与共享组件库（`packages/nb-ui`）；旧应用 `packages/neuro-book-legacy` 只作参照。各级 `node_modules` 是指向另一个 worktree 的符号链接，可以在 `packages/neuro-book` 下运行 `bun test ./<文件>`（路径带 `./`）、`bun x vitest run <文件>` 与 `bun run typecheck`，在 `packages/nb-ui` 下运行 `bun x vitest run <文件>`。

审查对象：`01722510f..HEAD` 的提交（`git log --oneline 01722510f..HEAD`：S0 Spec、S1 共同合同、按计划审查修订 Spec、S2 标题栏菜单、S3 视图标题、S4 资源管理器右键、S5 编辑区标题；其中 `0e4728679` 只含组件改名，它的其余改动在下一个提交 `734e3a5cb`）。**先读完整的 diff**（`git diff 01722510f..HEAD -- <路径>`），再做系统性审查。

**不要开子审查（子代理）**：自己按顺序读、核实，每核实一条就追加到报告。开了子审查，主会话会一直等，到运行时间上限时报告只写一半。

开发者的要求：**假定作者过于自信**。全面找代码缺陷与设计缺陷：正确性与不变量、竞态与时序（入口停止、命令撤回、菜单打开期间状态变化）、违反现有合同（Spec、组件同名 `.md`、UI 开发规范 `packages/nb-ui/docs/ui-development-spec.md`、`src/architecture.test.ts` 的依赖方向）、测试没有真正守住的行为、可简化之处。不要复述实现，不要给总体评价。过度防御的意见（收益小、收益与实现成本不对等、几乎不可能发生）不要写。候选问题先对照 base（`01722510f`）的实现，base 上就有的问题另记，不算本次回归。

## 依据

- 设计与计划：同目录上一级的 `../design.md`、`../plan.md`（末节“实施中的修订”以它为准）与计划审查的报告 `../plan-review-report.md`。已由开发者确认、不必再议：第一版四处菜单位置；编辑器标签右键与正文右键、子菜单、按住 Alt 换命令、Markdown 预览本身不在本次范围；资源管理器现有右键项不改成贡献；去掉“退出”；编辑区标题只画在活动组。
- Spec：`docs/specs/workbench/menus.md`（新）、`docs/specs/ui/workbench-shell.md` 外壳四输出 29、`docs/specs/workbench/views.md` 输出 10、11 与验收 8、`docs/specs/workbench/files-explorer.md` 的“右键菜单”与验收 20、`docs/specs/workbench/editor.md` 输出 34 与验收 21、`docs/specs/runtime/plugins.md`（贡献点、`implementation`、声明查询）。
- 组件文档：`packages/neuro-book/src/ui/menus/TitleActions.md`、工作台 `WorkbenchShell.md`、`WorkbenchTitleBar.md`，资源管理器 `FilesExplorerView.md`，编辑器 `EditorGroup.md`、`EditorArea.md`，nb-ui `ContextMenu.md`。
- 测试规范：`docs/testing/README.md`。

## 重点

1. 共同合同（`packages/neuro-book/src/plugins/commands/shared/menus.ts`）：`MenuItemRegistry` 的交付与撤回、入口开始停止时 `published` 先失效的依赖；`arrangeMenu` 的显示、可用、排序、分隔与 `extensions`、`contexts` 判定是否与 `menus.md` 一致；校验是否漏了规则表里的条目。
2. 标题栏菜单（`workbench/web/titlebar/`、各插件的菜单项）：搬迁后的四个菜单与搬迁前是否逐项一致（含勾选键、固定参数、收拢后的 ≡）；`withNativeEditing` 是否还认得撤销与重做；命令目录变化时菜单是否重算。
3. 视图标题（`titlebar-source.ts` 的 `viewActions`、`runViewAction`，`WorkbenchShell.vue`，`ui/menus/TitleActions.vue`、`title-actions.ts`）：按 key 执行在 `when`、预算分流、贡献项撤回之后是否仍找对动作；“⋯”的菜单身份与“移动到”是否一致、迟到的选择是否被丢弃；单视图上提到容器标题行与面板标签带两处接线。
4. 资源管理器右键（`explorer/web/view-host.ts`、`menu.ts`、`FilesExplorerView.vue`）：被右键的选择的快照时机、多选与文件夹、根行；固定项的 key 改名有没有破坏现有接线；nb-ui `ContextMenuItem` 新增的 `type`、`checked`。
5. 编辑区标题（`editor/web/title-actions.ts`、`EditorGroup.vue`、`EditorArea.vue`、`plugin.ts`）：只画在活动组、活动标签是页面或空组时的行为、执行前交出未提交输入、菜单身份、窄屏下标签条与按钮的布局。
6. 测试插件与 e2e（`src/web/testing/test-menus.ts`、`e2e/*.e2e.ts` 新增的 describe）：有没有 mock、spy、假计时器或固定等待；新断言是否真的守住 Spec 的验收；数值是否依赖不稳的几何或时序。

## 规则

- 只读：不修改检出里任何被跟踪的文件，不 commit、push、stash、切换分支，不删除文件。实验文件只放在 `/tmp/claude-1000/-home-<user>-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/review-t84-impl/`。
- 可以跑 `bun test ./<文件>`、`bun x vitest run <文件>`、`bun run typecheck`；要跑 vitest 时如需配置，写到上面的目录，`cacheDir` 指向那里。不要跑 e2e、开发服务、构建与 `bun install`。需要真实浏览器才能确认的，写清楚如何核实，标“未在浏览器中复现”。
- 报告文件**只追加**：每核实一条就用追加方式写入（例如 `cat >> report.md <<'EOF'`），不要整文件重写，不要等到最后。结束前用 `grep -c '^### C' report.md` 自查条数与正文一致。
- 用中文写。

## 报告

写到 `/tmp/claude-1000/-home-<user>-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/review-t84-impl/report.md`。

每条问题用三级标题 `### C<编号> <一句话>`，按发现顺序编号。每条写：**严重程度**（阻断、重要、建议）、**类别**、**位置**（文件:行）、**现象**、**为什么是问题**、**如何核实**（命令或实验，以及你是否已经跑过、结果）、**建议改法**。最后追加一节“各级数量”。
