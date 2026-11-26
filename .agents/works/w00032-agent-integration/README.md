---
schema: nbook.work/v1
workId: w00032-agent-integration
issueId: null
status: active
updated: 2026-11-17
---

# NeuroBook 接入 Agent

## 目标

Agent 作为内置插件接入 NeuroBook：以 master 的 nb-harness 为底座，参考内核分支 feat/w00002-harness-kernel 逐块补能力；先按先后关系逐条讨论设计，定稿后再实施。

## 决定

| 日期 | 决定 |
|---|---|
| 2026-10-28 | 开发者：以 master 的 nb-harness（nb-story 在用的那套）为底座，参考内核分支 `feat/w00002-harness-kernel`，分支做得多的地方逐块移过来 |
| 2026-10-28 | 开发者：插件给所有 Profile 加工具时，一起考虑工具发现（t04） |
| 2026-10-28 | 开发者：先建 Task 草稿，按先后关系逐个讨论设计 |
| 2026-10-28 | t02 定稿：合同以 master 为准、代码以分支为主体；一个包子路径导出；分工按“离开 NeuroBook 还能不能用”；升最新 OMP；分支 Spec 随代码搬来（[t02](tasks/t02-harness-baseline/README.md)） |
| 2026-10-28 | t03 定稿：条目树加当前叶子；会话放状态根、不随书走；不加租约；旧格式不在读取时转换，另给一次性迁移脚本（[t03](tasks/t03-session-model/README.md)） |
| 2026-10-28 | t04 定稿：id 即内部名字，交给服务商时 `.` 换 `__`；Profile 只声明、工具绑定存用户配置；工具发现搁置；会话中 Profile 变化按轻重分（[t04](tasks/t04-tool-registry/README.md)） |
| 2026-10-28 | t05 定稿：Profile 只提要求（工具、模型能力、压缩种子与摘要要求），实际配置放 Profile 设置；不碰审批；内置、插件、用户级三层；重载用打包加哈希；钩子拆到 t20（[t05](tasks/t05-profile/README.md)） |
| 2026-10-28 | t06 定稿：审批照搬分支、默认放行写入；只读模式弹审批且优先于审批模式；内置 `ask`；分支 t20 三条追认；不做“改了再批”（[t06](tasks/t06-approval/README.md)） |
| 2026-10-28 | t07 定稿：插话与排队照搬分支；中止补强制接管；排队进日志；等审批时打字即拒绝并附言；运行中不能改树；中断后不自动续跑（[t07](tasks/t07-run-control/README.md)） |
| 2026-10-28 | t08 定稿：复数方案是目录（根虚拟、条目真实），单数是当前这一个；`session://`、`profile://`（只在状态根）、`tmp://`、`docs://`、`skills://`；去掉 `local://`、`artifact://`；Skill 由 NeuroBook 自己管（[t08](tasks/t08-resources-home/README.md)） |
| 2026-10-28 | t09 定稿：模型服务单独插件；密钥统一进 OMP 凭据库；角色照合同；模型与推理档是会话级设置、不随回退切回（改 t03 决定 1）（[t09](tasks/t09-models/README.md)） |
| 2026-10-28 | t10 定稿（方向）：三个入口；九个贡献点，斜杠命令单独一个贡献点、不复用 `nbook.commands`；运行经远程服务推送；导出 `agent.startTask`（[t10](tasks/t10-agent-plugin/README.md)） |
| 2026-10-28 | t11 定稿：阈值照 omp 三层；就地、摘要模型、shake 三种方法，阈值与溢出各一个缺省顺序；“压缩”专精角色；压缩后放回最近文件等走公共流程（[t11](tasks/t11-compaction/README.md)） |
| 2026-10-28 | 提示词语言照 ADR 0034（领域与新写的基础设施提示词用中文）；长期目标是 i18n、现在用中文是为了方便（补进 `common.md`）；w00031 t05 评测继续搁置 |
| 2026-10-28 | t12 定稿：第一批工具 read、write、edit、grep、glob、shell、todo；shell 的洞第一版不补；网页工具另做插件；外部命令行发布时做；eval 开 t21、后台工作开 t22，都搁置（[t12](tasks/t12-builtin-tools/README.md)） |
| 2026-10-28 | t13 方向已讨论、优先级不高，排到末尾：归属 `nbook.history`；插件写入也记来源；收件箱不挡流程、参考旧组件迁移；会话回退与文件回退分开（[t13](tasks/t13-history/README.md)） |
| 2026-10-28 | t20：harness 以事件模型为骨架（日志 → 折叠 → 状态 → 视图 → 请求 → 副作用 → 日志），写成提案 [agent-harness-event-model](../../../docs/proposals/agent-harness-event-model.md) 待讨论 |
| 2026-10-29 | 提案第二稿：`reduce` 只看自己那一片、反应看同一份快照、扩展状态默认私有经选择器共享、`prompt` 能读状态、视图加 `attach`、预览也跑拦截链；循环由内核自己写，不再套 OMP 的 `Agent`（改 t02 决定 1）（[t20](tasks/t20-hooks/README.md)） |
| 2026-10-29 | t20：开发者同意历史是投影、模板四节点、内核与内置扩展的分工；按开发者要求做了 spike 并做两轮深入审查（omp 与 Opus），提案改成第三稿、介绍页发布 v3；第三稿改变已定写法的六处待开发者确认（[t20](tasks/t20-hooks/README.md)） |
| 2026-10-29 | t20：开发者提出“异步状态机”（输入缓冲区、一轮结束才提交进 `Message[]`），提案改成第四稿；同意去掉 `prelude`；按开发者要求派三个 Sonnet、一个 Fable、一个 omp 做接口设计兼架构审查，汇总成第五稿与 `spike/v5/`，待开发者看（[t20](tasks/t20-hooks/README.md)） |
| 2026-10-29 | t20 讨论结束：开发者认可提案第五稿；便利写法做成 helper（`reminder()`、`opening()`、`standardLayout()` 等）；t20 改了内核，实施时排在最前，实现要再审查一次；t05 的上下文机制按提案改写（[t20](tasks/t20-hooks/README.md)） |
| 2026-10-30 | t14：开发者定工具设计原则，一个工具只做一件事、宁可工具多、不设计复合工具，以后所有工具都按这条（记在 t04）；结果分自由、可选结构化、强制结构化三种；父 Agent 能做人类对子会话能做的操作（[t14](tasks/t14-multi-agent/README.md)） |
| 2026-10-30 | t14 讨论完成待审查：子代理工具 `agent_spawn`、`agent_send`、`agent_answer`，任务中心 `wait`、`kill`、`jobs`，子代理交结果用 `yield`；`sessions://<id>/` 映射整个会话目录（改 t08）；bash 工作目录改为 `project://`（没有项目时 `session://`）；对 t20 内核三处修正（审批与提问合成一条通道、`shared` 工具并发、`replyTo` 异步提问）（[t14](tasks/t14-multi-agent/README.md)） |
| 2026-10-30 | t14 omp 设计审查 18 条已处理：任何会话都能读任何会话（开发者认为不是漏洞，不采纳第 12 条）；中止只连带正在等的子会话；子代理与后台任务加并发上限；异步回答走 `resolve`；Workflow 另开 t24 搁置（[t14](tasks/t14-multi-agent/README.md)） |
| 2026-10-30 | t14 讨论完成：两轮 omp 设计审查处理完，开发者确认定稿；硬上限每会话 16、全局 32、深度 5（[t14](tasks/t14-multi-agent/README.md)） |
| 2026-10-30 | t15 讨论完成：标准 6 个字段加 `when-to-use`；第一版 Skill 只由用户 `$` 触发、不进提示词、没有参数；依赖只支持 Bun，应用按 `node_modules` 里的标记判断是否初始化；插件里的 Skill 构建时打包依赖；最小安装单位是插件，市场另开 t25；不支持额外的 Skill 目录（[t15](tasks/t15-skills/README.md)） |
| 2026-10-30 | t16：Agent 经 CodeAct 操作 NeuroBook 界面（快照、动作、截图、高亮），另开 w00033 做核心包 `nb-page-agent` 与内置插件；浏览器插件操作外部网站另开 w00034；Agent 与命令系统的对接、控件绑命令的规范搁置；指针与拖动搁置，以后由桌面外壳解决；eval（t21）要加让插件登记全局对象的贡献点（[t16](tasks/t16-command-bridge/README.md)） |
| 2026-10-30 | t16 讨论完成：`nbook project` 第一批五个子命令（list、info、create、add、check），写操作要求应用在运行，`check` 可由插件扩展；`nbook` 命令行与 start、serve、系统服务的设计另开 w00035（[t16](tasks/t16-command-bridge/README.md)） |
| 2026-10-30 | t17 方向讨论完成：对话是右栏的工作台视图、一个视图一个会话；模式菜单分 Agent 模式与审批模式；审批与停下运行的提问用提问向导替换输入框；工作台状态栏加 Agent 条目；第一版面板只做会话列表、分支树、简版上下文检查器；静态稿在实施时出（[t17](tasks/t17-conversation-ui/README.md)） |
| 2026-10-30 | t18 讨论完成：第一批内置 Profile 为主创、会话标题（标题加一句说明）、adhoc（工具由 Profile 定义，不给派发方指定工具）；第一版不带内置 Skill；提示词规范写进 `docs/standards/prompts.md`；评测优先级降低；Workflow 的临时 Profile 记进 t24（[t18](tasks/t18-builtin-profiles/README.md)） |
| 2026-10-30 | t19 讨论完成，全部按推荐：MCP 插件 `nbook.mcp` 另开 [w00036](../w00036-mcp/README.md)；第一版只有用户级配置、不读项目的 `.mcp.json`；工具缺省不绑 Profile、缺省算执行档；工具名上限改为 64（改 t04）（[t19](tasks/t19-mcp/README.md)） |
| 2026-10-30 | t25 移出：插件分发另开 [w00038](../w00038-plugin-distribution/README.md)（git、npm、官方与第三方市场、离线压缩包）；官方网站与服务（登录、备份、同步、社区、官方市场）另开 [w00037](../w00037-official-site/README.md)（[t25](tasks/t25-plugin-marketplace/README.md)） |
| 2026-10-30 | t13 讨论完成：收件箱三种接受方式（立即、下一条消息时、手动），不做按天数自动接受；每轮改动文件条由 nb-history 提供；保留、合并保存、大文件不存快照。同时改判 t06：默认不放行写入，写入要审批；先做 yolo，再做交审批模型，按工具的规则先于模式判定（[t13](tasks/t13-history/README.md)、[t06](tasks/t06-approval/README.md)） |
| 2026-11-01 | t20 之后先实施 t09（其余顺序是建议，见 [t09](tasks/t09-models/README.md)）；t09 的设置界面先出静态稿、定稿后前后端一起做；第一版不做 OAuth 登录 |
| 2026-11-02 | t10 之后先做 t08，再做 t12；nb-story 迁新内核放最后。t08 把方案注册做进 `nbook.files`，Agent 的方案都注册进文件服务（[t08](tasks/t08-resources-home/README.md)） |
| 2026-11-05 | t18 开工前核对现状后定：adhoc 挪到 t14，t18 只做主创和会话标题；tiny 没绑时用第一句话作兜底标题、不调模型；做一次一次性实验定 `edit` 缺省模式；主创读 `user://AGENTS.md` 与 `project://AGENTS.md`；主创提示词这一版是第一轮，开发者按实际创作继续优化（[t18](tasks/t18-builtin-profiles/README.md)） |
| 2026-11-05 | 开发者：t13、t14 优先级不高，接下来做 t17；t17 第一版以能真的用它写书为标准，其余拆到 [t28](tasks/t28-conversation-ui-followups/README.md)；t17 做完紧接着做 t11（[t17](tasks/t17-conversation-ui/README.md)） |
| 2026-11-05 | t17 完成并合入；`agent/conversation.md` 晋升 `implemented`（[t17](tasks/t17-conversation-ui/README.md)） |
| 2026-11-05 | t11 实现完成并合入：压缩方法三种经贡献点交出、放回、触发点设置、`/compact` 与压缩详情界面；前后端实现审查各一次，成立的都已修；`agent/compaction.md` 待开发者批准晋升（[t11](tasks/t11-compaction/README.md)） |
| 2026-11-06 | `agent/compaction.md` 晋升 `implemented`（[t11](tasks/t11-compaction/README.md)）。开发者体验后定：下一步做 [t28](tasks/t28-conversation-ui-followups/README.md)，之后 t14、t15；与 t28 无关的反馈记到 [t29](tasks/t29-ui-polish-after-t15/README.md)，这三个做完再优化 |
| 2026-11-06 | t06 重定：Agent 模式与审批是两个维度，`discuss`、`plan` 写入直接拒绝；黑白名单做成规则系统，第一条命中生效，作品目录的规则只能收紧；工作记在 t06，排在 t28 前五批之后（[t06 计划](tasks/t06-approval/plan.md)） |
| 2026-11-07 | t06 完成并合入：规则三层与判定流水线、`bash` 方言与只读清单、本会话批准与“以后都允许”、规则设置页、Agent 模式（`normal`、`discuss`、`plan`）与 `switch_mode`、`auto`（审批模型强制调用判定工具，只看用户亲手打的字与工具调用）；前后端实现审查各一次；`agent/permissions.md`、`agent/modes.md`、`ui/agent-conversation-view.md` 晋升 `implemented`（[t06](tasks/t06-approval/README.md)） |
| 2026-11-07 | 核对早期设计 Task：t02、t03、t04、t07 的实现已由后续 Task 完成，关闭，剩余项写明去向；t20 状态改为完成。开发者定后续顺序：t05（Profile 设置页，后端早已做完、没有界面）→ t14 → t15 → t29，t30 放最后；nb-story 迁新内核另建 [t31](tasks/t31-nb-story-new-kernel/README.md)，放最后 |
| 2026-11-09 | t05 完成并合入：Profile 设置页（列表、模型与审批、按提供者分组的工具绑定、用户级 Profile 的新建打开删除、能力缺口提示）；前后端实现审查各一次；`agent/profile-settings.md` 晋升 `implemented`（[t05](tasks/t05-profile/README.md)） |
| 2026-11-09 | t14 只做多 Agent，Workflow 在 t24；先出界面静态稿评审，定了再前后端一起实施、一次合入；shell 的 `async` 也在 t14 做（[t14](tasks/t14-multi-agent/README.md)） |
| 2026-11-10 | t32 完成并合入：落在 `nbook.agent` 里的通用部分补回 nb-harness 的宿主套件 `src/kit/`（文件访问接口 `SessionFiles` 与本机参考实现、内置工具、审批判定与审批模型、压缩方法与放回、运行守卫、会话句柄表与标题生成），NeuroBook 改为经它装配、行为不变；nb-form 的 Vue 一侧改为可选 peer；`harness/host-kit.md` 待晋升；删旧 `src/tools/` 记进 [t31](tasks/t31-nb-story-new-kernel/README.md)（[t32](tasks/t32-harness-backfill/README.md)） |
| 2026-11-10 | t14 合入：子代理工具与任务中心、`shell` 与 `ask` 的 `async`、子树与任务的远程、停靠区与子代理卡片、会话面板的子会话、“可派的子代理”一节；前后端实现审查各一次；合入前并进 t32 的宿主套件（守卫、`shell`、句柄表加可选钩子）。待开发者批准 `subagents.md`、`jobs.md` 等的晋升，并定 planned 条目里没做的几处去留（[t14](tasks/t14-multi-agent/README.md)） |
| 2026-11-10 | 开发者批准 t14 的 Spec 晋升：`agent/subagents.md`、`agent/jobs.md` 改为 `implemented`，其余 Spec 里 t14 的条目去掉 planned；没做的五处由我判断，改 Spec 跟现在的行为走，卡片写注册表的工具名记进 t29；t14 完成。接着做 t15（[t14](tasks/t14-multi-agent/README.md)） |
| 2026-11-10 | t15 开工，实施计划开发者确认：没声明白名单就没有可用的 Skill、主创声明全部；父 Agent 的 `$x` 也算触发；`nbook skill init` 离线可用；插件的 Skill 与 SDK 构建拆到 [t33](tasks/t33-plugin-skills/README.md)；先出一轮界面静态稿（[t15](tasks/t15-skills/README.md)） |
| 2026-11-11 | t15 评审两轮：后台安装的进度与结果由新建的 [t34](tasks/t34-background-tasks/README.md)（工作台的后台任务）承担，t15 的界面几片排在它之后；没带上的 `$` 改为给模型的 system-reminder；t15 切片 1–4 的后端已在分支上（[t15](tasks/t15-skills/README.md)） |
| 2026-11-11 | t34 合入：插件 `nbook.tasks`（服务端清单、按调用方登记、远程接口与推送限频）、状态栏任务条目与悬停、底部面板的“后台任务”与“通知”视图、铃铛、视图计数与 `revealRegion`；前后端实现审查各一次，成立的都已修。待开发者批准 `workbench/background-tasks.md` 晋升与相关条目去掉 planned；t15 变基后接上 Skill 初始化（[t34](tasks/t34-background-tasks/README.md)） |
| 2026-11-12 | 开发者批准 t34 的 Spec 晋升：`workbench/background-tasks.md` 改为 `implemented`，其余 Spec 里 t34 的条目去掉 planned；t34 完成。接着把 t15 变基到 master，做它的界面切片（[t34](tasks/t34-background-tasks/README.md)） |
| 2026-11-13 | t15 合入：Skill 目录与 `skills://`、`$` 带上正文与没带上的提醒、压缩后放回、Bun 依赖的初始化（后台任务、`nbook skill init`、文件锁）、Profile 白名单、`$` 菜单与确认框、设置里的 Skill 页与 Profile 页一节；收口审查后端 12 条、前端 16 条，成立的已修。待开发者批准 `agent/skills.md` 晋升与相关条目去掉 planned，并定 `bun.lock` 过期时怎样处理（[t15](tasks/t15-skills/README.md)） |
| 2026-11-13 | 开发者批准 t15 的 Spec 晋升：`agent/skills.md` 改为 `implemented`，其余 Spec 里 t15 的条目去掉 planned；`bun.lock` 过期记为已知限制；t15 完成。不判旧的文件锁 `tryLock` 搬进 nb-file-lock 并随 nb-story 发布，另在 w00043 开 Task（[t15](tasks/t15-skills/README.md)） |
| 2026-11-15 | 开发者：先做 t30（模型请求的 trace），排在 t29 之前；参考旧应用的 trace，先出界面静态稿；查看器的组件放进 nb-agent-ui（[t30](tasks/t30-model-request-trace/README.md)） |
| 2026-11-15 | t30 合入；开发者批准 `agent/request-trace.md` 晋升为 `implemented`，没做的几项标 planned、统一新建 [t35](tasks/t35-request-trace-followups/README.md)；t30 完成。下一步开 [t33](tasks/t33-plugin-skills/README.md)（[t30](tasks/t30-model-request-trace/README.md)） |
| 2026-11-15 | t33 开工：开发者确认[计划](tasks/t33-plugin-skills/plan.md)（6 个待确认项按推荐），用 autonomous-delivery 推进到 Task 完成（[t33](tasks/t33-plugin-skills/README.md)） |
| 2026-11-16 | t33 合入；开发者批准 t33 的 Spec 条目去掉 planned，t33 完成（[t33](tasks/t33-plugin-skills/README.md)）。开发者定：下一步做 [t29](tasks/t29-ui-polish-after-t15/README.md)；t31、t16、t13 移出本 Work、各开新 Work，本 Work 只剩 t29 与 [t35](tasks/t35-request-trace-followups/README.md) |
| 2026-11-16 | t29 合入；开发者批准 t29 的 Spec 条目去掉 planned，t29 完成。开发者确认 [t36](tasks/t36-conversation-panel-redesign/README.md) 的[计划](tasks/t36-conversation-panel-redesign/plan.md)，6 个待定项按推荐，开工（[t29](tasks/t29-ui-polish-after-t15/README.md)） |
| 2026-11-17 | t36 合入：视图的标题区（对话写在面板头上）、头改三列与子会话返回、第一屏与开场指令、模型不可用的提示卡与设置定位、子代理入口与浮层；前端实现审查 20 条（重要 4），成立的已修。Spec 条目已晋升、回写已写（开发者同日定这两件事不必审批，规范已改），审查带出的两处取舍开发者定保持现状，t36 完成（[t36](tasks/t36-conversation-panel-redesign/README.md)） |
| 2026-11-17 | t37 合入：状态栏可自定义（右键勾选、设置页拖动与上移下移排序、窄时从前往后收进悬停、插件经 `agent.statusItems` 加项）；缓存倒计时本版不做，交给插件项自己写；前端实现审查 13 条（重要 6），成立的已修；Spec 条目已晋升，t37 完成（[t37](tasks/t37-status-line-customization/README.md)）。待开发者定：要不要加“用户脚本”路径 |
| 2026-11-18 | t38 合入：状态栏不再标“计划模式”“全部放行”；状态栏的项可以换边，窄时先右后左收起；nb-layout 新增共用的实时布局排序 `useSortable`、`SortableList`（行跟手、跨组、键盘、放下等写完），状态栏设置页改用它；nb-ui 单选组与复选框对齐第一行。设计审查 16 条、实现审查 14 条，成立的已改；`ui/sortable-list.md` 晋升 implemented，t38 完成（[t38](tasks/t38-status-line-sorting/README.md)） |
| 2026-11-18 | t39 合入：nb-ui 的 `ContextMenu` 打开时才挂上（`v-if`）也夹回视口并聚焦首项，调用方不用再常挂着；用户脚本状态栏项按开发者决定不做（t37 决定 4）。小任务，不写计划、不审查；t39 完成（[t39](tasks/t39-context-menu-measure-on-mount/README.md)） |
| 2026-11-18 | t21 重开并推进：范围、计划（三份设计审查与 omp 对照，3.1 稿）与 Spec（planned）已定；切片 2 内核的嵌套调用通道先合入（不等审批简化提案，开发者定），eval 内核的子进程部分随之合入、还没接进应用（[t21](tasks/t21-eval-codeact/README.md)） |
| 2026-11-18 | t21 切片 3、4 合入：eval 工具接进应用（每会话的内核、重置提示、累计时限、嵌套写入成组，还没进内置 Profile）；插件给 eval 代码登记全局对象（`agent.evalObjects`、`docs://eval/`、eval 的说明按会话列出对象），示例插件 `word-stats`。换 Profile 会重置内核，记进待确认清单（[t21](tasks/t21-eval-codeact/README.md)） |
| 2026-11-18 | t21 完成：界面、内置 Profile 与真实模型切片合入；代码里调 `read` 交回对象（决定 10）；两份实现审查与 Spec 晋升核对都处理完，`eval.md` 晋升为 `implemented`，留 4 句 planned（[t21](tasks/t21-eval-codeact/README.md)） |
| 2026-11-19 | t40：eval 不做内存转储（开发者定）；会话关闭不再结束内核，再打开、叶子与 Profile 没变时接着用，内核照样按空闲与上限回收、服务端停止时结束；重置提示的原因写准（关闭期间的空闲与回收、换了 Profile、两次调用之间被外部结束）；实现审查（omp）4 条重要都改了：换走又换回 Profile、空闲期先退出、项目换目录（新原因“工作目录变了”）、起内核期间被登记表丢掉；t40 完成（[t40](tasks/t40-eval-kernel-survives-session-close/README.md)） |
| 2026-11-19 | t22 重开（开发者：也为 t24 做准备），6 条按推荐：后台任务结束时把结果送回启动它的会话（在跑时作插话，空闲时以宿主身份开运行；上一次是用户停的不唤起）；`shell` 前台过 60 秒自动转后台；不做 Monitor 与 stdin；Agent 的后台任务与后台会话进工作台的“后台任务”清单；任务中心对别的服务端插件开放登记；任务表照旧不存盘（[t22](tasks/t22-background-work/README.md)） |
| 2026-11-19 | t22 方向调整后写提案[统一后台任务](../../../docs/proposals/unified-background-tasks.md)，两轮 omp 设计审查（28、30 条，方向未被质疑、问题在实现细节）后收到方向与规则这一层、开发者接受，写 [ADR 0056](../../../docs/adr/0056-background-work-providers-and-session-notices.md)：`nbook.tasks` 只汇总、状态归提供方；缓冲区收提示（与插话同处取、排在前面）；唤起的门挂在会话上。拆成 [t41](tasks/t41-session-notices-and-wake/README.md)（内核）、[t42](tasks/t42-task-list-providers/README.md)（清单提供方）与 t22（Agent 的送达、自动转后台、eval 提示、工具登记任务）（[t22](tasks/t22-background-work/README.md)） |
| 2026-11-23 | t42 合入：`nbook.tasks` 收别的插件交出的行（提供方合同、远程 v2、按归属分组的视图），Agent 交出后台任务与会话的行，会话索引带回复首句、子代理卡片按它写完成；四片各经实现审查（Opus、omp、Sonnet），三条产品取舍记进待确认清单；修掉会话树读索引的缓存竞态。Spec 逐句核对后晋升有断言的部分，余项与内核停止的收口、验收 2 的原有偶发交 [t44](tasks/t44-task-list-followups/README.md)（[t42](tasks/t42-task-list-providers/README.md)） |

