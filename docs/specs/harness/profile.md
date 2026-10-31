---
schema: nbook.spec/v1
kind: behavior
status: planned
capability: harness.profile
owners:
  - nb-harness
---

# Harness 视图：模板、轮的渲染、提交与槽

## 目标与非目标

给 Profile 作者一套写提示词的接口：由会话某一刻的状态算出一次模型请求。Profile 用 `system` 写系统提示词，用 `prompt`（JSX 模板）摆整张请求，用 `turn` 定进行中的一轮的样子，用 `commit` 定一轮进历史的样子，用 `render` 换事件的文字；扩展用 `contribute` 往具名的槽里交内容。已提交的轮在同一个 Profile 版本下不再变，缓存由结构保证。

请求的形状与内容块见 [`harness/models.md`](models.md)；何时算请求、算不出时怎样收口见 [`harness/runtime.md`](runtime.md)；扩展的定义、装配与 `render` 的键见 [`harness/extensions.md`](extensions.md)。

不承诺：

- 内核不拼接相邻的 user 消息；服务商要求时由适配器合成（`models.md` 输出 5）。
- 模板里的文字不转义；`<Tag>` 的属性值转义见输出 3。
- 压缩摘要的块（来源 `summary`）随压缩补齐；预览过去的请求随宿主面补齐。
- 非对话请求（审批、压缩、后台）的样子由各自的入口定，不走 Profile 的模板。

## 术语与参与者

- **视图**：“状态 → 请求”这一步，只在要发请求与预览时算。
- **模板**：Profile 的 `prompt` 返回的节点树（`@notnotype/nb-harness/prompt` 的组件）。
- **容器**：`<System>`、`<User>`、`<Assistant>`；**行内节点**：`<P>`、`<Tag>`、`<ToolName>`。
- **块**：请求里的一段内容，带结构化的来源（`origin`）。
- **槽**：扩展经 `contribute` 交内容的具名位置；模板用 `<Slot>` 摆放。
- **提交**：一轮结束后以 `commit` 渲染成消息、并进历史。
- **生效工具集**：这次请求声明给模型的工具。

## 输入与前置条件

Profile 上与视图有关的字段（类型以 `/kernel/contracts` 导出的定稿类型为准）：

| 字段 | 形状 | 读视图 |
|---|---|---|
| `system` | 文字、模板节点，或 `(view) => 节点` | 是 |
| `prompt` | `(view) => 节点`；不写就是 `standardLayout()` | 是 |
| `turn` | `(turn, format, view) => 消息[]`；不写就是 `format.turn(turn)` | 是 |
| `commit` | `(turn, format) => 消息[]`；不写与 `turn` 相同 | 否 |
| `render` | 事件名 → `(event) => 文字 \| null` | 否 |

扩展的 `contribute`：槽名 → `{value: (view) => 文字 | null | undefined, volatile?, shared?}`。`value` 是纯函数。

模板节点：

| 节点 | 放在哪里 | 渲染成 |
|---|---|---|
| `<System>…</System>` | 顶层 | 系统块 |
| `<System />`（自闭合） | 顶层、`<System>` 里 | Profile 的 `system` |
| `<User>`、`<Assistant>` | 顶层 | 一条消息 |
| `<History last?>` | 顶层 | 已提交的轮（全部或最近 `last` 轮） |
| `<Turn />` | 顶层，恰好一个 | 进行中的这一轮 |
| `<Slot name stable? volatile? drop?>` | 顶层、容器里 | 槽的块；在顶层时成一条 user 消息 |
| `<P>`、`<Tag name attrs?>`、`<ToolName id>` | 任何位置 | 行内文字；在顶层时成一条 user 消息 |
| `<If tool>` | 任何位置 | 工具在生效工具集里时渲染子节点 |
| 文字、数字 | 任何位置 | 文字；在顶层时成一条 user 消息 |

`<Fragment>`（`<>…</>`）与数组展开到所在位置；`null`、`undefined`、`true`、`false` 什么也不渲染。

`helpers` 导出的纯函数：`standardLayout(options?)`、`finalOnly(turn)`、`withoutEvents(turn, dependency, ...names)`。

## 输出与可观察行为

模板：

