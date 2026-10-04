---
schema: nbook.task/v2
taskId: t48-web-ui-foundation-lab
---

# NeuroBook v2 第 4 步（一）：前端基础与 Lab 插件

## 目标与范围

按 [NeuroBook v2：并排重建应用](../../../../../docs/proposals/neuro-book-v2-rebuild.md) 方案第 2、4、6 节，为第 4 步“workbench 底座”打基础：引入 vue-router、UnoCSS、`@notnotype/nb-ui` 与 Vue 组件测试，把 Component Lab 做成只在开发模式加载的内置插件。开发者 2026-10-04 决定：第 4 步拆三个 Task，Lab 先行（本 Task；t49 命令与快速打开；t50 工作台外壳、拖放与布局）；组件测试用 Vitest + happy-dom，纯 TS 模型与后端仍用 `bun test`。主 Agent 编码，omp（默认模型）审查。

行为合同：[`ui.component-lab`](../../../../../docs/specs/ui/component-lab.md)（场景 1–15、17；场景 16 随 t49）、[`runtime.browser-host`](../../../../../docs/specs/runtime/browser-host.md)（挂载流程与页面表）、[`runtime.server-host`](../../../../../docs/specs/runtime/server-host.md)（开发入口）。旧实现 `packages/neuro-book-legacy/app/component-lab/`、`app/components/common/`、`uno.config.ts` 只作参照。

**做什么**

- **测试基建**：Vitest + happy-dom + `@vue/test-utils` 跑 `*.dom.test.ts`；类型检查分三遍；测试写法机检增加假计时器与全局替换；`test:affected` 能逐步运行串联的测试脚本。
- **样式与共享组件**：UnoCSS、nb-ui 样式与 Lab 主题；共享前端组件放 `src/ui/`。
- **页面**：vue-router 归 Web 宿主，`nbook.workbench` 定义页面贡献点 `workbench.pages`。
- **Lab 插件**：开发清单与开发入口，生产产物机检不含 Lab；迁 Lab 外壳、零件、JsonViewer 与两个透传夹具样例；`lab:shot`。

**实现决定**（计划随开发者 2026-10-04 审批）

1. **Lab 的启动语义**：v2 的 `/lab` 也建立窗口运行实例，引导请求是它唯一的 `/api/` 请求；不再有登录探测与旧桶迁移；加载鉴权插件后 Lab 同样受鉴权约束。
2. **验收口径按场景计**：`ui.component-lab` 场景 1–15、17 在新应用上通过，不按旧证据的组件与场景数量计。
3. **共享前端组件放 `src/ui/`**：宿主与插件都能引用；与 nb-ui 重复的 15 个旧 common 组件不迁，改用 nb-ui。
4. **生产访问 `/lab`**：服务端回退给外壳（200），前端显示“页面不存在”。
5. **依赖约定**：`dependencies` 只放后端进程导入的包（开发监督进程按其中的 workspace 包决定监视目录）；只进前端构建的包放 `devDependencies`，vue 随之移过去。两份产物都由打包器打包，不影响运行。
6. **组件测试命名 `*.dom.test.ts`**：包内 `bunfig.toml` 让 `bun test` 跳过它们，`test` 依次运行 `bun test` 与 `vitest run`。类型检查三遍：后端 tsc；前端 vue-tsc；组件测试与 e2e 的 vue-tsc（t47 的 e2e 此前不在任何类型检查里，一并补上）。

**不在本 Task**：命令、快速打开与 Lab 场景 16（t49）；工作台外壳、拖放、布局持久化与产品主题（t50）；workbench、agent、editor、novel-ide 域的 fixture；vue-i18n；Lab 时间线回放；主工作区 w00019 的 Lab 改动（合并 master 时按对照表迁入）。

## S0 实测（2026-10-04）

