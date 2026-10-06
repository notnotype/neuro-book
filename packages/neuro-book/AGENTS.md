# NeuroBook 应用包

仓库共享规则见根 [`AGENTS.md`](../../AGENTS.md)；本文件只补充本包的约定。

本包是 NeuroBook v2 的现行应用代码。设计依据：[NeuroBook v2：并排重建应用](../../docs/proposals/neuro-book-v2-rebuild.md)、[ADR 0023](../../docs/adr/0023-v2-frontend-backend-stack.md)。旧应用 `packages/neuro-book-legacy` 只作参照，不在其中修改代码；需要旧行为时读它，按 Spec 在本包重写；原样迁入的旧代码同样逐条对照 Spec 复核，不以“与旧实现一致”作为正确的依据。

## 目录约定

- `src/manifest.ts`：产品清单，列出本应用加载的全部插件，是“加载了什么”的唯一入口；只引用各插件的 `plugin.ts` 描述。`src/development-manifest.ts` 是开发清单（Component Lab），只由后端开发入口 `src/server/development-main.ts` 与前端的 `src/web/development-plugins.ts` 引用，后者只在 `import.meta.env.DEV` 分支里动态加载；生产构建不含它们，`check:dist` 检查。
- `src/server/`：后端宿主（进程入口、启动参数、停止来源与退出码、按清单装配插件）；`src/web/`：前端宿主（Vite 入口、浏览器宿主、根组件）。
- `src/ui/`：宿主与插件共用的前端组件（同名 `.md` 文档并列，Lab 自动收录），只引用前端库、`ui/` 与 `shared/`；只属于某个插件的界面组件放在插件的 `web/components/`。
- `src/shared/`：前后端宿主共用、与运行位置无关的代码：宿主之间的协议（例如浏览器引导的 TypeBox schema 与常量）、装配工具，以及各插件都要用的小工具（例如界面文本的中英两份 `localized-text.ts`）；不引用任何一侧的实现。插件自己的合同放在插件的 `shared/`。
- `src/plugins/<插件>/`：一个插件一个目录，`plugin.ts` 为插件描述（id、版本与运行位置），`server/`、`web/` 分别放后端与前端，`shared/` 放两端共用、与运行位置无关的代码（TypeBox 合同，以及不碰 DOM、Bun 与 Node API 的逻辑，例如命令表）。`web/` 不引用 `server/`，反之亦然，只经 `shared/` 交换类型与 schema。
- 插件之间只经内核的服务、贡献点协作；需要另一个插件的合同类型时只用 `import type`。宿主（`src/server/`、`src/web/`）是装配者，可以引用插件的工厂。服务键按对象身份比较，依赖另一个插件的服务时由宿主在装配时把服务键交给插件工厂（例如 `createWorkbenchBrowserPlugin({commands: commandServiceKey})`）。例外：Lab 的场景（`src/plugins/lab/web/fixtures/`）可以在运行时引用其它插件的 `web/` 与 `shared/`，用来挂载它们的组件、建场景自己的局部宿主；Lab 只在开发模式加载。
- 定义贡献点时规定贡献 id 的取法（例如插件 id、页面路径）：内核要求贡献 id 在同一贡献点内唯一，两个插件写同一个 id 时两条都被拒绝，不能让每个插件都写同一个固定 id。
- 命令（两端都可用）：插件向 `nbook.commands` 的贡献点 `commands.definitions` 提交，贡献 id 写命令 id（内置插件 `nbook.<域>.<动作>`，其它插件以自己的插件 id 开头）；要执行命令的入口在依赖里声明 `commandServiceKey`，按 id 执行。合同见 `src/plugins/commands/shared/contracts.ts` 与 [`workbench.commands`](../../docs/specs/workbench/commands.md)。
- 跨目录导入用 `nbook/*`（映射到 `src/*`）；同一插件或同一宿主目录内用相对导入。
- 前端不用全局 Pinia store；状态归插件所有，大块状态用浅层引用。
- 后端 HTTP 用 Hono，校验与接口描述用 TypeBox，不引入 Nuxt 与 Zod。
- 依赖：`dependencies` 只放后端进程导入的包（开发监督进程按其中的 workspace 包决定监视哪些源码目录）；只进前端构建的包（vue、vue-router、nb-ui、UnoCSS 等）放 `devDependencies`。两份产物都由打包器打包，这样分不影响运行。

