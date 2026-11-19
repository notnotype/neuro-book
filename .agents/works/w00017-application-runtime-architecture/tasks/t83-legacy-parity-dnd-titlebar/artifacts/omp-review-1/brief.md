# 任务：只读实现审查 w00017 t83（拖放、分栏、标签溢出与标题栏）

你在 worktree `/tmp/claude-1000/-home-<user>-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/review-t83/wt`（detached）。这是 NeuroBook v2 新应用（`packages/neuro-book`，前端 Vue，后端 Bun，插件化工作台）与共享组件库（`packages/nb-ui`）；旧应用 `packages/neuro-book-legacy` 只作参照。各级 `node_modules` 是指向另一个 worktree 的符号链接，可以在 `packages/neuro-book` 下运行 `bun test ./<文件>`（路径带 `./`）与 `bun run typecheck`，在 `packages/nb-ui` 下运行 `bunx vitest run <文件>` 与 `bun run typecheck`。

审查对象：`f7a0ebbb3..HEAD` 的七个提交（`git log --oneline f7a0ebbb3..HEAD`，S1 到 S7）。**先读完整的 diff**（`git diff f7a0ebbb3..HEAD -- <路径>`），再做系统性审查。

**不要开子审查（子代理）**：自己按顺序读、核实，每核实一条就追加到报告。开了子审查，主会话会一直等，到运行时间上限时报告只写一半。

开发者的要求：**假定作者过于自信**。全面找代码缺陷与设计缺陷：正确性与不变量、竞态与时序、违反现有合同（Spec、组件同名 `.md`、UI 开发规范、`src/architecture.test.ts` 的依赖方向）、测试没有真正守住的行为、可简化之处。不要复述实现，不要给总体评价。过度防御的意见（收益小、收益与实现成本不对等、几乎不可能发生）不要写。候选问题先对照 base（`f7a0ebbb3`）的实现，base 上就有的问题另记，不算本次回归。

## 依据

- 计划与开发者的决定：`/tmp/claude-1000/-home-<user>-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/review-t83/plan.md` 与同目录的 `task-README.md`（“开发者的决定”“第二轮的决定”“第三轮的决定”“实施进度”里与计划不同的三处）。这些已由开发者确认，不必再议：开放式分割线与整行收起、悬停线做成主题 token 且 nbook 用“相交处连着 + 发光”、收起分栏按前后插入、预备区覆盖所有没显示的 Part、放下后的过渡、标签截断到 96px 再只留图标再收进“更多”、活动栏收进“更多”、标题栏逐级让位与 40px 回差、≡ 打开按组的子菜单。“更多”里的拖放插入不在本次范围。
- Spec：`docs/specs/ui/workbench-shell.md` 外壳二输出 15、16、25，外壳三输出 20、21、22，外壳四输出 30，工作台打磨输出 38、39，对应验收 20、25、31、35、41、42 与“实现合同”；`docs/specs/theme/system.md`。
- 组件文档（与代码同名的 `.md`）：nb-ui `Splitter`、`GridRenderer`、`DropFeedbackOverlay`、`Tabs`、`IconButton`；工作台 `WorkbenchViewSection`、`WorkbenchViewContainerHost`、`WorkbenchToolPartHost`、`WorkbenchDragFeedback`、`WorkbenchShellLayout`、`WorkbenchActivityBar`、`WorkbenchTitleBar`。UI 规范 `packages/nb-ui/docs/ui-development-spec.md`。
- 测试规范：`docs/testing/README.md`。
- 已知的、与本次无关的失败：`settings/commands.test.ts` 的“项目层覆盖着主题时……”一例在 base 上同样失败。nb-ui 的标签字号写成 `text-[var(--text-xs)]` 被编译成颜色（另一个 Task 修），不算本次问题。

## 重点

1. 悬停线（`Splitter.vue` 的 `writeLineCore` 与 `sashLineEnds`、`GridBranchRenderer.vue` 的 `childEdges`）：两端是否连着的判断在各种树形（多层嵌套、0px 边界、被隐藏的分支、紧凑呈现）下是否正确；线芯对齐接缝在收起边界、缩放容器、dpr 非整数时会不会越出装饰带或摊成两条线；`getComputedStyle` 读 token 的时机与成本。
2. 拖放判定（`views/drop.ts`、`drop-dom.ts`、`drag-session.ts`）：收起分栏的插入位与“挨着展开分栏时平分”在同容器、跨容器、整容器并入、隐藏成员、全部收起各种组合下的意图是否正确、预览与提交是否一致（`isSameDropAction` 含 `reveal`）；预备区的命中优先级（真实落点、工具区、预备区）、键盘区域顺序与停靠点；预备区矩形（`shell/reveal.ts`）与外壳实际显示后的位置是否一致。
3. 写入（`state/layout-store.ts` 的 `applyView`）：`reveal` 与“放进收起的面板同次展开”和意图补丁是否同一次写入、冲突重放时会不会丢；无变化的意图带 `reveal` 时的行为；`arrivalPartOf` 的边界。
4. 收尾（`WorkbenchShell.vue` 的 `startSettle`、nb-ui `DropFeedbackOverlay` 的 `settling`）：跟量的终止条件、新拖动开始与组件卸载时的清理、减少动效与没有区域时的结束、`animationend` 的识别；会不会留下一层不消失的覆盖层。
5. 宽度适配（nb-ui `Tabs.vue`、`tabs-adapt.ts`，`WorkbenchActivityBar.vue`，`WorkbenchTitleBar.vue`、`titlebar/yield.ts`）：测量层的宽度与真实元素是否对得上（类名、内边距、字体、计数徽标、`inert`/`aria-hidden` 是否完整隔离焦点与读屏）、ResizeObserver 的观察与断开、回差、选中项永远可见、键盘焦点；`attrs` 在两种模式下落点的变化是否破坏现有消费方；标题栏的档位与 Spec 输出 30 的顺序是否一致、`SEARCH_COMFORT` 的取舍是否站得住。
6. 测试：有没有 mock、spy、假计时器或固定等待；新断言是否真的守住 Spec 的验收；e2e 的数值是否依赖不稳的几何或时序。

## 规则

- 只读：不修改 worktree 里任何被跟踪的文件，不 commit、push、stash、切换分支，不删除文件。实验文件只放在 `/tmp/claude-1000/-home-<user>-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/review-t83/`。
- 可以跑 `bun test ./<文件>`、`bun run typecheck`、nb-ui 的 `bunx vitest run <文件>`；要跑 vitest 时如需配置，写到 `/tmp/claude-1000/-home-<user>-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/review-t83/`，`cacheDir` 指向那里。不要跑 e2e、开发服务、构建与 `bun install`。需要真实浏览器才能确认的，写清楚如何核实，标“未在浏览器中复现”。
- 报告文件**只追加**：每核实一条就用追加方式写入（例如 `cat >> report.md`），不要整文件重写，不要等到最后。结束前用 `grep -c '^### C' report.md` 自查条数与正文一致。
- 用中文写。

## 报告

写到 `/tmp/claude-1000/-home-<user>-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/review-t83/report.md`。

每条问题用三级标题 `### C<编号> <一句话>`，按发现顺序编号。每条写：**严重程度**（阻断、重要、建议）、**类别**、**位置**（文件:行）、**现象**、**为什么是问题**、**如何核实**（命令或实验，以及你是否已经跑过、结果）、**建议改法**。最后追加一节“各级数量”。
