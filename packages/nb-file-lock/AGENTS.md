# nb-file-lock 包入口

本包位于 `packages/nb-file-lock`，遵循仓库共享 Agent 合同 [`../../AGENTS.md`](../../AGENTS.md)。本文件只保留本包的专属规则。

`@notnotype/nb-file-lock` 是跨进程的文件锁与加锁替换（[ADR 0045](../../docs/adr/0045-shared-host-packages-for-second-app.md)）：proper-lockfile 的锁目录、锁被接管后的发现、放锁前的身份核对，以及“读、决定、写临时文件、核对、改名”的加锁替换。使用它的行为合同在各使用方的 Spec 里，例如 [`settings/configuration.md`](../../docs/specs/settings/configuration.md) 输出 14、[`workspace/files.md`](../../docs/specs/workspace/files.md) 的“读取与保存”。

## 边界

- 只有一个入口 `.`，只在 Bun 进程里用（`node:fs`、`node:crypto`）。
- 工作区里只有本包直接依赖 `proper-lockfile`，版本固定为 `4.1.2`：根上的补丁按“包名@版本”生效，锁的过期与退避参数也只有这里一份。`scripts/ci/validate-proper-lockfile-patch.ts` 检查别的成员没有直接声明它。参数不同的另一把锁（例如长期持有、带心跳的日志位置锁）用本包转出的 `lock`，参数写在使用方。
- 与应用无关：源码不写应用名，不导入应用包（`src/app-neutral.test.ts`）。失败的 `detail` 与诊断事件名照搬原实现，由调用方加上自己的前缀。
- `proper-lockfile` 不带类型，声明在 `src/types/proper-lockfile.d.ts`，由入口文件第一行的 `/// <reference>` 带给每个导入本包的类型检查；使用方不要再放一份同名声明（会报重复标识符）。

## 测试

- 用 `bun test`；跨进程的用例经 `src/testing/lock-child.ts` 起真实子进程。`src/testing/` 只给本包的测试用。

## 完成门禁

`bun run typecheck` 与 `bun test` 在本包目录通过。改了锁或替换的语义，另跑应用里用到它的测试：`packages/neuro-book` 的 `src/backend`、`src/plugins/files`、`src/plugins/settings`、`src/plugin-platform`。