- vue-tsc 用新应用的前端配置检查引用 nb-ui 组件与主题包的 `.vue`：nb-ui 0 错误，约 5 s。旧 common 组件依赖 Nuxt 自动导入的 `ref`、`computed`、`watch`，迁移时补显式 import。
- Vitest 4.1 + Vite 8.1 + happy-dom 20：能挂载 nb-ui 的 Button、Tree 与 JsonViewer，`import.meta.glob`（eager raw 与懒加载 `.vue`）可用。
- UnoCSS 66.7 在 Vite 8 下可用：nb-ui transform 黑名单读出 31 个类名；`.ts` 里的类名要配 `content.pipeline.include` 才提取；产物 CSS 顺序与 import 顺序一致（reset → nb-ui → uno）。
- `import.meta.env.DEV` 分支里的动态 import 在生产构建中被摇掉。
- 包内 `bunfig.toml` 的 `[test] pathIgnorePatterns` 与命令行 `--path-ignore-patterns` 都能让 `bun test` 跳过 `*.dom.test.ts`；Vitest 接受 `--changed=<基准>`。

## 当前状态

2026-10-04 完成：主 Agent 编码（`8ddd1ee0`、`39fef4a1`、`8fa66bbf`、`e64a7f20`、`1c68eda1`、`eaf48866`、`4bbca2f5`、`b1352069`、`8729e1b1`、`22442b85`），omp 审查后按意见修正。

**实际改动（`packages/neuro-book`）：**

- **S1 测试基建**：`vitest.config.ts`（沿用 Vite 配置，happy-dom，Vitest 工作进程关掉 Node 26 自带的 webstorage）、包内 `bunfig.toml`、三份 tsconfig（`tsconfig.browser-test.json` 检查组件测试、e2e 与 `scripts/lab-shot.ts`）；`test` 依次跑 `test:bun` 与 `test:vitest`；根 `scripts/ci/test-conventions.ts` 增加 `fake-timer`、`module-mock` 覆盖 `vi.stubGlobal`/`vi.stubEnv`；`scripts/cli/test-affected.ts` 逐步运行串联的测试脚本；`src/architecture.test.ts` 不许产品代码引测试库。
- **S2 样式**：`uno.config.ts`（presetWind3 + presetIcons，nb-ui transform 黑名单现读，`.ts` 里的类名也提取）；`main.ts` 的样式顺序 reset → nb-ui → UnoCSS → 宿主样式；宿主页按钮用系统颜色。
- **S3 页面与路由**：`nbook.workbench` 定义 `workbench.pages`（`pages.ts`：贡献 id 写页面路径，`/api`、`/assets` 留给服务端）；`src/web/{router,mount}.ts`、`PageOutlet.vue`、`HostPage.vue`、`NotFoundPage.vue`，删除 `App.vue`。
- **S4 开发插件**：`src/development-manifest.ts`、`src/server/{process,development-main}.ts`、`src/web/development-plugins.ts`、`startServer({manifest})`；监督进程改跑开发入口；`scripts/check-dist.ts`（`build` 的最后一步，CI 矩阵加入）；依赖方向守卫限定开发代码的引用。
- **S5–S8 Lab**：`src/plugins/lab/`（纯模型、外壳、零件、手写场景注册表、透传夹具、`__nbLab` 类型在 `shared/`）；`src/ui/`（JsonViewer、SkillChip、主题包装载）；`scripts/lab-shot.ts`（`bun run lab:shot`，Node 运行）；宿主基础样式层与空图标；Vite 预构建清单补上第三方包。
- **顺带修复（`8fa66bbf`）**：`http.routes` 原来要求每个插件都用固定的贡献 id `api`，而内核要求贡献 id 在贡献点内唯一，第二个提供接口的插件一加载，两个插件的路由都不挂载（真实后端复现：同时加载两个测试路由插件，两者的接口都是 404）。改为贡献 id 写插件 id，补回归测试；`runtime.server-host` 与包 `AGENTS.md` 写明。
- **Spec 与文档**：`ui.component-lab`（排除机制改为开发插件与 `check:dist`、启动语义、场景 1/10/12/16 措辞、实现合同与证据改指新应用）、`runtime.browser-host`（页面表、宿主路由、两段挂载）、`runtime.server-host`（开发入口、`startServer({manifest})`、`http.routes` 贡献 id）、登记表两行；包 `AGENTS.md`（`src/ui/`、开发清单、依赖约定、样式、Lab、命令）与 README、模块边界、测试规范。

