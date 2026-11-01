---
schema: nbook.task/v2
taskId: t10-agent-plugin
status: active
updated: 2026-11-01
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

## 实施阶段的决定（开发者 2026-11-01，按 [plan.md](plan.md) 第 9 节的推荐）

9. 范围：本 Task 只实现 `agent.extensions`、`agent.tools`、`agent.profiles` 三个贡献点与服务端入口；其余六个贡献点、项目级入口（t12）、浏览器入口（t17）在用到它们的 Task 里建。
10. 改决定 2：钩子随 t20 改成扩展，贡献点叫 `agent.extensions`；`agent.profiles` 改成实现式（声明只放名称、说明与工具要求），插件的 Profile 跟着插件入口装载，打包加哈希只用于用户级 Profile。
11. 不做“积压过多断开”（改决定 5）：远程通道没有发送背压，本 Task 只把流式增量按 100 毫秒合并；要断开先给通道加背压，另开 Task。
12. 改决定 7：远程的 `startTask` 立即返回 `{sessionId, runId}`，结果经 `runResult` 与 `frames` 取；同进程的服务键给 `Promise<RunResult>`。
13. 改决定 4：`onAgentHook:<钩子点>` 改成 `onAgentSession`（第一次建或开会话前激活扩展的提供方），新增 `onAgentProfile:<key>`。
14. 新增 SDK 子路径 `@notnotype/nb-plugin-sdk/agent`：内核的定义接口成为插件 SDK 的公开接口。
15. 会话句柄无订阅、空闲 30 秒后关闭；t06 规则表之前审批用最小规则（只读放行、`yolo` 全放行、`allow-writes` 放行写入、其余询问）。

## 后续修改

- 2026-10-30（t15，开发者定）：插件 SDK 的构建预设顺带把插件里每个 Skill 的脚本连同 npm 依赖打成单文件，插件里的 Skill 装好就能用；打不进单文件的构建失败（[t15](../t15-skills/README.md) 第 7 条）。最小安装单位是插件，市场是插件市场（[t25](../t25-plugin-marketplace/README.md)）。

## 当前状态

实施计划 [plan.md](plan.md) 第一稿开发者确认（2026-11-01）；omp 设计审查 20 条（阻断 4、重要 16）全部成立，第二轮核对后新提 8 条（阻断 2、重要 6），计划改成第三稿（处置见 [evidences/design-review-disposition.md](evidences/design-review-disposition.md)），开发者确认后开工（2026-11-01）。

实施进展（Work 分支 `feat/w00032-agent-integration`）：

- 第 0 片 `bd2924993`：内核的工具集以宿主的声明为准、`AgentHost.profilesChanged`、会话头与列表带 `background`；nb-harness 327 通过，nb-story 内核验收门 4 通过，三处变异检查都被测试抓到。实现审查（omp）进行中。
- 第 1 片（master `17604b62c`）：新建 `agent/contributions.md`、`agent/sessions.md`（planned），内核与平台 Spec 跟上。
- 第 2 片 `61358c890`：`nbook.agent` 服务端骨架；插件测试 7 条，五处变异检查都被抓到；neuro-book 全量 1665 通过，governance 通过。实施中的调整见 [plan.md](plan.md) 第 5 节末尾，Spec 已随之改。

## 下一步

处理设计审查后按计划第 5 节的切片实施。