## 后端

- 插件提供 HTTP 接口时，在后端入口向贡献点 `http.routes` 提交一个处理器（通常是 Hono 应用），贡献 id 写插件自己的 id，挂载在 `/api/<插件 id>/`；合同见 `src/plugins/http/server/contracts.ts` 与 [`runtime.server-host`](../../docs/specs/runtime/server-host.md)。`/api/runtime/` 留给宿主。
- 长连接（事件流）在处理器里经 `env.registerEventStream(close)` 登记，否则会拖住排空。
- 记录诊断用 `@notnotype/nb-runtime/diagnostics` 的 `diagnosticsKey` 服务，不直接写文件或另建日志器。
- 测试需要额外插件时经 `startServer({plugins})` 注入（见 `src/server/testing/`），产品代码不加测试分支。

## 前端

- 窗口启动、引导与失败页的合同见 [`runtime.browser-host`](../../docs/specs/runtime/browser-host.md)。插件的浏览器入口在 `src/web/plugins.ts` 登记工厂；窗口只登记引导集合里出现的插件。页面经 `nbook.workbench` 的贡献点 `workbench.pages` 交出（贡献 id 写页面路径），路由归宿主（`src/web/router.ts`）。
- 样式：UnoCSS（`uno.config.ts`）与 nb-ui 的预编译样式同时在场，引入顺序与 transform 类黑名单的原因见 `src/web/main.ts`、`uno.config.ts`；主题变量来自 nb-ui 主题包。
- 浏览器基线：Chrome、Edge 119，Firefox 124，Safari 17.4（`vite.config.ts` 的 `BROWSER_TARGETS`）；不使用基线之外的浏览器 API。
- 测试分两个运行器：纯 TS 模块、后端与窗口合同用 `bun test`；Vue 组件测试命名 `*.dom.test.ts`，由 Vitest 在 happy-dom 里运行（`vitest.config.ts` 沿用 Vite 配置，包内 `bunfig.toml` 让 `bun test` 跳过它们）。需要真实布局的交互（尺寸、拖放、滚动）走 Playwright（`e2e/`）。
- `bun test` 不能导入 `.vue`：Bun 测试会导入的模块（例如工作台交出的根界面）用 `defineComponent` 与渲染函数写。
- `vite.config.ts` 关闭了依赖发现、预构建清单写死（依赖发现进行中时 Vite 的 `close()` 不结算，开发命令停止时会卡住）；页面直接或经 nb-ui 用到新的第三方包时加进 `optimizeDeps.include`，否则其中的 CommonJS 模块在开发模式加载失败。
- Component Lab（[`ui.component-lab`](../../docs/specs/ui/component-lab.md)）是开发插件 `src/plugins/lab/`：新组件写同名 `.md` 就进索引，可挂载的组件在 `src/plugins/lab/web/fixtures/index.ts` 登记场景（场景登记门禁 `fixtures/index.dom.test.ts`）。

## 命令

```text
bun run dev              # 开发模式：页面 http://127.0.0.1:3000/，后端改动后有序重启；状态根缺省 .dev-state/
bun run typecheck        # 类型检查：后端 tsc、前端 vue-tsc、组件测试与 e2e 的 vue-tsc
bun run test             # bun test（合同测试，含真实子进程）后接 Vitest 组件测试
bun run test:e2e         # 构建后用本机 Chrome 跑浏览器验收（Playwright 由 Node 运行）
bun run build            # 打包后端到 dist/server、前端到 dist/web，最后 check:dist 确认产物不含开发插件与本机路径
bun run smoke:server     # 打包后对产物运行进程级 smoke
bun run lab:shot -- -c <组件> --url <开发页面地址>   # 对 Lab 场景截图并检查溢出（Node 运行，对着 bun run dev）
NBOOK_STATE_ROOT=<目录> bun run start   # 运行打包产物（同时提供页面）
```
