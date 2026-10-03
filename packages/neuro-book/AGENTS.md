# NeuroBook 应用包

仓库共享规则见根 [`AGENTS.md`](../../AGENTS.md)；本文件只补充本包的约定。

本包是 NeuroBook v2 的现行应用代码。设计依据：[NeuroBook v2：并排重建应用](../../docs/proposals/neuro-book-v2-rebuild.md)、[ADR 0023](../../docs/adr/0023-v2-frontend-backend-stack.md)。旧应用 `packages/neuro-book-legacy` 只作参照，不在其中修改代码；需要旧行为时读它，按 Spec 在本包重写。

## 目录约定

- `src/manifest.ts`：产品清单，列出本应用加载的全部插件，是“加载了什么”的唯一入口；只引用各插件的 `plugin.ts` 描述。
- `src/server/`：后端宿主（进程入口、启动参数、停止来源与退出码、按清单装配插件）；`src/web/`：前端宿主（Vite 入口、浏览器宿主、根组件）。
- `src/shared/`：前后端宿主共用、与运行位置无关的代码：宿主之间的协议（例如浏览器引导的 TypeBox schema 与常量）和装配工具；不引用任何一侧的实现。插件自己的合同放在插件的 `shared/`。
- `src/plugins/<插件>/`：一个插件一个目录，`plugin.ts` 为插件描述（id、版本与运行位置），`server/`、`web/`、`shared/` 分别放后端、前端与共用的 TypeBox 合同。`web/` 不引用 `server/`，反之亦然，只经 `shared/` 交换类型与 schema。
- 插件之间只经内核的服务、贡献点协作；需要另一个插件的合同类型时只用 `import type`。宿主（`src/server/`、`src/web/`）是装配者，可以引用插件的工厂。
- 跨目录导入用 `nbook/*`（映射到 `src/*`）；同一插件或同一宿主目录内用相对导入。
- 前端不用全局 Pinia store；状态归插件所有，大块状态用浅层引用。
- 后端 HTTP 用 Hono，校验与接口描述用 TypeBox，不引入 Nuxt 与 Zod。

## 后端

- 插件提供 HTTP 接口时，在后端入口向贡献点 `http.routes` 提交一个处理器（通常是 Hono 应用），挂载在 `/api/<插件 id>/`；合同见 `src/plugins/http/server/contracts.ts` 与 [`runtime.server-host`](../../docs/specs/runtime/server-host.md)。`/api/runtime/` 留给宿主。
- 长连接（事件流）在处理器里经 `env.registerEventStream(close)` 登记，否则会拖住排空。
- 记录诊断用 `@notnotype/nb-runtime/diagnostics` 的 `diagnosticsKey` 服务，不直接写文件或另建日志器。
- 测试需要额外插件时经 `startServer({plugins})` 注入（见 `src/server/testing/`），产品代码不加测试分支。

## 前端

- 窗口启动、引导与失败页的合同见 [`runtime.browser-host`](../../docs/specs/runtime/browser-host.md)。插件的浏览器入口在 `src/web/plugins.ts` 登记工厂；窗口只登记引导集合里出现的插件。
- 浏览器基线：Chrome、Edge 119，Firefox 124，Safari 17.4（`vite.config.ts` 的 `BROWSER_TARGETS`）；不使用基线之外的浏览器 API。
- `bun test` 不能导入 `.vue`：需要在合同测试里加载的组件（例如工作台交出的根界面）用 `defineComponent` 与渲染函数写。
- `vite.config.ts` 关闭了依赖发现、只预构建 `vue`（依赖发现进行中时 Vite 的 `close()` 不结算，开发命令停止时会卡住）；新增需要预构建的依赖时加进 `optimizeDeps.include`。

## 命令

```text
bun run dev              # 开发模式：页面 http://127.0.0.1:3000/，后端改动后有序重启；状态根缺省 .dev-state/
bun run typecheck        # 类型检查（后端 tsc、前端 vue-tsc）
bun run test             # 合同测试（含真实子进程）
bun run test:e2e         # 构建后用本机 Chrome 跑浏览器验收（Playwright 由 Node 运行）
bun run build            # 打包后端到 dist/server、前端到 dist/web
bun run smoke:server     # 打包后对产物运行进程级 smoke
NBOOK_STATE_ROOT=<目录> bun run start   # 运行打包产物（同时提供页面）
```
