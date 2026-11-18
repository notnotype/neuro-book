---
schema: nbook.work/v1
workId: w00043-neurobot
issueId: null
status: active
updated: 2026-11-18
---

# NeuroBot：常驻、有记忆的 AI 员工

## 目标

新开子项目 NeuroBot（暂名）：用户面对的是有长期记忆的 bot（像真人员工），不是会话；bot 多渠道可联系、能互相协作与派子代理、有日程与周期任务。第一个用户是 NeuroBook 的看板娘，充当 AI 运营官。先调研同类项目与技术架构，讨论方向，再写提案。

## 需求（开发者 2026-11-09）

下面按开发者的原话整理，只调了顺序与格式，没有增删意思。

参照项目（优先级降序）：Grok Bot、Muse、ChatGPT Dots、OpenBOT（开源实现，约 1 万 star；开发者对这类跟风的速成品存疑，参考价值可能不大）。

起因：NeuroBook 的看板娘要有一台电脑（开发时先用本机）和社交媒体账号（B 站、X 等），充当 NeuroBook 的 AI 运营官。

1. **积累知识。** 小说写作是垂直领域，模型很少专门训练，风向常变，模型的知识是固定的，要靠记忆系统不断积累。知识要分清哪些是 bot 私有、哪些能做成共享知识库：
   - 梗（适合做知识库）：写作能用，聊天时接得住、用得活能让 bot 有活人感；
   - 小说平台的风向（可做知识库）：最新政策、别人分享的经验；
   - 写作技巧：别人在视频或图文里分享的；
   - bot 的私人记忆：认识的人、经历的事。记忆要能深度配置；理想是能记住几乎每一件重要的事和人，并有“做梦”机制整理记忆。
2. **做用户的私人代理（秘书）：**
   - 多渠道：web、app、tui、Telegram、Discord、QQ、短信、电话等；第一版先做 web 和 QQ；
   - 日程（可做成插件）：用户和 bot 共同维护；分周期任务（几点干活、刷牙）与一次性任务（几点开会）；存储可接日历应用或 Todoist，也可自己存；
   - bot 有自己的联系方式（例如邮箱），用户可以挂在主页；与用户共用邮箱也行，但分开更好：自己的邮箱 bot 可以自由回复，共用时不能随便以用户身份回复；
   - 给 bot 排周期任务，例如每周整理某领域的简报。
3. **多代理协作**（开发者认为与 DeepSeek 发布的 super agent 论文类似）：
   - 用户不感知会话，感知的是 bot（或者说 Profile）：用户不切换会话，像和一个真人交流；bot 有自己的记忆；上下文由 NeuroBot 管，保证不超限（自动压缩、缓存过期前压缩、空闲压缩）；
   - bot 之间能互相交流，用户能把 bot 拉进群讨论；
   - bot 能派子代理，自己管会话，对软件构建这类大任务特别有用。两个概念：bot 有记忆；agent（adhoc）通常用一次就不用，做调研、编码。用户只用 bot；bot 能创建 bot、派子代理。创建同级 bot 相当于“bot 想邀请一位员工加入”，要用户审批；创建子 bot 不用审批；
   - 组织架构：参考公司的组织架构，例如开发部主管同时推进多个项目、身处几个组织；但按小公司管理，开几百个 bot 不现实，用户也管不过来；
   - bot 分身（可能有需求）：例如让软件工程师 bot 并行开发多个项目，共享同一份记忆；
   - 交友与社区（优先级不高）：把别人的 bot 加进联系人列表；风险是 bot 要防上当受骗。
   - 开发者的问题：上面三点能否拼出现实存在的组织架构（例如三省六部制），现实架构有其合理性，可以拿来讨论。用户是老板，bot 是员工。例子：用户要开发一个软件，告诉秘书；秘书安排开会，邀请开发、产品、财务、市场部主管 bot 确认可行；开发部组建“产品 A 开发”组织，邀请新的或现有的 bot（软件工程师、设计师等）加入。
4. **自己去 B 站、X、Reddit 刷帖子、看视频、回评论，充当运营。** 只给开发者自己用，用来验证 NeuroBot 的能力够不够；看视频可以做成插件。

