---
schema: nbook.work/v1
workId: w00043-neurobot
issueId: null
status: active
updated: 2026-11-18
---

# NeuroBot：常驻、有记忆的 AI 员工

## 目标

新开子项目 NeuroBot（暂名）：用户面对的是有长期记忆的 bot（像真人员工），不是会话；bot 多渠道可联系、能互相协作与派子代理、有日程与周期任务。第一个用户是 NeuroBook 的看板娘，充当 AI 运营官。先调研同类项目与技术架构，讨论方向，再写提案。2026-11-18 起 bot 先做成 NeuroBook 的内置插件，NeuroBot 独立应用暂停；第一版范围见 [NeuroBook 的 bot](../../../docs/proposals/neurobot.md)。

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
| 2026-11-18 | 开发者：审批的四关太复杂，问“地址能不能写”能否放进规则、模式闸门能否用规则实现（切换模式就是换规则），要一版新方案；主 Agent 写了第一稿（模式与审批模式都写成规则组），开发者同意审查并要求带拉远看；三位审查者核出它会改掉至少五处已定结论、复杂度没降，改写成第二稿 [Agent 审批：一份自有目录、去掉 Agent 的地址表、询问写明来源](../../../docs/proposals/agent-approval-simplification.md)（[审查处理](tasks/t01-direction/evidences/approval-proposal-review-r1-disposition.md)），待开发者看 |
| 2026-11-18 | 开发者看过第二稿的逐步讲解后，同意两项待定：普通模式下只写自有目录在任何审批模式下都不问；不把模式闸门写成规则。第二稿派 Claude Opus 做一轮审查 |
| 2026-11-18 | Opus 审查第二稿（[处理](tasks/t01-direction/evidences/approval-proposal-review-r2-disposition.md)），10 条都成立、已改进提案；开发者同意为询问来源改 nb-harness 内核（加 `cause` 写进会话日志），接受逐个确认下命令只写自有目录也不问，审批提案接受 |
| 2026-11-18 | bot 提案第四稿的五项（开发者逐项答）：(1) Profile 是岗位、bot 是在岗的人，一个 Profile 可以有多个 bot，插件提供 bot 预设，“同意”；(2) 星璃做成 bot，“同意，profile://memory 有了 bot 后应该改成 bot://”（[w00050 t04](../w00050-lyra-persona-and-prompts/tasks/t04-profile-memory-init-and-permissions/README.md) 的三项改由 bot 提案覆盖）；(3) “NeuroBook 没有多渠道入站，不用做原始记录”；(4) 主对话不绑作品，“同意”；(5) “本机口令先不做”。提案 [`neurobot.md`](../../../docs/proposals/neurobot.md) 按此改写成第四稿 |
| 2026-11-18 | 第五稿第七节待定项的答复（开发者逐项答）：(3) 周期任务不只给 bot 的主对话，“session 对话应该，如果有对应的工具也应该可以用周期任务”；(4) “默认的 bot（就是星璃）可以装 shell”；(5) 抓取工具“web 工具不是在 w34 做吗？还在等 w32 现在在做的 t21 eval 工具呢。可以先不做”；(6) 费用上限“现有项目不是没有设费用上限吗？”，末句原话“可不用费用撒谎给你先”，主 Agent 按“第一版不做新的费用上限”理解，待开发者确认；(7) “省钱压缩第一版先不做，以后可以做”；(10) “第一版就做贡献点”。(1)(2)(8)(9) 开发者问了含义，答复后再定 |
| 2026-11-18 | 第五稿待定项第二轮（开发者逐项答）：(1) “提醒走 A。B 不做，这种日历式的提醒以后再单独做”；(2) “待你处理”第一版不做，“bot 类似 IM 里的好友，好友头上有气泡不就代表有维度消息吗”（“维度”应是“未读”）；(8)(9) “可以”；(3) 补充：子代理从产品上不能排，从架构上子代理会话也是普通会话，配了周期任务工具就能排；要支持一个插件让用户点一下就给会话或 bot 排周期任务；“周期任务通知本质上就是系统给这个 session 的缓冲区发一个消息，可以是 steer 可以是 followup，默认是 followup，可以在配置里调”，用户在前端能看到缓冲区并取消（单独开一种类型、前端过滤“也可以”，主 Agent 选了沿用两种模式）；(6) 第一版不做新的费用上限，“同意”；“其他的都同意”。提案改成第六稿，第七节没有待定项 |
| 2026-11-18 | 第七稿待定项（开发者答）：(1) 自动判断下周期任务的授权“按推荐”：用户亲手写下或确认过的条目算授权依据；(2) “有缓冲区的时候点停止应该有两种选项：一种是直接停止，清空缓冲区；另一种是停止本轮，缓冲区立马接着跑。第二个做法就是点击停止后停止，缓冲区也不清空，直到下一次恢复（可以是缓冲区新进）再继续运行。你觉得那种好”，主 Agent 推荐“等恢复”，开发者答“可以，等恢复”。第七稿没有待定项，做一轮窄的第三轮审查后接受 |
| 2026-11-18 | 第三轮审查（[处理](tasks/t01-direction/evidences/bot-proposal-review-r3-disposition.md)）后，“缓冲区归谁取”三轮都找出新路径。主 Agent 给了两条路：周期任务只在会话空闲时发，或者把缓冲区做成内核的状态机。开发者问“直接改内核的缓冲区逻辑呢，架构上会不会更好？”，看过比较后选内核这一条（原话“选内盒这一条”，“内盒”应是“内核”）；恢复时“留着的先跑”；“有几种配置用户自己可以选：合并一起发（默认）、保留原 steer、followup 顺序”。缓冲区的状态机另写一份内核的小提案，bot 提案引用它 |
| 2026-11-18 | 缓冲区小提案第一轮审查（[处理](tasks/t01-direction/evidences/buffer-proposal-review-r1-disposition.md)）后，主 Agent 改成只在“会话回到空闲”一处定留着，并列了三项。开发者答“可以，都按推荐”：(1) 你发消息或点继续放行全部，排话的人能放行自己排的，用户选“停止、排队的留着”留下的只有用户能放行；(2) 停止的缺省沿用 2026-11-05 的“留着”，只在输入框的停止按钮上多给“停止并清空排队”；(3) 用户自己发起的压缩，压完由 NeuroBook 自动放行，系统发起的压缩压完留着。主 Agent 说明的“子代理交出结果后排着的话留着”（偏离 t07 决定 1 的“completed 后按序取”）开发者没有提异议 |
| 2026-11-18 | 缓冲区小提案第二轮审查（[处理](tasks/t01-direction/evidences/buffer-proposal-review-r2-disposition.md)）后的两项，开发者答“同意”：(1) 用户停止子代理后，父 Agent 排给它的话也只有用户能放行，父 Agent 再发话时工具结果告诉它有几条被用户暂停；(2) 系统只能接着跑它自己开的运行，或在它持有的会话里接着跑（例如 bot 插件重启后的主对话），用户自己开的普通会话被中断后只有用户能点继续 |
| 2026-11-19 | t06 范围太大（插件骨架、主对话、等用户、对话宿主、未读，加上 t03 定的“消息”视图与书房入口不在任何 Task 里），开发者选“拆成两个”：t06 只做内核与服务端（主对话与等用户），界面另建 [t15](tasks/t15-messages-view/README.md) 并入 t07 |

