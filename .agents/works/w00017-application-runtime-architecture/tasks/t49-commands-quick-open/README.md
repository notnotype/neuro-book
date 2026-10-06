---
schema: nbook.task/v2
taskId: t49-commands-quick-open
---

# NeuroBook v2 第 4 步（二）：命令系统与快速打开

## 目标与范围

按 [NeuroBook v2：并排重建应用](../../../../../docs/proposals/neuro-book-v2-rebuild.md) 第 6 节第 4 步，把命令系统、命令面板与 Lab 命令场景迁入新应用。主 Agent 编码，omp（默认模型）审查。

行为合同：
- [`workbench.commands`](../../../../../docs/specs/workbench/commands.md)：场景 1–10，以及本 Task 新增的 11–13；
- [`workbench.quick-open`](../../../../../docs/specs/workbench/quick-open.md)：场景 1–7；
- [`ui.component-lab`](../../../../../docs/specs/ui/component-lab.md)：场景 16。

旧实现只作参照：`packages/neuro-book-legacy/app/utils/workbench/{context-keys,commands,keymap,command-query,editor-commands}.ts`、`app/composables/useWorkbenchCommands.ts`、`app/components/workbench/WorkbenchCommandPalette.vue`、`app/component-lab/fixtures/{lab-command-scene.ts,LabCommandInspector.vue,LabCommandSceneLayer.vue}`。

**开发者决定**（2026-10-06，计划随之审批）

1. **命令系统是内置插件 `nbook.commands`，不进内核。**
   - 它与运行位置无关，服务端和浏览器各有入口，以后加终端界面（TUI）入口。
   - 命令系统的一个用途是让用户与 Agent 不经界面操作软件。用 TUI 打开时 workbench 不激活，TUI 登记的命令照常可用。
2. **内核不提供 `ctx.commands`。**
   - 命令经 `nbook.commands` 的贡献点登记，经它导出的命令服务执行。
   - 协作机制只剩贡献点与导出 API 两种，命令建在这两者之上。
   - [ADR 0022](../../../../../docs/adr/0022-extensible-platform-and-plugin-trust.md) 决策 2、[平台设计](../../../../../docs/proposals/extensible-application-platform.md) P3 与 P7 同步修订。
3. **激活事件由拥有者插件定义。**
   - 内核只认 `onStartup`，其它前缀由拥有者声明，新增激活方式不改内核（`runtime.plugin-manifest`）。
   - 本 Task 只写 Spec，第一个需要懒激活的消费者出现时再实现。
4. **workbench 按真实消费者逐个加贡献点**，不一次做全。
   - 外壳的抽象（区域、图标栏、切换器、视图容器、视图）在 t50 之前单独设计一轮，交开发者审批。
5. **编辑器样板用 textarea 实现的最小编辑器**；Monaco 随第 5 步的编辑器迁入。
6. **命令标题用中英文本**：声明里直接写 `{zh-CN, en-US}`，设置插件加入前界面固定用简体中文；不引入 vue-i18n。

**不在本 Task**：
- 内核激活事件的实现；
- 跨运行位置执行命令；
- 上下文键与别名的贡献点、确认框的产品接入（都还没有产品消费者）；
- Monaco、vue-i18n；
- 第二批 `nbook.view.*` 命令（随 t50）；
- 文件快速打开。

## 当前状态

2026-10-06 完成：主 Agent 编码，omp 审查后按意见修正。

提交：
- `0012c5fd`：文档决定；
- `e00925da`：命令模型；
- `63f34ae8`：插件与装配；
- `fdfaaeac`：面板、键位与 Lab 命令场景；
- `b59c27de`：浏览器验收；
- `e48bfe9f`：Spec 与证据；
- 审查修正随本 Task 收口提交。

**实际改动（`packages/neuro-book`，另有文档）：**

- **文档决定**：
  - ADR 0022 决策 2：协作机制只剩贡献点与导出 API，命令建在其上；
  - 平台设计 P1、P3、P7、P11，推进表与决策记录；
  - `runtime.plugin-api`：删去 `ctx.commands` 与 `command-not-found`；
  - `runtime.plugin-manifest`：激活事件改由拥有者声明前缀，新增 `activationEventPrefixes` 与场景 16，实现推迟。
- **命令模型** `src/plugins/commands/shared/`：
  - 命令表 `registry.ts`、上下文键 `context-keys.ts`、合同 `contracts.ts`（贡献点 `commands.definitions`、声明的 TypeBox schema、`commandServiceKey`）；
  - 中英文本 `src/shared/localized-text.ts`。