记忆：考虑重启搁置的 nb-memory；要重启，先按实际使用场景做评测。

架构（初步，开工前要调研同类项目的技术架构）：一个 gateway、多个 device（服务器、手机）、多个 channel（web、tui、qq、app 等），其中 web、tui、app 是用户界面。技术架构的问题：是否继续作为 monorepo 的子项目；是否像 NeuroBook 一样用 nb-runtime 这套插件系统（开发者倾向于用）。

## 决定

| 日期 | 决定 |
|---|---|
| 2026-11-09 | 开发者：bot 与电脑的对应可配置，缺省所有 bot 共享一台电脑 |
| 2026-11-09 | 开发者：“bot 审 bot 这个机制，nb-harness 是提供了的。”追问后确认指工具调用这一层：例如运营 bot 发帖前由另一个 bot 判定放不放行（核对：nb-harness 有审批钩子 `ApproveHook` 与拦截链；`auto` 模式的判定实现 `auto-review.ts` 在 `nbook.agent` 里；w00032 t14 决定 8“审批一律交给用户”对 NeuroBot 要放开） |
| 2026-11-09 | 底座选 A：monorepo 里新建应用包，在 nb-runtime 上自建，借 OpenClaw 的设计（[t01](tasks/t01-direction/README.md)） |
| 2026-11-09 | Agent 能力：nb-harness 就是抽好的包，不新建包；按 w00032 t02 决定 3 把落在 `nbook.agent`、`nbook.models` 里的通用部分补回 nb-harness，作为 [w00032 t32](../w00032-agent-integration/tasks/t32-harness-backfill/README.md)，与 t14 的界面静态稿阶段并行 |
| 2026-11-09 | QQ 用 LLOneBot（OneBot v11），第一版不做；先做 web |
| 2026-11-09 | 记忆：第一版只做原始记录、Markdown 记忆文件与检索，bot 跑一段后用真实记录建评测，再定 nb-memory 重启还是另起 |
| 2026-11-09 | 第一版范围：只有看板娘一个 bot；用户不管会话（私信一个主会话、每个群一个会话，自动压缩，补空闲压缩）；日程与周期任务做成插件；保留原始记录。多 bot、组织、设备、社媒运营往后放 |
| 2026-11-09 | 提案 [NeuroBot 第一版](../../../docs/proposals/neurobot.md) 的要点开发者看过：缓存过期前压缩与空闲压缩都是为了省钱；其余待定项按推荐同意（名字暂用 `neuro-bot`、`nbot`；bot 与 Profile 分开；原始记录与会话日志分开；新压缩触发点放进 nb-harness；周期任务在单独的会话里跑；web 范围） |
| 2026-11-09 | 开发者：本会话的设计审查不用 omp，改用 Opus 子代理 |
| 2026-11-10 | 提案第二稿的待定项（开发者“可以，用推荐 b 吧”）：仍在 NeuroBook 应用里的部分只把安全攸关、已调好的抽成包共用（两端宿主中与应用无关的部分、HTTP 的来源核对、模型服务），其余 NeuroBot 自己写；web 加“待你处理”入口与设置页、另写 ADR 改 0030 的搬迁条件，没有单独作答，按推荐算追认 |
| 2026-11-10 | 开发者同意 t02 计划审查后的三项：模型服务放进新包 `nb-models`；加锁替换抽成与应用无关的小包；诊断日志的输出插件进 `nb-host` |
| 2026-11-10 | 开发者同意下面的“Task 规划”（答“可以”）。同一轮里还列着、没有单独作答的，按“待确认默认追认”算定：t02 计划的三项（小包名 `nb-file-lock`；三个包的 exports 与 `private: true`；五个内置角色与选择顺序归 `nb-models`）、w00032 t32 计划的旧 `src/tools/` 不合并留给 t31 删。代码由谁写没有答复，按开发者的全局规则由主会话写 |
| 2026-11-10 | 提案第二轮审查后的四项（开发者“都按推荐，第一版先把框架搭起来就行”）：gateway 加每次启动生成的本机口令（nb-host 可选项，t04 做）；第一版加只读的联网抓取工具，任务缺省不许跑 shell；主对话等用户时输入框一直可用，发消息即结算为“没批准”并带上这句话，30 分钟没人理由内核按过期结算；第一版网页只做标题未读数、页面内未读分隔线、按天分隔线与最小设置页，首次启动自动建缺省的看板娘。第一版以搭起框架为准（[t01](tasks/t01-direction/README.md)） |
| 2026-11-13 | 开发者定（w00032 t15 实现审查引出）：不判旧的系统文件锁从 nb-harness 与 nb-story 的两份副本合成一份，放进 nb-file-lock 的单独子路径，nb-file-lock 随 nb-story 发布，改 ADR 0045 决策 4 对它的“不发 npm”；建 [t12](tasks/t12-flock-into-file-lock/README.md)，未开工 |
| 2026-11-13 | t12 计划审查（两位 Sonnet，一位从整体看）后开发者改定方案 E：不判旧的文件锁单独成零依赖的小包 `nb-flock` 随 nb-story 发布，nb-file-lock 保持 private 与只有 `.`，ADR 0045 不改；见 [t12](tasks/t12-flock-into-file-lock/README.md) |
| 2026-11-18 | 开发者：NeuroBook 本身也适合做成 bot 员工的交互，用户仍可以用会话（不推荐）；NeuroBook 不需要多渠道与网关。按主 Agent 的推荐，bot 先做成 NeuroBook 的内置插件，NeuroBot 独立应用暂停（不删，等要外部渠道、远端设备或不开界面的常驻服务时再议）；第一版只有一个 bot；日程与周期任务做成 NeuroBook 的内置插件。提案 `neurobot.md` 不标接受，改写成 NeuroBook 的 bot 提案；t04、t05 随改写取消，t06 到 t10 改成在 NeuroBook 里做 |
| 2026-11-18 | 开发者最在意耦合：nb-agent-ui 要能适配会话模式、bot 模式、会话加 bot 模式；要求派几个子代理深查现有组件的耦合（功能与业务功能能否关掉，哪些可以拆开、哪些不推荐耦合、哪些可以接受）。开发者提出 bot 与 Profile 的关系（Profile 能否衍生多个 bot、插件怎样提供 bot）与新的 `bot://` 空间，待讨论 |
| 2026-11-18 | 耦合审查（[汇总](research/2026-11-18-coupling-audit.md)）后开发者定：内置插件不做成能关，接受这个取舍，以后确实需要再开；启动必需只留基础插件以后做（建了 [w00027 t20](../w00027-plugin-platform/tasks/t20-startup-required-base-plugins/README.md)，现在启动不慢）；会话能读别的会话的日志是有意的设计（Agent 的能力），不收紧 |
| 2026-11-18 | 开发者：周期任务先用 cron 注入当前对话（到点由系统往主对话注入一段提示词，同 Claude Code），按主 Agent 的补充，重活由 bot 自己派子代理（子 Profile 只装需要的工具）；原提案的单独任务会话、工具清单的三处强制与按会话裁剪工具集不做。注入的话要标明来源、不算用户的授权，空闲时由它开一轮（内核改动） |
| 2026-11-18 | 开发者：审批的四关太复杂，问“地址能不能写”能否放进规则、模式闸门能否用规则实现（切换模式就是换规则），要一版新方案；主 Agent 写了 [Agent 审批收成一套规则](../../../docs/proposals/agent-approval-as-rules.md) 的草稿，待开发者看 |

