# nb-harness 示例

分三层：`steps/` 七个可运行脚本，每个只比上一个多一个概念（真实模型）；`scenarios/` 的场景测试把同样的机制写成合同验证（脚本化模型，不联网、不花钱）；`assemble.ts` 与 `cli.ts` 是全部装配起来的写作助手，也可以当作写使用方（独立运行时、`nbook.agent` 插件）的样板。

讲解写在代码旁边：每个文件开头说明它演示什么、对应哪条合同，关键的每一步说明做什么、为什么、不这样会怎样。本文件只做目录、概念与阅读顺序。

## 阅读顺序

1. 先读讲解页 [`../docs/profile-architecture.html`](../docs/profile-architecture.html)（浏览器打开）：Profile 从 TSX 到模型请求的一张图与设计原理；再看下面的“几个概念”。
2. 一步一步（[`steps/`](steps/)，真实模型，读仓库根 `.env` 的 `NBOOK_LLM_*`，每个脚本跑一次花几次模型调用的钱）：
   - [`01-minimal`](steps/01-minimal.tsx)：`openRuntime` 加一个内联 Profile，问一句拿到回复；`unwrap` 与 Result。
   - [`02-profile-file`](steps/02-profile-file.ts)：Profile 搬进文件（[`profiles/assistant.profile.tsx`](profiles/assistant.profile.tsx)），`loadProfile`，`preview()` 看模型会收到什么。
   - [`03-tools-and-approval`](steps/03-tools-and-approval.tsx)：内置 `read`/`edit`、`project://` 资源方案、宿主审批回调；界面与命令行的应答方式。
   - [`04-sessions`](steps/04-sessions.ts)：JSONL 会话存储，换一个运行时 `openSession` 接着聊。
   - [`05-profile-data`](steps/05-profile-data.tsx)：注册数据源与节点（`invocation` 与 `model-call` 两种时机），自建主机。
   - [`06-compaction`](steps/06-compaction.tsx)：两轮之后手动 `compact()`，压缩后会话还记得前文；自动压缩的阈值与 `status.context`。
   - [`07-spill`](steps/07-spill.tsx)：超预算的工具结果溢出到 artifact，模型按 `artifact://N` 回读。
3. 合同场景（[`scenarios/`](scenarios/)，脚本化模型；先读 [`testing/scripted-model.ts`](testing/scripted-model.ts) 看模型流怎样脚本化）：
   - [`01-first-invocation`](scenarios/01-first-invocation.test.ts)：一次调用写进会话的顺序、模型看到的请求、事件。
   - [`02-approval-and-edit`](scenarios/02-approval-and-edit.test.ts)：先读后改、询问用户、批准与拒绝、本会话内允许。
   - [`03-queue-and-recovery`](scenarios/03-queue-and-recovery.test.ts)：插话与追加；等待审批时崩溃，重开后从日志恢复。
   - [`04-compaction`](scenarios/04-compaction.test.ts)：阈值触发压缩，压缩条目与重写的种子，压缩后模型看到什么。
   - [`05-cli`](scenarios/05-cli.test.ts)：命令行作为整体——真实子进程、OMP 真实网络传输、本地 OpenAI 兼容桩服务。
   - [`06-tool-result-spill`](scenarios/06-tool-result-spill.test.ts)：溢出与回读（工具在 [`tools/dump.ts`](tools/dump.ts)）。
   - [`live.llm.test.ts`](scenarios/live.llm.test.ts)：同一套装配换成真实模型。
4. 全部装配：[`profiles/writer.profile.tsx`](profiles/writer.profile.tsx)（带注册节点的 Profile）、[`nodes/workspace-tree.ts`](nodes/workspace-tree.ts)、[`assemble.ts`](assemble.ts)（配置、凭据、资源方案、主机、会话与溢出存储、压缩注册表），最后 [`cli.ts`](cli.ts) 在终端里和它对话。

## 几个概念

| 概念 | 是什么 | 代码里 | 合同 |
|---|---|---|---|
| 会话 | 一份只追加的条目日志；模型看到的上下文、是否在等用户、当前模型都由条目回放得出 | `session.log.entries`、`readPage` | [`harness.session`](../../../docs/specs/harness/session.md) |
| 调用 | 一次 `prompt` 或 `continue` 触发的 ReAct 运行，从 `invocation start` 到终态；`done` 在终态条目写入后完成 | `session.prompt()` 返回的 `Invocation` | [`harness.runtime`](../../../docs/specs/harness/runtime.md) |
| Profile | 一类 Agent 的声明：系统提示词、历史里的种子、每次调用追加的消息、字段（工具、模型、压缩、审批） | `defineProfile`、`loadProfile` | [`harness.profile`](../../../docs/specs/harness/profile.md) |
| 节点、数据源、字段 | 都经主机注册；内置的也一样。节点在渲染时只读已取好的数据 | `host.registerNodeType`、`registerSource`、`registerField` | 同上 |
| 工具与审批 | 工具按内核协议定义；每次调用前按策略、配置、本会话内允许、审批模式判定放行、拒绝、询问或交审批模型；询问先问宿主的 `approve` 回调，它给不出才等用户 | `defineTool`、`approval` 配置、`approve` 回调、`session.resolve` | [`harness.tools`](../../../docs/specs/harness/tools.md) |
| 资源寻址 | `方案://路径`；每个方案一个受根约束的目录型提供者或只读的虚拟提供者；内置 `read`、`edit` 只经它碰文件；超预算的工具结果全文进溢出存储，经 `artifact://` 回读 | `createResourceAccess`、`createLocalFileAccess`、`createSessionDirectories`、`createArtifactProvider`、`createJsonlArtifactStore` | [`harness.builtin-tools`](../../../docs/specs/harness/builtin-tools.md)、[`workspace.resources`](../../../docs/specs/workspace/resources.md) |
| 压缩 | 把一段历史压成摘要条目并重写种子；方法走注册，`soft` 内置 | `createCompactionRegistry`、`session.compact()` | [`harness.compaction`](../../../docs/specs/harness/compaction.md) |
| 模型与凭据 | 配置里自建的服务加 OMP 目录；key 在凭据库里，内核不读环境变量 | `createModelCatalog`、`openCredentials` | [`harness.models`](../../../docs/specs/harness/models.md)、[`harness.config`](../../../docs/specs/harness/config.md) |

共用的术语见 [Harness 术语表](../../../docs/specs/harness/glossary.md)。

## 运行

在 `packages/nb-harness` 下：

```text
bun examples/steps/01-minimal.tsx   # 各步脚本：真实模型，直接跑（要 .env 里的 NBOOK_LLM_* 与开发者授权）
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
