---
schema: nbook.spec/v1
kind: behavior
status: implemented
capability: harness.profile-dsl
owners:
  - nb-profile
---

# Profile 提示词装配 DSL

## 目标与非目标

Profile 作者用 TSX（或等价的函数调用）声明一棵提示词树：哪些段落进系统提示，历史消息展开在哪里，哪些静态消息放在前后，哪些内容按条件出现。宿主把当前历史交给渲染器，得到确定的系统提示段落列表和消息列表。同一棵树、同一份历史，渲染结果总是相同。

明确不承诺：

- 不与 NeuroBook 产品的 Profile SDK（`nbook/profile-sdk`）兼容：本 DSL 没有 `defineAgentProfile`、manifest、工具声明（`toolset`）、初始参数 schema、`context(ctx)` 函数，也没有 `SkillCatalog`、`WorkspaceFocusReminder` 等产品节点。产品 Profile 文件不能直接用本包加载。
- 不声明工具：模型能用哪些工具由 harness 装配决定，不在 Profile 里。
- 不做 token 预算、截断或压缩。
- 不隔离 Profile 代码：加载 Profile 就是执行该模块，Profile 文件是受信代码。

## 术语与参与者

- **Profile 节点（ProfileNode）**：`{kind, props, children}` 三元组；`kind` 决定渲染语义。
- **子节点（ProfileChild）**：节点、字符串、`null`、`undefined`、`false`，或它们的嵌套数组。后三种值表示“没有内容”。
- **Profile 模块**：默认导出一个 Profile 节点的 TS/TSX 模块，文件名约定为 `*.profile.tsx`。
- **渲染输入**：宿主提供的历史消息列表，每条为 `{role: "user" | "assistant" | "tool", text, callId?}`。
- **渲染结果**：`{systemPrompt: string[], messages: 渲染消息[]}`。
- **段落文本**：把一个节点下所有字符串按出现顺序用换行连接，再把连续三个及以上换行折叠为两个、去掉首尾空白后的结果。

## 输入与前置条件

- 构造树：调用包导出的节点函数，或在 TSX 中使用同名标签。TSX 文件需要把 JSX 导入源设为 `@notnotype/nb-profile`（文件头 `/** @jsxImportSource @notnotype/nb-profile */` 或 tsconfig 的 `jsxImportSource`）。
- 节点及其参数：

| 节点 | 参数 | 渲染语义 |
|---|---|---|
| `ProfilePrompt` | 无 | 根容器，按顺序渲染子节点 |
| `Fragment` | 无 | 透明容器 |
| `AppendingSet` | 无 | 透明容器（语义上表示“追加在历史之后的内容”，渲染与容器相同） |
| `System` | 无 | 段落文本作为一段系统提示 |
| `Reminder` | 无 | 与 `System` 相同，作为一段系统提示 |
| `HistorySet` | `kind?: "messages" \| "tool-results"` | 在此处展开渲染输入的历史；`tool-results` 只展开 `role` 为 `tool` 的消息；子节点被忽略 |
| `Message` | `role?: "user" \| "assistant"` | 一条静态消息，文本为段落文本；缺省 `user` |
| `AIMessage` | 无 | 一条静态助手消息 |
| `ToolCall` | `callId?: string` | 在历史中找第一条 `callId` 相同的消息并原样插入 |
| `ToolResult` | `callId?: string` | 与 `ToolCall` 相同 |
| `If` | `when: boolean` | `when` 严格为 `true` 时渲染子节点，否则整棵子树丢弃 |

- 渲染：提供 Profile 节点与渲染输入。
- 加载：提供 Profile 模块路径（相对路径按当前工作目录解析），或已导入的模块对象。

## 输出与可观察行为

- `systemPrompt`：按文档顺序收集每个 `System` 与 `Reminder` 的段落文本；段落文本为空时不收集。
- `messages`：按文档顺序收集 `Message`、`AIMessage` 生成的静态消息，`HistorySet` 展开的历史，以及 `ToolCall`/`ToolResult` 查到的历史消息。
- 直接位于容器下、不在 `System`/`Reminder`/`Message`/`AIMessage` 里的字符串不进入任何输出。
- `If` 在容器层和段落文本内部都生效：`when` 不为 `true` 时，子树里的系统段落、消息和文本都不出现。
- 不认识的 `kind`（例如宿主自定义节点）不报错，只按容器处理其子节点。
- `ToolCall`/`ToolResult` 的 `callId` 缺失、为空或在历史中找不到时，不产生消息。
- 同一段历史可以被多个 `HistorySet` 重复展开。
- 加载成功返回 `{path, node}`；`path` 为解析后的绝对路径（`profileFromModule` 未给路径时为 `<memory>`）。
- TSX 中的函数组件（返回 Profile 节点的函数）会被直接调用；字符串标签按上表查找。

## 状态与转换

本能力不引入持久状态。渲染是纯函数：不读环境变量、不读文件、不修改输入。加载会执行模块并由运行时缓存模块，同一路径在同一进程内重复加载得到同一份导出。

## 副作用与数据

- 渲染：无副作用。
- 加载：执行 Profile 模块的顶层代码（含其导入），副作用由该模块自身决定。本包不写任何文件。

## 失败与恢复

- 模块没有默认导出：加载失败，错误信息含路径。
- 默认导出不是 Profile 节点（没有字符串 `kind` 或数组 `children`）：加载失败，错误信息含路径。
- 模块执行或导入失败：原错误向上抛出。
- TSX 使用了不在节点表中的字符串标签：构造时抛错，错误信息含标签名。
- 渲染不抛错：任何形状的树都能渲染，不认识的部分被跳过或透传。

