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
- **实现审查（omp，范围 `36b7c3c3..8b507e12`，90 分钟到上限后用 `--resume` 只要收尾）**：7 条（重要 5、建议 2），证据 [`evidences/impl-review.txt`](evidences/impl-review.txt)。全部成立并已改：
  1. 命令行审批把空输入与 `/abort` 当作批准（重要）——只接受明确的 y/s/n，其它重新问，`/abort` 中止；
  2. 命令行等调用结束期间不读输入，运行中的插话与 `/abort` 被丢（重要）——输入只有一个读者（`startRead`，可取消，输掉与 `next()` 的竞争时把已到的行放回队列），运行中持续消费；
  3. `openCredentials` 的初始 key 写入失败后不关已打开的库（重要）——失败分支 `close()` 再返回 `credentials-unavailable`，用 SQLite 触发器写了合同测试并断言不留文件描述符；
  4. 示例装配在打开凭据之后的失败路径漏关库（建议）——`try/catch` 关库再抛，场景 4 断言；
  5. 重开到等待审批的会话时命令行没有应答入口（重要）——输入分派以会话状态为入口：重开后先问完 `status.pending`，恢复运行的进展按 `status` 事件观察（`attentionFromStatus`），与本进程有没有 `Invocation` 解耦；
  6. 提示已发出后关闭 stdin 会挂住（重要）——旧版 `rl.question` 的问题，重写后 `close` 事件让等待中的读者得到 `null`，按 `/quit` 收口；
  7. 建好运行时后替换 `deps.host`，新主机上没有运行时字段（建议）——`host` getter 在主机身份变化时先登记再返回。
  审查者用本地 OpenAI 兼容的 SSE 桩服务驱动真实命令行子进程复现 1、2、5、6，这个做法收进示例场景 [`05-cli`](../../../../../packages/nb-harness/examples/scenarios/05-cli.test.ts)（运行中 `/status`、审批输入校验、审批时 SIGKILL 后 `--session` 重开先拒后批、输入到头即退出）；3、4 的探针思路收进 `credentials.test.ts` 与场景 4；7 收进 runtime 场景 10。审查者声明未核实的边界：长会话下 `status` getter 每次回放整份日志的开销、`next()` 的订阅累积、带 `replace` 属性的配置快照被当成存储、`:memory:` 重开——都没有改动，留给下一轮。
- 处理后整包 `bun test` 196 pass、4 skip；typecheck、docs:check、governance:check 通过。

## 依据

- 开发者 2026-10-11：“可以，先进行一轮优化”（对示例写完后的问题清单）。
- 七份 Spec 已 `implemented`，改可观察行为先改 Spec。

## 下一步

无（本轮完成）。下一轮候选：预览接口、适配层统一的工具结果预算、审查者列出的未核实边界。
