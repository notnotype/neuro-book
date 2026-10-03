# ADR 0023：NeuroBook v2 去掉 Nuxt，前端 Vue + Vite，后端 Bun + Hono，校验统一 TypeBox

- 状态：Accepted
- 日期：2026-10-03
- 决策者：开发者
- 关联工作：[w00017 t43](../../.agents/works/w00017-application-runtime-architecture/tasks/t43-repository-reorganization/README.md)
- 相关文档：[NeuroBook v2：并排重建应用](../proposals/neuro-book-v2-rebuild.md)（`accepted`，本 ADR 的完整方案与取舍）、[ADR 0022](0022-extensible-platform-and-plugin-trust.md)（内核拥有进程、领域能力皆为内置插件）

## 背景

ADR 0022 决定内核拥有进程、HTTP 与 workbench 等都是内置插件。w00017 阶段 1 按这个方向在 Nuxt 应用里实现了内核、三类宿主与内置插件，但 Nuxt/Nitro 仍在构建、开发进程模型与入口上设限：开发热重载要在 nuxi 主线程与 Nitro worker 之间协调，生产入口要覆盖 Nitro 的 entry，Nitro 插件要逐个迁入内置插件，打包把 CJS 解析到 ESM 入口。应用设 `ssr: false`，没有使用 Nuxt 的服务端渲染。阶段 3 计划的插件运行期装载、卸载与路由贡献，与 Nuxt 构建期按文件约定生成路由和插件相冲突。

2026-10-03 开发者决定并排重建应用（旧包改名 `neuro-book-legacy` 只作参照），并借重建去掉 Nuxt。

## 决策

### 1. 去掉 Nuxt，前后端分离

新应用不依赖 Nuxt/Nitro。前端与后端各自构建、各自运行，经 HTTP 合同交互；同一个插件的前端、后端与共用合同放在同一目录。开发模式下 Vite 负责前端热更新，后端由我们的开发监督进程按 `runtime.server-host` 的停止序列有序重启；入口、路由与进程完全由宿主与内核决定。

### 2. 前端：Vue 3 + Vite

前端使用 Vue 3、Vite、vue-router、vue-i18n、UnoCSS 与 nb-ui。状态归各插件所有，在插件激活时建立、停止时释放；不使用全局 Pinia store 与全局持久化插件，大块状态使用浅层引用，不进入深度监听。

### 3. 后端：Bun + Hono

后端运行在 Bun 上，HTTP 使用 Hono。Hono 只负责请求处理（路由匹配、中间件、请求与响应）；生命周期、服务装配与插件登记归内核。`nbook.http` 拥有监听与准入，按插件前缀把请求分发给各插件的 Hono 子应用，插件启停时挂上或摘下。ADR 0022 第 2 节中“HTTP 服务（Nitro）”的表述由本条取代。

### 4. 校验与接口描述统一使用 TypeBox

新应用的 HTTP 合同、插件通道、插件配置、OpenAPI 与模型工具参数统一用 TypeBox 描述，不引入 Zod。

## 放弃的方案

- **保留 Nuxt**：未使用服务端渲染；构建期约定与自有的插件、宿主冲突。
- **NestJS**：自带依赖注入、模块与生命周期，与内核重复；模块启动时静态装配，不适合运行期启停插件；依赖装饰器元数据，esbuild 与 Bun 不生成。
- **Elysia**：自带依赖注入与分作用域的生命周期钩子，与内核重叠；Bun 优先，Node 需要适配器；几乎由一人维护。
- **Zod**：转换与自定义校验无法表达为 JSON Schema，而新应用的接口与工具参数都以 JSON Schema 为中心。

## 后果

- 开发热重载、生产入口、静态资源服务与路由分发由我们实现和维护；这部分代码进入宿主与 `nbook.http`，由 Spec 约束。
- 从旧包迁入的组件要去掉 Nuxt 自动导入、改为显式 import；nb-ui 的 Nuxt 模块包装不再被新应用使用。
- 产品打包、安装与桌面交付链需要另行设计；在此之前新应用只有开发模式与最简单的生产启动。
- `runtime.server-host`、`runtime.browser-host`、`runtime.plugin-channel`、`runtime.api-docs` 中与 Nuxt/Nitro 相关的描述，随新应用实施修订。
