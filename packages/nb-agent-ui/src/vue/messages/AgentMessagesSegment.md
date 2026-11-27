---
标签: [state:local, state:inject]
别名: ["消息视图段", "Messages segment"]
---

# AgentMessagesSegment

“消息”视图借给侧轨的那一段（docs/specs/agent/conversation.md 输出 57，docs/specs/workbench/views.md 输出 21）：收着时是 48 像素宽的一列快切，展开时是完整的列表（`AgentMessagesList`）。收着与展开是同一个组件，按 `expanded` 换画法，不看此刻的宽度（宽度过渡中也不换）。

内容分两处：`main`（中段，放不下时自己滚）与 `foot`（底段，贴底不滚）。给了 `targets` 时两处各 `Teleport` 进宿主给的元素（工作台侧轨的两个位置）；不给时按顺序画在自己的位置上，宿主把它放在哪就在哪（浮动窗的右边缘、Lab）。换位置是同一个实例，状态都在；DOM 是搬过去的，焦点与滚动位置由组件在搬完后放回去。

## 布局与交互

- **展开收起按钮**（`data-rail-toggle`、`data-messages-segment-toggle`，可访问名“展开”，`aria-expanded` 写状态，发 `toggle-expanded`）是视图段自己的（docs/specs/ui/workbench-layout.md 输出 50 的“三段”），右轨与浮动窗都是它：中段的第一个子元素，收着时排在头像上面（带 `data-rail-item`，进侧轨的纵向工具条），展开时定位到列表区右上角、和搜索框同一条中线（不带 `data-rail-item`，是列表区里的普通按钮）。两种是同一个元素，焦点跟着它走，不经 body。列表第一行按 `--acv-list-inset-end` 让出它（组件在列表区上写这个变量）。收着且 `tooNarrow` 时悬停与读屏描述给“窗口太窄”，按钮带 `data-rail-too-narrow`。
- **收着**（中段，按钮下面从上到下）：
  - bot 一组：圆头像（没有头像写名字的第一个字）。当前 bot 在头像外侧（侧轨的外缘一侧）有一条竖条，`aria-current`；换当前 bot 时竖条淡出淡入，会话的描边也过渡。未读是右上角的数字徽标；等你处理是 warning 色的圆点，和数字徽标形状不同（两者都有时只画圆点）。放不下时最后一个位置换成“+N”（`data-strip-more`），点它同“全部 bot”。
  - 一条短线。
  - 新对话（`data-messages-new-session`），然后是最近会话：方块写标题的第一个字，悬停与键盘聚焦给全名；当前会话描边，`aria-current`。普通会话不画未读。
  - 放几个按中段量到的高度算（`src/messages-segment-fit.ts`，按钮与“新对话”各占一格）：bot 先放、给会话留两个位置，最近会话按宿主给的次序放剩下的、只在末尾增减，当前会话永远占位，当前 bot 也顶替最后一个（bot 只剩“+N”的位置时一起收进去）。
  - `weak` 为真（区域隐藏或拖到零）时当前 bot 的竖条与当前会话的描边换成弱的颜色（`--border-strong`，故意不显眼：读屏仍按 `aria-current`），根上写 `data-rail-weak`。
