# 任务：只读实现审查 w00017 t82（面板的拖动手势）

你在 worktree `/tmp/claude-1000/-home-<user>-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/review-t82/wt`（detached）。这是 NeuroBook v2 新应用（`packages/neuro-book`，前端 Vue，后端 Bun，插件化工作台）与共享组件库（`packages/nb-ui`）；旧应用 `packages/neuro-book-legacy` 只作参照。各级 `node_modules` 是指向另一个 worktree 的符号链接，可以在 `packages/neuro-book` 下运行 `bun test ./<文件>`（路径带 `./`）与 `bun run typecheck`，在 `packages/nb-ui` 下运行 `bunx vitest run <文件>` 与 `bun run typecheck`。

审查对象：`f0ae4278a..HEAD` 的五个提交（`git log --oneline f0ae4278a..HEAD`）。**先读完整的 diff**（`git diff f0ae4278a..HEAD -- <路径>`），再做系统性审查。

**不要开子审查（子代理）**：自己按顺序读、核实，每核实一条就追加到报告。开了子审查，主会话会一直等，到运行时间上限时报告只写一半。

开发者的要求：**假定作者过于自信**。全面找代码缺陷与设计缺陷：正确性与不变量、竞态与时序、违反现有合同（Spec、组件同名 `.md`、UI 开发规范、`src/architecture.test.ts` 的依赖方向）、测试没有真正守住的行为、可简化之处。不要复述实现，不要给总体评价。过度防御的意见（收益小、收益与实现成本不对等、几乎不可能发生）不要写。候选问题先对照 base（`f0ae4278a`）的实现，base 上就有的问题另记，不算本次回归。

## 依据

- 计划：`/tmp/claude-1000/-home-<user>-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/review-t82/plan.md`（最新版；worktree 里的那份是旧版）。开发者 2026-10-13 已确认：去掉面板高与宽的固定 600 上限、凡是能最大化的位置都适用、阈值 24px，这三点不必再议。
- Spec：`docs/specs/ui/workbench-shell.md` 外壳一输出 3、4、5、7、8、10，验收 3、4、5、6；`docs/specs/ui/nested-grid.md`。
- 组件文档：`packages/neuro-book/src/plugins/workbench/web/components/WorkbenchShellLayout.md`；nb-ui `packages/nb-ui/src/components/layout/grid.md`、`Splitter.md`、`GridRenderer.md`。
- 测试规范：`docs/testing/README.md`。

## 重点

1. nb-ui：`toggleable` 在类型、规范化、网格与独立 Splitter 两处挑选显式切换对象时是否一致；有没有别的显式切换路径（Home/End、按钮、`setCollapsed`）漏了它；余量叶带收起意图时的分配与补偿是否守恒。
2. `shell/layout.ts`：编辑器收起意图写在哪些组合上（四种位置 × 四种对齐、隐藏、拖到零、紧凑、收起为标题头）；最大化时边界保留 1px 后对卡片边、焦点、停放、键盘（Enter、方向键、Home/End）的影响；面板与编辑器两侧都可收起时一次拖动里的状态转换；内容节点的最小尺寸（`minimumMain`）对高度降级、偏好压缩、紧凑呈现的影响；`shellPatch` 对最大化与面板尺寸的处理（拖成最大化不写尺寸、拖回写尺寸、同一场手势里来回跨阈值）。
3. `state/layout-store.ts`：补丁里的 `panelMaximized` 与“最大化/还原面板”命令、换位置等清除路径、紧凑呈现的关系；有没有在不可最大化时被置为 true 的路径。
4. `WorkbenchShellLayout.vue`：手势预览期间的停放与搬回（`previewShown`）、结束与取消的清理、与落账后投影更新的先后、焦点与 Teleport 记忆；被拒绝的提交（`acceptGesture` 返回失败）时会不会留下错误状态。
5. 测试：有没有 mock、spy、假计时器或固定等待；新断言是否真的守住 Spec 的验收；e2e 的数值是否依赖了不稳的几何。

## 规则

- 只读：不修改 worktree 里任何被跟踪的文件，不 commit、push、stash、切换分支，不删除文件。实验文件只放在 `/tmp/claude-1000/-home-<user>-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/review-t82/`。
- 可以跑 `bun test ./<文件>`、`bun run typecheck`、nb-ui 的 `bunx vitest run <文件>`；要跑 vitest 时如需配置，写到 `/tmp/claude-1000/-home-<user>-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/review-t82/`，`cacheDir` 指向那里。不要跑 e2e、开发服务、构建与 `bun install`。需要真实浏览器才能确认的，写清楚如何核实，标“未在浏览器中复现”。
- 报告文件**只追加**：每核实一条就用追加方式写入（例如 `cat >> report.md`），不要整文件重写，不要等到最后。结束前用 `grep -c '^### C' report.md` 自查条数与正文一致。
- 用中文写。

## 报告

写到 `/tmp/claude-1000/-home-<user>-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/review-t82/report.md`。

每条问题用三级标题 `### C<编号> <一句话>`，按发现顺序编号。每条写：**严重程度**（阻断、重要、建议）、**类别**、**位置**（文件:行）、**现象**、**为什么是问题**、**如何核实**（命令或实验，以及你是否已经跑过、结果）、**建议改法**。最后追加一节“各级数量”。
