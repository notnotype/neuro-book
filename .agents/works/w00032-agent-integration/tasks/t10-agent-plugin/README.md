---
schema: nbook.task/v2
taskId: t10-agent-plugin
status: planned
updated: 2026-10-28
---

# Agent 插件骨架与贡献点

## 目标与范围

定内置插件 nbook.agent 的结构、贡献点清单与激活事件、服务端运行与界面推送，以及插件禁用、升级对运行中会话的影响。

来源：需求 3；清单外第 5 项（[报告](../t01-survey/artifacts/report/index.html)）。

合同：本 Task 只做设计讨论，行为合同未变；定稿后在计划里写明改哪些 Spec。

## 要讨论的问题

- `nbook.agent` 的入口（服务端、浏览器）与依赖；harness 在服务端跑。
- 贡献点清单与激活事件：工具与工具组、Skill、Profile、文档、资源方案、斜杠命令、`@` 引用、工具渲染器、上下文槽、钩子、压缩方法；哪些写在清单里、哪些激活后登记。
- 运行不绑页面：服务端跑、推送、断线补齐（照 nb-story 的做法）。
- 插件禁用、升级、卸载时运行中会话的处理（平台提案 P1、P11）。
- 导出“以某 Profile 发起任务”。

## 材料

- [平台提案](../../../../../docs/proposals/extensible-application-platform.md) P1、P3、P9、P11
- [`runtime/plugin-manifest.md`](../../../../../docs/specs/runtime/plugin-manifest.md)
- [`story/qa.md`](../../../../../docs/specs/story/qa.md) 的运行与推送

## 前置

t02 到 t09。

## 决定（开发者 2026-10-28：方向先同意，具体实现时再细化调整）

1. 入口：服务端入口（harness、会话、运行、工具登记、Profile 目录、绑定与 Profile 设置，对外提供远程服务）；项目级入口（需要项目数据的内置工具，ADR 0024，t12 细化）；浏览器入口（对话视图、会话列表、Composer，用 nb-agent-ui，t17）。硬依赖只有设置与存储；`nbook.models`、资源与 Files、`nbook.commands`、nb-history 经远程服务调用，不可用时用到才报 `unavailable`。
2. 贡献点：

   | 贡献点 | 声明或实现 | 内容 | 细节 |
   |---|---|---|---|
   | `agent.tools` | 实现 | 工具声明（组、默认装到所有 Profile）与实现 | t04 |
   | `agent.profiles` | 声明 | 插件包里 `.profile.tsx` 的路径，Agent 插件打包加载 | t05 |
   | `agent.skills` | 声明 | 插件包里的 Skill 目录 | t15 |
   | `agent.docs` | 声明 | 插件包里的文档目录，挂到 `docs://<插件 id>/` | t08 |
   | `agent.hooks` | 实现 | 钩子，含往系统提示词加内容（取代单独的 `<Slot>` 填充贡献点） | t20 |
   | `agent.compactionMethods` | 实现 | 压缩方法 | t11 |
   | `agent.slashCommands` | 动作为实现，提示词模板为声明 | Composer 的 `/` 命令，见第 3 条 | t17 |
   | `agent.references` | 实现（浏览器） | Composer 里 `@` 引用的来源 | t17 |
   | `agent.toolRenderers` | 实现（浏览器） | 对话里工具调用怎么画 | t17 |

   资源方案归资源的拥有者（Agent 插件的 `session://` 等也走那里，标明只在 Agent 会话里有效）；模型适配器归 `nbook.models` 的 `models.adapters`。
3. 斜杠命令不复用 `nbook.commands`（开发者 2026-10-28 指出两者不是一个东西：斜杠命令作用于当前会话、参数是自由文字、很多是展开成发给模型的话；应用命令作用于应用、参数结构化、有副作用）。`agent.slashCommands` 分三种：动作（拿会话上下文与自由文字执行处理函数，如 `/compact`、`/fork`、`/model`、`/mode`、`/clear`）、提示词模板（模板加自由文字拼成一条用户消息，声明式文件）、Skill（每个 Skill 自动生成一条，t15）。动作可以只声明“执行命令 X、参数怎样映射”来转调应用命令；会话相关的动作同时登记为应用命令（命令面板与快捷键也能触发）；应用命令不自动出现在 `/` 菜单。
4. 激活事件：`onAgentTool:<工具 id>`（工具第一次被调用时激活提供方；声明来自清单，不激活也能给模型看）、`onAgentHook:<钩子点>`；压缩方法、`@` 来源、渲染器、斜杠动作在第一次用到时激活；Profile、Skill、文档、提示词模板只有声明。
5. 运行不绑页面：服务端跑，窗口经 ADR 0024 的远程服务订阅（WebSocket 上的 RPC，不另开 SSE）；先发快照，再按序推日志条目与事件，生成中的消息每 100 毫秒最多推一次，积压过多断开（照 nb-story）；断线后按最后收到的日志序号重订阅补齐；多个窗口订阅同一句柄。
6. 插件禁用、升级、卸载：工具提供方按 t04 方案 D（声明保留、调用得 `tool-unavailable`；执行中的调用超时由内核结算为“已中断”）；Profile 提供方按方案 D 只读；钩子提供方从下一次请求起不执行并写诊断；`nbook.models` 不可用时下一次请求以 `unavailable` 失败；`nbook.agent` 自己被停时所有运行按 t07 强制中止，重新启用后显示“上次运行被中断”。禁用前的确认界面列出运行中的会话。
7. 导出远程服务 `agent.startTask({profile, initial, input, project?, background?})`（TypeBox 合同），返回会话 id，结果为 `TurnResult`（含收尾工具的参数）；编辑器行内 AI、命令（t16）、Workflow、应用内的 nb-story 用它；子代理走同一条路（t14）。
8. nb-story 作为插件接入时经 `agent.profiles`、`agent.tools` 贡献；界面改不改用对话视图由 w00024 定。

## 后续修改

- 2026-10-30（t15，开发者定）：插件 SDK 的构建预设顺带把插件里每个 Skill 的脚本连同 npm 依赖打成单文件，插件里的 Skill 装好就能用；打不进单文件的构建失败（[t15](../t15-skills/README.md) 第 7 条）。最小安装单位是插件，市场是插件市场（[t25](../t25-plugin-marketplace/README.md)）。

## 当前状态

讨论完成（2026-10-28）。计划与实施切片在本 Work 的讨论全部完成后另定。

## 下一步

实施时按 implementation-planning 写 `plan.md`，细节届时与开发者再调。
