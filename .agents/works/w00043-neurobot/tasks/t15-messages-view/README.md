---
schema: nbook.task/v2
taskId: t15-messages-view
status: active
updated: 2026-11-20
---

# “消息”视图：bot 与会话两个标签、固定会话的对话宿主、未读与书房入口

## 目标与范围

[bot 提案](../../../../../docs/proposals/neurobot.md)第四节第 11 小节的界面部分，外观照 [t03](../t03-web-design/README.md) 的决定与评审板：
- “消息”视图：bot 与会话两个标签（t03 决定 6、12–14），bot 一侧是 IM 式的联系人列表（决定 13），会话一侧照现有会话面板；取代会话面板（`nbook.agent.sessions`）与 Agent 对话视图（`nbook.agent.conversation`），两者共用对话组件；
- `nbook.agent` 浏览器一侧对外的固定会话对话宿主服务（提案第 11 小节的取值表）；有归属的会话从活动条等处打开时转到 bot 的聊天；
- 未读与最后看到的位置（`nbook.bots` 存），bot 标签与书房入口上的未读；书房案头的看板娘入口与从右边滑出的聊天（决定 22、23）；
- 原 [t07](../t07-agent-ui-for-bot/README.md) 的 nb-agent-ui 部分：宿主消息的来源标签、过期的说法与占位、停靠位置的视图选项、按天与未读分隔线、会话、bot、会话加 bot 三种用法档与缺省回归、固定会话档的文案变体；
- 主对话长会话的指标在界面上的那一半（首屏渲染耗时）。

不做：多开对话窗口（t03 决定 7，搁置）；日程抽屉与表单归 t10。

合同：改 [`ui/agent-conversation-view.md`](../../../../../docs/specs/ui/agent-conversation-view.md)、[`agent/conversation.md`](../../../../../docs/specs/agent/conversation.md)、[`workbench/bookshelf.md`](../../../../../docs/specs/workbench/bookshelf.md)；新建的 `docs/specs/bots/main-conversation.md` 里未读与最后看到的位置一节（t06 建这份 Spec）。

依赖：[t06](../t06-main-conversation/README.md)（主对话、`ensureMain`、`owner`、过期的码）、t03。

来源：2026-11-19 开发者把 t06 拆成两个（选“拆成两个”）：t06 做后端主对话与等用户，界面另成这个 Task 并入 t07。

待定（t06 设计审查第二轮第 6 条）：主对话的只读解除（Profile 换回、同哈希恢复）现在没有推送，t06 只提供重取快照；界面要不要实时知道、由内核推状态还是界面重取，开工时定。

## 当前状态

2026-11-19 经 nbdev 新建；同日 t06 合入后开工。开工调研（只读，三位 Haiku 子代理）见 [evidences/survey.md](evidences/survey.md)。

决定：

1. 切法（开发者 2026-11-19，选“先能聊、再合并”）：分阶段各自合入。① `nbook.bots` 的浏览器入口、固定会话的对话宿主、一个单独的 bot 视图（IM 列表加聊天）与未读数，有归属的会话从活动条等处打开时转到它，做完就能聊；② 把它和会话面板合成两个标签的“消息”视图，取代会话面板与对话视图；③ 书房的看板娘入口与滑出聊天；④ 按天与未读分隔线等打磨与首屏指标。① 到 ② 之间 bot 与会话是两个视图，与 t03 定的最终样子不同。
2. 过期的说法与占位不做：t06 决定 4 不设等用户的期限。
3. 阶段 ① 的 bot 视图（开发者 2026-11-19 答“可以”，两处都按推荐）：只有一个 bot，视图里直接是聊天、不画联系人列表（列表在阶段 ②）；放左侧栏，有自己的活动栏图标。
4. 活动栏的入口也显示未读数（开发者 2026-11-20 答“都同意”）：改 `workbench/views.md` 输出 17，视图的 `badge()` 除了写在面板头的标题后，也画在它的活动栏图标上；随阶段 ② 做。同一句答复同意 t06 的 Spec 晋升 implemented。
5. 阶段 ② 的方向（开发者 2026-11-20）：bot 聊天与会话聊天共用一个聊天区，档位按打开的会话有没有归属定（开发者问“为什么不共用一个聊天组件”，答“可以，继续”）；计划 [plan-2.md](plan-2.md) 的三处待确认都按推荐（答“可以”）：消息视图在右栏、左侧栏不再有会话面板与 bot 入口；宽窄分界 600 像素；会话标签的滚到底分页这次不做。
6. 阶段 ② 设计审查后的两题（开发者 2026-11-20，都按推荐）：bot 行的第二行先写通用状态（在跑“正在回复…”、等你“等你处理”，平时最后一句话），具体活动文字等后端有摘要再补；宽版时对话的头画在聊天区上方（同 t03 r5），只有窄版接管面板头。入口角标的范围从决定 4 的活动栏延到右栏入口条（消息视图在右栏）。
7. 右栏收起时的未读（开发者 2026-11-20，第二轮设计审查后问，按推荐）：状态栏的 Agent 活动条目在有未读时也写“N 条新消息”，点了打开消息视图里那个 bot。
8. 阶段 ③ 的计划 [plan-3.md](plan-3.md)（草稿 3，设计审查两轮）的四处待确认都按推荐（开发者 2026-11-20 答“可以”）：等你处理时气泡写“等你处理”；看板娘只在等你处理时换成提问的表情；滑出聊天宽 420px、点外面不关，关闭靠头上的“关闭”与 Esc，Tab 在面板里循环；案头窄于 720px 时只留角标、不画气泡。滑出面板做成 nb-ui 新组件 `SidePanel`（nb-ui `Drawer` 的滑动关闭关不掉）。

