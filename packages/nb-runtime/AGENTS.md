# nb-runtime 包入口

本包位于 `packages/nb-runtime`，遵循仓库共享 Agent 合同 [`../../AGENTS.md`](../../AGENTS.md)；本文件只写本包的约定。

`@notnotype/nb-runtime` 是 NeuroBook 的内核，新应用的后端与浏览器宿主共用。五个机制各有一份行为合同：[`lifecycle`](../../docs/specs/runtime/lifecycle.md)（运行作用域与资源生命周期）、[`services`](../../docs/specs/runtime/services.md)（服务装配）、[`plugins`](../../docs/specs/runtime/plugins.md)（插件描述、激活与贡献）、[`application`](../../docs/specs/runtime/application.md)（运行实例与启动门禁）、[`diagnostics`](../../docs/specs/runtime/diagnostics.md)（诊断记录）。

## 边界

- 运行时零依赖：不依赖 UI 或 HTTP 框架、进程信号、DOM、文件或数据库驱动，也不依赖任何产品领域。需要这些能力的部分由宿主或插件实现后注入。
- 每个机制一个公开入口，即 `package.json` 的 `exports` 子路径，对应 `src/<机制>/<机制>.ts`；其余文件是实现细节，包外不深导入。
- 机制之间只引用对方的公开入口，且单向：services 引用 lifecycle，plugins 引用前两者，application 引用前三者，diagnostics 可引用前四者（application 只引用类型）。各机制的边界测试读取同目录源码核对导入，新增文件同样受约束。
- 模块顶层没有 I/O、单例与计时器。

## 验证

```text
bun run typecheck
bun run test
```
