# 任务：只读审查 w00017 t84 的设计稿与实施计划（菜单贡献点）

你在 `/tmp/claude-1000/-home-<user>-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/review-t84-plan/wt`（detached，实现开始前的代码，分支 `refactor/w00017-runtime-foundation` 的 `01722510f`）。这是 NeuroBook v2 新应用（`packages/neuro-book`：前端 Vue，后端 Bun，插件化工作台，内核在 `packages/nb-runtime`）与共享组件库（`packages/nb-ui`）；旧应用 `packages/neuro-book-legacy` 只作参照。

审查对象是同目录上一级的三份文件：

- `../design.md`：调研（旧应用与新应用的菜单各从哪里来）与推荐设计，末节是开发者的决定；
- `../plan.md`：实施计划（关键设计、Spec 改动、切片、验收映射）；
- `../task-README.md`：Task 记录。

这次只审设计与计划，不审实现（实现在别处并行进行，另有审查）。**不要运行测试、typecheck、构建或开发服务**：这个检出的 `node_modules` 链到正在编码的 worktree，跑出来的结果不代表这份代码。读代码用 `rg`、`git grep`、`sed`。

**不要开子审查（子代理）**：自己按顺序读、核实，每核实一条就追加到报告。开了子审查，主会话会一直等，到运行时间上限时报告只写一半。

开发者的要求：**假定作者过于自信**。找设计与计划里的缺陷：与现有合同冲突（Spec、已接受的提案与 ADR、组件同名 `.md`、内核的贡献点语义）、漏掉的情况与位置、站不住的取舍、会让实现走弯路或返工的地方、验收映射没覆盖的行为、可以更简单的做法。每条都要对照代码或文档核实，写出依据的文件与行。不要复述计划，不要给总体评价。过度防御的意见（收益小、收益与成本不对等、几乎不可能发生）不要写。

## 已定、不必再议

开发者 2026-10-13 确认：第一版做四处菜单位置（标题栏菜单、视图标题含“⋯”、资源管理器右键、编辑区标题含按后缀的局部条件）；编辑器标签右键与正文右键、Markdown 预览本身、子菜单、按住 Alt 换命令不在本次范围。计划里“与设计稿不同”的三处（资源管理器现有右键项不改成贡献、去掉“退出”、点非活动编辑组的标题按钮先激活该组）开发者已知悉。

## 依据

- 平台设计稿 `docs/proposals/extensible-application-platform.md`（accepted），尤其“菜单位置由拥有者定义……上下文键分全局键与局部键……`when` 由 workbench 求值”一段（约第 332 行）与插件清单的 `menus` 示例（约第 154 行）。
- 内核贡献点：`packages/nb-runtime/src/plugins/contracts.ts`（`implementation: "required" | "none"`、顶层与入口贡献）、`docs/specs/runtime/plugins.md` 输出 15 与验收 16、17、26（`pending`/`unknown-point`、声明查询）、`docs/specs/runtime/plugin-manifest.md`、`docs/specs/runtime/plugin-hot-plug.md`。
- 命令与可用性：`docs/specs/workbench/commands.md`，`packages/neuro-book/src/plugins/commands/shared/`（`contracts.ts`、`context-keys.ts`、`keybinding.ts`）。
- 现有菜单与动作：`packages/neuro-book/src/plugins/workbench/web/titlebar/menu-model.ts`、`titlebar-source.ts`、`components/WorkbenchTitleBar.vue`（含收拢后的 ≡ 子菜单）、`shared/views.ts` 的 `ViewAction`、`components/WorkbenchViewActions.vue`；`docs/specs/ui/workbench-shell.md` 外壳四输出 28–31 与验收 32–37、`docs/specs/workbench/views.md` 输出 10。
- 资源管理器：`packages/neuro-book/src/plugins/explorer/web/menu.ts`、`view-host.ts`、`commands.ts`、`components/FilesExplorerView.vue`；`docs/specs/workbench/files-explorer.md`（右键、选择与粘贴目标、命令一节）。
- 编辑器：`packages/neuro-book/src/plugins/editor/web/`（`commands.ts`、`components/EditorGroup.vue`、`EditorTabBar.vue`、`EditorArea.vue`）；`docs/specs/workbench/editor.md`。
- 测试插件：`packages/neuro-book/src/web/testing/`（`sample-views.ts` 等）与 `NBOOK_TEST_PLUGINS` 的装载。
- 测试规范 `docs/testing/README.md`；Spec 写法 `docs/specs/AGENTS.md`、`docs/specs/README.md`。