## 待确认

自主推进时照推荐做了、待开发者追认的决定见 [`pending-confirmations.md`](pending-confirmations.md)。

## 调研

- [仓库内的现状](research/2026-10-28-repo-survey.md)：harness 两条线、新应用现状、文档冲突、其它 Work 里相关的未完成事项、旧应用的 Agent 功能面、nb-story 问答的预演。
- [外部参照](../../../docs/research/agent-runtime-references.md)：omp 与 DeepSeek Harness 的机制、模型接口与 OMP 包族的工具发现。
- [各家 code agent 的子代理设计](research/2026-10-30-subagent-survey.md)（t14）：工具形状、结果、续用与插话、审批与提问、运行控制、父子关系。
- [各家的 Skill：字段、参数、依赖、更新与市场](research/2026-10-30-skill-survey.md)（t15）。
- [旧应用的 Agent 资产、评测做法与临时代理](research/2026-10-30-builtin-profiles-survey.md)（t18）。
- [各家的 MCP 客户端](research/2026-10-30-mcp-client-survey.md)（t19）。
- [模型服务：OMP、新应用与旧应用的现状](research/2026-11-01-model-service-survey.md)（t09）。
- [插件市场：Obsidian、VS Code、Claude Code 与其它](research/2026-10-30-plugin-marketplace-survey.md)（t25）。
- [Agent 操作宿主应用与网页界面](research/2026-10-30-host-control-survey.md)（t16）：宿主命令、网页界面的感知与操作、截图与高亮、omp 的浏览器与 eval、CodeAct 的文档形式、页面内可复用的库。
- [需求对照与遗漏](tasks/t01-survey/artifacts/report/index.html)（t01 的 `report` 产物）：开发者列的 20 条需求与清单外 10 项。

