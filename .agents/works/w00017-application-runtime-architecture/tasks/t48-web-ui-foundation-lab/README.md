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

2026-10-04 进行中：S1 测试基建。

## 验收

1. `ui.component-lab` 场景 1–15、17 在新应用上通过（`bun test`、Vitest 与 `e2e/lab.e2e.ts`）。
2. 生产构建不含 Lab 代码（`check:dist`），生产访问 `/lab` 显示“页面不存在”。
3. t47 的 browser-host e2e 保持通过。
4. `typecheck`、`test`、`smoke:server`、`test:e2e` 通过；`docs:check`、`governance:check` 失败为 0。
