# nb-runtime 包入口

本包位于 `packages/nb-runtime`，遵循仓库共享 Agent 合同 [`../../AGENTS.md`](../../AGENTS.md)；本文件只写本包的约定。

`@notnotype/nb-runtime` 是 NeuroBook 的内核，新应用的后端与浏览器宿主共用。六个机制各有一份行为合同：[`lifecycle`](../../docs/specs/runtime/lifecycle.md)（运行作用域与资源生命周期）、[`services`](../../docs/specs/runtime/services.md)（服务装配）、[`plugins`](../../docs/specs/runtime/plugins.md)（插件描述、激活与贡献）、[`application`](../../docs/specs/runtime/application.md)（运行实例与启动门禁）、[`diagnostics`](../../docs/specs/runtime/diagnostics.md)（诊断记录）、[`remote`](../../docs/specs/runtime/plugin-channel.md)（远程服务与 RPC 协议）。

典型用法见应用包的 [`examples/`](../neuro-book/examples/README.md)：示例教的是怎么写应用插件，要和内置插件（`nbook.storage`、`nbook.state`、`nbook.commands`）一起用，放在本包会让内核依赖应用包。本包只留自己的合同测试。公开接口改动时同一提交里更新受影响的示例（应用包的 `bun run test` 会运行它们），新增机制或新的典型用法时补插件与场景。插件描述的类型 `PluginDescriptor` 归本包（`plugins` 入口），应用包经 `src/manifest.ts` 引用。

## 边界

- 运行时依赖只有 TypeBox（合同 schema）：不依赖 UI 或 HTTP 框架、进程信号、DOM、文件或数据库驱动，也不依赖任何产品领域。需要这些能力的部分由宿主或插件实现后注入。
- 每个机制一个公开入口，即 `package.json` 的 `exports` 子路径，对应 `src/<机制>/<机制>.ts`；其余文件是实现细节，包外不深导入。
- 机制之间只引用对方的公开入口，且单向：services 引用 lifecycle，plugins 引用前两者，application 引用前三者，diagnostics 可引用前四者（application 只引用类型）。各机制的边界测试读取同目录源码核对导入，新增文件同样受约束。
- 模块顶层没有 I/O、单例与计时器。
- 服务键按服务 id 识别（[ADR 0025](../../docs/adr/0025-service-keys-by-id.md)）：同一 id 定义两次是同一个键，装配不维护受信键清单。内部以 `key.name` 作 Map 的键与比较依据，不按键对象的身份。
- 源码只用浏览器与 Bun 都有的标准 API。`bun run typecheck` 用两份配置检查：`tsconfig.json` 带 Bun 类型、不带 DOM，拦住只有浏览器才有的全局；`tsconfig.browser.json` 只查源码、带 DOM、不带 Bun/Node 类型，拦住只有 Bun/Node 才有的全局。
- 运行环境需提供 `Promise.withResolvers`、`AbortSignal.any` 与 `AbortSignal.timeout`；浏览器宿主的最低版本随应用骨架确定。

## 验证

```text
bun run typecheck
bun run test
```