阶段 ① 已完成并合入 master（`0fcdedc83`）：

- 切片：`7c722c34c`（nb-agent-ui 的头像与停靠档）、`f2fcffa3f`（agent 浏览器入口的固定会话宿主与转交）、`957280a0f`（主对话的未读、看到与头像路由）、`56cd96691`（bot 视图与归属路由、e2e 验收 1、2）、`07928d3b9`（e2e 未读计数：失焦时记未读、拿回焦点清零，变异检查过）。
- 实现审查：前端 Sonnet 9 条、后端 omp 3 条，全部成立，处理见 [evidences/impl-review-disposition.md](evidences/impl-review-disposition.md)；修正 `bcecfc7dc`、`ac9d48971`、`7f919f147`、`2aa01c20b`，Spec 改动 master `3b5530516`（`bots/view.md`、`agent/conversation.md` 输出 31、53）。
- 验证：nb-agent-ui 192 条；neuro-book 的 bots 与 agent 576 条、bot 视图 dom 5 条；合并 master 后 e2e `bots-chat`、`agent-subagents`、`agent-conversation` 31 条全过。合并后的全量 bun 测试有 3 条确定失败（依赖方向、SDK 导出面、活动栏重复 id），分支没有改动这几处，失败的写法在 master 上也存在。
- 后续：`agent-conversation.e2e.ts:687`（附件）在 master 上也时常失败；产品那一半（新建期间加附件另建会话）已修，测试那一半（`newSession` 在会话加载完之前返回）没修。

阶段 ③ 实现完成，实现审查 Sonnet 10 条已处理（[处理](evidences/impl-review-3-disposition.md)）（2026-11-20）：

- 切片：`b68ff259e`（nb-ui `SidePanel`、层级 `sidePanel` 一档）、`e332034ff`（拆出 `contact-opener`、`ContactCover`、窗口焦点；借用重开不算打开）、`9d8dd8ef1`（书架案头的贡献位 `projects.desk`）、`f2d590198`（对话视图的 `closable`、`escape`，`ConversationHost` 的 `close` 与 `noSessionList`）、`73713c190`（输入框第一次打开时聚焦落空的修复）、`041eacb69`（看板娘入口与滑出聊天、e2e 书房三组）、`525a51ae9`（气泡定位）。
- 实施中查出、计划外修的：对话输入框第一次打开时聚焦落空，三层原因（markdown 插件的包装在 PromptEditor 代码加载完之前交出的方法是 undefined、PromptEditor 在挂载钩子里才建编辑器且正文还要过一两拍才挂进文档、输入框只读时聚焦不生效），各在拥有它的组件里修并补测试；消息视图第一次打开时同样会碰上，以前没有测到。
- 验证：e2e `bots-chat`、`bookshelf`、`agent-conversation`、`lab-agent-ui` 87 条全过；单元测试 nb-ui、nb-agent-ui（205）、nb-markdown 提示词（86）、应用 agent、markdown、projects、lab（vitest 357、bun 161）；类型检查四个包；新增否定断言都做了变异检查。（“联系人消失时关面板”那段我曾记为变异活下来，实现审查重做后测试会失败，是我那次变异没改到位。）
- Spec：master `9ecf84781`（planned）：`agent/conversation.md` 输出 54 与验收 10、`workbench/bookshelf.md` 输出 22、`bots/view.md` 验收 4、`ui/agent-conversation-view.md` 的 `closable` 与 `escape`。

## 下一步

- 阶段 ③：书房案头的看板娘入口与从右边滑出的聊天（t03 决定 22、23），复用宿主加对话视图的组合。计划 [plan-3.md](plan-3.md)，开发者 2026-11-20 确认（决定 8）；实现完成，见上。
- 阶段 ④：按天与未读的分隔线、首屏指标。
- 后续（不阻塞）：会话标签的滚到底分页；第二行的具体活动文字（等后端的活动摘要）；`agent-conversation` 附件那条的测试时序（`newSession` 在会话加载完之前返回）。