## 重点

1. 共同合同：一个形状加各位置的扩展字段，能不能装下四处；`section` 用名字排序、`order`、`label`、`toggled`、`when` 的语义与现有条目贡献点、视图动作是否一致；`args: "<名字>"` 的做法与命令参数校验（命令的 `args` schema 不接受时会怎样）；`extensions` 的判定（多选、文件夹、多段后缀、大小写）与平台设计稿“局部键”的关系，是否会和以后的 `when` 局部键冲突。
2. 贡献方式：菜单项写成插件描述顶层的 `implementation: "none"` 贡献——描述在多个运行位置共用，其它位置的 `pending`/`unknown-point` 有没有副作用；“贡献方入口没激活时命令不在目录里所以不显示”是否在所有情况下成立（例如命令由别的插件提供、命令已登记但入口停止）；拥有者在激活时读 `declarations.list` 之后登记的插件看不到——在产品的启动顺序里会不会发生。
3. 标题栏条目搬迁：计划列的归属是否与命令实际由谁提供一致；节名与顺序能否还原现有四个菜单（含收拢后的 ≡ 子菜单、Lab 场景里写死的菜单数据）；有没有别处也读 `menu-model.ts` 的定义；去掉“退出”与 `desktopOnly` 有没有遗漏的使用者。
4. 视图标题：`placement` 与 `VIEW_ACTIONS_MAX`、single 时上提到容器标题行的规则（views.md 输出 10）、“移动到”的位置如何共处；`workbench.view-title` 给不存在或未加载的视图贡献时的行为；`args: "instance"` 在别的插件贡献的项上是否说得通。
5. 资源管理器与编辑区：贡献项收到的地址与 Files 的选择、粘贴目标规则（files-explorer.md）是否一致；编辑区“先激活该组再执行”与编辑器命令的实际行为（是否都作用于活动组、是否有命令带组参数）；标签条右侧占宽与现有的横向滚动、390px 窄屏。
6. Spec 改动表：新 Spec 与四份已有 Spec 的分工是否会出现两处写同一规则；有没有漏改的文档（例如提到 `explorer/context` 或标题栏菜单的其它 Spec、组件 `.md`）。
7. 切片与验收映射：顺序能否每片单独通过；有没有行为没有对应的测试；e2e 与组件测试的分工是否合理。

## 规则

- 只读：不修改检出里任何文件，不 commit、push、stash、切分支，不删除文件。实验文件只放在 `/tmp/claude-1000/-home-<user>-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/review-t84-plan/`。
- 报告文件**只追加**：每核实一条就用追加方式写入（例如 `cat >> report.md <<'EOF'`），不要整文件重写，不要等到最后。结束前用 `grep -c '^### P' report.md` 自查条数与正文一致。
- 用中文写。

## 报告

写到 `/tmp/claude-1000/-home-<user>-CodeRepository-neuro-book/c38df555-3a36-49c9-bf4f-4027b5da6d32/scratchpad/review-t84-plan/report.md`。

每条问题用三级标题 `### P<编号> <一句话>`，按发现顺序编号。每条写：**严重程度**（阻断、重要、建议）、**类别**、**依据**（文件:行）、**问题**、**为什么是问题**、**建议改法**。最后追加一节“各级数量”。
