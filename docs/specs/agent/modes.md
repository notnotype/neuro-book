---
schema: nbook.spec/v1
kind: behavior
status: planned
capability: agent.modes
owners:
  - packages/neuro-book/src/plugins/agent/backend/permissions
  - packages/neuro-book/src/plugins/agent/web
---

# Agent 模式

## 目标与非目标

给会话三种工作状态：`normal` 正常干活，`discuss` 只讨论，`plan` 讨论并写计划。模式和审批模式是两个独立的维度：模式回答“现在要不要改东西”，审批模式回答“改的时候问不问”。

不承诺：

- 模式不是安全边界，闸门靠[规则的命令判定](permissions.md)，同样只覆盖模型通常的写法。
- 批准计划时不清上下文，要时用户自己 `/compact`。

## 术语与参与者

- **闸门**：`discuss`、`plan` 下拦截写调用的那一步，位置见 [`agent/permissions.md`](permissions.md) 输出 1。
- **草稿**：当前会话目录（`session://`）与临时目录（`tmp://`）。写它们不算写。
- 主 Profile 装模式扩展 `nbook.agent.modes`；没装的 Profile 没有模式，界面不显示，闸门不起作用。

## 输入与前置条件

| 模式 | 提示 | 闸门 |
|---|---|---|
| `normal` | 无 | 无 |
| `discuss` | 只讨论，不改作品 | 有 |
| `plan` | 只讨论，把计划写到 `session://plan.md`，写完用 `switch_mode` 申请开始 | 有 |

- 扩展设置 `mode`，经 `changeSettings` 修改，缺省 `normal`。
- 设置 `nbook.agent/modeWriteAction`（用户层）：`deny`（缺省）或 `ask`。

工具 `switch_mode{mode}`。

## 输出与可观察行为

### 闸门

1. 调用分三类。`effect` 是读：只读，放过。判定对象里有写路径，全部落在草稿里，且命令都只读：只写草稿，放过且不问。其余都算写：`modeWriteAction` 是 `deny` 时拒绝，码 `mode-blocked`，文字告诉模型切换模式；是 `ask` 时询问。
2. 算写的调用，放行规则与 `yolo` 都不能放过（[`agent/permissions.md`](permissions.md) 输出 1）。拒绝规则先于闸门。
3. 没有判定对象的写工具、看不懂的命令都算写。
4. 界面把 `mode-blocked` 显示成单独的文字（“计划模式下不能修改文件”），不显示成规则拒绝。

### 提示

5. 提示放在这一轮开头的消息里（`reminder`），不进系统提示词，工具集不随模式变。模式变了的那一轮写完整提示，之后每轮一句短的；回到 `normal` 时写一句“已退出”，之后不写。压缩、回退后再写一次完整的。
6. 同一模式连续多轮，请求的前缀不变；切换只影响新写的这条之后。

### 切换

7. 用户切换立刻生效，经模式控件、Shift+Tab、`/plan`、`/mode`。还没有会话时存在宿主里，建会话后、第一次发送前提交。
8. 模型用 `switch_mode` 申请，任何审批模式下都要用户答：它的 `effect` 是读，不经审批，工具自己用提问通道问（[`harness/runtime.md`](../harness/runtime.md) 输出 39 的提问）。放行规则与 `yolo` 不起作用，拒绝规则能禁掉它。
9. 目标已是当前模式：直接返回，不问。后台会话没人答：失败 `ask-unavailable`。用户拒绝：结果带附言，模式不变。
10. 退出 `plan`（目标不是 `plan`）：工具执行时读 `session://plan.md`，正文进提问的请求。向导显示全文，选项是批准并开始（可同时选审批模式，默认保持当前）与继续改（带附言）。批准用一次 `changeSettings` 同时改模式与审批模式，工具结果带批准的计划正文与开始实现的指示，所以用户看到的和模型拿到的是同一份。继续改：结果是附言，模式不变。没有计划或超过 256 KB：工具失败并告诉模型，不问用户。

### 界面

11. 输入框工具栏上 Agent 模式控件与审批模式控件并排，都一直可见。点 Agent 模式切下一种（normal、discuss、plan 循环），Shift+Tab 相同：补全菜单开着时 Shift+Tab 不切模式，没有监听者的编辑器（就地编辑）不吞这个键，切换后读屏播报。非 `normal` 时审批模式控件变淡，提示批准计划后按它走，仍可点；全部放行保留红色警告。
12. `/plan`：切到 `plan`，已在 `plan` 不动；带文字时切完把文字发出去。`/mode <名>`：只管 Agent 模式，接 key 与显示名，不接审批模式；没参数切下一种；名字不对提示可选项。
13. 非 `normal` 在状态栏标出。

## 状态与转换

模式是会话层设置：回退不切回，重开保留，`fork` 带上。

时序与寿命：

- 放行之后、开始执行之前模式变了，按现在的模式重判（同一回复里切模式加写、等审批时别的窗口切了模式都走这条）；拒绝过的不重判，已开始的不追溯。
- 服务重启时等 `switch_mode` 回答的运行收口为中断，重开后重新问。

## 副作用与数据

模式进会话日志的 `settingsChanged`。计划文件在会话目录，压缩时放回（[`agent/compaction.md`](compaction.md) 输出 8）。

## 失败与恢复

| 码 | 含义 | 调用方怎么办 |
|---|---|---|
| `mode-blocked` | 模式闸门拒绝了写调用 | 模型调 `switch_mode`，或换只读的做法 |
| `ask-unavailable` | 后台会话没人答 `switch_mode` | 模型按当前模式继续 |

## 边界与兼容

没装模式扩展的 Profile 不受影响。`modes` 为空时视图不显示模式控件。

## 验收与 Smoke

1. `plan` 加 `allow-writes`：读、写 `plan.md`、只读 shell 放行；写作品、`rm` 拒绝；批准计划后写作品放行。
2. `plan` 加 `yolo`：写作品仍拒绝；`switch_mode` 仍要问。
3. `modeWriteAction: "ask"` 加命中的放行规则：询问。
4. 同一回复里切模式加写，两种顺序；等审批时别的窗口切模式。
5. 真实模型：`plan` 写计划、申请、批准、开始。

Smoke：`packages/neuro-book/src/plugins/agent/modes.test.ts`。

## 证据

- 批准依据：开发者 2026-11-06（[t06 计划](../../../.agents/works/w00032-agent-integration/tasks/t06-approval/plan.md) 的“开发者的决定”与“确认结果”）。
