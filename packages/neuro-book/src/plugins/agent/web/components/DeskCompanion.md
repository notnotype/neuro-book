---
标签: [state:inject, env:portal]
别名: ["看板娘入口", "Desk Companion"]
---

# DeskCompanion

书房案头的看板娘入口与从右边滑出的聊天（[`agent/conversation.md`](../../../../../../../docs/specs/agent/conversation.md) 输出 54，[`bots/view.md`](../../../../../../../docs/specs/bots/view.md)）。由 `nbook.agent` 贡献到书架的 `projects.desk`，叠在案头看板娘那一格上：猫由书架（`ShelfDesk`）画，这里画盖在猫上的按钮、角标、气泡与面板，经 `update:mood` 改猫的表情。

## 布局

- 根元素铺满那一格，圆角取 `inherit`（约束见 `ShelfDesk.md`）。
- **按钮**：透明、盖满猫，焦点环画在它上面。读屏名同消息视图的头像列：“星璃”“星璃，3 条未读”“星璃，等你处理”。
- **角标**：右上角，与入口角标同一种（`Badge`，计数超过 99 写 99+）；有等你处理的事时换成警示色的“!”。没有未读时不画。
- **气泡**：格子正下方、右对齐、可以向左伸出格子，尖角对准猫的中线；单行截断，最宽 260px；不可点、不推动案头的布局。等你处理时写警示色“等你处理”；否则有未读时写最后一句话；都没有时不画。最后一句话不进读屏名。案头窄于 720px（容器查询，同 `ShelfDesk`）时不画气泡，只留角标。
- **面板**：`SidePanel`（420px，贴右边，不压暗），读屏名是联系人名字；里面是 `desk` 位置的对话（头画在内容里，右列最后是“关闭”，没有会话列表）。面板里没有会话、或点联系人到聊天出现之间，盖 `ContactCover`，下面的对话 `inert`。

## 交互

- 代表谁：按提供者表的次序，第一个有联系人的归属插件的第一个联系人。没有联系人时没有按钮（不能点的猫）；联系人读不到时根上的提示写原因。
- 点按钮打开面板：借用宿主、读模型与 Profile（`ensureStarted`）、打开这个联系人的主对话（`contact-opener.ts`）。面板开着时看板娘多半被面板盖住，关闭靠头上的“关闭”、Esc（焦点在面板里或看板娘上时；输入框里按 Esc 也关）；宽窗口里看板娘露在外面时再点也关。
- 关闭：作废在途的联系人，交还借用，焦点回到看板娘（`SidePanel` 的规则）。
- 打开后第一次“没有盖层、输入框已挂上”时，焦点还在面板里、看板娘或页面上就放进输入框。
- 看到：面板开着、窗口有焦点、没有盖层时把已应用的 seq 交给归属插件。
- 联系人消失（归属插件停了）时关面板。
- 心情：等你处理时发 `update:mood("ask")`，否则 `"idle"`。在跑不换表情。

## 数据

```ts
type DeskCompanionProps = {
    providers: readonly {plugin: string; provider: SessionOwnerProvider}[];
    activity: readonly ActivityItem[];
    /** 有没有可用的模型：没有为 false，还没读到为 null。 */
    hasModel: boolean | null;
    /** `desk` 位置的宿主（`SessionHost` 的子集加 `borrow`）。 */
    host: ContactHostPart & {borrow(): () => void};
    /** 面板里的对话：收 `close`，暴露 `focusComposer()`；第一次打开时才加载。 */
    conversation: Component;
    openModelSettings: () => void;
    ensureStarted: () => void;
};

type DeskCompanionEmits = {
    "update:mood": [mood: "ask" | "idle"];
};
```

## 隐藏通道理由

`state:inject`：文字经 `useAgentPageText()` 取 agent 插件的翻译。`env:portal`：面板经 `SidePanel` 传送到页面根上。
