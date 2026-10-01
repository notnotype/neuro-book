# nb-session API 参考

包入口：`@notnotype/nb-session`（只有根导出）。行为合同见 [会话日志 Spec](../../../docs/specs/harness/session-log.md)；本文件只说明每个导出怎么用。

## 工厂

### `createMemorySessionLog(options): SessionLog`

进程内存中的日志，适合测试与不需要落盘的短会话。

| 参数 | 类型 | 说明 |
|---|---|---|
| `sessionId` | `string` | 会话 id；内存实现不校验形状 |
| `now` | `() => Date`，可选 | 时钟，默认 `new Date()` |

同步返回，`repair()` 恒为 `{droppedBytes: 0}`。

### `createJsonlSessionLog(options): Promise<SessionLog>`

一会话一文件的 JSONL 日志：`<root>/<sessionId>.jsonl`。

| 参数 | 类型 | 说明 |
|---|---|---|
| `root` | `string` | 已存在的目录；不会自动创建 |
| `sessionId` | `string` | 必须匹配 `SESSION_ID_PATTERN` |
| `now` | `() => Date`，可选 | 时钟 |

创建时读回已有文件以续接 `seq`。会话 id 不合法或根目录不存在时 reject。

```ts
import {createJsonlSessionLog} from "@notnotype/nb-session";

const log = await createJsonlSessionLog({root: "/data/sessions", sessionId: "s-001"});
```

## `SessionLog`

```ts
interface SessionLog {
    readonly sessionId: string;
    append(inputs: readonly SessionEntryInput[]): Promise<readonly SessionEntry[]>;
    read(options?: SessionReadOptions): Promise<readonly SessionEntry[]>;
    tail(): Promise<SessionEntry | null>;
    repair(): Promise<{readonly droppedBytes: number}>;
}
```

同一实例的四个方法按调用顺序串行执行。

| 方法 | 返回 | 失败 |
|---|---|---|
| `append(inputs)` | 打戳后的条目，顺序同入参；空数组直接返回 `[]` | JSONL 文件有中断尾时 reject（先 `repair`）；写文件失败时 reject |
| `read({sinceSeq?, limit?})` | `seq > sinceSeq` 的前 `limit` 条，升序 | 不 reject：JSONL 实现把任何读文件错误都当作空会话（已知缺口，见 Spec） |
| `tail()` | 最后一条或 `null` | 同 `read` |
| `repair()` | 截掉的中断尾字节数；无中断尾为 0 | 截断失败时 reject |

JSONL 实现的 `read`、`tail`、`repair` 每次重读文件；`append` 不重读，单写者前提见 Spec。

## 条目类型

`SessionEntry` 是下面五种的联合，全部带 `SessionEntryBase`（`seq: number`、`at: string`）：

| 类型 | `kind` | 专有字段 |
|---|---|---|
| `MessageEntry` | `"message"` | `role: "user" \| "assistant" \| "system"`、`text: string` |
| `ToolCallEntry` | `"tool_call"` | `callId: string`、`toolName: string`、`argsJson: string` |
| `ToolResultEntry` | `"tool_result"` | `callId: string`、`isError: boolean`、`text: string` |
| `CompactionEntry` | `"compaction"` | `summary: string`、`replacedThroughSeq: number` |
| `MetaEntry` | `"meta"` | `key: string`、`value: JsonValue` |

`SessionEntryInput` 是同样五种去掉 `seq`、`at` 后的联合，作为 `append` 的入参。`JsonValue` 是包自带的 JSON 值类型。

## 会话 id

- `SESSION_ID_PATTERN`：`/^[A-Za-z0-9._-]{1,128}$/`。
- `isValidSessionId(id): boolean`：按上式判断。会话 id 用作文件名，这个限制用来防止路径穿越。
