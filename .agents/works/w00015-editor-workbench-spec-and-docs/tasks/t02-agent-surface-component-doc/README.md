---
schema: nbook.task/v2
taskId: t02-agent-surface-component-doc
---

# AgentChatSurface 组件文档与能力标签

## 目标

按 `docs/standards/code/components.md` 为 `packages/neuro-book/app/components/novel-ide/agent/AgentChatSurface.vue` 补齐同名文档 `AgentChatSurface.md`（与实现并列），关闭 w00014/t01 缺口 9。

## 修改范围

1. frontmatter 写能力标签（封闭清单）。该组件直接读写 store、发起请求、建立长连接、使用定时器，应按「宿主 / 流式宿主」配方逐条核对实际通道后声明（如 `state:local`、`state:shared-read`、`state:shared-write`、`io:read`、`io:mutate`、`io:stream`、`env:timer`、`env:portal`）；实现中存在的通道不得漏声明，声明了实现中不存在的标签同样视为声明不可信。
2. 宿主 / 流式宿主配方要求写全各节：布局、交互、数据、状态、不支持、隐藏通道理由——`state:shared-read` 要写明读取哪个 store 的哪些字段以及为何不能由父组件传入；每个 `io:` 要写明为何该请求不能由宿主发起；`env:portal` 要写明渲染目标与目标缺失时的表现。
3. 「已知偏差」一节明确隔开尚未实现的改进（例如 w00014/t01 缺口 5 记录的孤儿 inline 实现），不混入正文。

## 验证

- 文档与实现交叉核对：每条声明都能在实现里找到对应通道，每个隐藏通道都有标签与理由。
- 文档描述的是"当前应成立的行为"；无法确认的行为不写，或放入「已知偏差」。
- 回到 w00014/t01 记录，把缺口 9 更新为已闭合，并注明 `app/**` 其余组件的整体缺口仍待另案处理。

## 边界

只写文档，不改组件实现；不把 `app/**` 全部组件的文档补齐纳入本 Task。