## 讨论顺序

| Task | 讨论什么 | 前置 |
|---|---|---|
| [t02](tasks/t02-harness-baseline/README.md) | harness 底座：两条线对照与移植清单 | — |
| [t03](tasks/t03-session-model/README.md) | 会话模型：条目树、回退与分支、存放与单写者 | t02 |
| [t04](tasks/t04-tool-registry/README.md) | 工具登记、命名与工具发现 | t02 |
| [t05](tasks/t05-profile/README.md) | Profile：定义、存放层次、钩子与设置 | t02、t04 |
| [t06](tasks/t06-approval/README.md) | 审批、提问与 Agent 模式 | t03、t04 |
| [t07](tasks/t07-run-control/README.md) | 运行控制：插话、排队与中止 | t03、t06 |
| [t20](tasks/t20-hooks/README.md) | 钩子：钩子点、读写能力、顺序与按 Profile 开关（从 t05 拆出） | t05、t06、t07 |
| [t08](tasks/t08-resources-home/README.md) | 资源地址与 home：会话、Profile、Agent 三层与文档 | t03、t05 |
| [t09](tasks/t09-models/README.md) | 模型服务与模型角色 | t02 |
| [t10](tasks/t10-agent-plugin/README.md) | Agent 插件骨架与贡献点 | t02 到 t09 |
| [t11](tasks/t11-compaction/README.md) | 上下文压缩 | t03、t09 |
| [t12](tasks/t12-builtin-tools/README.md) | 基础工具与外部命令行依赖 | t04、t06、t08、t26 |
| [t26](tasks/t26-write-interface/README.md) | 写入接口：读、暂存与提交、文件操作、操作分组与记账槽（文件访问第 1 阶段，从 t12 拆出） | t08 |
| [t14](tasks/t14-multi-agent/README.md) | 多 Agent（Workflow 在 t24） | t05、t06、t07 |
| [t15](tasks/t15-skills/README.md) | Skill 规范与目录 | t05、t08、t10、t34 |
| [t25](tasks/t25-plugin-marketplace/README.md) | 插件市场：索引、来源、版本与更新、信任；Skill 经插件分发 | t10、t15 |
| [t16](tasks/t16-command-bridge/README.md) | Agent 操控 NeuroBook 与 `nbook project` 子命令 | t06、t10 |
| [t17](tasks/t17-conversation-ui/README.md) | 对话界面：Composer、状态栏、待处理区（并入 w00019 t11） | t06、t07、t09、t10；w00028 t03 合入 |
| [t28](tasks/t28-conversation-ui-followups/README.md) | 对话界面第二批：分支树、上下文检查器、附件、草稿、触发符、Agent 模式 | t17、t06、t15 |
| [t27](tasks/t27-run-reliability/README.md) | 运行可靠性：模型请求重试、卡死超时、循环检测与费用上限（对照 omp 的设置项，排在 t18 之前） | t12 |
| [t18](tasks/t18-builtin-profiles/README.md) | 内置 Profile、提示词规范与评测 | t05、t12、t15 |
| [t19](tasks/t19-mcp/README.md) | MCP 插件 | t04、t08、t10 |
| [t21](tasks/t21-eval-codeact/README.md) | eval 工具（CodeAct），完成：`eval.md` 已晋升 | t04、t12 |
| [t22](tasks/t22-background-work/README.md) | Agent 的结果送达、`shell` 自动转后台、eval 的提示、工具登记任务（统一后台任务提案的第三块），完成：合入 master，Spec 按逐句核对晋升 | t41 |
| [t41](tasks/t41-session-notices-and-wake/README.md) | 内核缓冲区的提示与会话级唤起门，完成：合入 master，Spec 按逐句核对晋升 | — |
| [t42](tasks/t42-task-list-providers/README.md) | 后台任务清单的提供方与分组视图，完成：合入 master，Spec 按逐句核对晋升了有断言的部分，其余交 t44 | t22 |
| [t44](tasks/t44-task-list-followups/README.md) | 后台任务清单的余项：补断言晋升、内核停止的收口、验收 2 的偶发 | t42 |
| [t45](tasks/t45-openrouter-app-attribution/README.md) | 给 OpenRouter 的请求带应用归属请求头，未开工 | 官方站的域名与隐私说明（w00037、w00053） |
| [t46](tasks/t46-profile-extensions-by-id/README.md) | Profile 声明按 id 引用扩展，模式控件跟着模式扩展走，修插件 Profile 切换模式报 unknown-extension；完成：合入 master | — |
| [t23](tasks/t23-session-history/README.md) | Agent 查询会话历史：分页、搜索、视角，搁置 | t14 |
| [t24](tasks/t24-workflow-integration/README.md) | Workflow 与 Agent 的对接，搁置 | t14 |
| [t13](tasks/t13-history/README.md) | nb-history 接入与文件变更感知（优先级不高，排到末尾） | t08、t12 |

