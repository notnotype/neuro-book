# NeuroBook 应用包

仓库共享规则见根 [`AGENTS.md`](../../AGENTS.md)；本文件只补充本包的约定。

本包是 NeuroBook v2 的现行应用代码。设计依据：[NeuroBook v2：并排重建应用](../../docs/proposals/neuro-book-v2-rebuild.md)、[ADR 0023](../../docs/adr/0023-v2-frontend-backend-stack.md)。旧应用 `packages/neuro-book-legacy` 只作参照，不在其中修改代码；需要旧行为时读它，按 Spec 在本包重写。

## 目录约定

- `src/manifest.ts`：产品清单，列出本应用加载的全部插件，是“加载了什么”的唯一入口。
- `src/server/`：后端宿主（进程入口、开发监督进程、监听）；`src/web/`：前端宿主（Vite 入口、浏览器宿主、根组件）。
- `src/plugins/<插件>/`：一个插件一个目录，`plugin.ts` 为插件描述，`server/`、`web/`、`shared/` 分别放后端、前端与共用的 TypeBox 合同。`web/` 不引用 `server/`，反之亦然，只经 `shared/` 交换类型与 schema。
- 前端不用全局 Pinia store；状态归插件所有，大块状态用浅层引用。
- 后端 HTTP 用 Hono，校验与接口描述用 TypeBox，不引入 Nuxt 与 Zod。

目录在第 3 步“应用骨架”中建立，本文件随之补充命令与验证入口。
