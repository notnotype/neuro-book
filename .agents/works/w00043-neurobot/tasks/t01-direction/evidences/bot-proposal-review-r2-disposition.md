# 《NeuroBook 的 bot》第六稿的审查处理（第二轮，2026-11-18）

审查对象：第六稿 `docs/proposals/neurobot.md`，提交 `4d996850e` 时的固定副本。第六稿按开发者对第五稿十项待定的答复修改后，派一位 Claude Opus 做轻量的第二轮（前后端都看）：[报告](bot-proposal-review-r2-backend-opus.txt)，14 条：阻断 1、重要 6、建议 7。

主 Agent 的核实：在主工作区用真实内核重跑了第 1 条的复现（[stranded-r2](bot-proposal-review-r2-stranded.test.ts.txt)，`packages/nb-harness` 下 `bun test`，2 条通过：以收尾工具 `finished` 收口后缓冲区留着 `followup`；只压缩的运行之后留着 `steer`；会话都回到 `idle`）。读了 w00032 t07 的决定 1、3（开发者 2026-10-28：排队在 `completed` 后按序取，出错或中止时不处理；中止默认清空；重启后队列不自动发出、等用户确认），`runtime.md` 输出 40（提问的结局是 `QuestionAnswer`）、`runtime/services.md` 输出 11、12（按调用方门面、身份由内核填）、`workspace/resources.md` 的跨项目访问（`projects://` 为没在运行的项目取租约）。

第 1 条是“收口后缓冲区没人取”这一类第二次换路径出现（第一轮 B1 是 `error` 与只压缩的 `followup`）。按审查 Skill 的“同一类问题每轮都找出新路径时问题在结构上”，第七稿不再逐条补，改成一张“收口方式 × 谁排的”表，一处定全：正常结束（含 `finished`、只压缩）内核一律接着取；`error`、中止、重启照 t07 决定处理用户的话，宿主的话由注入方按持久记录用带条件的 `start` 取。

| 条 | 归类 | 处理 |
|---|---|---|
| 1 `finished`、只压缩时的 `steer`、普通会话的 `interrupted`、用户的话遇 `error` 都会留在缓冲区 | 成立（已复现前两种） | 第 6 小节改成按收口方式的总表；`finished` 与只压缩的运行归进“正常结束”，内核接着取（`followup` 取第一条、`steer` 全取），对所有会话生效，与 t07 决定 1“completed 后按序取”的意思一致；用户的话遇 `error`、重启照 t07 决定 1、3 留着等用户；宿主的话由 `nbook.schedule` 持久记录“已发未取”，`error` 收口与服务端启动时取 |
| 2 `start` 不记发出者；先查再 `start` 有竞态，会退化成“继续” | 成立 | 内核 `start` 加 `take`（指定 `inputId`，或 `"none"` 只接着跑），条件不满足时失败、不退化；`runStarted` 记发出者，“已自动继续”由它推出；`nbook.bots` 的自动接续用 `take: "none"` |
| 3 期限与 `expired-run` 只对审批成立；用户回来后不解除；期限放在哪组设置 | 成立 | 提问到期交回 `unavailable{expired}`，`expired-run` 同样作用于后面的同步提问；`InteractionDecision` 加 `expired`；用户本人的话进入运行即解除；期限放进核心设置组，子会话继承 |
| 4 普通会话没有期限、宿主消息会越积越多 | 成立 | 宿主消息开的一轮，期限取会话设置，没有时取消息自带的（日程缺省 30 分钟）；同一条目上一次的消息还排着或那一轮没收口时跳过，记“目标忙，已跳过” |
| 5 固定会话档没盖住隐式建会话、换会话与发送语义 | 成立 | 选项表加“没有会话时”“换会话的动作”“发送”“停止”四行；有归属的会话在 `nbook.agent` 的一处（宿主的打开与 `nbook.agent.focus-session`）转给 owner 插件 |
| 6 Agent 能给别的会话排周期提示词；`source.plugin` 调用方自报 | 成立 | Agent 的日程工具只能排自己所在的会话，给别的会话排只经界面与插件服务；`agentKey` 改成按调用方门面提供，`source.plugin` 由 `nbook.agent` 盖章；写明插件服务不是权限关 |
| 7 `edit`、`remove` 不看发出者 | 成立 | `harness/runtime.md` 加“指令按发出者的权限”表：`edit` 只允许原发出者，`remove` 允许用户与原发出者，`resolve` 不收宿主；`inputEdited` 记编辑者 |
| 8 “自动判断”下周期任务没有授权依据，招牌用例跑不通 | 成立，交开发者 | 开发者选推荐：用户亲手写下或确认过的条目算授权依据（第 6 小节的四类材料与“用户确认”） |
| 9 `owner` 也是调用方自报 | 成立 | `owner.plugin` 按调用方门面盖章，调用方只给 `owner.id`；`bots://` 的写授权以 bot 记录里的主对话 id 为准 |
| 10 `send` 结算写成内核规则，会改普通会话的合同 | 成立 | 改成显式选项 `settlePending: "deny"`，缺省不结算；结算范围含嵌套调用里的同步事项、不含异步提问；bot 视图的发送传它 |
| 11 目标的状态与幂等键细节 | 成立 | 快照加解析好的目标会话 id，`commandId` 含目标会话 id；第 6 小节加目标状态表（归档、删除、换 Profile、只读、属于没打开的书、带 `result` 或 `caller` 的子会话）；“没打开的书”按 `projects://` 的租约定为照常注入，不再留给 t10 |
| 12 悬空的半句、`expired-run` 归属两处、无费用约束、守卫停着时白发 | 成立 | 删掉“省钱压缩计时的起点”；`expired-run` 统一归内核；已知限制补“不设 `maxCost` 时无人值守的花费没有约束”，周期条目加最小间隔；守卫停着时日程不发、标“等你处理” |
| 13 来源行的计划时刻没有出处；`label` 能伪造格式 | 成立 | `source` 加 `at`；`label` 单行、限长、去掉控制字符与分隔符；格式写死在 `runtime.md` |
| 14 点停止会一并取消周期任务 | 成立，交开发者 | 开发者定缓冲区不空时停止给两个选项（清空，或留着）；留着之后马上跑还是等恢复，主 Agent 推荐等恢复，写成第七节待定项 1 |