- **插件** `createCommandsPlugin(location)`：
  - 两个运行位置共用，接收者在提交时登记、撤回时释放，执行异常记入诊断；
  - 进入产品清单与两侧装配，窗口必需插件加上 `nbook.commands`。
- **workbench**：
  - 只作消费者：`commands/` 下有检索、键位分发、面板宿主、面板文案、面板入口命令与槽位；组件 `WorkbenchCommandPalette`；
  - `/` 页挂异步加载的 `WorkbenchCommandHost`；
  - 命令服务键由宿主装配时交进来。
- **Lab 命令场景** `fixtures/command-scene/`：局部宿主、textarea 样板编辑器、四条编辑器命令、命令检视与确认框；`WorkbenchCommandPalette` 的场景。
- **依赖方向守卫**：Lab 场景可以在运行时引用其它插件的 `web/` 与 `shared/`。
- **后端 tsc 的 `.vue` 类型垫片**（`src/types/vue-sfc.d.ts`）。
- **测试**：
  - Bun：命令表 29 例、插件经真实内核 5 例、检索与键位 20 例、编辑器命令 7 例；
  - Vitest：面板 8 例、页面宿主 1 例、Lab 场景 4 例、`/` 页的整条接线 1 例；
  - e2e：`lab-commands.e2e.ts` 11 例、`commands.e2e.ts` 1 例。
- **Spec 与文档**：`workbench.commands`（原位重写，capability id 与路径不变）、`workbench.quick-open`、`ui.component-lab`（场景 16、例外、实现合同）、`runtime.browser-host` 与 `runtime.server-host`（必需插件）、登记表三行、包 `AGENTS.md` 与 README。

**与计划的出入：**

- **工作台依赖命令服务的方式**：计划里写的是工作台直接 `requires` 命令服务的键。实际上服务键按对象身份比较，而插件之间只能 `import type`，所以改由宿主装配时交进来（`createWorkbenchBrowserPlugin({commands: commandServiceKey})`）。包 `AGENTS.md` 写明了这条约定。
- **后端 tsc 多了 `.vue` 类型垫片**：bun 测试会导入工作台插件，而它按需加载 `.vue`，后端 tsc 解析不了。垫片只在 `tsconfig.json` 里生效；两遍 vue-tsc 不包含它，组件的类型仍由 vue-tsc 精确检查。
- **产品页的执行失败只记诊断**：产品命令表现在只有面板入口这一条命令，没有需要呈现给用户的失败，所以不画 `role="alert"` 区域。Lab 命令场景保留了检视区的提示。
- **样板编辑器忽略内容没变的输入**：正文没变的 `input` 不进撤销栈。实测 Playwright 的 `fill` 会连发多次同样的正文，不忽略的话，撤销只会退回到同一段正文。
- **quick-open 场景 7 的对比度口径**：玻璃主题（nbook、macos）的面板是半透明加背景模糊，实际看到的底色取决于下层内容，算不出确定值。所以对比度按文字与面板底色这对 token 计算（不计透明度），材质另外检查：面板要么底色不透明，要么是带背景模糊的半透明。

**旧路径到新路径（以后合并 master 时对照）：**

| 旧（`packages/neuro-book-legacy/app/`） | 新（`packages/neuro-book/src/`） |
|---|---|
| `utils/workbench/{commands,context-keys}.ts` | `plugins/commands/shared/{registry,context-keys}.ts`（合同在 `contracts.ts`） |
| `utils/workbench/{keymap,command-query}.ts` | `plugins/workbench/web/commands/` 同名文件 |
| `composables/useWorkbenchCommands.ts`（面板部分） | `plugins/workbench/web/commands/palette-host.ts` |
| `components/workbench/WorkbenchCommandPalette.{vue,md}` | `plugins/workbench/web/components/` |
| `utils/workbench/editor-commands.ts`、`components/editor-workbench/editor-view.types.ts`（命令用到的部分） | `plugins/lab/web/fixtures/command-scene/{editor-commands,editor-binding}.ts`（第 5 步随编辑器插件迁走） |
| `component-lab/fixtures/{lab-command-scene.ts,LabCommandInspector.vue,LabCommandSceneLayer.vue}` | `plugins/lab/web/fixtures/command-scene/` |
| `component-lab/fixtures/{CodeEditorViewFixture,WorkbenchCommandPaletteFixture}.vue` | `plugins/lab/web/fixtures/WorkbenchCommandPaletteFixture.vue`（用 `SampleTextEditor.vue`） |
| i18n `workbenchCommands.*` | 命令声明里的中英文本；面板文案 `plugins/workbench/web/commands/palette-messages.ts` |

## 验收