**与计划的出入：**

- 只迁 SkillChip 作透传夹具样例，ReferenceChip 不迁：它依赖旧应用的引用链接模型（`shared/reference-link.ts` 706 行），属编辑器域，随编辑器迁移。
- LabShell 改写地址栏仍用 `history.replaceState(history.state, …)` 而不是 `router.replace`：它原样保留 vue-router 记录的 `history.state`，少改迁移代码，方便以后合并 w00019。
- 页面贡献的路径冲突改由内核的“贡献 id 唯一”裁决（贡献 id 写页面路径），页面表不再自己判重：结果与加载顺序无关。
- 旧的 `lab-debug.test.ts` 用替身改写 `getBoundingClientRect`，删去，`measure()` 由真实浏览器 e2e 覆盖；检查器的组件归属测试改为挂载真实组件，不再手造 Vue 内部字段。
- 旧的主题宿主类 `app/utils/theme/host.ts` 没有迁：Lab 用不到，nb-ui 浮层默认挂到 `body`。

**旧路径到新路径（以后移植 w00019 的 Lab 改动时对照）：**

| 旧（`packages/neuro-book-legacy/app/`） | 新（`packages/neuro-book/src/`） |
|---|---|
| `component-lab/LabShell.vue`、`LabFixtureControls.vue`、`lab-*.ts`、`inspect.ts`、`use-*.ts`、`stage-backdrops.ts` | `plugins/lab/web/` 同名文件；`lab-debug.ts` 的类型移到 `plugins/lab/shared/debug-api.ts` |
| `component-lab/component-index.ts` | `plugins/lab/web/component-index-model.ts`（纯函数）+ `component-index.ts`（扫描） |
| `component-lab/{CollapsibleSidePanel,EventLogPanel,HighlightBox,MarkdownView,SurfaceTierDemo,ViewportCanvas,FixtureExample}.{vue,md}`、`*.types.ts` | `plugins/lab/web/components/` |
| `component-lab/fixtures/index.ts`、`subject-fixture.ts`、`README.md`、Lab 零件与 JsonViewer 的 `*Fixture.vue` | `plugins/lab/web/fixtures/`（注册表只留这几项与 SkillChip） |
| `components/common/JsonViewer.{vue,md}`、`SkillChip.{vue,md}` | `ui/` |
| `utils/theme/install-theme-packs.ts` | `ui/theme/install-theme-packs.ts` |
| `pages/lab.vue` | `plugins/lab/web/LabPage.vue` + `plugins/lab/web/plugin.ts`（页面贡献） |
| `../scripts/lab/shot.ts`、`../scripts/smoke/component-lab.ts` | `../scripts/lab-shot.ts`、`../e2e/lab.e2e.ts`、`../e2e/lab-shot.e2e.ts` |
| 测试：`*.test.ts`（Vitest + jsdom） | 纯 TS 的改由 `bun test`；要 DOM 的改名 `*.dom.test.ts` |

## 验收

1. `bun run typecheck`（三遍）0 错误；`bun run test`：`bun test` 21 个文件 111 个用例、Vitest 8 个文件 33 个用例通过（[`app-checks.txt`](evidences/app-checks.txt)），连跑 3 次无波动。
2. `bun run test:e2e` 18 个用例通过（[`e2e.txt`](evidences/e2e.txt)）：t47 的 browser-host 与开发命令用例保持通过，另加页面表之外的路径、生产构建没有 `/lab`；`lab.e2e.ts` 9 个用例覆盖 `ui.component-lab` 场景 1、2、5–9、11–13、15、17；`lab-shot.e2e.ts` 覆盖场景 14。构建内的 `check:dist` 通过；把 Lab 改成静态导入时 `check:dist` 报出两个文件、构建失败（手动反例，未入库）。
3. 场景 3、4 由组件索引模型测试覆盖，场景 10 由 `check:dist` 与生产 e2e 覆盖，场景 16 随 t49。
4. `bun run smoke:server` S1–S5 通过（[`smoke-server.txt`](evidences/smoke-server.txt)）。
5. `docs:check`、`governance:check` 失败为 0、本次改动无新警告；`test:affected --typecheck`（`bun.lock` 有改动，选中全部包）只有开发者决定暂不处理的 4 项既有失败（llmlint 类型检查与 Vitest、nb-ui、test-support），其余全部通过（[`affected.txt`](evidences/affected.txt)）。

