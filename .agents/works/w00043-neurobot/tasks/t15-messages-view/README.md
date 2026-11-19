---
schema: nbook.task/v2
taskId: t15-messages-view
status: planned
updated: 2026-11-19
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

## 当前状态

2026-11-19 经 nbdev 新建，尚未开工。

## 下一步

等 t06；开工时先写 Spec 草稿，再写计划，前端审查。
