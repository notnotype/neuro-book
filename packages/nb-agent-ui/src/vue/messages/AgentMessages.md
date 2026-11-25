---
标签: [state:local, state:inject]
别名: ["消息视图", "Messages"]
---

# AgentMessages

“消息”视图的外框（docs/specs/agent/conversation.md 输出 1–3，t03 决定 8、12）：把列表（`AgentMessagesList`）、窄版的头像列与聊天区排在一起，按宿主给的 `layout` 换版式。聊天区、列表、头像列各只有一份 DOM，换版式只改它们的位置与显隐，所以聊天区在宽窄之间不重挂、滚动与输入框的焦点都在。

## 布局与交互

- **宽版**（`layout: "wide"`）：左边的列表栏（缺省 260 像素），右边聊天区。列表的切换行右端有收起按钮；收起后左边换成头像列，头像列顶上的按钮展开列表栏。收起后焦点到头像列的展开按钮，展开后到列表栏的收起按钮（被点的按钮跟着不见）。
- **拖宽度**（宽版）：列表栏与聊天区之间的线是 nb-layout 的分隔线（`role="separator"`，名称由“消息列表”“聊天区”拼成；指针、键盘与悬停的样子见 [`Splitter`](../../../../nb-layout/src/vue/Splitter.md)）。列表栏宽 200 到 420 像素，聊天区至少留 320 像素（视图窄时列表栏的上限跟着降）。拖到 200 像素以内再过 40 像素收成头像列，收着时往外拖过 40 像素展开；焦点在线上时 `Enter` 收起、展开。松手（或键盘调完）时发 `update:listWidth`（展开着时，取整的像素）与 `update:listCollapsed`（变了才发）；拖动中头像列与列表按当时的收起状态换。给的 `listWidth` 超出范围时按范围显示，不改它；交回的是松手时显示的宽度，所以视图窄、宽度被聊天区的下限压着时拖一下，宿主记着的宽度就换成压过的值。面板比 200 像素窄的时候（往收起的门槛拖、收起与展开的宽度过渡中）列表不跟着挤窄，被面板裁掉右边；头像列与列表在收起状态变的那一刻直接换，不随宽度过渡。窄版时这条线不可拖、不进 Tab 顺序。
- **窄版**（`layout: "narrow"`）：左边 52 像素的头像列，右边聊天区。头像列从上到下：开列表的按钮、各个联系人的头像、分隔、最近会话的图标（宿主给几个画几个，消息视图给 5 个）。
  - 联系人头像：有未读时右上角一个点，有等你处理的事时点是黄色（`data-strip-waiting`）；选中的有底色；按钮的名称是“名字”加未读数。
  - 会话图标：悬停写标题；名称是标题。
  - 点联系人发 `open-contact`，点会话发 `open-session`。
- **抽屉**（窄版里开列表）：从头像列右边拉出，宽 `min(300px, 85%)`，压在聊天区上，非模态（`role="dialog"`，名称“消息列表”）。
  - 打开：头像列顶上的按钮，或宿主改 `drawerOpen`（面板头的标题）。打开时焦点到列表里第一个输入框。
  - 关闭：在视图里点抽屉外（头像列、聊天区）、`Esc`（焦点在抽屉里或在开它的按钮上时，里面的控件已经处理了的不管）、选了一项（点了联系人；会话一页由宿主经 expose 的 `closeDrawer()` 关）。`Esc` 与选了一项关闭后焦点回到开它的按钮（宿主给的 `drawerAnchor` 或头像列的按钮）。视图之外的点击不关：工作台面板头的标题由宿主切换，传送到页面上的浮层（行菜单、改名小窗）不算抽屉外。
  - 内容常驻，收起只是不显示：开着改名小窗时抽屉不关，收起也不丢小窗。
- **换版式**：窄变宽时开着的抽屉收起（发 `update:drawerOpen`），列表留在原处变成列表栏，里面的焦点不动；宽变窄时列表收起，焦点原来在列表里的放到头像列的按钮上，否则不动焦点。
- **自绘窗口头**（`windowDrag`，宿主把视图浮成窗、视图的第一行就是窗口头时）：列表的切换行与头像列顶上那一行写 `data-window-drag`，空白处按住拖的是宿主的窗口；头像列顶上那一行高 `--acv-head-height`（缺省 40 像素，与切换行一样）、顶到上边，与对话头同高；窄版的抽屉从这个高度下面拉出，不压住对话头与宿主盖在右上角的按钮。
- 最小尺寸：宽版不小于 600 像素（宿主按这个分界给 `layout`），窄版聊天区占头像列之外的全部。

## 数据

```ts
type AgentMessagesProps = {
    layout: "wide" | "narrow";
    /** 宽版的列表栏收起了没有（受控，`v-model:listCollapsed`）。 */
    listCollapsed: boolean;
    /** 宽版列表栏的宽度，CSS px（受控，`v-model:listWidth`）；默认 260。 */
    listWidth?: number;
    /** 窄版的抽屉开着没有（受控，`v-model:drawerOpen`）。 */
    drawerOpen: boolean;
    /** 列表当前页（受控，`v-model:tab`），交给 `AgentMessagesList`。 */
    tab: "bot" | "sessions";
    sections: readonly MessagesContactSection[];
    /** 选中的联系人 `key` 或会话 id。 */
    selected: {kind: "contact"; key: string} | {kind: "session"; id: string} | null;
    /** 头像列里的最近会话，给几个画几个。 */
    recentSessions: readonly MessagesRecentSession[];
    /** 宿主那边开抽屉的按钮（工作台面板头的标题）：关抽屉后焦点回到它。没有为 null。 */
    drawerAnchor?: HTMLElement | null;
    now: number;
    locale?: AgentLocale;
    /** 宿主自绘窗口头：切换行与头像列顶上那一行是窗口的拖动区。默认 false。 */
    windowDrag?: boolean;
};

type AgentMessagesEmits = {
    (e: "update:listCollapsed", collapsed: boolean): void;
    (e: "update:listWidth", width: number): void;
    (e: "update:drawerOpen", open: boolean): void;
    (e: "update:tab", tab: "bot" | "sessions"): void;
    (e: "open-contact", key: string): void;
    (e: "retry-contacts", sectionKey: string): void;
    (e: "open-session", id: string): void;
};

type AgentMessagesSlots = {
    /** 聊天区。 */
    default(): unknown;
    /** 会话一页（交给 `AgentMessagesList`）。 */
    sessions(): unknown;
};
```

expose `closeDrawer()`：关抽屉、焦点回到开它的按钮（宿主在会话一页选了会话之后调）。attrs 透传到根元素。根上写 `data-messages-layout`（`wide`、`narrow`）。

## 状态

列表的各种状态见 `AgentMessagesList`。没有联系人时头像列只有开列表的按钮与最近会话。

## 不支持

- 不自己量宽度：版式由宿主给（宿主量视图根，宽不小于 600、高不小于 360 像素为宽版）。
- 不多开聊天区（t03 决定 7）。

## 隐藏通道理由

`state:inject`：翻译端口（`provideAgentText`）。`state:local`：开抽屉的那个按钮（关后还焦点）；拖动中列表栏收起了没有（松手才交回宿主）。分栏自己的隐藏通道（窗口上的手势监听、分隔线读屏文字的注入点）见 `Splitter` 的文档：宿主没有注入 nb-layout 的文字时，分隔线的读屏文字是英文。
