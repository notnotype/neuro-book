# 根工具链规范

适用：根 `nuxt.config.ts`、`vitest.config.ts`、`uno.config.ts`、`bunfig.toml`、`*.d.ts` 及跨领域构建配置。TypeScript 配置同时读取 [`common.md`](common.md) 与 [`languages/typescript.md`](languages/typescript.md)。

- 配置只声明工具边界、插件、路径、生成入口和平台条件；产品领域逻辑进入所属模块。
- 路径基于配置文件或显式仓库根解析，不依赖调用方当前目录。开发、CI、构建和发布对同一配置项使用同一默认值。
- 类型声明只弥补缺失的外部类型，不扩宽真实 API；生成的 Nuxt、Prisma 和构建声明由对应命令产生。
- 测试配置必须显式包含作用域内全部测试，并加载统一临时根 setup；新增测试目录时验证它实际被收集。
- 改动配置后运行直接消费它的 prepare、typecheck、测试或构建命令；配置可解析不能代替消费方验证。
- 给共享构建器设置全局解析条件（例如 `import`）时，`require` 调用方也会按这些条件解析；同时提供 `import` 与 `require` 入口、且调用方要用默认导出的包，要用真实产物验证，源码环境跑通不能证明产物正确。

完成标准：配置在所有消费环境使用同一路径和默认值，目标命令实际加载该配置，生成物未被手改。