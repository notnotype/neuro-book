# @notnotype/nb-profile

Agent 提示词装配 DSL。用 TSX 声明一棵提示词树：系统提示有哪几段、历史消息展开在哪里、前后放哪些静态消息、哪些内容按条件出现；渲染器把树和当前历史变成系统提示段落与消息列表。

它是 [`@notnotype/nb-harness`](../nb-harness/README.md) 的提示词装配器，不依赖 harness、OMP 或 NeuroBook 产品。注意：它和产品的 Profile SDK（`nbook/profile-sdk`）是两套实现，产品的 `.profile.tsx` 不能用本包加载，差异见 [Spec](../../docs/specs/harness/profile-dsl.md#目标与非目标)。

## 安装与运行环境

- 仓库内 workspace 包（`private`），以 TS 源码作为入口，运行时需要 Bun 1.3.14 及以上（Bun 直接执行 TSX）。
- 只依赖 Node 内置模块。

```jsonc
"dependencies": {"@notnotype/nb-profile": "workspace:*"}
```

## 快速开始

`writer.profile.tsx`：

```tsx
/** @jsxImportSource @notnotype/nb-profile */
import {AppendingSet, HistorySet, ProfilePrompt, Reminder, System} from "@notnotype/nb-profile";

export default (
    <ProfilePrompt>
        <System>你是一名写作助手。</System>
        <HistorySet />
        <AppendingSet>
            <Reminder>不要改动作者没有要求修改的段落。</Reminder>
        </AppendingSet>
    </ProfilePrompt>
);
```

宿主：

```ts
import {loadProfile, renderProfile} from "@notnotype/nb-profile";

const {node} = await loadProfile("writer.profile.tsx");
const {systemPrompt, messages} = renderProfile(node, {
    messages: [{role: "user", text: "把第三段改紧凑一点。"}],
});
// systemPrompt: ["你是一名写作助手。", "不要改动作者没有要求修改的段落。"]
// messages:     [{role: "user", text: "把第三段改紧凑一点。"}]
```

## 节点一览

| 节点 | 作用 |
|---|---|
| `ProfilePrompt`、`Fragment`、`AppendingSet` | 容器 |
| `System`、`Reminder` | 一段系统提示 |
| `HistorySet` | 展开历史（`kind="tool-results"` 只取工具消息） |
| `Message`、`AIMessage` | 静态消息 |
| `ToolCall`、`ToolResult` | 按 `callId` 插入一条历史消息 |
| `If` | `when` 为 `true` 时保留子树 |

写 TSX 时注意：相邻字符串之间会插入换行，句内插值请用模板字符串。

## 文档

- [API 参考](docs/api.md)：节点、渲染、加载与 JSX 运行时。
- [行为规范](../../docs/specs/harness/profile-dsl.md)：渲染规则、失败语义、与产品 SDK 的边界和已知缺口。
- 示例：[`examples/assistant.profile.tsx`](examples/assistant.profile.tsx)（含自定义组件）与 [`examples/render-profile.ts`](examples/render-profile.ts)（加载、渲染、`If` 开关对比），运行 `bun examples/render-profile.ts`。

## 开发

```bash
bun run typecheck
bun test          # 含示例 smoke（tests/examples.test.ts）
```

包级规则见 [AGENTS.md](AGENTS.md)。
