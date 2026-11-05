---
schema: nbook.spec/v1
kind: behavior
status: planned
capability: agent.compaction
owners:
  - nbook.agent
---

# Agent 的上下文压缩

## 目标与非目标

长对话写到模型窗口上限时不断：`nbook.agent` 给内核的压缩流程（[`harness/runtime.md`](../harness/runtime.md) 输出 46–52）交出三种方法、缺省顺序与放回的内容，插件能贡献别的方法。

不承诺：

- 不做服务商的远端压缩，不做把对话渲染成图片的方法；
- 放回不含“加载过的 Skill”：Skill 还没有实现；
- 不渲染 Markdown 版的对话记录：放回只给会话日志的地址；
- 摘要写得好不好不是合同，只保证小节齐全、“用户的要求”原文保留；
- 方法不设时限：内置方法的模型调用有内核的超时，第三方方法卡住时由用户停止。

## 术语与参与者

- **方法**：一次压缩的实现，内核按名字调用，名字就是贡献 id。
- **保留窗口**：要摘要的方法留原文的部分，最近约 20,000 token。

## 输入与前置条件

贡献点 `agent.compactionMethods`：id 带插件前缀，实现 `(job: CompactionJob) => Promise<CompactionResult>`（[`harness/runtime.md`](../harness/runtime.md) 输出 47）。内置的 `nbook.agent.shake`、`nbook.agent.inplace`、`nbook.agent.summary` 同样经它交出。

缺省顺序：超过阈值与手动 `shake → inplace → summary`，服务商报溢出 `shake → summary`。Profile 的 `compaction.onThreshold`、`onOverflow` 写了的优先。

## 输出与可观察行为

### 方法

1. `shake` 不调模型。保留所有轮（切点取第一个）和上一次的摘要，把保留窗口之外能找回的工具结果（`read`、`grep`、`glob`、图片、输出长的 `shell`）换成占位，占位写明怎么找回。省下的不到压缩前估算的 20% 时失败。
2. `inplace` 用会话的模型与推理档，在压缩前的请求末尾追加压缩请求，工具声明不变，要求不调用工具（`toolChoice: "none"`），输出上限 16,384 token；回复的文字就是摘要。溢出时不用。回复带工具调用或没有文字算失败：有的端点不支持禁止工具调用。
3. `summary` 把请求的消息序列化成文字，用“压缩”角色的模型写摘要。输入放不下时按那个模型的窗口减输出上限分段，后一段带前一段的摘要；单条消息放不下时切块；图片写成尺寸占位。
4. 要摘要的两种方法取保留量不超过 20,000 token 的最早切点，没有时取最后一个（这时保留量可以超过）。`tokensAfter` 是摘要的估算加保留量，和压缩前同一个口径。
5. 摘要的小节：用户的要求（原文）、约束与偏好（文风、人称、禁忌）、已定的设定与情节决定、进度（章节完成、在写、待办）、关键上下文（路径、章节、引用段落）、未回答的问题、下一步（引用原话）。再次压缩时旧摘要里“用户的要求”原样保留；能再取到的细节只留地址。压缩要求（Profile、`/compact` 后面的话、拦截层加的）写进提示词。
6. 成功结果的 `details` 是 `{model?, usage?, require}`：`usage` 是这个方法各次模型调用之和。没有调模型的没有 `model`、`usage`。

### 放回

7. `replacement` 为 null 时不放回：对话没丢。
8. 其余情况放回，每段一条给模型的文字：最近成功读过或改过的至多 5 个文件；`session://plan.md`，有才放；会话日志的地址 `sessions://<本会话>/session.jsonl`。
9. 文件从压缩前的路径按调用与结果配对：只取成功的 `read`、`write`，`edit` 只取 `details.files` 里成功的文件，按时间倒序。经会话的资源视图重新读，权限按现在的算；读不到、撤权、已删除、不是文本的跳过并写诊断，不让压缩失败。
10. 单个文件最多 8,000 token，文件与计划合计不超过 20,000 token 与模型窗口的 25% 中较小的一个，超了截断。显示格式与 `read` 工具相同，并把快照记进会话共用的行锚：模型接着用这些行锚能 `edit`，截断的部分和 `read` 一样不算见过。
11. 放回了什么写进 `compaction` 事件的 `restored`：`[{kind: "file" | "plan" | "log", target, tokens, truncated}]`。

### 贡献的方法

12. 贡献的声明先可读，第一次调用才激活提供方；激活失败算这个方法失败。提供方停止时，在途的调用被中止并算失败，换下一个；晚到的结果丢弃。之后的调用算失败，再激活后用新的一代。

## 状态与转换

方法不写盘、不写日志，只交结果。时序与寿命：

- 一次压缩按顺序逐个调用，前一个失败才调下一个。
- 放回在方法成功之后、写压缩事件之前；中止时不写。
- 行锚的快照在内存里，服务端重启后失效，模型重新 `read`。

## 副作用与数据

压缩事件与放回的文字进会话日志，别的不落盘。

## 失败与恢复

| 码 | 含义 | 调用方怎么办 |
|---|---|---|
| 方法的 `{failed}` | 这个方法没成功 | 内核换下一个 |
| `compaction-failed` | 全部方法失败 | 按 [`harness/runtime.md`](../harness/runtime.md) 输出 46、50、52 收口；对话没动 |
| `restore-skipped` | 放回时一个文件读不到（诊断） | 模型需要时自己 `read` |

## 边界与兼容

公开接口是贡献点 `agent.compactionMethods` 与方法名。第三方方法与内置方法同样信任。压缩事件的 `details`、`restored` 只给界面看，不进请求。

## 验收与 Smoke

1. 真实内核加本机端点：超过阈值，shake 省得够就停；不够换就地，就地的模型、推理档与消息前缀和对话请求相同；就地回复工具调用时换摘要。
2. 服务商报溢出或回 413：shake、摘要，用“压缩”角色，同一请求重发一次。
3. 只配了压缩角色、对话模型不可用时手动压缩走到摘要。
4. 压缩后用放回的行锚直接 `edit` 成功。
5. 第三方方法：未激活、激活失败、运行中撤回、按 Profile 顺序调用。

Smoke：`packages/neuro-book/src/plugins/agent/compaction.llm.test.ts`（真实模型：长对话触发压缩，接着写）。

## 证据

- 批准依据：[w00032 t11](../../../.agents/works/w00032-agent-integration/tasks/t11-compaction/README.md) 的决定与计划确认时的修改，开发者 2026-11-05。