- **底段**（只在收着时）：“全部 bot”（汇总徽标 `data-messages-summary`：未读合计；有等你处理时 warning 色、换成方角，另写 `data-messages-summary-waiting`；没有未读只有等你处理时是一个 warning 圆点）与“会话历史”。两个按钮带 `data-messages-open="bot"`、`"sessions"`；点了发 `show-list`（页），宿主请求展开并切页，展开好了宿主调 expose 的 `focusSearch(页)`。展开时整段 `hidden`（`Teleport` 的目标不拆，项不进 Tab），由列表底部的导航接替。
- **展开**：中段是 `AgentMessagesList`（bot 页、会话页、底部导航），宽由宿主给。列表在展开之后淡入，晚于宽度过渡（`--motion-layout`）开始，宽度长出来的过程中不挤着显示名字；减少动效时直接显示。收起时列表直接拿掉，bot 页的搜索词经 `v-model:botQuery` 留在宿主，会话页的搜索词本来在宿主。
- 搜索框里 `Esc`：框里有字先清空；已空时发 `escape-search`（宿主把焦点交回聊天输入框），不收起。
- 收着时每个可聚焦项带 `data-rail-item`：侧轨把它们和入口排成一条，统一管 Tab 与方向键。不给 `targets` 时没有侧轨来管，每一项照常可 Tab。
- 换位置（侧轨与右边缘之间、侧轨换了元素）之后放回焦点与滚动位置：浏览器里被搬动的节点会丢焦点、滚动回到顶。平时就记（`focusin` 记最后获得焦点的一项，滚动在捕获阶段记每个滚过的元素），换位置时再取已经晚了：右轨的元素先被拆掉。用户自己把焦点挪出视图段时清掉记下的焦点；被拆掉、藏起来丢的不算，搬完即使工作台已把焦点交给了标签或外壳根也放回来。
- 悬停提示在左边（`tooltipSide`，缺省 `left`：消息视图只停右轨与右边缘）。
- 按钮的颜色跟着工作台侧轨的皮肤变量（`--skin-activitybar-foreground`、`-hover`、`-active`、`-surface`），宿主没给时用 nb-ui 的正文与悬停色。

## 数据

```ts
type AgentMessagesSegmentProps = {
    expanded: boolean;
    /** 侧轨给的两个位置；不给（null）时画在自己的位置上。 */
    targets?: {main: HTMLElement; foot: HTMLElement} | null;
    sections: readonly MessagesContactSection[];
    selected: {kind: "contact"; key: string} | {kind: "session"; id: string} | null;
    /** 最近会话，按最近活动排好；组件按高度从末尾截。 */
    recentSessions: readonly MessagesRecentSession[];
    /** 展开时列表的当前页（受控，`v-model:tab`）。 */
    tab: "bot" | "sessions";
    /** bot 页的搜索词（`v-model:botQuery`）；不绑时组件自己记。 */
    botQuery?: string;
    /** 区域隐藏或拖到零：“当前”退成弱描边。默认 false。 */
    weak?: boolean;
    /** 展开按钮给“窗口太窄”（宿主拒了展开请求、仍放不下）。默认 false。 */
    tooNarrow?: boolean;
    now: number;
    locale?: AgentLocale;
    tooltipSide?: "left" | "right";
};

type AgentMessagesSegmentEmits = {
    (e: "update:tab", tab: "bot" | "sessions"): void;
    (e: "update:botQuery", query: string): void;
    (e: "open-contact", key: string): void;
    (e: "open-session", id: string): void;
    (e: "new-session"): void;
    /** 收着时点了底段的按钮或“+N”：宿主请求展开、切到这一页。 */
    (e: "show-list", tab: "bot" | "sessions"): void;
    (e: "retry-contacts", sectionKey: string): void;
    /** 搜索框已空时按了 `Esc`。 */
    (e: "escape-search"): void;
    /** 点了展开收起按钮：宿主向工作台请求。 */
    (e: "toggle-expanded"): void;
};

type AgentMessagesSegmentSlots = {
    /** 会话页（交给 `AgentMessagesList`）。 */
    sessions(): unknown;
};
```

expose `focusSearch(tab)`：展开着、列表已挂上时把焦点给这一页的搜索框；列表还没挂上时记下，挂上后再给，挂上之前又收起就作废。宿主只在展开请求成功（`done`）之后调它。根上写 `data-messages-segment` 与 `data-messages-segment-state`（`collapsed`、`expanded`）；`targets` 给了时这两个属性在 `main` 里那一份上。

## 状态

列表的加载中、失败、空、没有命中见 `AgentMessagesList`。收着时：联系人还在加载或读不到时 bot 一组是空的，短线照画；没有最近会话时只有“新对话”。

## 不支持

- 不自己请求展开：展开要过工作台的预算，由宿主经视图段的 `request` 去要。
- 不画容器入口：那是侧轨自己的。

## 隐藏通道理由

`state:inject`：翻译端口（`provideAgentText`）。`state:local`：中段量到的高度（按它截）；等列表挂上再给焦点的那一页；坏掉的头像地址。