1. 不写 `prompt` 时请求依次是：系统块（Profile 的 `system`，接着收稳定的槽）、开场槽 `opening`（一条 user 消息；没有扩展交开场时没有这条）、已提交的轮、进行中的这一轮、会变的槽（一条 user 消息）。`standardLayout({volatile: "before-turn"})` 把会变的槽移到进行中的这一轮之前；`history: false` 不放已提交的轮，`history: {last: n}` 只放最近 n 轮。
2. 容器里每个子节点是一块；行内节点把子节点直接相连成一块；块之间怎样分段由适配器决定。没有文字的块与没有块也没有工具调用的消息丢弃。
3. `<Tag name attrs>` 渲染成 `<name k="v">…</name>`，属性按书写顺序，值里的 `&`、`"`、`<` 转义成 `&amp;`、`&quot;`、`&lt;`；子节点不转义。
4. `<ToolName id>` 渲染成这个工具交给服务商的名字（显式的 `providerName`，否则按 `models.md` “输入与前置条件”的规则换算）；`<If tool>` 只在这个工具 id 在生效工具集里时渲染子节点。
5. 模板放错位置（`<History>`、`<Turn />`、`<User>`、`<Assistant>`、带子节点的 `<System>` 放进容器或行内节点；`<System />` 放进 `<User>`、`<Assistant>` 或行内节点；`<Slot>` 放进行内节点）时这次请求算不出来，诊断 `template-invalid`；`<Turn />` 不是恰好一个时同样算不出来，诊断 `turn-node-count`。两者都按 `runtime.md` 输出 10 收口，`extensionFailed` 的 `code` 为 `invalid-output`。

轮的渲染：

6. `format.turn(turn)`：附带内容在前、用户的话在最后，合成一条 user 消息；然后每一步依次是回复（带工具调用）、各工具结果（每条一条 tool 消息）、这一步之后的对话事件（合成一条 user 消息）。
7. 事件的文字按优先级取：`format.withRender` 给的（只在 `commit` 里）、Profile 的 `render`、扩展给自己事件的 `render`、缺省。缺省：回复取它的内容块（文字、思考与服务商元数据原样保留）；`data.text` 是字符串的取它；其余把 `data` 的 JSON 包进 `<system-reminder>`。`render` 返回 `null` 或空文字时这条事件不渲染；回复与工具结果的 `render` 返回 `null` 时（类型不允许，JS 写法可能出现）用缺省文字，免得留下没有结果的工具调用；`render` 抛错时用缺省文字，诊断 `render-threw`。
8. `format.assistantText(reply)` 只留回复的文字、不带工具调用；Profile 的 `render` 覆盖了 `assistant` 时，回复渲染成那一段文字，工具调用照常保留。
9. Profile 的 `turn` 抛错时这次请求算不出来，按 `runtime.md` 输出 10 收口（`entry: "turn"`）。

提交：

10. 一轮结束后，第一次需要它的请求用 `commit(turn, format)` 把它渲染成消息；没写 `commit` 时用 Profile 的 `turn`（视图取那次请求的）。同一个 Profile 哈希（`extensions.md` 输出 28）下，已提交的轮的消息之后每次请求原样拼接，不再调用 `commit`。
11. `commit` 是纯函数：同一组事件、同一个 Profile 哈希，重开会话或回退之后算出的消息逐块一致。Profile 哈希变了，按新 Profile 重新渲染全部已提交的轮。
12. `commit` 抛错时这一轮用 `format.turn(turn)` 提交，诊断 `commit-threw`；交回的消息里工具调用与结果不成对（输出 17 的规则）时同样改用 `format.turn(turn)`，诊断 `commit-invalid`。之后的请求照常。
13. `finalOnly(turn)` 去掉工具结果、中间的步与每一步之后的事件，只留最后一步的回复并去掉它的工具调用；附带内容与用户的话保留。没有回复的轮原样交回。
14. `withoutEvents(turn, dependency, ...names)` 从附带内容与每一步之后的事件里去掉这个依赖的这几种对话事件（类型 `<依赖 id>/<名字>`）。

槽：

