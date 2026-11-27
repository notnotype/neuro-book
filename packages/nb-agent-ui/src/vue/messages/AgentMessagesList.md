---
标签: [state:local, state:inject]
别名: ["消息列表", "Messages list"]
---

# AgentMessagesList

“消息”视图的列表（docs/specs/agent/conversation.md 输出 1–3、docs/specs/bots/view.md）：底部是“Bot”“会话”两项的导航，bot 一页是 IM 式的联系人列表，会话一页由宿主经插槽放会话面板（`AgentSessionPanel`）。它是消息视图段展开时的完整列表（`AgentMessagesSegment`）；视图段收起时列表拿掉，bot 页的搜索词经 `v-model:botQuery` 留在宿主，会话页的搜索词本来在宿主。

## 布局与交互

- 底部导航（`data-messages-nav`，高 52 像素，上面一条细线）：“Bot”与“会话”两项等分，图标在上、字在下（图标同视图段收着时底段的两项），当前页用强调色与粗一档的字重，另一页用淡色（docs/specs/agent/conversation.md 输出 57 的“展开”）。Bot 一项的角标是所有联系人未读的合计（`data-messages-summary`，中性色的小胶囊，没有不写）；有等你处理时 warning 色、方角（`data-messages-summary-waiting`），没有未读只有等你处理时是一个 warning 圆点；读屏名带上未读或“等你处理”。这是一组 `tablist`：当前页是 Tab 停靠点，左右方向键、`Home`、`End` 换页并把焦点带过去；项带 `aria-selected` 与面板的 `aria-controls`，面板带 `aria-labelledby`。点了只换这一页，不换聊天区；宿主打开会话时按会话有没有归属切页。换页时新的一页淡入（减少动效时直接换）。
- 搜索行右端按 `--acv-list-inset-end`（缺省 0）让位：视图段把展开收起按钮画在列表区右上角。
- bot 一页：顶上一个搜索框（放大镜图标，提示“搜索”），按名字筛（大小写不分）；下面一行一个联系人：
  - 头像（没有头像写名字的第一个字）、名字、时间（`last.at`，同会话列表的时间列）；
  - 第二行：在跑时蓝字“正在回复…”，等你时黄字“等你处理”，平时是最后一句话（`last.text`），没有写淡色的“还没有消息”；
  - 右边是未读数（正整数才写）；
  - 选中的行底色同会话面板的当前行，`aria-current`。
- 联系人按 `sections` 分段（每个贡献方一段，段之间不画标题）：加载中写“正在加载…”；失败写原因与“重试”（发 `retry-contacts`）；所有段都读到了、一个联系人都没有时写“还没有 bot”。搜索没有命中写“没有匹配的 bot”。
- 会话一页：插槽 `sessions` 的内容占满剩下的高度，自己滚。
- 搜索框里 `Esc`（两页一样）：框里有字先清空（会话页在框上发一次 `input`，走会话面板自己的 `v-model`）；已空时发 `escape-search`，由宿主把焦点交回聊天输入框。
- 列表自己不定宽，宽由外框给（视图段展开的宽度）；行内文字单行省略号截断，时间与未读数固定在右边。

## 数据

```ts
type AgentMessagesListProps = {
    /** 当前页（受控，`v-model:tab`）。 */
    tab: "bot" | "sessions";
    /** 联系人，按贡献方分段。 */
    sections: readonly MessagesContactSection[];
    /** 选中的联系人的 `key`；没有为 null。 */
    selectedContact: string | null;
    /** 时间列按它算，宿主定期更新。 */
    now: number;
    locale?: AgentLocale;
    /** bot 页的搜索词（`v-model:botQuery`）；不绑时组件自己记。 */
    botQuery?: string;
};

type AgentMessagesListEmits = {
    (e: "update:tab", tab: "bot" | "sessions"): void;
    /** 点了联系人。 */
    (e: "open-contact", key: string): void;
    /** 点了某一段的“重试”。 */
    (e: "retry-contacts", sectionKey: string): void;
    (e: "update:botQuery", query: string): void;
    /** 搜索框已空时按了 `Esc`。 */
    (e: "escape-search"): void;
};

type AgentMessagesListSlots = {
    /** 会话一页的内容（会话面板）。 */
    sessions(): unknown;
};
```

类型 `MessagesContactSection`、`MessagesContact` 见 `src/types.ts`。expose `focusSearch(page)`：把焦点给这一页的搜索框（会话页是插槽里的第一个输入框）。attrs 透传到根元素。

## 状态

见上面“布局与交互”的加载中、失败、空、没有命中。

## 不支持

- 不排序：联系人按宿主给的顺序。
- 不画子会话与子 bot（t03 决定 13：进聊天头部的子代理入口）。
- 第二行不写具体在做什么（t15 决定 6）。

## 隐藏通道理由

`state:inject`：翻译端口（`provideAgentText`），同包里的其它组件。`state:local`：宿主不绑 `botQuery` 时的搜索词。
