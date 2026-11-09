# 商业“常驻 AI 员工”产品调研：Grok Bot、Muse、ChatGPT Dots、DeepSeek super-agent

调研日期：2026-11-09

## 问题

NeuroBot 要做“常驻、有记忆的 AI 员工”平台。本文收集四个对象公开的、可核查的事实，按固定维度整理：基本概念与会话关系、记忆、多 bot、执行环境、渠道、日程与主动行为、安全与授权、技术架构。只写事实，不写推荐与价值判断。查不到的写“没查到”。

## 证据等级说明

| 等级 | 含义 |
|---|---|
| 官方文档 | 厂商自己的文档、官方博客、帮助中心、开源仓库的 README 与 docs |
| 论文 | 同行评审或预印本论文、技术报告。本次四个对象中没有找到任何一篇，见 DeepSeek 一节 |
| 媒体报道 | 新闻媒体、行业媒体的报道 |
| 检索摘要 | 只有搜索结果里的摘要，没能读到原文 |

两条使用说明：

- 读取网页用的 WebFetch 返回的是小模型对页面的摘要，不是逐字原文。因此下文凡标“官方文档”的条目，含义是“来源是官方页面、经工具摘要得到”，措辞是转述；带引号的短语是工具输出里标为引文的部分。
- 以下页面读取时被拒绝（HTTP 403 或工具拦截），只能引用搜索摘要或第三方转述：`x.ai/blog/introducing-grok-bot`、`openai.com/index/introducing-dots/`、`openai.com/index/devday-2026-recap/`、`help.openai.com` 全部文章、`wired.com`、`axios.com`、`scmp.com`、`dealroom.co`。

