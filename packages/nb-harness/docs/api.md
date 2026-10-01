# nb-harness API 参考

包入口：`@notnotype/nb-harness`，测试辅助在 `@notnotype/nb-harness/testing`。行为合同按能力分为四份 Spec：

- [Harness 装配与对话轮次](../../../docs/specs/harness/agent-turn.md)（`createHarness`、模型、插件）
- [内置文件工具](../../../docs/specs/harness/file-tools.md)（`read`、`edit`、`truncateText`）
- [SSE 序列化与写出](../../../docs/specs/harness/sse.md)
- 依赖的 [会话日志](../../../docs/specs/harness/session-log.md) 与 [Profile DSL](../../../docs/specs/harness/profile-dsl.md)

本文件只说明每个导出怎么用；类型中出现的 `Model`、`AgentTool`、`AgentEvent`、`StreamFn`、`Effort`、`EditStore` 等来自 OMP 包族，见 [OMP 能力报告](omp-capabilities.md)。

## Harness

### `createHarness(options): Promise<Harness>`

| 选项 | 类型 | 说明 |
|---|---|---|
| `model` | `Model \| string` | `"provider/modelId"`、目录内唯一的裸 `modelId`，或 OMP `Model` 对象 |
| `cwd` | `string` | 内置工具解析相对路径的目录 |
| `sessionLog` | `SessionLog` | 来自 `@notnotype/nb-session` |
| `node` | `ProfileNode` | 来自 `@notnotype/nb-profile` |
| `plugins` | `HarnessPlugin[]`，可选 | 创建时注册 |
| `streamFn` | `StreamFn`，可选 | 缺省 OMP `streamSimple`；离线装配用 `scriptedStreamFn` |
| `apiKey` | `(model) => string \| undefined`，可选 | 缺省 `createEnvApiKeyResolver()` |
| `thinkingLevel` | `Effort`，可选 | 推理强度 |
| `readMaxLines`、`readMaxBytes` | `number`，可选 | `read` 输出预算，缺省 2000 行、50 KiB |

模型引用无法解析、插件名为空或重复时 reject。

### `Harness`

```ts
interface Harness {
    readonly sessionId: string;
    readonly tools: readonly AgentTool[];
    turn(input: string, options?: {readonly signal?: AbortSignal}): Promise<HarnessTurnResult>;
    subscribe(listener: (event: AgentEvent) => void): () => void;
    use(plugin: HarnessPlugin): void;
    close(): Promise<void>;
}

interface HarnessTurnResult {
    readonly text: string;                     // 本轮最后一条助手消息的文本
    readonly entries: readonly SessionEntry[]; // 本轮写入日志的全部条目，含用户消息
}
```

| 成员 | 说明 |
|---|---|
| `tools` | 内置 `read`、`edit` 在前，插件工具按注册顺序在后；每次访问返回新数组 |
| `turn` | 渲染 Profile 设置系统提示 → 追加用户消息 → 跑完 Agent 循环 → 等日志写完后返回。不排队：上一轮未结束时再调用会被 OMP 以 `AgentBusyError` 拒绝 |
| `subscribe` | 同步收到 OMP 原始事件；返回取消函数 |
| `use` | 注册插件，对之后的模型调用生效；重名抛错 |
| `close` | 取消订阅、中止循环、等待日志写入；不报告写入错误 |

