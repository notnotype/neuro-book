# nb-profile API 参考

包入口：`@notnotype/nb-profile`，另有 `@notnotype/nb-profile/jsx-runtime` 与 `@notnotype/nb-profile/jsx-dev-runtime`。行为合同见 [Profile DSL Spec](../../../docs/specs/harness/profile-dsl.md)；本文件只说明每个导出怎么用。

## 节点函数

全部节点函数接收一个 props 对象，返回 `ProfileNode`，不做 I/O。`children` 可以是单个子节点或数组。

| 函数 | props | 作用 |
|---|---|---|
| `ProfilePrompt` | `children` | 根容器 |
| `Fragment` | `children` | 透明容器 |
| `AppendingSet` | `children` | 透明容器，表示追加在历史之后的内容 |
| `System` | `children` | 一段系统提示 |
| `Reminder` | `children` | 一段系统提示（与 `System` 相同） |
| `HistorySet` | `kind?: "messages" \| "tool-results"` | 在此处展开历史；`tool-results` 只取 `role: "tool"`；子节点被忽略 |
| `Message` | `role?: "user" \| "assistant"`、`children` | 静态消息，缺省 `user` |
| `AIMessage` | `children` | 静态助手消息 |
| `ToolCall` | `callId?: string` | 插入历史中第一条同 `callId` 的消息 |
| `ToolResult` | `callId?: string` | 同 `ToolCall` |
| `If` | `when: boolean`、`children` | `when === true` 时保留子树 |

```ts
import {HistorySet, ProfilePrompt, System} from "@notnotype/nb-profile";

const node = ProfilePrompt({children: [System({children: ["你是写作助手。"]}), HistorySet({})]});
```

## TSX

在 `.profile.tsx` 文件头声明 JSX 导入源，或在 tsconfig 中设置 `"jsx": "react-jsx"` 与 `"jsxImportSource": "@notnotype/nb-profile"`：

```tsx
/** @jsxImportSource @notnotype/nb-profile */
import {HistorySet, ProfilePrompt, System} from "@notnotype/nb-profile";

export default (
    <ProfilePrompt>
        <System>你是写作助手。</System>
        <HistorySet />
    </ProfilePrompt>
);
```

- 标签可以是上表的节点函数，也可以是任意返回 `ProfileNode` 的函数（自定义组件）。
- 未导入、按字符串查找的标签只认上表名称，其它名称在构造时抛错。
- 相邻字符串子节点之间会插入换行。句内插值写成模板字符串：``{`回答使用${lang}。`}``，不要写成 `回答使用{lang}。`。

`jsx-runtime` 导出 `jsx`、`jsxs`、`Fragment`、`createElement` 与 `JSX` 命名空间；`jsx-dev-runtime` 导出同形的 `jsxDEV`，Bun 在非 production 下使用它。一般不需要直接导入这两个子路径。

## 渲染

### `renderProfile(node, input): RenderedProfile`

```ts
interface ProfileRenderInput {
    readonly messages: readonly ProfileRenderMessage[];
    readonly now?: () => Date;   // 当前没有节点使用
}
interface ProfileRenderMessage {
    readonly role: "user" | "assistant" | "tool";
    readonly text: string;
    readonly callId?: string;
}
interface RenderedProfile {
    readonly systemPrompt: readonly string[];
    readonly messages: readonly ProfileRenderMessage[];
}
```

纯函数。`systemPrompt` 是每个 `System`/`Reminder` 的段落文本（空段落不收集）；`messages` 按文档顺序收集静态消息与展开的历史。不认识的节点 `kind` 按容器处理，不抛错。

### `collectText(children): string`

把子节点中的字符串按顺序用换行连接，遵守 `If`，折叠连续空行并去掉首尾空白。`System`、`Message` 等节点的文本都由它生成；自定义节点需要同样的文本规则时可以复用。

## 加载

### `loadProfile(path): Promise<LoadedProfile>`

导入模块（相对路径按当前工作目录解析），取默认导出并校验。返回 `{path: 绝对路径, node}`。模块没有默认导出、默认导出不是节点或模块执行失败时 reject。加载会执行模块代码，Profile 文件是受信代码。

### `profileFromModule(mod, path?): LoadedProfile`

对已经导入的模块对象做同样的校验，适合宿主自己控制导入方式（例如打包后的模块表）。`path` 只用于返回值与错误信息，缺省为 `<memory>`。

### `isProfileNode(value): value is ProfileNode`

`kind` 为字符串且 `children` 为数组即视为节点。

## 类型

- `ProfileNode`：`{kind: string, props: Record<string, unknown>, children: ProfileChild[]}`。
- `ProfileChild`：`ProfileNode | string | null | undefined | false | ProfileChild[]`。
- `LoadedProfile`、`ProfileRenderInput`、`ProfileRenderMessage`、`RenderedProfile`：见上文。
