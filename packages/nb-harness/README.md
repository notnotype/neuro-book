# @notnotype/nb-harness

NeuroBook 的 Agent harness：以 OMP 包族（`@oh-my-pi/*`）为底座，把模型、内置文件工具、插件工具、Profile 和会话日志装配成一个会话句柄。宿主每提交一条输入，句柄跑完一整轮 Agent 循环，把消息和工具调用按顺序写进会话日志，并实时转发运行事件；另带一套 SSE 序列化与写出工具，方便把事件推给客户端。

它面向 NeuroBook 领域，不追求通用；通用能力直接用 OMP，领域工具通过插件接入。目前还没有接入 NeuroBook 产品（由 Issue #117 管理）。

> **使用前须知**：当前版本只适合受信的本机使用。内置 `read`/`edit` 不限制在 `cwd` 内，harness 里的 `edit` 没有写前确认；模型失败与中止会表现为空回复；重启后模型上下文不会从日志恢复。完整清单见 [agent-turn](../../docs/specs/harness/agent-turn.md#边界与兼容) 与 [file-tools](../../docs/specs/harness/file-tools.md#边界与兼容) 的已知缺口。

## 包关系

```text
@notnotype/nb-harness ──► @notnotype/nb-session   会话日志
        │            └──► @notnotype/nb-profile   提示词装配
        └──► @oh-my-pi/pi-agent-core / pi-ai / pi-catalog / pi-natives / pi-utils（精确锁定 18.2.5）
```

## 安装与运行环境

- 仓库内 workspace 包（`private`），以 TS 源码作为入口。OMP 只发布 TS 源码，只能在 Bun 1.3.14 及以上运行，Node 不可用。
- OMP 依赖带平台原生包（Linux x64 约 346 MB）。
- OMP 的环境模块在导入时会读取 `$HOME/.env` 和当前目录的 `.env` 并修改 `Bun.env`，见 [OMP 能力报告第 7 节](docs/omp-capabilities.md)。

```jsonc
"dependencies": {
    "@notnotype/nb-harness": "workspace:*",
    "@notnotype/nb-profile": "workspace:*",
    "@notnotype/nb-session": "workspace:*"
}
```

## 快速开始

```ts
import {createHarness} from "@notnotype/nb-harness";
import {ProfilePrompt, System} from "@notnotype/nb-profile";
import {createJsonlSessionLog} from "@notnotype/nb-session";

const harness = await createHarness({
    model: "deepseek/deepseek-flash",                  // API key 缺省读 DEEPSEEK_API_KEY
    cwd: "/path/to/workspace",                          // read / edit 的相对路径基准
    sessionLog: await createJsonlSessionLog({root: "/path/to/sessions", sessionId: "s-001"}),
    node: ProfilePrompt({children: [System({children: ["你是一名写作助手。"]})]}),
});

harness.subscribe((event) => console.log(event.type));   // agent_start … agent_end

const {text, entries} = await harness.turn("读取 chapter.md，把第三行改得更紧凑。");
await harness.close();
```

不想调用真实模型时，传 `streamFn: scriptedStreamFn("固定回复")`（来自 `@notnotype/nb-harness/testing`）和任意 `apiKey`，即可离线验证装配。

## 能力

| 能力 | 入口 | 规范 |
|---|---|---|
| 装配与对话轮次 | `createHarness`、`resolveModel`、`definePlugin` | [agent-turn](../../docs/specs/harness/agent-turn.md) |
| 文件工具 | `read`、`edit`（`createReadTool`、`createEditTool`） | [file-tools](../../docs/specs/harness/file-tools.md) |
| SSE | `serializeSseEvent`、`serializeAgentEvent`、`writeSseStream` | [sse](../../docs/specs/harness/sse.md) |

`edit` 缺省使用 OMP 的 hashline 模式：模型先 `read` 拿到 `[path#tag]` 锚点头，再按行号发起修改；锚点伪造或修改未展示的行会被拒绝，磁盘不变。

## 示例

在包目录运行：

| 命令 | 内容 | 调用真实模型 |
|---|---|---|
| `bun examples/offline-turn.ts` | Profile + 会话日志 + 插件工具 + 两轮对话 + 日志读回 | 否 |
| `bun examples/file-tools.ts` | 直接调用 `read`/`edit`：先读后改、伪造锚点、写前确认 | 否 |
| `bun examples/sse-stream.ts` | `node:http` 起本机端口，把一轮对话的事件经 SSE 推给 `fetch` 客户端 | 否 |
| `bun examples/real-model.ts` | 模型调用 `read` 读文件后回答；需要进程环境里有 `DEEPSEEK_API_KEY`，没有时跳过 | 是 |

## 文档

- [API 参考](docs/api.md)：每个导出的参数、返回值与用法。
- [OMP 能力报告](docs/omp-capabilities.md)：OMP 包族的能力面、编辑引擎实测语义与陷阱。
- 行为规范：[agent-turn](../../docs/specs/harness/agent-turn.md)、[file-tools](../../docs/specs/harness/file-tools.md)、[sse](../../docs/specs/harness/sse.md)。

## 开发

```bash
bun run typecheck
bun test                                 # 不调用模型；真实模型用例显示为跳过
bun run test:llm                         # 真实模型用例（*.llm.test.ts），凭据从仓库根 .env 读取
```

包级规则见 [AGENTS.md](AGENTS.md)。