使用前必读 [agent-turn 的已知缺口](../../../docs/specs/harness/agent-turn.md#边界与兼容)：模型失败、缺 key 与中止都会让 `turn` 正常返回空文本；模型上下文不会从日志恢复。

```ts
const harness = await createHarness({model: "deepseek/deepseek-flash", cwd, sessionLog, node});
const controller = new AbortController();
const {text, entries} = await harness.turn("读取 a.txt 并总结", {signal: controller.signal});
await harness.close();
```

## 模型

| 导出 | 说明 |
|---|---|
| `resolveModel(reference): Model` | 解析模型引用；空引用、未知 provider、未知模型、裸 id 不唯一时抛错 |
| `listProviders(): string[]` | OMP 内置目录的 provider id |
| `createEnvApiKeyResolver()` | 返回 `(model) => key`：先查 OMP 的 provider 环境变量，`deepseek` 再回退 `DEEPSEEK_API_KEY` |
| `applyBaseUrlOverride(model): Model` | `deepseek` 模型在 `DEEPSEEK_API_BASE` 非空时换 `baseUrl`，其它原样返回 |

## 插件

```ts
interface HarnessPlugin {
    readonly manifest: PluginManifest;            // {name, version?, description?}
    readonly tools?: readonly AgentTool[];
    readonly readFormats?: readonly PluginReadFormat[];
}

interface PluginReadFormat {
    readonly id: string;
    canRead(path: string): boolean;
    read(path: string, options: {offset?: number; limit?: number}): Promise<{text: string} | null>;
}
```

| 导出 | 说明 |
|---|---|
| `definePlugin(plugin)` | 校验 `name` 非空、同一插件内工具不重名，原样返回；不检查与其它插件或内置工具的重名 |
| `createPluginHost()` | 返回 `PluginHost`：`register`（重名抛错）、`unregister`（未注册抛错）、`list`、`tools`、`readFormats`。harness 内部使用，宿主也可以单独用 |

工具一律实现 OMP 的 `AgentTool`：

```ts
const echo: AgentTool = {
    name: "echo",
    label: "Echo",
    description: "回显输入",
    parameters: {type: "object", properties: {text: {type: "string"}}, required: ["text"]},
    execute: async (_toolCallId, params) => ({content: [{type: "text", text: String((params as {text: string}).text)}]}),
} as AgentTool;

harness.use(definePlugin({manifest: {name: "demo"}, tools: [echo]}));
```

## 文件工具

### `createReadTool(options: ReadToolOptions): AgentTool`

| 选项 | 说明 |
|---|---|
| `cwd` | 相对路径的基准 |
| `formats` | 插件读取格式，按顺序尝试 |
| `maxLines`、`maxBytes` | 输出预算，缺省 2000、51200 |
| `store` | 与 `edit` 共享的 `EditStore`；给出时输出 `[path#tag]` 锚点头并登记快照 |

工具参数：`{path, offset?, limit?}`。输出格式与失败见 [file-tools Spec](../../../docs/specs/harness/file-tools.md)。

### `createEditTool(options: EditToolOptions): AgentTool`

| 选项 | 缺省 | 说明 |
|---|---|---|
| `cwd` | — | 相对路径的基准 |
| `mode` | `"hashline"` | `EditToolMode`：`hashline`、`replace`、`patch`、`apply_patch` |
| `store` | 新建 | 必须与 `read` 共享同一个实例 |
| `confirmWrite` | 全部允许 | `(request) => boolean \| Promise<boolean>`；返回 false 则该次编辑返回错误结果、不写盘 |
| `allowFuzzy`、`fuzzyThreshold` | `true`、`0.8` | OMP 模糊匹配 |
| `enforceSeenLines` | `true` | 只允许改 `read` 展示过的行 |
| `localSandboxRoot`、`vaultRoots`、`homeDir` | —、—、用户主目录 | 原样传给 OMP 引擎，策略未定义 |

工具参数：`{input: string}`，内容为所选模式的原文载荷。两个工具都不限制在 `cwd` 内，见 Spec 的访问范围说明。

### `truncateText(content, {maxLines, maxBytes}): TextBudgetResult`

按行累加、先到先停：返回 `{text, truncated, reason}`，`reason` 为 `"lines"`、`"bytes"` 或 `null`。不追加省略提示。

## SSE

| 导出 | 说明 |
|---|---|
| `serializeSseEvent({data, event?, id?, retry?})` | 编码一帧；非法输入抛错 |
| `serializeSseComment(text)` | 编码注释行 `: text\n` |
| `serializeSseJsonEvent({data: JsonValue, event?, id?, retry?})` | `data` 先 `JSON.stringify` |
| `serializeAgentEvent(event)` | 事件名 `agent`、`data` 为事件 JSON |
| `writeSseStream(response, subscription)` | 设置 SSE 响应头，按背压写出 `connected` 帧和订阅中的每一帧，并处理双向关闭 |

```ts
type SseFrame = {readonly frame: Buffer};
type SseSubscription<Event extends SseFrame> = AsyncIterable<Event> & {
    readonly connected: Event;
    readonly signal: AbortSignal;
    close(reason?: "consumer_closed"): void;
};
```

`SseResponse` 是 Node `ServerResponse` 的最小子集，`node:http` 的 response 可以直接传入。完整的订阅实现见 [`examples/sse-stream.ts`](../examples/sse-stream.ts)。

## 测试辅助：`@notnotype/nb-harness/testing`

### `scriptedStreamFn(reply: string | {text: string}): StreamFn`

每次模型调用都立即返回同一段文本、`stopReason: "stop"` 的流。只用于验证装配（工具注册、事件、日志落盘），不能代替真实模型；按仓库测试合同，需要模型行为的测试必须调用真实 DeepSeek。
