---
标签: [state:local, state:inject]
别名: ["消息视图", "Messages"]
---

# AgentMessages

“消息”视图的外框（docs/specs/agent/conversation.md 输出 57）：视图里只有聊天区，外加借给侧轨的视图段（`AgentMessagesSegment`）。没有宽窄两版、没有可拖的列表栏与抽屉：完整列表在视图段展开之后。

## 布局与交互

- 聊天区（默认插槽）占满视图；它一直是同一份 DOM，视图段换位置、收起展开都不重挂，滚动与输入框的焦点都在。
- 视图段在哪由宿主给的 `placement` 定：
  - `rail`：送进侧轨给的 `main`、`foot` 两个元素（工作台的右轨）。视图里不占位置。
  - `edge`：画在视图自己的右边缘，一栏宽 `width`，左边一条描边，这一栏写 `data-float-rail`；顶上让出 `--acv-segment-inset-top`（缺省 0，浮动窗把右上角留给“回到停靠”）。
  - `none`：不画（视图段这一刻没借到地方）。
  - `rail` 与 `edge` 之间换的是同一个视图段实例，只换去处：搜索词与当前页都在；滚动与焦点的恢复见 `AgentMessagesSegment`。
- 收着与展开、底段的两个按钮、“+N”、搜索框里的 `Esc` 见 `AgentMessagesSegment`；要不要展开由宿主向工作台请求，外框只转发事件。

## 数据

```ts
type AgentMessagesProps = {
    placement: MessagesSegmentPlacement; // {kind: "rail"; main; foot} | {kind: "edge"; width} | {kind: "none"}
    /** 视图段此刻生效的展开状态（工作台给）。 */
    expanded: boolean;
    sections: readonly MessagesContactSection[];
    selected: {kind: "contact"; key: string} | {kind: "session"; id: string} | null;
    recentSessions: readonly MessagesRecentSession[];
    /** 展开时列表的当前页（受控，`v-model:tab`）。 */
    tab: "bot" | "sessions";
    /** bot 页的搜索词（`v-model:botQuery`）：视图段收起时列表拿掉，搜索词留在宿主。 */
    botQuery?: string;
    /** 区域隐藏或拖到零：“当前”退成弱描边。默认 false。 */
    weak?: boolean;
    now: number;
    locale?: AgentLocale;
};

type AgentMessagesEmits = {
    (e: "update:tab", tab: "bot" | "sessions"): void;
    (e: "update:botQuery", query: string): void;
    (e: "open-contact", key: string): void;
    (e: "open-session", id: string): void;
    (e: "new-session"): void;
    /** 收着时点了“全部 bot”“会话历史”或“+N”：宿主请求展开并切页，成功后调 `focusSearch`。 */
    (e: "show-list", tab: "bot" | "sessions"): void;
    (e: "retry-contacts", sectionKey: string): void;
    /** 搜索框已空时按了 `Esc`：宿主把焦点交回聊天输入框。 */
    (e: "escape-search"): void;
};

type AgentMessagesSlots = {
    /** 聊天区。 */
    default(): unknown;
    /** 会话页（交给视图段里的列表）。 */
    sessions(): unknown;
};
```

`MessagesSegmentPlacement` 从 `@notnotype/nb-agent-ui/vue` 导出。expose `focusSearch(tab)`（转给视图段）。attrs 透传到根元素；根上写 `data-messages-placement`。

## 状态

见 `AgentMessagesSegment` 与 `AgentMessagesList`。

## 不支持

- 不自己量宽度、不分版式：视图段的宽与展开由工作台定（docs/specs/ui/workbench-layout.md 输出 50）。
- 不多开聊天区（t03 决定 7）。

## 隐藏通道理由

`state:inject`：翻译端口（经视图段与列表的 `provideAgentText`）。`state:local`：宿主不绑 `botQuery` 时的搜索词。