产品背景（均为 2026 年，媒体报道）：Grok Bot 2026-08-11 宣布并进入早期 beta（[glitchwire](https://glitchwire.com/news/spacexai-launches-grok-bot-an-ai-that-logs-into-your-tools-and-does-the-actual-w/)）；Muse 2026-09-08 发布（[aiwiki 检索摘要](https://aiwiki.ai/wiki/muse)、[Vellum](https://www.vellum.ai/blog/official-muse-breakdown)）；Dots 与 ChatGPT Space 2026-09-29 在 DevDay 发布（[VentureBeat](https://venturebeat.com/ai/openai-launches-dots-always-on-ai-agent-coworkers-and-chatgpt-space-where-they-can-collaborate-with-human-teams)）；DeepSeek 的 super-agent 设计文章与原型仓库 2026-10-31 或 11-01 公开。

---

## 1. xAI（SpaceXAI）Grok Bot

主要来源（均为官方文档，docs.x.ai，经 WebFetch 摘要）：

- 概览：<https://docs.x.ai/grok-bot>
- 创建与管理 bot：<https://docs.x.ai/grok-bot/bots>
- 工作原理：<https://docs.x.ai/grok-bot/how-grok-bot-works>
- 聊天与协作：<https://docs.x.ai/grok-bot/chat-and-collaboration>
- 共享 bot：<https://docs.x.ai/grok-bot/shared-bots>
- 电脑与应用：<https://docs.x.ai/grok-bot/computer-and-apps>
- 技能、例行任务与自动化：<https://docs.x.ai/grok-bot/skills-routines-and-automations>
- 审批、安全与隐私：<https://docs.x.ai/grok-bot/approvals-security-and-privacy>
- 安全（企业向）：<https://docs.x.ai/grok-bot/security>
- 常见问题：<https://docs.x.ai/grok-bot/faq>
- 用例：<https://docs.x.ai/grok-bot/use-cases>
- 入门：<https://docs.x.ai/grok-bot/get-started>

### 1.1 基本概念与会话

- Bot 是“带名字、有职责、有自己的对话、工作上下文随时间积累的持久 AI 队友”。（官方文档，bots 页）
- 每个 bot 有自己的对话。文档不使用 “session” 一词，用 “conversation” 与 “chat”。（官方文档，bots 页）
- 重置对话会清空历史，但保留记忆、文件、例行任务（routines）和设置。（官方文档，bots 页）
- 用户有一个主 bot（primary Bot）：它是主要联络点，“会自己找你汇报，并协调你的其它 bot”，可以把任务交给专职 bot，例如把报销请求交给“报销 bot”。共享 bot 不能当主 bot。（官方文档，bots 页、how-grok-bot-works 页）
- 文档推荐“一个 bot 一个职责”：同一职责的 bot 会积累该职责的记忆，只需解释一次。（官方文档，how-grok-bot-works 页）
- 上下文如何续：文档提到 bot 保留“稳定偏好、重要事实和工作摘要，因此不必重放每条消息”就能保持角色。上下文窗口大小与压缩（compaction）行为：没查到，FAQ 明确没有记录。（官方文档，bots 页、FAQ 页）
- 用户界面：聊天是主界面，还可语音通话、发语音备忘；可在桌面、手机、Slack、X 上使用。（官方文档，概览页、FAQ 页）

### 1.2 记忆

- 分类（官方文档，bots 页）：
  - 稳定偏好、重要事实、工作摘要；
  - 用户要求它长期遵守的规则（例如“发邮件前总是先问我”）；
  - 关于用户的事实（姓名、时区）——这类在用户的所有 bot 之间共享；
  - 带日期的工作日志。
- 每个 bot 有自己的记忆；个人事实跨 bot 共享。（官方文档，how-grok-bot-works 页）
- 保存是自动的，bot “自己决定”记什么；要保证被记住需要明确要求它记住。（官方文档，bots 页）
- 查看、纠正、删除记忆：在聊天里完成（例如问 “What do you remember about me?”）；个人 bot 没有专门的记忆界面。（官方文档，bots 页、FAQ 页）
- 删除 bot 会清除它的记忆；删除账号会清除所有 bot 的记忆；重置对话不清除记忆。（官方文档，bots 页）
- 登录凭据、银行卡等放在 Vault，不属于记忆。（官方文档，bots 页）
- 共享 bot：拥有者与 Manager 可以改它的指令、技能、记忆与应用；bot 可以保存对整个团队有用的经验并会说明；不会为团队保存关于某个成员的个人信息；拥有者与 Manager 读不到各人的聊天。（官方文档，shared-bots 页）
- 群聊：文档没有描述群共享记忆；每个 bot 在群里保留自己的记忆，不与群里其它 bot 共享。（官方文档，bots 页、chat-and-collaboration 页）
- 离线整理记忆（类似“做梦”）：没查到。

### 1.3 多 bot

- bot 之间能对话：一个 bot 给另一个 bot 发异步消息（“handoff”），接收方被唤醒、处理，之后可能回复；交接在对话里可见。文档建议每个阶段只有一个负责 bot，并警告并行交接会造成重复工作与噪音。（官方文档，chat-and-collaboration 页）
- 没有“禁止 bot 互相发消息”的开关；只能在对话里告诉它们不要这样做并要求记住。每条 bot 回复（含 bot 之间的消息）都计入用量。（官方文档，chat-and-collaboration 页）
- 群聊：在 “To:” 里加 2 到 6 个 bot；可以加队友共享给你的 bot，但不能和运行在你自己电脑上的 bot 放在一起。普通消息由群里的 bot 自行决定谁回应，`@` 指定一个 bot，`@everyone` 慎用。群里不显示审批请求、密钥与登录请求、邮件或 Slack 草稿；bot 到群的交接消息只能是文本。（官方文档，chat-and-collaboration 页）
- 谁能创建 bot：用户自己在界面创建；bot 也可以“建议或创建”一个专职 bot；用户可要求保持 bot 名册小。团队里还有 “dr eggbot”（问几个问题后一职责一 bot 地建好）和 “tinkabot”（把 API 包成带 MCP 服务器与技能的插件，经用户批准才发布）。创建 bot 是否需要审批：文档没有描述创建环节的审批，tinkabot 的“发布”需要用户批准。（官方文档，bots 页、how-grok-bot-works 页）
- 分享形态：模板分享（每人得到一份独立拷贝，不含电脑、登录和对话历史）与共享 bot（同一个 bot，各人聊天私有，按文档方式授权给全团队或指定人）。企业 admin 可控制公开模板分享。（官方文档，bots 页、shared-bots 页）
- 多 bot 团队的协作形态：每个 bot 负责一步并把成果传给下一个，形成序列，由用户审最终结果。主 bot 如何巡检团队、如何跟踪交接：文档没有描述。（官方文档，use-cases 页）
- 数量上限：FAQ 未给出 bot 数量上限。每个 bot 的 routine 上限 50 个。（官方文档，FAQ 页、routines 页）

### 1.4 执行环境

- 云上电脑：“持久的云电脑”，带浏览器、命令行与文件系统，文件在任务之间保留，关掉笔记本也继续工作。（官方文档，computer-and-apps 页）
- 一个用户一台电脑，该用户的所有 bot 共享这台电脑。每个 bot 有自己的屏幕，可并行工作，每个 bot 同时只能在自己屏幕上跑一个电脑操作任务；屏幕“不是独立的安全边界”。文件、浏览器登录态、cookie 与命令行凭据在 bot 之间共享，删除 bot 不会清掉它们。（官方文档，computer-and-apps 页、approvals 页）
- 用户可实时观看任意 bot 的屏幕；遇到 SSO、通行密钥、验证码等可以“接管”电脑，处理完再让 bot 继续。（官方文档，how-grok-bot-works 页、computer-and-apps 页）
- 持久化：长期文件放 `/workspace`；临时目录与手动装的包在更新或恢复后不保留；更新、恢复、重置可在设置里做。（官方文档，computer-and-apps 页）
- 与本机连接：bot 可以在用户自己的电脑上执行命令、读写文件，默认每条命令都询问，可设为“总是允许”或“永不允许”，与云电脑的审批分开设置。（官方文档，security 页、computer-and-apps 页）
- 运行位置：只在 Cursor 托管的云电脑上运行，不支持本地部署；电脑位于美国。（官方文档，security 页）
- MCP：bot 可以添加目录之外的 MCP 服务器（URL 或在云电脑上运行的命令）。（官方文档，computer-and-apps 页）
- 子代理：auto review 的覆盖范围里提到 “Cloud Agent 与 subagent 的启动”，说明存在子代理与云代理；其运作细节：没查到。（官方文档，security 页）

### 1.5 渠道

- 官方 FAQ 列出的入口：macOS、Windows、Linux 桌面应用；iPhone、iPad、Android 应用；X Chat 里聊天；在 X 上 `@bot` 交接一条帖子；在 Slack 里与共享 bot 对话。支持语音听写与语音通话，bot 可发语音备忘。（官方文档，FAQ 页）
- 事件触发：Slack 消息、GitHub/Linear/Sentry/PagerDuty 事件、发到 bot 自己地址的邮件、webhook。（官方文档，routines 页）
- bot 自己的邮箱：computer-and-apps 页写用户可以认领一个 `mail.grokbot.com` 的地址（认领后不能改名或删除，`+` 别名进同一收件箱），并提到 bot 可以从“自己的邮箱收件箱”读一次性验证码。该地址在团队版默认关闭，需 admin 开启。（官方文档，computer-and-apps 页）
- 电话号码、短信渠道：FAQ 明确没有提到。语音通话是 app 内通话。（官方文档，FAQ 页、chat-and-collaboration 页）
- 语音通话一次只能与一个 bot 进行，群聊中不可用。（官方文档，chat-and-collaboration 页）

### 1.6 日程与主动行为

- Skill：可复用的任务说明（步骤、决策规则、期望输出、安全边界）。所有 bot 共享一个私有技能库。可用 “Teach a task” 录制最长十分钟的屏幕操作生成技能草稿（不录麦克风）。（官方文档，routines 页）
- Routine：让 bot 按“时间表或事件”运行某个工作流。时间表用自然语言（如“工作日 8:00”），间隔至少五分钟；新建后不立即运行，等下一个时间点。云上运行，笔记本关着也能跑。（官方文档，routines 页）
- 限额：每个 bot 最多 50 个 routine；全账号每小时 300 次运行，每个 routine 每小时 200 次；每次运行消耗用量；长时间不在时，bot 可能询问是否继续保持 routine，无回应则可能暂停。保留每个 routine 最近 20 条运行记录。（官方文档，routines 页）
- 主动行为：主 bot 会“自己找你汇报”；bot 在你离开时继续工作，完成后通知。事件触发只算“新活动”，触发前已有的事件不会启动运行。（官方文档，how-grok-bot-works 页、routines 页）
- 示例：早晨简报 bot 回顾收件箱、日历、Slack、文档的变化，起草一条给团队频道的草稿但不发送；“每周一 9 点”的营销团队、“每月 1 号”的月结团队。（官方文档，use-cases 页）
- 设计原则（文档给出）：先自动化准备工作，让 bot 起草、对账、推荐，再行动；发送、购买、删除、发布、改生产系统需要审批。（官方文档，routines 页）

### 1.7 安全与授权

- 身份：bot 没有自己的身份和凭据，以登录用户的身份行动，权限不会超过该用户；每个动作可追溯到具名成员。（官方文档，how-grok-bot-works 页、security 页）例外：团队管理的连接器可使用团队或服务账号凭据。
- 审批卡片：显示拟执行的操作与输入；选项为 Allow once、Always allow（可保存规则）、Deny（拒绝后 bot 不会重试，直到用户再发消息）。审批只覆盖该动作，不覆盖已完成的工作。来自聊天的卡片不过期；来自 routine、收到的消息等后台工作的卡片 30 分钟后过期。（官方文档，approvals 页）
- Auto Review：默认开启，由一个独立的审查模型在风险动作执行前检查（shell 命令、应用调用、电脑操作、写自动化、委派/启动子代理），结果为放行、要求审批或拒绝。用户自定义规则只能更严格，“Ask first” 优先于 “Allow automatically”；规则上限 20 条加 20 条，每条 1000 字。文档说明它不审查所有副作用，例如记忆写入与多数设置改动。（官方文档，approvals 页、security 页）
- 后台邮件：聊天里发起的发送遵循 Auto Review；routine 触发的邮件以草稿等待用户点 Send；转发和 Auto Review 读不全的附件总是需要用户确认。（官方文档，approvals 页、computer-and-apps 页）
- 防提示注入：
  - 文档（approvals 页）写明只有用户自己的消息算请求，“来自别处的文本，例如邮件或网页，不算你的请求”；
  - 收到的邮件被当作信息而非指令；未通过垃圾或病毒扫描的邮件正文与附件被移除且不会触发 routine；
  - 外部内容以不可信数据呈现给模型；企业可用推理钩子（inference hooks，beta）在下一次模型调用前过滤；
  - 文档承认这些措施“降低但不消除”风险，要求把重要动作放在审批后面。（官方文档，approvals 页、security 页）
- 凭据：登录顺序为 Vault、已连接的密码管理器（如 1Password）、Secure Form；模型“从不接收已保存的密码、卡号或安全码”。连接器令牌留在后端，不存到电脑上。Vault 里的卡结账时不再逐笔审批；Vault 在共享 bot 上不可用。（官方文档，security 页、approvals 页）
- 共享 bot 的审批：只有 bot 正在回答的那个人可以批准；群聊卡片没有 Always allow。共享 bot 用拥有者的应用与密钥，用到你自己的账号前会先问你。（官方文档，shared-bots 页、approvals 页）
- 企业控制：admin 可强制 Auto Review、加团队规则、设网络策略（Allow All、默认加团队白名单、仅团队白名单）、审计日志、可选的动作录制。（官方文档，security 页）

### 1.8 公开的技术架构信息

- 单个用户一台带持久磁盘的云电脑，bot 共享；连接器令牌留在后端；模型由系统按任务选择，用户不能选模型，请求发往 SpaceXAI 第一方模型或第三方提供商。（官方文档，security 页、FAQ 页）
- 每日加密备份；不提供单台电脑的时间点恢复。（官方文档，security 页）
- 底层模型栈与 bot 调度实现：没查到。launch 报道称 Grok 4.5 由 SpaceXAI 与 Cursor 联合训练（媒体报道，[检索摘要](https://aiweekly.co/node/9806)）。

### 1.9 来源之间的矛盾与未决

- “bot 自己的电脑”：官方文档写明电脑按用户分配而非按 bot 分配，所有 bot 共享一台，bot 之间不是安全边界（官方文档，FAQ 页、computer-and-apps 页）。
- bot 是否有自己的账号：how-grok-bot-works 页写“Bots have no accounts of their own”，而 computer-and-apps 页写可认领 `mail.grokbot.com` 邮箱。两页同时存在，文档没有说明如何协调（可能的区分是“登录第三方服务的账号”与“邮箱地址”，但这是推断，文档未说明）。
- 价格与准入：FAQ 写随 X Subscription 的 Premium、Super、Ultra 与旧 Cursor 的 Pro、Pro+、Ultra、Teams 提供，共享用量池；launch 媒体写面向 SuperGrok Heavy（$300/月）、Cursor Ultra（$200/月）、Cursor Teams Premium（[glitchwire](https://glitchwire.com/news/spacexai-launches-grok-bot-an-ai-that-logs-into-your-tools-and-does-the-actual-w/)），另一家称起价 $120/月（[检索摘要，constellationr](https://www.constellationr.com/insights/news/spacexai-launches-grok-bot-work-assistant)）。可能是 beta 阶段与之后的区别，没有来源明说。
- 厂商归属：文档托管在 docs.x.ai，但安全与隐私条款写 “Cursor”、“Anysphere”，并称账号与数据设置来自 Cursor 账号；媒体对 Cursor 收购是否已完成说法不一（媒体报道，[检索摘要](https://aiweekly.co/node/9806)）。
- 媒体称 bot 可“在没有人监督下”于群聊中协调（[glitchwire](https://glitchwire.com/news/spacexai-launches-grok-bot-an-ai-that-logs-into-your-tools-and-does-the-actual-w/)），官方文档则说明交接在对话中可见、审批只能由发起人响应、并建议每阶段单一负责人。

---

## 2. Meta Muse

主要来源：

- 官方安全与架构博客（旧地址 research.meta.ai 301 到此）：<https://muse.ai/blog/security-and-safety-for-ai-agents-our-approach-with-muse>（官方文档）
- 官方设计博客：<https://muse.ai/blog/how-we-designed-muse>（官方文档）
- 官方首页：<https://muse.ai>（官方文档）
- Meta 帮助中心“管理 Muse 数据”：<https://www.meta.com/help/artificial-intelligence/2225571704857152/>（官方文档）
- Meta 帮助中心“隐私、安全与保护”：<https://www.meta.com/help/artificial-intelligence/1047255454427887/>（官方文档）
- Meta 新闻室 Connect 2026：<https://about.fb.com/news/2026/09/the-biggest-news-from-connect-2026/>（官方文档）

### 2.1 基本概念与会话

- Muse 是 Meta 的个人 AI agent，“你给它一个目标，它处理其余部分”，用途含整理邮件、订位、购物、管理日历。（官方文档，muse.ai 首页）
- 设计上以“主聊天里的一段长对话”为中心，而不是一问一答；用户可随时打断或一次发多个任务。后来加了 “side chats”（侧聊），因为部分测试者想要按话题隔离上下文。（官方文档，how-we-designed 博客）
- 主聊天不能被直接删除，只能通过整体 “Reset Muse” 清除；侧聊和单条消息可以删除。（官方文档，帮助中心“管理 Muse 数据”）
- “Goals” 标签页跟踪长期任务与计划。（官方文档，how-we-designed 博客）
- 用户不需要“管理会话”这一点：官方资料里只有一条主对话加可选侧聊，没有写会话列表或会话恢复的概念。上下文压缩机制：没查到。
- 用户可以给 agent 命名、做头像、自定义沟通方式（媒体报道，[检索摘要，testingcatalog](https://www.testingcatalog.com/meta-to-announce-shared-agents-for-muse-at-meta-connect.md)）。

### 2.2 记忆

- 官方帮助中心：用户可以在 助手图标 → Identity 下编辑或删除 `Memory.md`（记忆）、`Soul.md`（个性）、`Identity.md`（身份）。（官方文档，帮助中心）
- 官方安全博客：用户可以自由“查看、编辑、下载这些文件，包括 Muse 关于你的记忆”。设计博客：记忆“跨对话持久，可以管理大量上下文”。（官方文档）
- 删除与遗忘：
  - 有 “forget skill”：在聊天里要求 Muse 忘掉某个主题或一组互动，它会搜索记忆和支撑文件并“尽最大努力”删除；
  - 官方明确写 Muse 可能仍记得从被删内容中学到的信息；
  - 删除聊天消息不等于清除记忆；“Reset Muse” 永久删除聊天记录、文件和进行中的任务（“管理数据”页的列举里没有写记忆；“隐私安全”页写“重置 Muse 以删除所有 Muse 数据”，见 2.9）；
  - 可以导出 Muse 数据（聊天、文件、agent 信息）。（官方文档，帮助中心）
- 内容文件描述：`Soul.md` 默认模板含 “You're not a chatbot. You're becoming someone.” 之类文字，部分与 OpenClaw 模板重合；Meta 产品负责人 Nat Friedman 在 X 上承认 Muse 深受 OpenClaw 启发，Meta 称是从零构建（媒体报道，[SmartScope](https://smartscope.blog/en/blog/meta-muse-soul-md-personality-file-contents-editing-2026/)，其来源 TechCrunch 未读到）。
- 夜间整理：SmartScope 称 App 记忆页写明 `Memory.md` “在对话开始时加载、每晚整理”，同时说明 Meta 官方帮助没有解释整理方式；`Soul.md` 可能被 Muse 自动更新并通知用户，频率与触发条件未确认（媒体报道，[SmartScope](https://smartscope.blog/en/blog/meta-muse-memory-md-remembers-view-edit-delete-2026/)）。这一条没有官方文档来源。
- 联系人档案：WIRED 2026-10-03 报道，Muse 为用户生活中的人（家人、朋友、同事）建立页面，含事实、关系历史、共享上下文、未完事项；据“从产品中提取的指令”，由一个每小时运行的过程建立和更新，页面可以从稀疏开始逐步丰富；Meta 的回应是 Muse 使用用户选择共享的信息和公开信息，用户可选择连接哪些应用、断开服务、让 Muse 忘记信息（媒体报道，经 [letsdatascience 转述](https://letsdatascience.com/news/meta-muse-creates-profiles-of-users-contacts-15585c25)，WIRED 原文 <https://www.wired.com/story/muse-creates-detailed-profiles-of-all-your-friends-and-family/> 未能读取）。报道自己说明这描述的是被提取指令里的预期行为，没有证明每个联系人都有页面。Meta 官方帮助中心与博客均未提及联系人档案。
- 是否跨 bot 共享：Muse 公开资料里是单 agent，此项不适用；“共享 agent”见 2.3。

### 2.3 多 bot

- 官方资料（博客、帮助页、Connect 新闻室）未描述多个 Muse、Muse 之间对话、群组或 sub-agent 管理。
- Vellum（媒体，自带营销性质）称 Muse 能启动并并发运行 subagent，付费档有更高并发（媒体报道，[Vellum](https://www.vellum.ai/blog/official-muse-breakdown)）。官方安全博客只提到一个“浏览器 sub-agent”。
- TestingCatalog 2026-09-10 发现 App 构建里有隐藏的 “Shared Agents” 区域，可创建 agent（提示词、名称与外观、技能、外部服务连接），用起来表现为 Muse 内部独立的 sub-agent 对话；Meta 未公开宣布，后续又报道该入口消失或受限（媒体报道，来源是未公开功能的发现，[testingcatalog](https://www.testingcatalog.com/meta-to-announce-shared-agents-for-muse-at-meta-connect.md)）。Connect 官方新闻室页面未提到。
- Muse 将来可能接入 Messenger 与 Telegram：TestingCatalog 2026-09-22 称在界面与代码痕迹中看到，未确认群聊（媒体报道，来源是代码痕迹，[testingcatalog](https://www.testingcatalog.com/meta-prepares-muse-for-messenger-and-telegram.md)）。
- 谁能创建 agent、是否审批：没查到。

### 2.4 执行环境

- 每个用户一台专属云电脑 “Muse Secure VM”：“隔离的 Linux 机器，带浏览器，有足够的存储、CPU 和内存做实事”。VM 是“你放进 Muse 的一切的记录系统”，持续备份，客户端（iOS、Android、Web）通过安全传输层直连 VM。（官方文档，安全博客）
- 隔离结构：Hatch 守护进程（Muse 核心 harness）、工作区和工具二进制运行在 `systemd-nspawn` 运行时单元里（单元内 root 映射到宿主上的非特权用户，独立 Debian 根文件系统、虚拟网卡、过滤系统调用、受限 capability）；安全服务在单元外作为独立 systemd 单元运行：`hatch-safety`（分类器）、`privsep`（连接器 worker）、`hatch-authd`（凭据）、Sentinel（权限与出网）；持久状态放在单独的 Postgres 数据库；单元与服务通过带 SO_PEERCRED 的 Unix 域套接字通信。设计被描述为“同一台机器上的两个隔离安全域，而不是拿着 root 的 LLM agent”。（官方文档，安全博客）
- Muse 有自己的电脑，带文件系统和终端，可以自己写代码，并能使用完整浏览器；agent 与用户都可使用并可随时介入。（官方文档，设计博客、首页）
- 后台持续运行：见 2.6。
- 与用户本机的连接：官方首页与帮助页只描述云端 VM；Vellum 称 Muse 不能管理用户电脑上的本地文件、终端或桌面软件（媒体报道），The Decoder 称 Connect 上宣布 Muse 可控制 Mac 应用（媒体报道，[the-decoder](https://the-decoder.com/meta-gives-its-muse-ai-agent-video-avatars-email-addresses-and-mac-control/)，仅此一家，Meta 新闻室页面未提到）。
- 机密 VM：官方称“Muse Confidential VM”计划稍后推出，目标是“以密码学方式可验证地”阻止 Meta 访问 VM 数据；目前访问受操作策略限制，Meta 在“支持、保护或运营服务”所需时可访问数据。（官方文档，安全博客）

### 2.5 渠道

- Muse 应用（iOS、Android、桌面、muse.ai 网页）与 WhatsApp，可文字或语音；首发仅美国。（官方文档，首页；媒体报道，[Vellum](https://www.vellum.ai/blog/official-muse-breakdown)）
- 通知：帮助中心有短信通知的帮助文章链接（首页列出，未读正文）。（官方文档，首页）
- Connect 2026（2026-09-23）宣布：Muse 将有自己的电子邮件地址，可用它办事，或作为与它沟通的方式；语音模式；AI 眼镜集成“未来几个月”；Muse Charm 钥匙扣设备预计年底前出货；新增连接器含 Walmart、Best Buy、Instacart、Notion、Granola、GitHub、Box 等。（官方文档，Meta 新闻室）
- 电话号码：没查到。

### 2.6 日程与主动行为

- Muse“按计划并响应相关事件持续工作”，应用关闭后后台继续；仅在“真正有新内容或需要你输入”时通知。（官方文档，设计博客）
- Muse 可以主动发消息，“主动消息必须真的有帮助、值得打断”；有 Ideas 标签页与围绕目标的主动建议；主动性可以关闭或调整。（官方文档，设计博客）
- 日历：可管理日历，部分连接器会主动推送更新（如日历变化），连接前会标明。（官方文档，首页、帮助中心）
- 定时任务：Vellum 称 VM 支持 “scheduled cron jobs”（媒体报道）；官方页面里没有直接找到对应说法。
- 提醒可通过聊天创建，在 Upcoming 视图查看。（官方文档，帮助中心）

### 2.7 安全与授权

- Sentinel 是连接器动作与网络出站的“唯一权限权威”：返回 allowed、denied 或 ask，依据用户设置的连接器策略。官方原话：“Muse 提出动作，只有 Sentinel 能授予执行权限。”（官方文档，安全博客）
- 审批对话框出现在客户端界面里，“不是通过与 Muse 的对话”；批准是“严格的能力授权，不是对话里的建议”；授权类型包括一次性、会话范围、任务范围、限时、永久，由 Sentinel 决定提供哪些。只读、之前已允许或低风险的动作不打断。（官方文档，安全博客）
- 默认需要审批的动作：发邮件、购买等不可逆动作；结账页使用已保存支付信息时每次都要确认精确购买细节；支付通过 Stripe Link 的一次性卡号，绑定商家、金额和有限时间。（官方文档，安全博客、设计博客）
- 凭据：沙箱代码只看到 `authd` 签发的替代令牌，真实凭据由 Sentinel 在网络边界替换进去，“agent 从不看到真实令牌”；OAuth 令牌存放在用户的 VM，而不是 Meta 中央设施。（官方文档，安全博客）
- 防提示注入的分层措施（官方文档，安全博客）：模型训练（称 Muse Spark 1.3 在该能力上接近 SOTA）；harness 把外部数据标为不可信输入；一组独立训练的分类器并行扫描进入模型上下文的外部数据；需要把数据带出 VM 的动作要人工审批；“污染出站”（tainted egress）用内核级数据流跟踪，读过用户数据的进程失去自动放行；邮件连接器过滤一次性验证码、重置密码链接与登录魔法链接；浏览器 sub-agent 看到的是无障碍树而不是原始 DOM，不能运行 JavaScript、禁用 devtools，并有 DOM 与图片注入检测。
- 文档承认：提示注入“仍是业界的开放问题”，“Muse 会也将继续出错”；漏洞赏金最高 30 万美元，其中影响单个用户的提示注入最高 13 万美元。（官方文档，安全博客）
- 数据使用：不与 Meta 广告系统共享对话与 VM 数据；“帮助改进模型”的设置默认开启，可关闭且对此前的互动同样生效。（官方文档，帮助中心）

### 2.8 公开的技术架构信息

- 上面 2.4 与 2.7 的组件（Hatch、`hatch-safety`、`privsep`、`hatch-authd`、Sentinel、Postgres、systemd-nspawn）全部出自官方安全博客。
- 模型：Vellum 称 Muse 运行在专有模型 Muse Spark 上，面向长轨迹工具调用训练（媒体报道）；安全博客提及 Muse Spark 1.3。设计博客引用系统提示的第一句：“Your purpose is to make your user's life better.”
- 无法切换模型、无法自托管（媒体报道，[Vellum](https://www.vellum.ai/blog/official-muse-breakdown)）。

### 2.9 来源之间的矛盾与未决

- 联系人档案只有 WIRED 经第三方转述（且依据“提取出的指令”），Meta 官方文档没有提；“每小时”（联系人档案）与“每晚”（Memory.md 整理，SmartScope）是两个不同来源给的两种整理频率，均无官方文档。
- Reset 删除的内容：帮助中心“管理数据”页列举“聊天记录、文件和进行中的任务”，没有写记忆；“隐私安全”页写重置可删除“所有 Muse 数据”；第三方指南写明含记忆（[rywalker](https://rywalker.com/research/meta-muse)、[SmartScope](https://smartscope.blog/en/blog/meta-muse-memory-md-remembers-view-edit-delete-2026/)）。官方页之间的措辞不同，没有逐项清单。
- sub-agent：媒体称存在并发，官方设计博客与 Connect 新闻室页面都没提；“Shared Agents” 是未公开功能。
- Mac 控制、视频头像：只有 The Decoder 一家报道，Meta 新闻室页面未提。
- 帮助中心未对 `Soul.md` 与联系人档案提供说明（据搜索摘要，SmartScope 也这样写）。

---

## 3. OpenAI ChatGPT Dots

本节官方页面（`openai.com/index/introducing-dots/`、`openai.com/index/how-we-build-safety-security-and-privacy-into-dots/`、`help.openai.com/en/articles/20001529`、`20001530`）全部读取失败（403），只拿到搜索摘要，其余内容来自对官方内容的媒体转述。凡与 OpenAI 原文有关的条目，等级为“媒体报道”或“检索摘要”，不是“官方文档”。

可用来源：

- VentureBeat（媒体报道）：<https://venturebeat.com/ai/openai-launches-dots-always-on-ai-agent-coworkers-and-chatgpt-space-where-they-can-collaborate-with-human-teams>
- Decrypt（媒体报道）：<https://decrypt.co/379584/openai-gave-ai-agents-their-own-computers-devday-2026-everything-announced>
- The Neuron（媒体报道）：<https://www.theneuron.ai/news/openai-devday-2026-chatgpt-is-becoming-an-ai-operating-system/>
- Promptessor、Anima（第三方博客，文中称引用了 OpenAI 官方页面）：<https://promptessor.com/blog/openai-dots>、<https://animaapp.com/blog/agentic/openai-dots/>
- OpenAI 帮助中心与官方页（检索摘要）：<https://help.openai.com/en/articles/20001529-dots-privacy-security-and-safety-faqs>、<https://help.openai.com/en/articles/20001530>、<https://openai.com/index/introducing-dots/>

### 3.1 基本概念与会话

- Dot 是 ChatGPT 里的常驻 agent，“设计成员工关掉聊天窗口后继续工作”：监控项目、使用软件、响应变化的信息，并把完成的工作带回来请用户批准。（媒体报道，VentureBeat）
- 帮助中心英文文章描述：Dot 是“可以承担持续责任、在对话之间持续推进的 always-on agent”。（检索摘要，help.openai.com 20001530）
- 与会话的关系：Dot 可以同时处理多个项目、接新任务，不需要分开的对话线程。（媒体报道，VentureBeat、promptessor）一个 Dot 可通过 ChatGPT、Slack 或 Teams 与同一个 Dot 对话。（媒体报道，VentureBeat）
- 创建：在 ChatGPT 桌面应用或桌面浏览器里创建首个 Dot、连接应用，让它自我介绍；创建时可改名，默认 handle 基于用户名；目前不能在手机上创建，手机 App 在创建后可给它发消息。（检索摘要，help.openai.com；媒体报道，promptessor、animaapp）
- 数量：The Neuron 称“目前每个用户一个主 Dot”，并说 OpenAI 设想 Dots 团队协作；Promptessor 称首个 Dot 免费、“OpenAI 计划之后支持更多 Dot”；VentureBeat 与 Decrypt 称“首个 Dot 随套餐赠送”；帮助中心关于“多个 Dot”：检索没有找到。
- 上下文续接：除“在对话之间持续推进”外，压缩机制没有查到。Decrypt 提到同日发布的 Agents API 提供“上下文压缩”给开发者（媒体报道），与 Dots 本身的关系没有说明。
- 重置：重置会删除 Dot 及其对话、记忆与计划任务。（检索摘要，help.openai.com）

### 3.2 记忆

- Dot 会逐渐学习个人的“偏好、标准和工作习惯”。（媒体报道，VentureBeat）
- 记忆与 ChatGPT 记忆的关系：关闭 ChatGPT 的记忆会停止 Dot 与 ChatGPT 之间共享记忆，但不会删除 Dot 已经收到的信息。（检索摘要，help.openai.com 隐私安全 FAQ）
- 断开应用只停止后续访问，不自动清除 Dot 已学到的信息。（媒体报道，animaapp）
- 分类、存储位置、用户能否逐条查看与删除、是否跨 Dot 共享、是否有离线整理：没查到。
- 私有笔记：VentureBeat 称 OpenAI 说不会用 Dot 的主动研究和它给自己的私有笔记训练模型，说明 Dot 有“给自己的私有笔记”，但笔记的结构与用户可见性没查到。
- 在 ChatGPT Space 中：共享一个 Page 不会暴露私人对话或个人记忆；但 ChatGPT 写到 Page 上的记忆内容对协作者可见；协作者各自的训练与记忆设置仍对共享内容生效。（媒体报道，VentureBeat）

### 3.3 多 bot（多 Dot）

- Specialist Dots（专职 Dot，试点中）：与个人 Dot 不同，拥有组织层面的身份、凭据、系统访问权限，被分配明确业务角色；内部试验覆盖采购、发票处理、邮件营销、客服、商务合同；早期企业试点由 OpenAI 工程师定义每个 agent 的职责、工具与审批流程。（媒体报道，VentureBeat；The Neuron：独立身份、凭据、硬件）
- OpenAI 正与微软合作，把专职 agent 接入 Microsoft Agent 365 做治理。（媒体报道，VentureBeat）
- Dot 与 Dot 之间能否对话、群组：没查到。
- 在 ChatGPT Space 里，多名员工与各自的 ChatGPT、Codex、Dots 在同一 Page 上协作；可 `@` 提到 Dot 或 ChatGPT 让它执行下一步。（媒体报道，VentureBeat）
- Dot 可以把执行委托给 ChatGPT Work 或 Codex，再把结果带回来；这些委托任务计入对应产品用量。（媒体报道，promptessor）
- 谁能创建 Dot、是否审批：个人 Dot 由用户在桌面端创建；专职 Dot 由 OpenAI 工程师与企业共同定义（见上）；其余没查到。

### 3.4 执行环境

- 每个 Dot 有自己的云电脑和浏览器，与员工本机分开，除非用户连接二者。可授权 Dot 直连笔记本或其它设备，访问默认关闭，需在桌面应用中开启。（媒体报道，VentureBeat；检索摘要，help.openai.com）
- 已保存的网站凭据可被使用而不把密码暴露给模型。（媒体报道，VentureBeat）
- 通过 OpenAI 的插件生态连接 4000 多个应用。（媒体报道，VentureBeat、Decrypt）
- 后台持续运行：用户关掉笔记本后 Dot 继续工作（媒体报道，Decrypt、检索摘要）；Activity View 可查看后台进度并重新引导。（检索摘要，OpenAI 官方页的搜索结果）
- 模型：多数报道称 GPT-6 Astra；搜索摘要称 OpenAI 页面有更新，把驱动 Dot 的前沿模型扩展到 GPT-6.1 Terra。（媒体报道与检索摘要，见矛盾一节）

### 3.5 渠道

- 现有：ChatGPT 网页、移动与桌面端；Slack、Microsoft Teams。（媒体报道，VentureBeat、Decrypt）
- 语音通话：Decrypt 与 Promptessor 称已可用语音通话，短信“即将推出”；VentureBeat 称“其它消息应用与电话通话，以音频模型形式，Altman 说‘很快’”，即尚未上线。（见矛盾一节）
- 邮件：VentureBeat 称邮件不是 Dot 的直接渠道，只出现为 Page 可汲取的来源。Dot 是否有自己的邮箱或电话号码：没查到。

### 3.6 日程与主动行为

- 主动研究：在用户没有主动使用时，Dot 检查已连接应用里需要关注的事项；这一阶段的工具是只读的，不能发消息、改内容、控制电脑或浏览器。（媒体报道，VentureBeat；检索摘要，Tom's Guide）
- 自动化：重复任务可委托给按计划或按外部事件运行的 automations。（媒体报道，VentureBeat）Anima 称界面有 “Scheduled” 区域（媒体报道）；Promptessor 称文章未描述调度功能。Page 可设置检查哪些来源、更新哪些部分、多久运行一次。（媒体报道，VentureBeat）
- OpenAI 正在添加按计划或按事件（来信、Slack 消息）触发的共享团队任务。（媒体报道，The Neuron）
- Dot 可在需要输入时给用户发消息。（媒体报道，promptessor）

### 3.7 安全与授权

- 应用控制：组织与用户通过现有 ChatGPT 应用控制选择 Dot 可访问哪些应用；插件权限在 ChatGPT 的 Plugins 标签页管理，跨 Dot、ChatGPT、Work、Codex 通用。（媒体报道，VentureBeat；检索摘要，help.openai.com）
- Custom Rules：可对具体动作“允许、要求批准或禁止”；不能覆盖内置护栏。（媒体报道，VentureBeat；检索摘要，help.openai.com）
- Auto-review：对有后果的动作，对照用户指令、Custom Rules 与内置安全要求，决定可以自主进行还是需要批准；每个动作可放行、要求用户批准或由用户亲自执行。（媒体报道，VentureBeat、promptessor；promptessor 引用了 OpenAI 的 deploymentsafety 页面）
- 仅限人类的动作：修改密码等敏感操作保留给用户。（媒体报道，VentureBeat）
- 批准一条消息不等于授予持续代为联系他人的权限；事先批准仅限用户授权的范围。（检索摘要，help.openai.com 隐私安全 FAQ）
- 提示注入：OpenAI 的 Dots 专门页面没有读到。Promptessor 称“安全监控检查恶意指令并可暂停或停止工作”（媒体报道）；OpenAI 的 GPT-6 Astra 系统卡里的提示注入指标不是 Dots 专属（官方文档，<https://deploymentsafety.openai.com/gpt-6-astra/evaluating-auto-review>：间接提示注入防御成功率 96.23% 升至 99.79%，IPI Arena 15 次尝试的估计攻击成功率 Astra 8.5%、GPT-5.6 Sol 27.0%）。Dots 专属的 “Robustness for dots” 小节没读到（页面 21.6 万字符只读了前 10 万）。
- 数据使用：Business、Enterprise、Edu 工作区内容默认不用于训练；个人计划用户选择。（媒体报道，VentureBeat）
- OpenAI 承认 Dots 会犯错，建议审查有后果的工作。（媒体报道，VentureBeat）

### 3.8 公开的技术架构信息

- Dot 运行在 Codex harness 之上：Decrypt 称“驱动 dots 的 harness 现已开源”；The Neuron 没提开源，只说 Agents API 让开发者使用与 Codex 相同的底层 agent harness，含托管沙箱。（媒体报道，见矛盾一节）
- ChatGPT Space 被报道为“持久的共享状态层”，替代之前的 Library。（媒体报道，VentureBeat、The Neuron）
- 同日发布的 Agents API 增加电脑使用、多 agent 工具、工具搜索与上下文压缩。（媒体报道，Decrypt）
- Dot 内部的记忆、调度、沙箱实现：没查到。

### 3.9 来源之间的矛盾与未决

- 驱动模型：媒体写 GPT-6 Astra；检索摘要称 OpenAI 页面更新为“包含 GPT-6.1 Terra”。
- 语音通话：Decrypt、Promptessor 写已可用；VentureBeat 写电话通话“即将推出”。
- Dot 数量：The Neuron“每用户一个主 Dot”；Promptessor“之后支持更多”；专职 Dot 是组织级的另一类。是否允许个人拥有多个 Dot：没有可靠来源。
- Space 套餐：Decrypt 写 Pro、Business、Enterprise；VentureBeat 写 Dots 面向 Pro 与 Business Premium，Enterprise、Edu、Healthcare 为管理员开启的 beta。可能是两个功能不同的覆盖面，没有来源明说。
- 开源 harness：只有 Decrypt 明确写开源。
- 调度：VentureBeat、Anima 写有自动化与 Scheduled 区域；Promptessor 写文章未描述调度。
- 帮助中心旧版本称“仅限美国的 Pro beta”，新版本称对 EEA、瑞士、英国之外的 Pro 与 Business Premium 开放（检索摘要）。

---

## 4. DeepSeek “super-agent”

### 4.1 它是什么、准确名称与链接

- 没有找到论文或 arXiv 技术报告。它是 DeepSeek Harness 团队的一篇中文技术文章，标题 “Exploring Super-agent Design: Towards a More Autonomous Agent System”（探索 Super-agent 设计，向更自主的 agent 系统），加一个开源原型仓库。（媒体报道、第三方分析：Anima 写文章发布于 2026-10-31，英文机翻 2026-11-01 在 X 上发布；其它来源写 11-01。）
- 文章原文链接：没查到。Anima 页面写原文是中文，未给出 URL；检索摘要提到知乎，但没读到知乎页面。作者署名：多个来源写 Yujia Qiao，无法核实。
- 开源原型（官方文档）：<https://github.com/deepseek-ai/dsh-superagent-prototype>，MIT 许可，TypeScript，仓库页面显示约 2.17 万 star；README 写明 “Research prototype for reference only, not an official DeepSeek product”，“not production-ready”，且“与内部版本不同，文章里的一些设计是该原型没有实现的未来方向”。
- 媒体：SCMP 称其为技术论文（检索摘要，<https://scmp.com/tech/article/3372884/deepseek-unveils-ai-super-agent-coding-race-openai-anthropic>，读取失败）；Interesting Engineering（媒体报道，<https://interestingengineering.com/ai-robotics/china-deepseek-architecture-multi-agent-ai>）；letsdatascience（媒体报道，<https://letsdatascience.com/news/deepseek-proposes-experimental-super-agent-to-coordinate-mul-cc3cd380>）。
- 第三方对文章的详细总结：<https://www.besthub.dev/articles/deepseek-s-super-agent-4-core-designs-turning-ai-into-teammates-9bc5520b7792>、<https://animaapp.com/blog/agentic/deepseek-super-agent/>。下面凡来自这两篇的“文章内容”，等级为“媒体报道（第三方总结）”，不是原文。
- 仓库 docs 已逐篇读取（官方文档）：`000-philosophy`、`001-domain`、`002-authorization`、`003-execution`、`007-architecture`，路径在 `https://github.com/deepseek-ai/dsh-superagent-prototype/blob/main/docs/`；`004-prompts`、`005-panel`、`006-deployment`、`008-cookbook` 未读。

### 4.2 基本概念与会话

- 原型是“针对一个 GitHub 仓库的主动编码 agent”，监听 GitHub，可选监听飞书；有授权的人提出请求时，它开一个工作项，在自己的 agent session 与目录里工作，再在原对话里回复（例如一个 PR）；一个网页面板显示需要人处理的事项。（官方文档，README）
- 目标：“占用尽量少的人类注意力，给出尽量多的价值”；动作只在被请求或团队写下的规则允许时发生，仅在有人必须行动或有结果可用时才说话。（官方文档，000-philosophy）
- 会话关系：一个安装只有一个主 Session（preset `dsh-superagent-router`，14 个应用工具），负责读取、路由、管理 Ticket、评估、回复和配置；每个 Ticket 一个执行者 Session 加一个目录（`worker-<ticket id>`），执行者 Session 有 6 个应用工具，Ticket 结束后工具调用被拒绝。（官方文档，007-architecture、003-execution）
- 第三方对文章的描述：session 不再是 agent 工作的单位；一个长期存在的 Router 负责聊天与派发，隔离的 Worker 各自执行一个任务，另有一个 Watchdog 检查全局；Router 与 Worker 都是 DeepSeek Harness 的 session，仅提示词、工具与职责不同。（媒体报道，检索摘要与 Anima）
- 动机：人通常只能同时盯 3 到 5 个活跃 agent session。（媒体报道，Interesting Engineering；检索摘要）
- 领域模型（官方文档，001-domain）：Source（事件流）→ Trigger（不可变事件）→ Thread → Eval（判断一批 Trigger，两层：确定性门禁加模型评估）→ Decision（accept、stop、ignore、unavailable）→ Ticket（授权工作单位，只有 Eval 能创建）与 Mandate（accept 授予的权限，记录策略版本、范围、强度）→ Assignment（Ticket 与一个执行者实例的绑定）→ Report（progress、waiting、ready、blocked、failed、dropped）。Attention 表示在 Ticket 上等待人回答的问题。
- 上下文如何续：运行时不在内存里持有权威的领域状态；工作状态在 SQLite；会话在重启后保留，重启时运行中的 Assignment 以 “host restarted” 结束，新的 Assignment 带恢复说明，让执行者先检查自己的目录、git 历史与 GitHub，再重复外部动作。（官方文档，007-architecture、003-execution）

### 4.3 记忆

- 原型自己：状态在单文件 SQLite（`orchestrator.sqlite`），含 trigger、disposition、thread、ticket、decision、effect、outbox、kv 等表；“目前没有任何东西删除旧记录”。读缓存重启后丢失。（官方文档，007-architecture）
- 长期记忆：仓库资料中没有长期记忆机制的描述。Anima 总结的一位评论者称 DeepSeek Harness 当时没有内置的跨 session 长期记忆，文章把“数月级的记忆”列为开放问题（媒体报道，第三方总结）。是否有整理或做梦类机制：没查到。
- Router 持全局上下文，每个 Worker 有自己的上下文目录（媒体报道，第三方总结，besthub）。

### 4.4 多 agent 协作

- Router/Worker：Router 用较轻的模型，“从不执行具体任务”；每个任务一个隔离的 Worker session，用最强可用模型，只向 Router 汇报。（媒体报道，第三方总结）
- 源码侧对应：执行者不能向人提问或展示、不能改配置、不能启动或给其它 Session 发消息，这些限制由工具可用性强制，不只靠提示词。（官方文档，007-architecture）
- Worker 并发：默认 3 个、可调 1 到 16，“人的消息可以比 maxWorkers 多用一个槽位”，新工作不会阻止人继续已有 Ticket。（官方文档，007-architecture、003-execution；Anima 总结一致）
- 直通：Worker 拥有的 Thread（例如它的 PR）上的后续消息绕过 Router 直达该 Worker。（官方文档，002-authorization、003-execution；媒体报道，besthub）
- 执行者的子 agent：使用 DeepSeek Harness 的 `standard` preset，Ticket 结束时失去工具。（官方文档，003-execution）
- 创建权限：Ticket 只能由 Eval 创建；Bot 只有出现在 Source 的 bot 名单上才能产生“推测候选”，永远不能产生“明确请求”；其它 bot 不被接纳。（官方文档，002-authorization）
- 基准（作者自报）：作者自己的合成负载下，super-agent 设计 p95 完成时间 15.7 分钟，对比单 session 加 subagent 工具 29.5 分钟，cache-read token 约两到四倍；该基准用约 300 条模拟消息（约 20 个真实工作请求），每种设计跑 5 次，衡量的是调度而非代码质量。（媒体报道，第三方总结，besthub 与 Anima；Interesting Engineering 写“不到 16 分钟对 29 分钟以上”）

### 4.5 执行环境

- 执行者 Session “以操作者的 OS 用户，不经审批”运行命令；每个 Ticket 目录通常是一个 git worktree；前台 shell 超过 5 秒转后台；每轮后台任务最长 30 分钟。（官方文档，003-execution）
- 被屏蔽命令的包装器与目录“不是安全边界”，worker 可以用绝对路径运行程序。（官方文档，003-execution）
- 文章提出的“云脑、本地手”（BYOM）：无状态计算在可替换的云容器里，Session 状态在数据库，开发者机器上的本地执行守护进程保存未提交改动与凭据、只执行命令并返回结果；这个部分以及存算分离在开源原型里没有实现。（媒体报道，besthub 总结）

### 4.6 渠道

- 来源：GitHub（启用）与飞书（原型包里禁用）；用户从 GitHub issue、PR、评论与默认分支 CI，以及（可选）飞书聊天或私聊与它交互。（官方文档，002-authorization、007-architecture）
- 邮件、电话、自己的账号：agent 使用团队提供的 GitHub 账号与提交邮箱（环境变量），README 建议用专用的 OS 账号与 GitHub 账号。（官方文档，003-execution；媒体报道，Anima）

### 4.7 日程与主动行为

- 主动工作需要团队写下的规则：每条规则描述一类主动工作，主动 accept 至少要匹配一条规则；accept 模式 `off`、`observe`（默认，评估后只记录“本会接受”）、`auto`；文档建议先在 `observe` 下运行，审阅决策记录后再切 `auto`。（官方文档，002-authorization）
- 推测执行示例：群里有人报告缺陷，agent 尝试复现并提交修复供人审；失败则保持沉默，不发通知。（媒体报道，Interesting Engineering）
- 调度：主调度循环每两秒运行一次；Source 在 live Ticket 存续期及其后两周内轮询已订阅 Thread。（官方文档，007-architecture、003-execution）周期性定时任务（cron 类）：没查到。
- 看门狗：文章设计里有云侧 Watchdog；原型里它只做每小时重启，没有漂移检测。（媒体报道，besthub）

### 4.8 安全与授权

- 核心原则：“消息、评论和被引用的文档是决策的输入，它们不能改变权限”；允许名单、规则与 Mandate 由宿主强制。（官方文档，002-authorization）
- 门禁：谁可以发起请求由允许名单与每个 Source 的“准入表”决定；强度分 Explicit、Inferred、Not admitted；Mandate 记录来源、范围、策略版本与匹配规则；恢复 Ticket 前重新验证 Mandate。只有三件事能改变 Mandate：accept 创建、人的 stop 撤回、重验证失败撤销。（官方文档，002-authorization）
- Executor 无法声称“人要求我停下”；停止必须来自人的消息（经 Eval 判断）或面板命令。（官方文档，002-authorization）
- 审批：对工作请求没有单独的人工审批流程，权限来自门禁、准入表与 Mandate；合并 PR 之类的条件属于 agent 指令，不属于策略。（官方文档，002-authorization）
- 默认指令只允许小的、已批准的 PR（少于 200 行改动）自动合并，需要第二个账号的 CLI；两个 preset 以 `danger-full-access` 运行，文档建议专用 OS 与 GitHub 账号。（媒体报道，Anima 总结）
- 提示注入：仓库文档里没有内容级过滤，只有上面的结构性控制。作者文章把提示注入与凭据泄露列为开放的安全问题（媒体报道，Anima 总结）。007-architecture 的开放问题写：Trigger 的哪些字段可信（例如 Source 的 actor 与 Thread 成员）、agent profile 与 DeepSeek Harness 安装的部署隔离。（官方文档）

### 4.9 来源之间的矛盾与未决

- 是否“论文”：SCMP 的检索摘要称“技术论文”，其它来源和 README 都表明是一篇博客式技术文章加原型，没有 arXiv 或技术报告。
- 日期：2026-10-31（Anima 与检索摘要）与 2026-11-01（Interesting Engineering、letsdatascience、besthub 的发表日期，可能是英文版或报道日期）。
- Router/Worker 的措辞出自第三方总结与检索摘要；仓库里的对应术语是“主 Session（router preset）”与“执行者 Session”。文章原文未读到，名词以第三方为准。
- 文章中的设计与开源原型不一致：README 与 besthub 都说明部分是未来方向。
- 作者署名未核实。

---

## 5. 速查对照（只列已有证据支持的事实）

| 维度 | Grok Bot | Muse | Dots | DeepSeek 原型 |
|---|---|---|---|---|
| 用户感知单位 | bot（有名字与职责，一个 bot 一段对话） | 一个 agent 加一条主对话，可开侧聊 | 一个 Dot，同时处理多个项目，无需分线程 | 对用户是一个 agent；内部每个工作项一个 Session |
| 会话管理 | 可重置对话，记忆保留 | 主对话不可单独删除，只能整体 Reset | 重置会删除 Dot 及其对话与记忆 | 内部每个 Ticket 一个 Session，人不管理 |
| 记忆载体 | 对话外的记忆（偏好、规则、日志），在聊天里查看与删除 | `Memory.md`、`Soul.md`、`Identity.md`，可编辑、下载、forget | 偏好、标准、习惯；细节没查到 | SQLite 工作状态；长期记忆没有 |
| 多 bot | 主 bot 加专职 bot，bot 之间 handoff，2 到 6 个 bot 群聊 | 无官方描述；Shared Agents 为未公开发现 | 专职 Dot（试点）；Space 里人与 Dot 共用 Page | Router 加多 Worker，直通，Worker 不能互发消息 |
| 电脑 | 按用户一台，所有 bot 共享，每个 bot 一块屏 | 按用户一台 VM | 每个 Dot 一台云电脑 | 操作者本机的 OS 用户 |
| 渠道 | 桌面与手机 app、X、Slack、邮件触发、webhook | app、网页、WhatsApp；将有自己的邮箱 | ChatGPT、Slack、Teams；语音与短信有矛盾 | GitHub、飞书 |
| 定时与主动 | routine（时间表与事件）、主 bot 主动汇报 | 按计划与事件持续工作、主动消息可关 | automations、主动研究（只读） | 规则驱动的主动工作，默认只记录 |
| 对外行动确认 | Auto Review 加审批卡片 | Sentinel 加客户端审批对话框 | Auto-review 加 Custom Rules | 门禁、准入表、Mandate |
