# @notnotype/nb-session

Agent 会话的 append-only 日志。一个会话的消息、工具调用与结果、压缩摘要和元数据按追加顺序写入，日志负责分配连续序号、打时间戳、进程重启后续写，并把写到一半的尾部识别出来交给调用方显式修复。

它是 [`@notnotype/nb-harness`](../nb-harness/README.md) 的存储层，但不依赖 harness、OMP 或 NeuroBook 产品，可以单独使用。

## 安装与运行环境

- 仓库内 workspace 包（`private`），以 TS 源码作为入口，运行时需要 Bun 1.3.14 及以上。
- 只依赖 Node 内置模块。

```jsonc
// 使用方的 package.json
"dependencies": {"@notnotype/nb-session": "workspace:*"}
```

## 快速开始

```ts
import {createJsonlSessionLog} from "@notnotype/nb-session";

const log = await createJsonlSessionLog({root: "/data/sessions", sessionId: "s-001"});

await log.append([
    {kind: "message", role: "user", text: "读一下 a.txt"},
    {kind: "tool_call", callId: "c1", toolName: "read", argsJson: '{"path":"a.txt"}'},
    {kind: "tool_result", callId: "c1", isError: false, text: "1: alpha"},
]);

const entries = await log.read({sinceSeq: 0});   // 按 seq 升序
const last = await log.tail();                     // 最后一条或 null
```

文件落在 `/data/sessions/s-001.jsonl`，一行一条。进程崩溃留下半行时，`read` 只返回完好的部分，`append` 会拒绝，直到调用 `repair()` 截掉残片。

测试或临时会话用 `createMemorySessionLog({sessionId})`，接口相同。

## 两种实现

| | `createMemorySessionLog` | `createJsonlSessionLog` |
|---|---|---|
| 存储 | 进程内存 | `<root>/<sessionId>.jsonl` |
| 会话 id 校验 | 不校验 | `[A-Za-z0-9._-]{1,128}` |
| 重启续写 | 不适用 | 读回已有文件 |
| 中断尾 | 不会出现 | `read` 截断、`append` 拒绝、`repair` 修复 |

## 文档

- [API 参考](docs/api.md)：每个导出的参数、返回值与失败。
- [行为规范](../../docs/specs/harness/session-log.md)：持久化格式、状态转换、失败语义和已知缺口。
- [示例](examples/jsonl-log.ts)：`bun examples/jsonl-log.ts`，演示追加、重开续写、中断尾修复。

## 开发

```bash
bun run typecheck
bun test          # 含示例 smoke（tests/examples.test.ts）
```

包级规则见 [AGENTS.md](AGENTS.md)。
