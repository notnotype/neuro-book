---
schema: nbook.task/v2
taskId: t04-tool-registry
status: planned
updated: 2026-10-30
---

# 工具登记、命名与工具发现

## 目标与范围

定工具 id 与给模型看的名字、工具工厂、工具组、插件给所有 Profile 加工具的方式、工具发现，以及工具变化与提示词缓存的边界。

来源：需求 5、7（工具部分），也是需求 14（MCP）的前提；开发者 2026-10-28 要求工具发现与“插件给所有 Profile 加工具”一起考虑（[报告](../t01-survey/artifacts/report/index.html)第 5、7 条）。

合同：本 Task 只做设计讨论，行为合同未变；定稿后在计划里写明改哪些 Spec。

## 要讨论的问题

- id 与模型名：没写名字时取 id 最后一段还是必须显式写；撞名报错还是自动加前缀；插件工具 id 的换算（分支：`/` 换 `__`、`.` 换 `_`）。
- 工厂函数与按会话的构造参数（nb-story 每轮新建登记表、状态放闭包）。
- 工具组；插件给所有 Profile 加工具；Profile 能否拒绝某些插件工具；w00017 移交的“工具 × Profile 批准”要不要。
- 工具发现：客户端机制（所有服务商可用）与 Anthropic、OpenAI 的原生延迟加载；加载后的工具放进 tools 数组还是经分发工具调用；被加载的工具记进会话日志以便恢复。
- 工具变化与缓存边界：插件启用、禁用、升级时会话内的工具集怎么变（现在：快照不变）。
- 工具声明的字段：等级（t06 用）、并发、严格模式、`loadMode`、`summary`。

## 材料

- [外部参照](../../../../../docs/research/agent-runtime-references.md)第 4 节（工具发现）
- [w00017 移交的调研](../../../w00002-neuro-agent-harness-redesign/research/2026-09-29-plugin-agent-tools-and-profiles.md)
- [`agent/harness.md`](../../../../../docs/specs/agent/harness.md) 输出 1 到 6
- 分支上的 `docs/specs/harness/tools.md`

## 前置

t02。

## 决定（开发者 2026-10-28）

1. 名字：工具 id 就是 NeuroBook 内部的名字，允许带点；Profile、绑定配置、日志视图、界面、审批都用 id。交给服务商的名字默认由 id 换算，`.` 换成 `__`（`builtin.file.read` → `builtin__file__read`），id 里不许出现 `__`，所以能还原；换算结果按 Anthropic 的规范校验 `^[a-zA-Z0-9_-]{1,128}$`。可以显式覆盖交给服务商的名字（只能用规范允许的字符）。提示词里引用工具用 `<ToolName id="…"/>` 渲染模型实际看到的名字。分支 t20 待确认的“插件工具名换算”（有损的 `.` → `_`）按本条改判。（2026-10-30 t19 改：校验长度上限改为 64，OpenAI 的工具名超过 64 字符报 400，见 [t19](../t19-mcp/README.md)。）
2. 工厂函数：工具定义分静态声明与 `create(会话上下文)`，每个会话建一次实现（可带 `dispose`），会话状态放闭包；声明冻结进快照。
3. Profile 只声明要哪些工具（必需、可选；能检测可选工具在不在，据此换提示词），不决定会话最终装哪些；Profile 不再自带工具，以后需要时先登记实现再引用。
4. 工具绑定在 Profile 之外，存为应用级用户配置、按 Profile key 分：
   - 默认绑定 = Profile 必需 + 可选 + 插件声明“默认装到所有 Profile”的工具；用户在设置里按 Profile 增删，必需工具不能删。
   - 可以绑定 Profile 没声明的工具（“插件给所有 Profile 加工具”靠这条）；Profile 检测不到它们，模型只看工具自己的描述。
   - Agent 插件把绑定算成会话的工具列表交给 harness，harness 只检查必需工具都在。
   - w00017 移交的“工具 × Profile 批准”不做：装插件即信任（ADR 0022），执行时的批准在 t06。
5. 工具发现搁置，不做；以后有需求打算用 CodeAct 实现。
6. 会话进行中 Profile 变了，用方案 D（按轻重分）：
   - 只换实现、声明不变：无感。
   - 提示词变：下一次请求生效，写一条记录（Profile 版本与内容 hash），界面显示“Profile 已更新”，不提醒模型。
   - 工具增减或声明变：下一次模型请求前生效，写一条记录并给模型一条提醒（如“`x` 已卸载，新增 `y`”），缓存从变化处失效一次。
   - 继续不了（Profile 被删、必需工具没了、初始输入通不过新校验）：会话停用为只读，提示恢复插件、fork 到别的 Profile 或新建。
   - 有效工具集总按当前绑定现算，日志只记“告诉过模型什么”，每次请求前与当前路径上最后一条记录比对，所以回退到变化前的分支不必特殊处理。
   - 生效时机是“下一次模型请求前”（与分支一致），长运行可能中途换工具。
   - 等审批或等回答的调用，其工具被卸载时按 `tool-unavailable` 结算；运行中插件被禁用，它的工具调用返回 `tool-unavailable`。
   - 空闲会话不主动处理，等它下一次请求时再比对。
   - 历史里对已卸载工具的调用回放时原样保留，前提是服务商接受，见下面的实测。
7. 声明字段：沿用 master 的 id、说明、参数、提供方、版本、收尾、并发、严格校验、自定义参数语法；交给服务商的名字可选（缺省按第 1 条换算）；风险等级的字段先留，语义在 t06 定。

开发者的补充（2026-10-28，转 t05）：Profile 通过插件共享，借插件的依赖声明保证 Profile 引用的工具都已安装。

工具设计原则（开发者 2026-10-30，t14 讨论时定，所有工具适用）：一个工具只做一件事，宁可工具多，不设计按参数切换行为的复合工具。理由：好理解，以后做 CodeAct（t21）时一个工具就是一个函数。代价是工具描述变长，多出多少由实验量出来（t14）。

## 实测：历史里调用过、本次没有的工具

脚本 [`scripts/probe-tool-history.ts`](scripts/probe-tool-history.ts)，结果 [`evidences/tool-history-probe.txt`](evidences/tool-history-probe.txt)（2026-10-28）。四种请求：历史里调用过 `old__lookup`、本次 tools 只有 `new__search`；同样的历史、本次不带 tools；工具名 65 个字符；工具名 128 个字符。

- DeepSeek Chat Completions、DeepSeek 的 Anthropic 兼容接口、Gemini 的 OpenAI 兼容接口：四种都 200，模型按历史正常回答。
- OpenAI 与 Anthropic 官方接口没测到：luna 中转一直 429，OpenRouter 账户没有余额（402）。开发者定不再重试，实施第一个切片时再测（兼容接口的校验是 DeepSeek 自己做的，不代表 Anthropic 官方）。

## 当前状态

讨论完成（2026-10-28）。计划与实施切片在本 Work 的讨论全部完成后另定。

## 下一步

实施时按 implementation-planning 写 `plan.md`，第一个切片先在 OpenAI 与 Anthropic 官方接口上复测上面的四种请求。