讨论顺序就是依赖顺序；讨论定的事写进各 Task 的 README，实施的切片与分支在讨论完后另定。

实施时 t20 排在最前（开发者 2026-10-29 定）：它定了 harness 内核（日志与写入批、输入缓冲区与指令、对话形状与提交、扩展接口、拦截链），t03、t05、t06、t07、t09、t10、t11 的实现都建在它上面。t20 的实现要再做一次审查。

## 相关 Work

- [w00002](../w00002-neuro-agent-harness-redesign/README.md)：nb-harness 的来历；内核分支的记录只在分支上（主工作区那份 README 停在 2026-09-22）。
- [w00019 t11](../w00019-agent-conversation-view/tasks/t11-complete-view/README.md)：对话视图完整版，并入 t17。
- [w00025 t12](../w00025-editor/tasks/t12-inline-ai-editor-api/README.md)：行内 AI 编辑器接口，在本 Work 要在编辑器里改正文时开工。
- [w00028 t03](../w00028-i18n/tasks/t03-shared-packages-migration/README.md)：共享包的文字迁移，合入后再写 Agent 插件的界面。
- [w00031 t03](../w00031-language-policy/tasks/t03-failure-projection/README.md)：错误码与参数，工具错误的形状按它来。
- [w00024](../w00024-nb-story/README.md)：nb-story 问答是 nb-harness 现在唯一的使用方。

