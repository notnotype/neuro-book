---
schema: nbook.work/v1
workId: w00033-page-agent
issueId: null
status: active
updated: 2026-11-27
---

# Agent 操作 NeuroBook 界面：nb-page-agent 核心包与自操作插件

## 目标

让应用内的 Agent 像用户一样看懂并操作 NeuroBook 的窗口：可操作控件的文本快照与引用、点击输入等动作、截图、高亮引导、可见的 Agent 光标与操作提示。核心做成纯 TS 的包 nb-page-agent（只管在一个页面里做事），内置插件把它接进每个窗口，并经 eval 向 Agent 提供全局对象。来源：w00032 t16 讨论（2026-10-30）。

## 已定的事

来自 [w00032 t16](../w00032-agent-integration/tasks/t16-command-bridge/README.md) 的讨论（开发者 2026-10-30），细节以那里的决定为准：

- 结构：核心包 `nb-page-agent`（纯 TS 的 DOM 层：快照、引用、动作、高亮、光标，只管在一个页面里做事）加一个薄的 Vue 层（控件名、命令绑定的指令）；内置插件把核心包装进每个窗口，服务端经 eval 的贡献点向 Agent 提供全局对象。浏览器插件（[w00034](../w00034-browser-use/README.md)）把同一个核心包注入外部网页，模型只学一套用法。
- 一定用 CodeAct：这些能力不作内置工具，写成一份由类型定义生成的文档，模型先读文档再在 eval 里调用（依赖 [w00032 t21](../w00032-agent-integration/tasks/t21-eval-codeact/README.md)）。
- 目标窗口：用户当前的窗口。
- 控件的稳定名用指令在代码里登记（草案 `v-nb-target`），接口形态好不好用、列表项怎样写，实施时先审查；快照只在控件声明了命令绑定时标出命令 id。
- 高亮先看 driver.js 能不能满足、扩展性够不够，不行就自己写。
- Agent 操作时窗口有可见的提示（光标、停止按钮），以后多人远程协作也用得上。
- 指针与拖动搁置。以后有桌面外壳时由外壳提供可信输入与真实截图，web 下自动回退（页面内模拟事件、DOM 重画截图）。
- Agent 与命令系统的对接、控件绑命令的规范与通用命令（关闭最上层等）搁置，在 w00032 t16 里。

## 要讨论的问题

t16 讨论过、开发者还没表态的推荐（详见 t16 README 的同名小节）：

- 截图的同意粒度；用户中途切窗口时 Agent 跟不跟；没有窗口显示会话时的退路。
- 第一版范围（推荐先做快照、高亮、截图，界面动作第二批）。
- 接口命名（自定义加 Playwright 子集名，先做对照实验）；`nbook` 全局对象的范围；窗口状态的只读面；设置的读写接口；包名。

## 调研

- [浏览器 Agent 调研与实测](../w00034-browser-use/research/2026-11-19-browser-agents-survey.md)（2026-11-19）：外部网站上的注入与快照探针（严格 CSP 下 `<script>` 标签被拦、经 CDP 的主世界与隔离世界可用、shadow DOM、自己注入的快照与无障碍树的大小）；page-agent 当前源码的走查；browser-use 用 `backendNodeId` 作跨快照稳定的编号。
- [Agent 操作宿主应用与网页界面](../w00032-agent-integration/research/2026-10-30-host-control-survey.md)：页面内可复用的库（第 7 节）、omp 的浏览器与 eval（第 5 节）、CodeAct 的文档形式（第 6 节）、截图与高亮（第 3、4 节）。

## Task

| Task | 内容 | 状态 |
|---|---|---|
| [t01](tasks/t01-design/README.md) | 设计：核心包与插件的接口、快照与控件名、动作、截图、高亮、光标 | 设计稿第四稿已定，第一批由 t03 实施 |
| [t02](tasks/t02-ui-actions/README.md) | 第二批：Agent 代替用户操作界面（动作、光标、提示条与停止、确认、拖拽指引） | 未开工 |
| [t03](tasks/t03-ui-guide/README.md) | 第一批实现：快照、界面目录、截图与引导（`ui` 对象） | 完成，合入 master（3cd37bde2） |
| [t04](tasks/t04-guide-one-eval/README.md) | 引导一次走完：eval 文档、`not-found` 说明遮挡、真实模型评测场景 | 未开工 |
| [t05](tasks/t05-guide-wait-targets/README.md) | 引导的等待条件与控件名：`until` 等出现，编辑器、资源管理器、对话输入框的稳定名 | 未开工 |
| [t06](tasks/t06-guide-flows/README.md) | 流程声明：插件登记多步操作的引导路径，`ui.find` 交回完整步骤 | 未开工，在 t05 之后 |

## 前置

[w00032 t21](../w00032-agent-integration/tasks/t21-eval-codeact/README.md)（eval 与它的贡献点，2026-11-18 完成）；w00032 t20 的内核。