## 边界与兼容

- 包 `@notnotype/nb-profile` 只依赖 Node 内置模块；以 TS 源码为入口，运行时需要 Bun 1.3.14 及以上。导出根入口、`./jsx-runtime` 与 `./jsx-dev-runtime`（Bun 在非 production 下使用后者）。
- 本 DSL 是 nb-harness 的提示词装配器，与产品 Profile SDK 是两套独立实现，见“目标与非目标”。
- 使用方：[`harness.agent-turn`](agent-turn.md) 每轮渲染一次，但当前只消费 `systemPrompt`，不消费 `messages`（见该规范的已知缺口）。
- 已知缺口（当前未保证，修复前不要依赖）：
  - 渲染输入的 `now` 字段被接受但没有任何节点使用。
  - `ToolCall` 与 `ToolResult` 渲染语义完全相同，都只按 `callId` 取第一条匹配消息，不区分调用与结果。
  - `HistorySet` 的子节点被忽略；产品 SDK 中写在 `HistorySet` 里的静态消息在本 DSL 下不会出现。
  - `If` 只接受严格的 `true`，传入真值（如非空字符串）也会被当作 false；类型上要求 `boolean`，但运行时不报错。
  - 段落文本在相邻字符串子节点之间插入换行，因此 TSX 的句内插值会被拆行：`<System>回答使用{lang}。</System>` 渲染为 `"回答使用\n简体中文\n。"`。目前只能改用模板字符串。

## 验收与 Smoke

1. Given `System("第一段")`、`Reminder("提醒一段")`、`System("第二段")`，When 渲染，Then `systemPrompt` 依次为三段，`messages` 为空。
2. Given 静态用户消息、`HistorySet`、`HistorySet kind="tool-results"`、`AIMessage`，以及三条历史（user、tool、assistant），When 渲染，Then 消息文本依次为：静态用户消息、三条历史、tool 历史、静态助手消息。
3. Given 顶层 `If when=false` 包住系统段与消息，以及 `System` 内部的 `If when=false`，When 渲染，Then 被包住的内容都不出现，`System` 内其余文本用换行连接。
4. Given `ToolResult callId="c1"`、`ToolResult callId="missing"`、无 `callId` 的 `ToolResult`，When 渲染，Then 只得到历史中 `callId` 为 `c1` 的那条消息。
5. Given `System` 子节点为 `"标题", "", "", "正文", "  "`，When 渲染，Then 段落为 `"标题\n\n正文"`。
6. Given `Message` 未给 `role` 与 `role="assistant"`，Then 分别渲染为 user 与 assistant。
7. Given 自定义 `kind` 的节点包住一个 `Message`，When 渲染，Then 不报错且消息出现。
8. Given 一个 TSX Profile 文件，When 加载并渲染，Then 返回绝对路径并得到预期系统段与历史；Given 没有默认导出或默认导出不是节点的模块，Then 加载失败且错误含路径。
9. Smoke：在包目录运行 `bun examples/render-profile.ts`，加载 `examples/assistant.profile.tsx` 并打印两种条件下的渲染结果，以 0 退出。

## 实现合同

- **owner**：`packages/nb-profile`（`@notnotype/nb-profile`）。
- **公开接口**：根导出节点函数（`ProfilePrompt`、`System`、`Reminder`、`HistorySet`、`AppendingSet`、`Message`、`AIMessage`、`ToolCall`、`ToolResult`、`If`、`Fragment`）、`renderProfile`、`collectText`、`isProfileNode`、`loadProfile`、`profileFromModule` 与相关类型；`./jsx-runtime` 导出 `jsx`/`jsxs`/`Fragment`/`createElement`/`JSX`，`./jsx-dev-runtime` 导出 `jsxDEV` 等同形入口。逐项说明见 [API 参考](../../../packages/nb-profile/docs/api.md)。
- **关键不变量**：
  - 节点是普通对象，构造时把 `props.children` 规范化为数组；节点函数不做任何 I/O。
  - `renderProfile` 是对树的一次深度优先遍历，输出顺序等于文档顺序。
  - 段落文本的拼接与折叠规则只在 `collectText` 一处实现，`System`、`Reminder`、`Message`、`AIMessage` 共用。
  - 加载器只认默认导出，并在返回前用 `isProfileNode` 校验。

## 证据

- 实现入口：[`render.ts`](../../../packages/nb-profile/src/render.ts)、[`nodes.ts`](../../../packages/nb-profile/src/nodes.ts)、[`loader.ts`](../../../packages/nb-profile/src/loader.ts)、[`jsx-runtime.ts`](../../../packages/nb-profile/src/jsx-runtime.ts)
- 合同测试：[`render.test.ts`](../../../packages/nb-profile/tests/render.test.ts)、[`loader.test.ts`](../../../packages/nb-profile/tests/loader.test.ts)
- Smoke：[`examples.test.ts`](../../../packages/nb-profile/tests/examples.test.ts)（运行 [`examples/render-profile.ts`](../../../packages/nb-profile/examples/render-profile.ts)）
- 批准与实现：2026-09-18 开发者批准以 OMP 为底座重建 harness 并拆出 nb-profile（[w00002 Work](../../../.agents/works/w00002-neuro-agent-harness-redesign/README.md)）；实现见 [t06](../../../.agents/works/w00002-neuro-agent-harness-redesign/tasks/t06-nb-harness-rebuild/README.md)，本规范由 [t07](../../../.agents/works/w00002-neuro-agent-harness-redesign/tasks/t07-harness-specs-and-docs/README.md) 按代码与测试补写。
