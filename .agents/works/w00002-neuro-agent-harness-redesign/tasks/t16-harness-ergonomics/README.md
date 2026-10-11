---
schema: nbook.task/v2
taskId: t16-harness-ergonomics
---

# nb-harness 第一轮优化：手感、目录寿命与 edit 的真实可用性

## 目标

写完 [`examples/`](../../../../../packages/nb-harness/examples/README.md) 之后列出的问题（2026-10-11 向开发者汇报，开发者决定“先进行一轮优化”）中优先级靠前的几项，按 Spec 流程改合同再改实现：

| 项 | 问题 | 改法 | Spec |
|---|---|---|---|
| 7 | 模型目录按一份配置快照建，配置 `replace` 后运行时读到新快照、目录还是旧的 | `createModelCatalog` 可接 `ConfigStore`（每次按 `current` 看）；`RuntimeDeps.models` 可省略，缺省从 `deps.config` 建 | [`harness.models`](../../../../../docs/specs/harness/models.md) 输出 10、[`harness.runtime`](../../../../../docs/specs/harness/runtime.md) 输入 |
| 6 | 自建模型没给 `contextWindow` 时压缩报 `nothing-to-compact`，像“没东西可压” | 手动 `compact()` 对没有正 `contextWindow` 的模型返回 `compaction-failed` 并说明；`soft` 的不适用原因写明配置项 | runtime 输出 14、[`harness.compaction`](../../../../../docs/specs/harness/compaction.md) 输出 7 |
| 10 | `harness/` 命名空间下拼错的字段只警告、被静默忽略 | `harness/` 下未注册的字段是错误（`invalid-prompt`，诊断 `unknown-field` 为 error）；其它命名空间仍是警告 | [`harness.profile`](../../../../../docs/specs/harness/profile.md) 输出 3 |
| 1 | 装配样板重 | `RuntimeDeps` 的 `host`、`models`、`tools`、`compaction` 可省略，各有缺省 | runtime 输入 |
| 2 | 凭据必须先落 SQLite 文件 | `openCredentials({sqlitePath: ":memory:"})` 已可用（OMP 的 SQLite 存储接受 `:memory:`），写进 Spec 与文档；`openCredentials` 加 `apiKeys` 初始写入 | models 输入与输出 5 |
| 3 | 等待审批时 `done` 不结束，使用方只能自己 race | `Invocation.next()`：下一个需要处理的点，`waiting`（带待处理事项）或 `done` | runtime 输入与输出 6 |
| 5 | 内置 `soft` 的摘要传输换不掉，测试要另注册方法 | `createCompactionRegistry({soft: {completeImpl}})` | compaction 输入与输出 1 |
| 9 | 状态里没有上下文用量 | `status.context: {tokens, window, threshold}`（最近一次调用的模型与设置可知时） | runtime 输入与输出 5 |
| 8 | `steer` 送达时机的措辞与行为不一致 | 改成“下一次模型请求时送达” | runtime 术语与输出 11 |
| 12 | `edit` 的说明没把 hashline 语法讲全，真实模型没验证过先读后改 | 工具说明用 OMP 的 `editDescription("hashline")` 加本模块的路径约束；示例 live 场景补先读后改 | [`harness.builtin-tools`](../../../../../docs/specs/harness/builtin-tools.md) 输出 6 |

非目标（下一轮）：预览接口（4）、适配层统一的工具结果预算（11）。

## 当前状态（2026-10-11）

- 计划见 [`plan.md`](plan.md)。
- **实现**（计划 S1，一个提交）：五份 Spec 条目改动（models 输入与输出 5、10、场景 3、5；runtime 术语、输入、输出 5、6、11、14、失败表、场景 5、8、10、11；compaction 输入、输出 1、7、场景 1；profile 输出 3、失败表、场景 6；builtin-tools 输出 6）；代码：`models/catalog.ts`（目录接受 `ConfigStore`，按快照身份缓存索引）、`models/credentials.ts`（`apiKeys`、`:memory:`）、`runtime/types.ts`、`runtime/runtime.ts`（缺省依赖用 getter 读活的 deps，拷贝会断掉“建好运行时后换 `model.stream`”这条路）、`runtime/session.ts`（`next()`、`status.context`、无窗口的 `compact()`）、`compaction/registry.ts`、`soft.ts`、`profile/prepare.ts`、`builtin/edit.ts`（说明用 OMP `editDescription("hashline")`）。合同测试各补一条；示例与命令行改用新接口（`assemble` 不再建目录与注册表、`openCredentials` 的 `apiKeys`、场景 2 与命令行用 `next()`、场景 4 用 `soft.completeImpl`）。
- 验证：`bun test` 194 pass、4 skip（含示例 5 条）；`typecheck`；真实模型（gpt-6-luna）：live 的只读与先读后改各 1 pass（先读后改一次成功，模型按 OMP 的 hashline 说明写出了正确的 `PUT 2.=2:`）。只读那条第一次跑时以 `failed` 结束、66 秒，当时测试没打印 `error`，重跑通过；已让测试把 `error` 带进失败消息，再出现时能看到原因。
- `:memory:` 实测：OMP 的 SQLite 存储接受它，每次打开各一份，不在磁盘留文件。

## 依据

- 开发者 2026-10-11：“可以，先进行一轮优化”（对示例写完后的问题清单）。
- 七份 Spec 已 `implemented`，改可观察行为先改 Spec。

## 下一步

实现 → 自跑验证 → omp 实现审查 → 处理。