## 调研

- [仓库内的现状](research/2026-11-09-repo-survey.md)
- [商业产品：Grok Bot、Muse、ChatGPT Dots、DeepSeek super-agent](research/2026-11-09-commercial-bots.md)
- [开源实现：OpenClaw、CopilotKit/OpenBot、nanobot、Letta、QQ 接入、Koishi](research/2026-11-09-open-source-architecture.md)
- [耦合审查汇总：功能能否关、bot 插件缺的接缝、内核与 bot 冲突的假设](research/2026-11-18-coupling-audit.md)（2026-11-18，四位审查者）

## Task 规划

开发者 2026-11-10 同意。第一版按能用到什么程度分四步，每步做完都能实际用起来：

1. **能聊**：看板娘在 web 上有一条不断的对话，用户不开会话、不切会话。
2. **能长期聊**：有记忆，省钱的压缩，上下文不超限。
3. **能办事**：日程、到点提醒，周期任务自己去跑。
4. **自用调参**：实际跑一段，按真实花费与记录调数值，攒下记忆评测的材料。

| Task | 内容 | 依赖 |
|---|---|---|
| **准备** | | |
| [t01](tasks/t01-direction/README.md) | 提案第二轮审查，接受 | 无 |
| [w00032 t32](../w00032-agent-integration/tasks/t32-harness-backfill/README.md) | nb-harness 补回 Agent 的通用部分（别的 Work） | 无 |
| [t02](tasks/t02-host-base/README.md) | 抽 `nb-file-lock`、`nb-host`、`nb-models` | `nb-models` 的两片在 w00032 t32 之后 |
| [t03](tasks/t03-web-design/README.md) | web 界面设计评审（静态稿） | 无 |
| **第一步：能聊** | | |
| [t04](tasks/t04-app-skeleton/README.md) | 应用骨架与 gateway | t01、t02 的 `nb-host` |
| [t05](tasks/t05-models-settings/README.md) | 模型与设置页 | t02 的 `nb-models`、t04、t03 |
| [t06](tasks/t06-main-conversation/README.md) | 主对话（原始记录、harness 接线、对话页） | w00032 t32、t04、t05、t03 |
| [t07](tasks/t07-agent-ui-for-bot/README.md) | nb-agent-ui 的调整（事件开启的轮次、分隔线） | t03；与 w00032 t14 错开 |
| **第二步：能长期聊** | | |
| [t08](tasks/t08-cost-saving-compaction/README.md) | 省钱的两种压缩触发 | w00032 t32、t02 的 `nb-models` |
| [t09](tasks/t09-bot-memory/README.md) | bot 的记忆 | t06、t08 |
| **第三步：能办事** | | |
| [t10](tasks/t10-schedule/README.md) | 日程与周期任务插件 | t06、t07、t09 |
| **第四步** | | |
| [t11](tasks/t11-dogfood/README.md) | 第一版自用与调参 | t10 |

