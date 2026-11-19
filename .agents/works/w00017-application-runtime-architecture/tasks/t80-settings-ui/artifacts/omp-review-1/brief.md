# t80 设置界面：实现审查

你是 NeuroBook 仓库的代码审查者。请审查 t80 Task（设置界面与贡献点）的实现，找出真实的缺陷。**只审查、不改代码**：不改仓库里任何文件，不 commit、push、stash、切分支。

## 位置

- 审查用的 checkout：`/home/<user>/CodeRepository/neuro-book/.worktree/w00017-t80-review`（固定在提交 `28d4e3de`，依赖已装好）。只在这里读代码、跑测试。
- 审查范围：`git diff a64f9d9b 28d4e3de`（t80 分支相对主线的全部改动；中间的 merge 提交 `850f0871` 带进来的是主线自己的改动，不在范围内）。
- 报告文件：`/tmp/claude-1000/-home-<user>-CodeRepository-neuro-book/d02974de-3474-4f89-a563-45b5c8d8b06d/scratchpad/t80-review/report.md`。

## 报告的写法（重要）

- **只追加，不覆盖**：每核实一条，就立刻用追加的方式（例如 `cat >> report.md <<'EOF'`）写入这一条，不要重写整个文件，不要先攒着最后一次写。中途被截停时，已写的条目要能留下。
- 每条的格式：

  ```
  ## C<编号> <一句话标题>
  - 严重度：阻断 / 重要 / 建议
  - 位置：<文件>:<行>
  - 依据：违反了哪条合同（Spec 文件与输出、验收编号），或者哪条仓库规则
  - 复现或证据：怎么触发、你实际跑出的结果（命令与输出摘要）；只能从代码推断的写明“从代码推断”
  - 建议的修法：一两句
  ```
- 全部审完后，在文件末尾追加一节“总结”：条目总数（各严重度几条）、你跑过的命令与结果、没有覆盖到的范围。追加之前用 `grep -c '^## C' report.md` 核对条目数与总结一致。
- 每条都要先核实再写：读调用方、读测试、能跑就跑；结论依赖运行时行为时，在真实运行时复现（测试、Lab 或 e2e），不要靠直接调内部函数或伪造运行时不会出现的时序得出结论。核实后不成立的不写。

## 依据

- 行为合同：`docs/specs/settings/configuration.md`（尤其输出 1、11、19、21、23）、`docs/specs/settings/settings-window.md`（整份，status planned）、`docs/specs/ui/workbench-shell.md`（输出 15、40、41 与相关验收）、`docs/specs/workbench/bookshelf.md`（输出 1、12、18）、`docs/specs/workbench/commands.md`（`nbook.settings.open`）。
- 计划与决定：`.agents/works/w00017-application-runtime-architecture/tasks/t80-settings-ui/plan.md` 与同目录 `README.md` 的“设计决定”。
- 仓库规则：根 `AGENTS.md`、`packages/neuro-book/AGENTS.md`、`docs/standards/code/README.md` 及其列出的规范、`docs/testing/README.md`（测试写法：测行为不测实现、依赖用真的、不用假计时器与固定等待）、`docs/standards/code/components.md`（组件与同名 `.md`）。

## 重点看

1. **合同符合**：代码是否做到 Spec 写的每条输出；Spec 是否如实描述代码（写了却没做，或做了却没写）。
2. **授权与写入路径**：用户编辑 `edit`、`unset` 是否只接受 `nbook.settings` 自己且没有经过代理的请求；浏览器一侧的先行核对与拥有者一侧的核对是否一致；写入结果、`unknown-outcome`、层快照的应用顺序。
3. **贡献点的生命周期**：`settings.sections`、`workbench.activitybar-items`、`workbench.overlays` 的登记、交付、撤回、入口停止、加载失败、重复 id；撤回后是否还会用到旧实现；页面卸载与缓存。
4. **设置窗口的状态**：两个标签、已修改与恢复默认、本作品覆盖提示、层 `invalid`／`unavailable`、写入失败回到实际值、窗口尺寸记录、`open` 命令的参数与失败、公开状态 `windowOpen`。
5. **界面**：控件只用 nb-ui、样式只用 token；组件同名 `.md` 与实现一致；键盘与焦点（Esc、焦点回到打开前、左栏上下键、目录选择器叠在设置窗口上时的焦点）。
6. **测试质量**：测试是否测行为、是否用真实依赖、有没有固定等待或假计时器；关键行为有没有测试会在实现退回时失败。
7. **任务之外的不变量**：初始化与停止顺序、跨插件只经 `shared/contracts` 与 `src/ui/` 引用、资源释放、没有删掉范围外的代码。

## 已知、不必再报

- 用户层文件路径不发给浏览器（`runtime/projects.md` 的路径可见性），这是有意的取舍。
- 设置窗口组件加载失败时 `windowOpen` 仍为真（Spec 已如实写明，概率低）。
- `runItem` 按条目 id 在状态栏、标题栏、活动栏三处一起找，沿用既有写法。
- 作品分区未设置时的文案“第一次新建作品时会记下”与书架行为不一致，开发者正在决定。
- nb-ui 的 `SegmentedControl` 截断与 `text-[var(--text-*)]` 字号缺陷归另一个 Task（t81）。

## 可以运行的

在 `packages/neuro-book` 里：`bun run test:bun`、`bun run test:vitest`、`bun run typecheck`；e2e 前先 `bun run build && bun run build:e2e`，再 `bunx playwright test -c e2e/playwright.config.ts "e2e/settings\.e2e\.ts"` 之类（过滤词要写成转义后的文件名）。另一个进程可能同时在跑浏览器测试，偶发超时重跑一次。不要起长驻的开发服务；确需起时记下 PID，结束前用它停掉。