1. **类型检查与单元、组件测试**（[`app-checks.txt`](evidences/app-checks.txt)）：
   - `bun run typecheck` 三遍 0 错误；
   - `bun test` 27 个文件 173 例通过；
   - Vitest 11 个文件 47 例通过。
2. **浏览器验收**（[`e2e.txt`](evidences/e2e.txt)）：`bun run test:e2e` 30 例通过。
   - 新增的 12 例覆盖：
     - `workbench.commands` 场景 10、13；
     - `workbench.quick-open` 场景 1、7（四主题 × 双配色 × 390 px）；
     - `ui.component-lab` 场景 16。
   - t47、t48 原有的 18 例保持通过。
3. **场景与覆盖方式**：
   - `workbench.commands` 场景 1–9、11、12 由命令表、插件（真实内核）、键位、编辑器命令的 Bun 测试与 Lab 场景的组件测试覆盖；
   - `workbench.quick-open` 场景 2–6 由面板的组件测试（真实 QuickInput）与检索测试覆盖。
4. **服务端 smoke**（[`smoke-server.txt`](evidences/smoke-server.txt)）：`bun run smoke:server` S1–S5 通过。
5. **治理与受影响范围**（[`affected.txt`](evidences/affected.txt)）：
   - `docs:check`、`governance:check` 失败为 0，本次改动无新警告；
   - `test:affected --typecheck` 只选中 neuro-book，全部通过。
6. **产物大小**：`build` 后与 t48 对比。
   - t48：一个 JS 块 254 KB（gzip 82.8 KB），CSS 115 KB。
   - 现在首屏的 JS 是两块，共 317 KB（gzip 106 KB），多出约 63 KB（gzip 24 KB）。
   - 命令宿主（QuickInput 等）是 50 KB 的异步块。
   - CSS 164 KB（gzip 21 KB）。
   - 增量来源：用 source map 按源文件统计生成的字节，两次构建都是 `vite build --sourcemap`，t48 在临时 worktree 里构建。
     - 多出的约 60 KB 里约 45 KB 是 Vue 运行时：runtime-core 多 26 KB，runtime-dom 多 17 KB。命令宿主虽是异步块，它用到的 Vue 功能（Teleport、过渡、指令等）进了首屏与它共用的那份 Vue。
     - 本 Task 自己的代码：命令系统 7 KB、工作台 2 KB、中英文本 2.6 KB。
     - 要压首屏，得调整分块，不在本 Task。

**omp 审查（默认模型，只读）：** 一次跑完（[`omp-review.txt`](evidences/omp-review.txt)），列 1 条阻断、3 条建议。主 Agent 逐条核实，全部成立，处理如下；改写的别名用例撤掉修复时失败：

1. 阻断“登记命令时不查别名表，命令 id 与已有别名同名也能登记，经该 id 执行的命令随登记与释放改变”：成立（旧实现同样如此）。`register` 遇到同名别名时拒绝后来者、只报告一次；别名用例补上这个方向，并断言被拒后别名仍执行原命令。`workbench.commands` 的别名定义与场景 2 写明两个方向都拒绝。
2. 建议“场景 6 把等待确认期间切到只读模式也写成 `stale-target`，实现返回 `read-only`”：成立，改 Spec 不改实现。场景 6 与“只读联动”拆开写：命令被替换返回 `stale-target`，切到 discuss/plan 返回 `read-only`。
3. 建议“激活事件写作 `<前缀>:<参数>` 并激活声明该事件的全部入口，却保留了不带参数的 `onChannel`”：成立，是本 Task 修订激活事件时留下的。改为 `onChannel:<插件 id>`，`runtime.plugin-manifest`、平台设计、`runtime.plugin-channel`、`runtime.api-docs` 同步；平台设计清单示例里的命令 id 一并改成以插件 id 开头。
4. 建议“三处测试整句比对生成的中文文案”：成立（测试规范把断言措辞列为变更探测）。改为断言失败码、原因含命令 id、只报告一次；诊断断言级别、消息含命令 id、原始异常。

修正后 `typecheck`、`bun test`（173 例）、`test:affected --typecheck`、`docs:check`、`governance:check` 通过；浏览器验收没有重跑，产品与 Lab 都不登记别名。

**未验证**：
- Windows；
- Firefox 与 Safari（键位平台判定回退 `navigator.platform`）；
- Agent 调用与跨运行位置执行命令（本 Task 没有）；
- 产品页的行号模式（随编辑器插件接入）；
- 激活事件的内核实现（只写了 Spec）。

## 下一步

[t50](../t50-workbench-shell-design/README.md) 单独设计一轮工作台外壳的抽象（区域、图标栏、切换器、视图容器、视图），交开发者审批；外壳、拖放与布局的实现由设计稿切成 t51–t53。
