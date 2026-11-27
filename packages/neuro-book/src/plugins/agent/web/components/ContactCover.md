---
标签: [state:inject]
别名: ["联系人盖层", "Contact Cover"]
---

# ContactCover

盖在聊天区上的一层（[`agent/conversation.md`](../../../../../../../docs/specs/agent/conversation.md) 输出 53，[`bots/view.md`](../../../../../../../docs/specs/bots/view.md) 输出 3）：点联系人到聊天出现之间（没有模型、正在打开、打不开），消息视图里还没选 bot，或书房面板里找不到 bot。消息视图（`MessagesHost`）与书房的看板娘面板（`DeskCompanion`）共用。

## 布局

- 铺满聊天区（绝对定位，`inset: 0`），面板底色，内容在中间竖排：
  - 没有模型：插头图标、标题“先添加一个模型服务商”、一句说明、主按钮“去添加”；
  - 正在打开：转圈与“正在打开对话…”；
  - 打不开：“打不开和 {名字} 的对话（{码}）。”与“重试”；
  - 还没选 bot：“选一个 bot 开始聊天”与“全部 bot”（`data-messages-pick-bot-open`，发 `show-bots`，宿主展开视图段的 bot 页）；
  - 找不到 bot：“找不到这个 bot。”。
- 宿主负责让下面的聊天区不可用（`inert`）：盖层里的按钮是这时唯一能聚焦的。

## 数据

```ts
type ContactCoverState =
    | {kind: "pick-bot"}
    | {kind: "missing"}
    | {kind: "pending"; pending: PendingContact}; // contact-opener.ts

type ContactCoverProps = {
    cover: ContactCoverState;
    /** 右上角画“关闭”（`data-messages-cover-close`），点了发 `close`：书房的面板里盖层盖住了对话的头。 */
    closable?: boolean;
};

type ContactCoverEmits = {
    /** 点“去添加”。 */
    "add-provider": [];
    /** 点“重试”，带联系人的键。 */
    retry: [key: string];
    close: [];
    /** 还没选 bot 时点“全部 bot”。 */
    "show-bots": [];
};
```

## 隐藏通道理由

`state:inject`：文字经 `useAgentPageText()` 取 agent 插件的翻译。
