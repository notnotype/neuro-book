---
标签: []
别名: ["提示卡", "Notice Card"]
---

# AgentNoticeCard

模型用不了（`availability` 为 `profile-unavailable`）时压在输入框上方的提示卡（[`ui/agent-conversation-view.md`](../../../../../docs/specs/ui/agent-conversation-view.md) 的“输入框与待处理区”）。只写一行“此 Profile 需要的模型角色未绑定模型”时，用户不知道是哪个角色、去哪里改；卡写明卡在哪里，第一个按钮直达对应的设置。

它是 `AgentConversationComposer` 的零件，不单独导出。别的状态（归档、打开失败、模型能力提示）仍是一行字，不用它。

## 布局

浮层的面（`nb-ui-popover-surface`：面色、描边、圆角、投影由主题定），占原来那行字的位置：停靠区与排队消息之下、输入框外框之上，和输入框同宽，不叠在消息上。左边一个警告色图标，右边自上而下：标题（加粗）、说明（淡色、小一号）、按钮行。文字放不下时换行，不截断。

## 交互

- 点按钮发 `act`，带动作 id；视图转成 `availability.act`。第一个按钮是主按钮，其余是次要的。
- 出现时不抢焦点；根元素是 `role="status"`，读屏随内容播报。

## 数据

```ts
type AgentNoticeCardProps = {
    /** 视图的 `ctx.availability`：`icon` 没给时是提示图标；`title` 没给时只画说明；`message` 为空时不画说明。 */
    notice: AvailabilityView;
};

type AgentNoticeCardEmits = {
    (e: "act", action: string): void;
};
```

没有插槽、没有 expose；attrs 落在根元素上。根元素带 `data-composer-availability`，按钮带 `data-availability-action`，与一行的写法相同，宿主的测试不必分两种找。

## 不支持

不判断该出哪张卡：标题、说明、图标与按钮都由宿主按解析失败的结果算好放进 `availability`。不关闭、不收起：原因没解决时它一直在。