autonomous-delivery 推进中照推荐做了、待开发者追认的决定记在 [待确认清单](pending-confirmations.md)。

## 调研

- [仓库内的现状](research/2026-11-09-repo-survey.md)
- [商业产品：Grok Bot、Muse、ChatGPT Dots、DeepSeek super-agent](research/2026-11-09-commercial-bots.md)
- [开源实现：OpenClaw、CopilotKit/OpenBot、nanobot、Letta、QQ 接入、Koishi](research/2026-11-09-open-source-architecture.md)
- [耦合审查汇总：功能能否关、bot 插件缺的接缝、内核与 bot 冲突的假设](research/2026-11-18-coupling-audit.md)（2026-11-18，四位审查者）

## Task 规划

2026-11-18 按已接受的 [NeuroBook 的 bot](../../../docs/proposals/neurobot.md) 与 [Agent 内核的输入缓冲区](../../../docs/proposals/agent-input-buffer-states.md) 重排（开发者“可以，都按推荐”）。NeuroBot 独立应用暂停，t04、t05 搁置；省钱压缩第一版不做，t08 搁置。第一版分三步：

1. **能聊**：星璃常驻在 NeuroBook 里，有一条不断的主对话，等用户时不卡住。
2. **有记忆**：`bot://` 里的人设与记忆，常驻的几份进提示词。
3. **能办事**：日程与周期任务往会话里注入，用户写下或确认过的条目算授权。

