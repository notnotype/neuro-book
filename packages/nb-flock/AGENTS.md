# nb-flock 包入口

本包位于 `packages/nb-flock`，遵循仓库共享 Agent 合同 [`../../AGENTS.md`](../../AGENTS.md)。本文件只保留本包的专属规则。

`@notnotype/nb-flock` 是不判旧的进程级独占文件锁 `tryLock`：持有到 `release` 或进程退出，进程怎样结束锁都由系统放掉。工作区里的使用者：nb-harness 的会话日志、nb-story 的书库、导入与问答配置、应用的 Skill 安装。按过期判旧、可等待可接管的锁是另一种，在 `nb-file-lock`；两者怎么选见 [ADR 0052](../../docs/adr/0052-non-stale-file-lock-package.md)。

## 边界

- 只有一个入口 `.`，只在 Bun 进程里用；只导入 `bun:ffi` 与 `node:` 内置模块，没有运行时依赖（随 nb-story 发布到 npm，装它的人不该多装别的包；`release:check` 的 `undeclared_import` 拦住未声明的包）。
- 与应用无关：源码不写应用名，不导入应用包。
- Windows 段在 Windows 上实测过（[ADR 0031](../../docs/adr/0031-nb-story-supports-windows.md)），自动测试与 `release:smoke` 都不跑 Windows：改到它要在 Windows 上重测。

## 测试

- 用 `bun test`；跨进程的用例经 `src/testing/lock-child.ts` 起真实子进程。`src/testing/` 只给本包的测试用，不进发布包。

## 完成门禁

`bun run typecheck` 与 `bun test` 在本包目录通过。改了锁的语义，另跑使用方的锁测试：`packages/nb-harness` 的 `src/kernel/log`、`packages/nb-story` 的 `bun test`、`packages/neuro-book` 的 `src/plugins/agent/backend/skills/install.test.ts`。
