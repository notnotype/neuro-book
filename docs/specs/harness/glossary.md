---
schema: nbook.spec/v1
kind: glossary
status: implemented
capability: harness.glossary
owners:
  - nb-harness
---

# Harness 术语表

`nb-harness` 七份 Spec 共用的词。每个词以“出处”列的 Spec 为准，这里只用一两句帮助定位，成熟度跟随出处；各 Spec 只定义自己新引入的词，用到这里的词时链接本表或出处。新词被第二份 Spec 用到时移入本表。与产品运行时共用的词见 [运行时术语表](../runtime/glossary.md)。

## 会话与历史

| 术语 | 含义 | 出处 |
|---|---|---|
| 会话头、条目、条目输入 | 会话文件第一行是会话头；之后每项是条目，带类型、id、`parentId` 与时间戳；调用方追加的是不含这三项的条目输入。 | [`harness.session`](session.md#术语与参与者) |
| 回放 | 从条目序列计算派生状态（模型上下文、会话状态、设置）的纯函数。 | [`harness.session`](session.md#术语与参与者) |
| 调用窗口 | 一条助手消息加上它之后、下一条助手或用户消息之前的全部工具结果；工具结果只在同一窗口里按 id 配对。 | [`harness.session`](session.md#术语与参与者) |
| 本段历史 | 最后一个 `compaction` 条目之后的条目；没有压缩时为全部条目。压缩从它的起点取历史。 | [`harness.session`](session.md#术语与参与者)、[`harness.compaction`](compaction.md#术语与参与者) |
| 用户发出的消息 | `role: "user"`、`attribution` 不是 `"agent"`、`synthetic` 不为真的消息；种子、提醒与压缩摘要回放后都带 `attribution: "agent"`，不算。 | [`harness.profile`](profile.md#术语与参与者)、[`harness.session`](session.md#术语与参与者) |
| 轮 | 从一条用户发出的消息开始、到下一条之前的全部消息；第一条之前算第一轮。会话的分页与 Profile 的 `History last`、`Reminder every` 用同一划分。 | [`harness.session`](session.md#术语与参与者)、[`harness.profile`](profile.md#术语与参与者) |
| 种子 | Profile `History` 子节点渲染出的消息：新会话开始时写入，每次压缩后再写一次（`once` 的除外）；在会话里是 `harness/seed` 的 `custom_message` 条目。 | [`harness.profile`](profile.md#术语与参与者)（产生）、[`harness.session`](session.md#术语与参与者)（形状）、[`harness.compaction`](compaction.md#术语与参与者)（压缩后重写） |
| 追加消息、请求消息 | `Appending` 渲染出的消息在调用开始时写进会话；直接放在 `Prompt` 下的消息只用于本次请求，不写进会话。 | [`harness.profile`](profile.md#术语与参与者) |
| 未结束的调用、开放窗口 | 最后一个 `invocation` 的阶段为 `start`、`resumed` 或 `waiting` 的调用；它范围内最后一条助手消息的调用窗口（之后没有用户消息）是开放窗口，待处理事项只看它。 | [`harness.session`](session.md#术语与参与者) |

## 调用与状态

| 术语 | 含义 | 出处 |
|---|---|---|
| 调用 | 一次 `prompt`、`continue` 或恢复后 `resolve` 触发的 ReAct 运行，从 `invocation start`（或 `resumed`）到终态；与会话里的 `harness/invocation` 条目一一对应。 | [`harness.runtime`](runtime.md#术语与参与者)、[`harness.session`](session.md#输入与前置条件) |
| 受理 | 操作在写任何条目之前的检查；受理失败返回结构化错误、不留痕迹，受理之后的失败写成调用的终态。 | [`harness.runtime`](runtime.md#术语与参与者) |
| 待处理事项 | 开放窗口里有 request、没有 response 的 `interaction`（第一批只有审批）；会话状态为 `waiting`，运行时为 `waiting-user`。 | [`harness.session`](session.md#输出与可观察行为)（输出 13）、[`harness.runtime`](runtime.md#术语与参与者) |
| 插话队列、追加队列 | `steer` 的消息在下一个工具批次结束时送给模型；`followup` 的消息在本次调用完成后自动开始下一次调用。只在内存里。 | [`harness.runtime`](runtime.md#术语与参与者) |
| 事件 | 运行时发出的带序号的类型化消息，序号在一个会话句柄内从 1 起单调递增，不缓冲、不补发。 | [`harness.runtime`](runtime.md#术语与参与者) |
| 写入时机 | 哪些消息在什么时候进日志：输入与提醒在受理通过后，助手消息与工具结果在 OMP `message_end`，插话在送给模型时。 | [`harness.runtime`](runtime.md#术语与参与者) |

## 模型与配置

| 术语 | 含义 | 出处 |
|---|---|---|
| 配置快照 | 一份校验通过、填好缺省值、深冻结的 `HarnessConfig`；一次调用开始时取定，调用内不变。 | [`harness.config`](config.md#术语与参与者) |
| 模型引用 | `<providerId>/<modelId>`：服务 id 到第一个 `/` 为止，其余整个是模型 id。 | [`harness.config`](config.md#术语与参与者) |
| 模型角色 | 按模型角色合同登记的条目（`id`、`axis`、`modelKey`）；`approval` 角色绑定了模型时审批模式缺省为 `auto`。 | [`harness.config`](config.md#术语与参与者)、[`harness.tools`](tools.md#术语与参与者) |
| 目录 | 配置里自建服务的模型加 OMP 内置目录的模型；同一个引用以配置里的为准。 | [`harness.models`](models.md#术语与参与者) |
| 选择链 | 显式模型 → 指定的角色 → Profile 配置的模型 → Profile 声明的缺省角色 → 全局缺省模型；角色环的失败不回落。 | [`harness.models`](models.md#术语与参与者) |
| 凭据存储 | OMP `AuthStorage` 背后的存储：SQLite 文件或使用方实现的接口；内核不读环境变量。 | [`harness.models`](models.md#术语与参与者) |

## 工具与审批

| 术语 | 含义 | 出处 |
|---|---|---|
| 工具定义 | `defineTool` 的结果：id、说明、参数 schema、风险、作用域与执行函数；内置与插件工具同一协议。 | [`harness.tools`](tools.md#术语与参与者) |
| 等级 | `read`、`write`、`exec` 三档，未声明按 `exec`；`read` 工具为 `read`，`edit` 为 `write`。 | [`harness.tools`](tools.md#术语与参与者)、[`harness.builtin-tools`](builtin-tools.md#输入与前置条件) |
| 策略 | 工具对一组参数声明的 `deny`（一律拒绝）或 `ask`（一律询问用户，`yolo` 除外）。 | [`harness.tools`](tools.md#术语与参与者) |
| 工具来源、可见工具 | 来源列出此刻可用的工具并按次取实现；可见工具是 Profile `harness/tools` 列出的 ∩ 来源可用的，在每次调用开始时取定。 | [`harness.tools`](tools.md#术语与参与者)、[`harness.runtime`](runtime.md#输入与前置条件) |
| 审批模式 | `always-ask`、`write`、`auto`、`yolo`；按会话临时设置 → 配置 → Profile 字段解析，都没有时看 `approval` 角色是否绑定。 | [`harness.config`](config.md#输入与前置条件)、[`harness.tools`](tools.md#术语与参与者) |
| 本会话内允许 | 用户以 `scope: "session"` 批准过的工具与等级，由会话回放得出（`approvalGrants`）。 | [`harness.tools`](tools.md#术语与参与者)、[`harness.session`](session.md#输出与可观察行为)（输出 14） |
| 判定、审批模型 | 对一次工具调用算出放行、拒绝、询问用户或交给审批模型；审批模型是 `approval` 角色解析出的模型，回答 `allow`、`deny` 或 `escalate`。 | [`harness.tools`](tools.md#术语与参与者) |
| 根、根内路径 | `FileAccess` 的绝对目录；相对路径经规范化（符号链接按真实路径）仍在根里才是根内路径。 | [`harness.builtin-tools`](builtin-tools.md#术语与参与者) |
| 快照与标签 | `read` 把展示过的行登记到会话的 OMP `EditStore` 得到标签；`edit` 以 `[path#tag]` 开头据此核对先读后改。标签是内容哈希，不是会话私有令牌。 | [`harness.builtin-tools`](builtin-tools.md#术语与参与者) |

## 压缩

| 术语 | 含义 | 出处 |
|---|---|---|
| 压缩方法、压缩结果 | 注册进来、能判断适用并把历史压成结果的对象；结果形状与 OMP `compact` 的返回值和 `compaction` 条目一致。 | [`harness.compaction`](compaction.md#术语与参与者) |
| 方法顺序、压缩设置 | Profile 字段 `harness/compaction` 给出的方法 id 列表（缺省 `["soft"]`）与 `keepRecentTokens`、`reserveTokens`、`threshold`、`instructions`。 | [`harness.compaction`](compaction.md#术语与参与者)、[`harness.runtime`](runtime.md#输入与前置条件) |