15. 每个扩展的 `value` 返回非空文字时交一块（来源 `{kind: "slot", name, extension}`），同一个槽的几块按装配序排。`value` 抛错时这个扩展的这个槽这次不交，诊断 `contribute-threw`。
16. `<Slot name="x">` 放槽 `x` 的块；`<Slot name="*" stable>`、`<Slot name="*" volatile>` 收没有被按名字摆放的、稳定或会变的槽（不论按名字的写在前面还是后面）；`<Slot name="x" drop>` 表示有意不要，不渲染也不报诊断。槽有内容而模板没摆时内容丢弃，诊断 `slot-unplaced`。会变的槽被放进系统块时诊断 `slot-volatile-in-system`。同一个槽名有几个扩展交内容、且不是都写了 `shared: true` 时，装配时诊断 `slot-collision`，各块照常渲染。

请求：

17. 发请求前校验：每条 tool 消息回答它之前最近一条带工具调用的 assistant 消息里的一个调用，紧跟在那条 assistant 消息之后（中间只隔着其它 tool 消息）；每个调用恰好有一条结果。不满足时运行以 `error`、码 `request-invalid` 收口，诊断 `request-invalid` 写明第一处不合格的位置。
18. 每一块都带来源：模板与 `format.user` 里的固定文字是 `{kind: "fixed", by: "profile"}`；事件是 `{kind: "event", eventId, type, extension}`（内核事件的 `extension` 为 `kernel`）；槽是 `{kind: "slot", name, extension}`。
19. 开发模式（`NODE_ENV` 不是 `production`，与冻结状态的开关相同）下的检查：同一轮相邻两次请求里进行中这一轮的消息，前一次按块（角色、来源与内容哈希）必须是后一次的前缀，否则诊断 `prefix-unstable`；没写 `commit` 时，提交的消息同样必须以这一轮最后一次请求里的样子开头，否则诊断 `commit-differs`。
20. 测试工具的 `requests[n].outline()` 一行一条消息：`<角色>: <来源> | <来源>`，来源写作 `fixed:<by>`、`event:<类型>`、`slot:<槽名>@<扩展>`、`summary:<压缩 id>`、`intercept:<扩展>`，工具调用写作 `call:<工具 id>`；有系统块时第一行是 `system: …`。

## 状态与转换

无。视图是状态的纯函数；内核记住的只有已提交的轮的渲染结果与开发检查用的上一次渲染，都不进日志。

时序与寿命：

- 已提交的轮的渲染结果在会话打开期间、Profile 哈希不变时有效；重开或换 Profile 后重新算。
- 视图读这次请求所在叶子的状态（`extensions.md` 输出 23）。

## 副作用与数据

无。视图不写日志；请求的哈希随 `modelStarted` 写入（`runtime.md` 输出 6）。

## 失败与恢复

| 码 | 含义 | 调用方怎么办 |
|---|---|---|
| `profile-failed` | `prompt`、`system`、`turn` 抛错，或模板结构不合规（`template-invalid`、`turn-node-count`） | 按诊断改 Profile |
| `request-invalid` | 算出的请求里工具调用与结果不成对 | 检查 `turn` 有没有丢掉工具结果 |

视图的诊断码：`template-invalid`、`turn-node-count`、`render-threw`、`commit-threw`、`commit-invalid`、`contribute-threw`、`slot-unplaced`、`slot-volatile-in-system`、`slot-collision`、`request-invalid`、`prefix-unstable`、`commit-differs`。

## 边界与兼容

- 公开接口：`@notnotype/nb-harness/prompt` 的组件与 JSX 运行时；`/kernel` 的 `standardLayout`、`finalOnly`、`withoutEvents`；`Format` 的方法。
- 模板节点的渲染规则与块的来源是 Profile 作者依赖的合同；新增节点只追加。

## 验收与 Smoke

1. 一个写了 `commit`（`finalOnly`）的 Profile 跑两轮带工具调用的对话，重开会话再跑一轮：第三次运行的请求里，前两轮的消息与重开前最后一次请求里的逐块一致，且不含工具调用。
2. 2 万条事件的会话打开后算一次请求（提交缓存冷）与接着再算一次（缓存热），各自用时进 Task 证据。

Smoke：不适用——视图由内核测试覆盖，没有独立入口。

## 证据

- 批准依据：[提案：Agent harness 的事件模型](../../proposals/agent-harness-event-model.md)第 7、8、13 节（2026-10-31 接受）、[ADR 0035](../../adr/0035-harness-log-driven-kernel.md)
