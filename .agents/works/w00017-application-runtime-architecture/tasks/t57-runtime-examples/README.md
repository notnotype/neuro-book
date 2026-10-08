---
schema: nbook.task/v2
taskId: t57-runtime-examples
---

# nb-runtime 示例插件

## 目标与范围

开发者 2026-10-08 要求：给 `packages/nb-runtime` 补一组典型的示例插件，便于理解内核；之后随插件系统完善不断补充。示例放在 `packages/nb-runtime/examples/`，只经公开入口引用内核，每个都能直接运行，并配一个测试随包的 `bun run test` 运行，接口改了示例没跟上会直接失败。

行为合同未变：示例只演示 `runtime/services.md`、`plugins.md`、`application.md`、`lifecycle.md`、`plugin-channel.md` 已有的行为，不改内核代码。

## 当前状态

2026-10-08 完成第一批五个示例：

| 示例 | 内容 |
|---|---|
| `01-services` | 共享服务与依赖、按依赖激活与逆序释放、入口作用域上的资源 |
| `02-per-consumer` | 按调用方门面、按插件分开数据、门面随调用方释放后抛 `ServiceRevokedError` |
| `03-contribution-point` | 贡献点、接收者、声明与实现分开、不合格声明只拒绝那一条、目录查询 |
| `04-remote-service` | 两个内核实例之间的远程服务：合同、按需激活、调用方身份、订阅、输入校验 |
| `05-delegating-proxy` | 代理插件以调用方身份转发（`remote.on`、`remoteDelegates`、代理允许清单） |

`examples/README.md` 是索引与写法、维护约定；包的 `AGENTS.md` 补上第六个机制 `remote` 与示例的维护约定；`tsconfig.json` 把 `examples` 纳入类型检查。

验证：`bun run --cwd packages/nb-runtime typecheck` 通过；`bun run --cwd packages/nb-runtime test` 278 例通过（含 5 个示例测试）；五个示例逐个 `bun examples/<示例>.ts` 运行输出与测试一致；`docs:check`、`governance:check` 无失败。

下一批随 K5 起的切片补充：插件状态 store 与公开状态、项目实例与 `{project}` 目标等。