| Task | 内容 | 依赖 |
|---|---|---|
| **已完成或搁置** | | |
| [t01](tasks/t01-direction/README.md) | 方向与提案（已完成） | 无 |
| [t02](tasks/t02-host-base/README.md) | 抽 `nb-file-lock`、`nb-host`、`nb-models` | 见该 Task |
| [t04](tasks/t04-app-skeleton/README.md)、[t05](tasks/t05-models-settings/README.md)、[t08](tasks/t08-cost-saving-compaction/README.md) | 独立应用的骨架、模型设置页、省钱压缩（搁置） | 无 |
| [t07](tasks/t07-agent-ui-for-bot/README.md) | nb-agent-ui 的 bot 档（2026-11-19 并入 t15） | — |
| **准备** | | |
| [t03](tasks/t03-web-design/README.md) | NeuroBook 里 bot 的界面设计评审 | 无 |
| [t13](tasks/t13-approval-simplification/README.md) | Agent 审批：自有目录、去掉地址表、询问写明来源 | 无 |
| [t14](tasks/t14-input-buffer-states/README.md) | 内核的输入缓冲区：每条带状态（对所有会话生效） | 无 |
| **第一步：能聊** | | |
| [t06](tasks/t06-main-conversation/README.md) | `nbook.bots` 与主对话、等用户（内核与服务端） | t14 |
| [t15](tasks/t15-messages-view/README.md) | “消息”视图、固定会话的对话宿主、未读与书房入口（含原 t07） | t06、t03 |
| [t16](tasks/t16-kernel-narrow-window-defects/README.md) | 内核四个窄窗口缺陷（t06 设计与实现审查引出，不阻塞第一版） | t06 |
| [t17](tasks/t17-kernel-review-followups/README.md) | t16 审查挖出的内核原有缺陷（未开工，不阻塞第一版） | t16 |
| [t18](tasks/t18-messages-float-window-im/README.md) | 消息视图浮成窗口时像 IM：列表栏可拖宽、切换控件、浮动窗里视图自绘头 | t15 |
| [t19](tasks/t19-messages-view-ui-polish/README.md) | 消息视图界面优化：两侧共用贴外缘的侧轨，消息视图把视图段借给右轨，展开即完整列表；浮动窗里画在右边缘（已合入） | t18 |
| **第二步：有记忆** | | |
| [t09](tasks/t09-bot-memory/README.md) | bot 的记忆 | t06、t13 |
| **第三步：能办事** | | |
| [t10](tasks/t10-schedule/README.md) | `nbook.schedule` 与宿主消息的含义 | t14、t06、t15 |
| [t11](tasks/t11-dogfood/README.md) | 第一版自用与调参 | t10 |

最长的依赖链是 t14 → t06 → t15 → t10 → t11（2026-11-19 开发者把 t06 拆成两个，界面成 t15 并入 t07）。t03、t13、t14 可以同时开工。每个 Task 开工时先按提案改 `planned` Spec，再写计划。

第一版之后的路线（独立应用与外部渠道、记忆评测与 nb-memory、多 bot、触达、省钱压缩、联网、按天费用）不建 Task：提案写明每一步开工前另行讨论。

## Task

- [t01 方向讨论与同类项目调研](tasks/t01-direction/README.md)
- [t02 把两端宿主的通用部分与模型服务抽成包](tasks/t02-host-base/README.md)
- [t03 NeuroBook 里 bot 的界面设计评审](tasks/t03-web-design/README.md)
- [t04 NeuroBot 应用骨架与 gateway](tasks/t04-app-skeleton/README.md)
- [t05 模型与设置页](tasks/t05-models-settings/README.md)
- [t06 bot 的主对话（`nbook.bots`）](tasks/t06-main-conversation/README.md)
- [t07 nb-agent-ui 的 bot 档](tasks/t07-agent-ui-for-bot/README.md)
- [t08 省钱的两种压缩触发](tasks/t08-cost-saving-compaction/README.md)
- [t09 bot 的记忆](tasks/t09-bot-memory/README.md)
- [t10 日程与周期任务（`nbook.schedule`）](tasks/t10-schedule/README.md)
- [t11 第一版自用与调参](tasks/t11-dogfood/README.md)
- [t12 不判旧的文件锁单独成包 nb-flock 并随 nb-story 发布](tasks/t12-flock-into-file-lock/README.md)
- [t13 Agent 审批：自有目录、去掉地址表、询问写明来源](tasks/t13-approval-simplification/README.md)
- [t14 Agent 内核的输入缓冲区：每条带状态](tasks/t14-input-buffer-states/README.md)
- [t15 “消息”视图：bot 与会话两个标签、固定会话的对话宿主、未读与书房入口](tasks/t15-messages-view/README.md)
- [t16 内核四个窄窗口缺陷](tasks/t16-kernel-narrow-window-defects/README.md)
- [t17 t16 审查挖出的内核原有缺陷](tasks/t17-kernel-review-followups/README.md)
- [t18 消息视图浮成窗口时像 IM](tasks/t18-messages-float-window-im/README.md)
- [t19 消息视图界面优化](tasks/t19-messages-view-ui-polish/README.md)