最长的依赖链是 w00032 t32 → t02 的 `nb-models` → t05 → t06 → t09 → t10，起点是 t32。t01、t02 不碰 t32 的那几片、t03 与 t32 可以同时做；t04 在 `nb-host` 合入后就能开工。提案接受后，每个 Task 开工时先写自己那份 Spec 的草稿，再写计划。

第一版之后的路线（QQ、记忆评测与 nb-memory、多 bot、组织、设备与渠道、社媒运营）不建 Task：提案写明每一步开工前另行讨论。

## Task

- [t01 方向讨论与同类项目调研](tasks/t01-direction/README.md)
- [t02 把两端宿主的通用部分与模型服务抽成包](tasks/t02-host-base/README.md)
- [t03 第一版 web 界面设计评审](tasks/t03-web-design/README.md)
- [t04 NeuroBot 应用骨架与 gateway](tasks/t04-app-skeleton/README.md)
- [t05 模型与设置页](tasks/t05-models-settings/README.md)
- [t06 主对话](tasks/t06-main-conversation/README.md)
- [t07 nb-agent-ui 为 NeuroBot 做的调整](tasks/t07-agent-ui-for-bot/README.md)
- [t08 省钱的两种压缩触发](tasks/t08-cost-saving-compaction/README.md)
- [t09 bot 的记忆](tasks/t09-bot-memory/README.md)
- [t10 日程与周期任务插件](tasks/t10-schedule/README.md)
- [t11 第一版自用与调参](tasks/t11-dogfood/README.md)
- [t12 不判旧的文件锁单独成包 nb-flock 并随 nb-story 发布](tasks/t12-flock-into-file-lock/README.md)
