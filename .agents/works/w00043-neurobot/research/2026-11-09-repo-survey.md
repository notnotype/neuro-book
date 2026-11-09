# NeuroBot 能复用什么：仓库内现状

- 日期：2026-11-09（master `1a3f27da3`）
- 问题：NeuroBot 如果作为 monorepo 子项目、用 nb-runtime，现有的哪些能力可以直接复用，哪些要先动上游。
- 证据等级：**文档**为读过的 Spec、提案、ADR 原文；**目录**为只看了目录结构与行数、没读实现；**推断**为据此推出、未验证。
- 状态：资料，不是设计依据。

## 1. Agent 能力在包里还是在应用插件里

[`monorepo-boundaries.md`](../../../../docs/modules/monorepo-boundaries.md) 规定领域包不得依赖应用包（文档）。所以只有在包里的能力能被另一个应用直接用。

| 能力 | 位置 | 证据 |
|---|---|---|
| harness 内核：日志驱动的状态机、运行、压缩流程（不认识具体方法） | 包 `nb-harness`（`src/kernel/`，非测试源码约 13,400 行） | 目录；[ADR 0035](../../../../docs/adr/0035-harness-log-driven-kernel.md) |
| Profile 定义与 JSX 渲染 | 包 `nb-profile` | 目录 |
| 会话日志（JSONL、内存版） | 包 `nb-session` | 目录 |
| 对话视图 | 包 `nb-agent-ui`（核心纯 TS、Vue 层） | 文档（monorepo-boundaries） |
| 压缩的三种方法（shake、inplace、summary）与放回 | 应用插件 `nbook.agent`（`backend/compaction/`） | 文档（[`agent/compaction.md`](../../../../docs/specs/agent/compaction.md)） |
| 审批规则、Agent 模式、`auto` 审批模型 | 应用插件 `nbook.agent`（`backend/permissions/`） | 目录；w00032 t06 |
| 会话管理、会话元数据、Profile 设置、资源方案（`session://` 等，读写由 `nbook.files` 管） | 应用插件 `nbook.agent`（`backend/` 下非测试源码合计约 6,300 行） | 目录；`schemes.ts` 头注释 |
| 内置工具 read、write、edit、shell、grep 等 | 应用插件 `nbook.agent`（`backend/builtin/`）；`nb-harness/src/tools/` 另有 read、edit | 目录 |
| 模型服务、角色与压缩触发点设置 | 应用插件 `nbook.models` | 文档（compaction.md 的 owner 一节） |
| 第三方插件的安装、登记、装载、构建 | 应用 `src/plugin-platform/`，按目录机检、不出现应用名 | 文档（[ADR 0030](../../../../docs/adr/0030-plugin-platform-layering.md) 决策 2） |
| 插件内核：生命周期、服务、插件、清单、应用装配、诊断、远程服务 | 包 `nb-runtime`，与应用无关，应用名由平台档案传入 | 文档（ADR 0030 决策 1）；`package.json` 的 exports |

- ADR 0030 决策 2 原文：“出现第二个使用插件模式的应用时，再把这个目录搬成包，档案就是它的配置接口。”（文档）
- 内置插件靠 `nb-runtime` 的插件机制装配，第三方插件的通用管理才在 `plugin-platform`；只用内置插件的应用不必先搬 `plugin-platform`（推断，依据是 ADR 0030 对两者职责的划分，没有在代码里核实装配路径）。
- 已有一个不依赖应用、单独运行的使用者：`nb-story` 用 `nb-runtime` 的 `./remote` 与 `nb-harness`、`nb-profile`、`nb-session` 做内置问答（文档）；w00032 t31 计划把它迁到新内核（文档）。

## 2. 上下文压缩的触发点

- 现有触发点：超过阈值、服务商报溢出、手动 `/compact`（文档，compaction.md 的“输入与前置条件”）。
- 在 compaction.md 里没搜到空闲时压缩、缓存过期前压缩（按“空闲”“idle”“缓存”“cache”搜索）。
- 对话界面是“一个视图一个会话”，会话由用户在界面上开（w00032 t17 决定，文档）。

## 3. 多 Agent 的已定设计

w00032 t14（讨论定稿、未实施，文档）：子代理工具 `agent_spawn`、`agent_send`、`agent_answer`，任务中心 `wait`、`kill`、`jobs`，子代理用 `yield` 交结果；父子是平级的会话文件、互相记着关系；审批一律交给用户；硬上限每会话 16、全局 32、深度 5。adhoc Profile 也挪到 t14。

## 4. 与多实例拓扑的对照

[ADR 0024](../../../../docs/adr/0024-multi-instance-runtime-topology.md) 与[多实例拓扑提案](../../../../docs/proposals/multi-instance-runtime-topology.md)（文档）：

| NeuroBot 设想 | 现有拓扑里的对应 | 差别 |
|---|---|---|
| gateway | 服务端实例（应用级，不绑定项目；Agent 会话运行在这里） | 现有服务端随用户打开应用运行；常驻、后台服务、系统服务另在 w00035 讨论，未定 |
| channel 中的 web、tui | 浏览器客户端、TUI 客户端；握手、连接代次、重连规则已定 | 现有客户端绑定 0 或 1 个项目，NeuroBot 的客户端要绑定的是 bot 或对话 |
| channel 中的 QQ、Telegram、邮件 | 没有对应物 | 外部平台的入站消息要路由到某个 bot 的某段对话，现有拓扑只有本应用自己的客户端 |
| device（服务器、手机） | 最接近的是项目子进程：服务端创建的子实例，经内核 RPC 通信 | 子实例由服务端在本机创建；device 是远端主动连上来、向 gateway 提供能力（执行命令、浏览器、摄像头）的实例，方向和鉴权都不同 |
| 运行位置 | 运行位置是宿主声明的字符串，内核不列举（文档，提案第 1 节） | 加一个 `device` 之类的位置不需要改内核的枚举（推断） |

## 5. nb-memory 与 bot 记忆

- 现状（文档，包内 README 与 PROJECT-STATUS）：0.1.0，Task 113 的产物，只收编进 monorepo、没接入主应用；master 上最近的改动只有收编与治理迁移两次提交。
- 数据模型：episode（原始叙事，只追加，语义层可由它重放重建）、facts（发生过的事，只追加，带主体 id）、主体注册表（类型、带时点的别名、一行本体描述）、state（带失效区间的可变状态）。双时间轴：`tick` 是摄入序，`instant` 是故事时间，可回退；缺坐标时不可见。检索是向量加 BM25 的 RRF 融合（文档）。
- 别处对它的态度（文档）：
  - V9 小说记忆图与 nb-story 都不依赖、不改它；
  - 世界引擎内核推荐只复用它的检索索引，并指出检索要求嵌入服务、没有只走关键词的入口；
  - harness 事件模型提案拿它举例：作为扩展在 `input` 上写检索结果，在运行结束时按次数触发摘要。
- 它的评测是 B1 剧情记忆基准（另一个仓库 `nb-memory-bench`，20 章、338 条事实、48 个探针），针对小说叙事，不是对话场景（文档）。
- 没有对应物的需求：共享知识库（梗、平台风向、写作技巧，带来源与时效）；离线整理（“做梦”）；同一 bot 多个分身同时写记忆时的合并（推断，按 README 列出的公开 API 判断）。