**omp 审查（默认模型，只读）：** 一次跑完（[`omp-review.txt`](evidences/omp-review.txt)），列 4 条阻断、8 条建议，多数落在原样迁入的旧 Lab 代码上。主 Agent 逐条核实（查了相关代码的提交来历），处理如下；新增或改写的测试撤掉修复时失败：

1. 建议“Lab 用 `history.replaceState` 改地址栏，router 记录的当前路由过时”：成立。改为经宿主 router 的 `replace` 改写查询参数；e2e 断言换组件后 router 的当前路由与地址栏一致。
2. 阻断“组件、场景写进 sessionStorage，与 Spec 的 localStorage 合同不符”：成立，但改 Spec 不改实现。会话状态是开发者 2026-09-24 在旧应用里有意加的（两个标签页各看各的组件与场景），Spec 没跟上；`ui.component-lab` 改为写明两份文档的字段、为什么分开与恢复顺序。降为建议。
3. 阻断“合法的地址参数没有写进偏好”：成立（旧应用同样如此）。恢复期间 watcher 不保存，恢复结束后在采纳了地址参数时补写偏好与会话；补 Bun 测试与 e2e（只带参数打开一次，不带参数再开时恢复同一状态）。
4. 阻断“场景切换先淡出再淡入，中间舞台是空的”：成立，是旧应用的回退：开发者 2026-09-03 专门删掉退场过渡并写进 Spec，09-18 又加回了 `mode="out-in"` 的淡出淡入。去掉过渡与配套的退场状态；e2e 逐帧采样舞台，换组件期间始终只有一个、始终不透明（把过渡加回去时这条断言失败）。
5. 建议“加载遮罩与舞台动效写死时长”：成立。舞台过渡已删；遮罩改用 `--motion-fast`。
6. 阻断“自定义壁纸存取失败没有收口”：成立，降为建议（开发工具的边角）。保存失败时本次照样显示、提示刷新后不保留；删除失败时照样回到默认桌面；启动时读不到也提示。都写一条 `console.warn`。
7. 建议“依赖方向守卫看不到动态 `import()`”：成立。守卫解析动态导入，前端开发入口只允许 `web/main.ts` 动态加载；断言从真实 `main.ts` 解析出这条动态导入。
8. 建议“`lab:shot` 按固定时长等待”：部分成立。这是命令行工具的 `--wait` 选项（点击后、截图前），不是测试；改为只在给了 `--click` 时等待，没点击时舞台已由 `__nbLab` 的 ready 确认。点击分支没有补 e2e。
9. 建议“两段挂载的失败分支没有测试”：成立。补 `src/web/mount.dom.test.ts`（真实窗口、内核与工作台插件，只有连接对象是按协议返回的替身）。
10. 建议“SkillChip 写死颜色”：成立，改用 `--status-warning`。
11. 建议“减少动态时加载转圈与舞台动画仍在动”：成立。舞台动画已删；两处转圈加 `motion-reduce:animate-none`。
12. 建议“别名混有非字符串时静默丢弃”：成立。混有非字符串时提示并按没有别名处理，补测试。

另：`LabShell.vue` 约 2000 行，超过前端规范 1200 行的审查线；拆分是 `ui.component-lab` 已登记延期的 t09，本 Task 不做。

**未验证**：Windows；Firefox、Safari 上的实际运行；场景 3 中阻断原因与入口跳转的界面（真实索引里还没有这类条目，随 t50）；数据面板编辑非法 JSON 的界面行为（分层输入与校验由组件测试覆盖，e2e 只覆盖回写与还原）。

## 下一步

t49：命令与快速打开（`workbench.commands`、`workbench.quick-open`、Lab 场景 16）。