## 后续（本 Work 不做）

- 提示词缓存的保留时长与预热（omp 的 `providers.cacheRetention`、`cacheWarming`）、旧会话与大块内容的清理（`gc.*`）：t27 之后再定（t12，2026-11-04）。
- nb-story 的 400 请求全文落盘：它经 `createHarness` 自己调 `streamSimple`，不经过内核的适配器，所以 t27 的删除管不到它，进程照写 `~/.omp/logs/http-400-requests/`（t27，2026-11-04）。
- 网页工具插件（`web_fetch`、`web_search`）与网页搜索：另开 Work（t12，2026-10-28），2026-11-19 建为 [w00052](../w00052-web-tools/README.md)。
- MCP 插件：另开 [w00036](../w00036-mcp/README.md)（t19，2026-10-30）。
- 插件分发与官方网站：另开 [w00038](../w00038-plugin-distribution/README.md)、[w00037](../w00037-official-site/README.md)（t25，2026-10-30）。
- 外部命令行的检测、下载与“外部工具”设置页：发布时做，策略记在 [t12](tasks/t12-builtin-tools/README.md)（2026-10-28）。
- shell 的安全加固（密钥正则、路径条件、环境变量白名单）：以后专门做安全时考虑（t12，2026-10-28）。
- nb-story 迁新内核：另开 [w00047](../w00047-nb-story-new-kernel/README.md)（t31，2026-11-16）。
- nb-history 接入：另开 [w00048](../w00048-history-integration/README.md)（t13，2026-11-16）。
- Agent 与命令系统的对接（搁置）：另开 [w00049](../w00049-agent-command-bridge/README.md)（t16，2026-11-16）。
- `read` 加一个参数让模型自己选要不要带地址头与行号：只读长篇正文、不打算按行改时省 token（开发者在 t21 提出，代码里调的已经交回原文对象，2026-11-18）。
- 编辑组顶上的提示条（`EditorGroup` 里的 nb-ui `Banner`）重新设计：开发者认为现在的写法没做好，以后改；对话面板的模型提示用浮层提示卡，不跟它（[t29](tasks/t29-ui-polish-after-t15/README.md) 决定 10，2026-11-16）。
- eval 跨 Profile 保留变量：先不做，换 Profile 照旧重置内核；要做时去掉 `SessionKernel` 里比 Profile 的那一个判断（[t40](tasks/t40-eval-kernel-survives-session-close/README.md) 决定 4，2026-11-19）。
- eval 重置原因被挤掉时的提示：先不做；一句话的改法是把服务重启、分叉与原因被挤掉共用的兜底提示改成“服务重启、分叉或原因没记下”（[t40](tasks/t40-eval-kernel-survives-session-close/README.md) 决定 5，2026-11-19）。
- eval 内核在父进程死掉之后不退出：内核是单独的进程组，单元卡在死循环里时事件循环转不出来，察觉不到父进程（测试或服务端）已经退出，会一直空转。2026-11-19 发现 t21 测试留下的一个内核孤儿空转了 27 小时、占约 80% CPU（开发者手动结束）。改法候选：内核里另起一个 Worker 线程看父进程，或由服务端启动时清理上次留下的内核；要做时另建 Task（t41 期间记下）。
