# nb-harness 示例

把七个模块装配成一个会读改小说文件的写作助手，用五个场景演示内核的主要机制；也可以当作写使用方（独立运行时、`nbook.agent` 插件）的样板。装配、Profile、注册节点都用真实实现，只有模型的流在场景里换成脚本（不联网、不花钱）；`live.llm.test.ts` 与命令行用真实模型。

讲解写在代码旁边：每个文件开头说明它演示什么、对应哪条合同，关键的每一步说明做什么、为什么、不这样会怎样。本文件只做目录、概念与阅读顺序。

## 阅读顺序

1. [`testing/scripted-model.ts`](testing/scripted-model.ts)：运行时怎样接受一个模型流，场景怎样脚本化它。
2. [`profiles/writer.profile.tsx`](profiles/writer.profile.tsx)：一个 Profile 文件——`System`、`History`（种子）、`Appending`（输入与提醒）三个分区与字段。
3. [`nodes/workspace-tree.ts`](nodes/workspace-tree.ts)：注册一个数据源与一个内容节点，让 Profile 用上外部数据。
4. [`assemble.ts`](assemble.ts)：配置、凭据、文件访问、Profile 主机、会话存储、压缩注册表怎样接成 `Runtime`。
5. 场景，按编号：
   - [`01-first-invocation`](scenarios/01-first-invocation.test.ts)：一次调用写进会话的顺序、模型看到的请求、事件。
   - [`02-approval-and-edit`](scenarios/02-approval-and-edit.test.ts)：先读后改、询问用户、批准与拒绝、本会话内允许。
   - [`03-queue-and-recovery`](scenarios/03-queue-and-recovery.test.ts)：插话与追加；等待审批时崩溃，重开后从日志恢复。
   - [`04-compaction`](scenarios/04-compaction.test.ts)：阈值触发压缩，压缩条目与重写的种子，压缩后模型看到什么。
   - [`05-cli`](scenarios/05-cli.test.ts)：命令行作为整体——真实子进程、OMP 真实网络传输、本地 OpenAI 兼容桩服务；运行中的命令、审批输入的校验。
   - [`live.llm.test.ts`](scenarios/live.llm.test.ts)：同一套装配换成真实模型：只读问答，以及按 hashline 协议先读后改。
6. [`cli.ts`](cli.ts)：在终端里和它对话。

## 几个概念

| 概念 | 是什么 | 代码里 | 合同 |
|---|---|---|---|
| 会话 | 一份只追加的条目日志；模型看到的上下文、是否在等用户、当前模型都由条目回放得出 | `session.log.entries`、`readPage` | [`harness.session`](../../../docs/specs/harness/session.md) |
| 调用 | 一次 `prompt` 或 `continue` 触发的 ReAct 运行，从 `invocation start` 到终态；`done` 在终态条目写入后完成 | `session.prompt()` 返回的 `Invocation` | [`harness.runtime`](../../../docs/specs/harness/runtime.md) |
| Profile | 一类 Agent 的声明：系统提示词、历史里的种子、每次调用追加的消息、字段（工具、模型、压缩、审批） | `defineProfile`、`loadProfile` | [`harness.profile`](../../../docs/specs/harness/profile.md) |
| 节点、数据源、字段 | 都经主机注册；内置的也一样。节点在渲染时只读已取好的数据 | `host.registerNodeType`、`registerSource`、`registerField` | 同上 |
| 工具与审批 | 工具按内核协议定义；每次调用前按策略、配置、本会话内允许、审批模式判定放行、拒绝、询问用户或交审批模型 | `defineTool`、`approval` 配置、`session.resolve` | [`harness.tools`](../../../docs/specs/harness/tools.md) |
| 资源寻址 | `方案://路径`；每个方案一个受根约束的目录型提供者或只读的虚拟提供者；内置 `read`、`edit` 只经它碰文件 | `createResourceAccess`、`createLocalFileAccess`、`createSessionDirectories` | [`harness.builtin-tools`](../../../docs/specs/harness/builtin-tools.md)、[`workspace.resources`](../../../docs/specs/workspace/resources.md) |
| 压缩 | 把一段历史压成摘要条目并重写种子；方法走注册，`soft` 内置 | `createCompactionRegistry`、`session.compact()` | [`harness.compaction`](../../../docs/specs/harness/compaction.md) |
| 模型与凭据 | 配置里自建的服务加 OMP 目录；key 在凭据库里，内核不读环境变量 | `createModelCatalog`、`openCredentials` | [`harness.models`](../../../docs/specs/harness/models.md)、[`harness.config`](../../../docs/specs/harness/config.md) |

共用的术语见 [Harness 术语表](../../../docs/specs/harness/glossary.md)。

## 运行

在 `packages/nb-harness` 下：

```text
bun run test:examples      # 只跑示例场景（脚本化模型）
bun test                   # 连同包的其它测试一起跑；内核的公开接口改了、示例没跟上会直接失败
bun run test:llm           # 真实模型：包内的三处冒烟加示例的 live 场景；要 .env 里的 NBOOK_LLM_* 与开发者授权
bun run typecheck          # examples 在 tsconfig 的 include 里
```

命令行：

```text
NB_HARNESS_API_KEY=<key> bun examples/cli.ts --config <config.json> --workspace <作品目录>
```

`config.json` 是 [`harness.config`](../../../docs/specs/harness/config.md) 的 `HarnessConfig`，例如：

```json
{
    "providers": [{"id": "luna", "api": "openai-completions", "baseUrl": "https://example.com/v1", "models": [{"id": "gpt-6-luna", "contextWindow": 128000}]}],
    "models": {"defaultModel": "luna/gpt-6-luna"},
    "approval": {"mode": "write", "tools": {"edit": "ask"}}
}
```

状态目录缺省是 `<作品目录>/.nb-harness`（会话 JSONL 与凭据库），`--session <id>` 重开一个会话（等待审批时退出的会话重开后仍在等）。
