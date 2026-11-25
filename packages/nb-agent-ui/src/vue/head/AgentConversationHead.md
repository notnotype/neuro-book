---
标签: [state:inject, env:portal]
---

# AgentConversationHead

对话视图的头（[`ui/agent-conversation-view.md`](../../../../../docs/specs/ui/agent-conversation-view.md) 的“顶栏”）：左列新建或返回，中列 Profile 图标、会话标题与下拉箭头，右列宿主放的东西、常驻的顶栏动作与“⋯”。它与别的顶栏不同的地方是能把三列分别送到视图之外的位置（工作台面板头的标题区，[`workbench/views.md`](../../../../../docs/specs/workbench/views.md) 输出 19），换位置时组件不重建：开着的菜单、宿主放进右列的浮层都不丢。

它是 `AgentConversationView` 的零件，不单独导出；“⋯”里几项的状态（上下文检查、会话树、视图模式）仍在视图里，这里只发事件。

## 布局

三列网格，两侧至少放得下自己的内容并平分剩下的宽度，标题按整行居中；两侧放不下时标题截断。高 32px，按钮 24px。给了 `targets` 时整行不画，三列的内容分别送进 `targets.start`、`targets.title`、`targets.end`；没给时画在原处。`390×844` 下结构不变，标题先截断。

## 交互

- 左列：子会话（`ctx.session.path` 不空）是返回，只有图标，发 `select`，带父会话的 id（`path` 的最后一项）；顶层会话且 `newSession` 为真是新建，发 `create`；没选会话时空着。
- 中列的图标：会话给了头像（`ctx.session.avatar`）时画成圆形头像图片（`data-header-avatar`），否则是 Profile 图标。
- 中列：有 `sessions` 时是会话列表的入口。画在原处时中列是一个按钮，点了切换 `sessionsOpen`；送进标题区时中列只有文字与图标，按下由宿主转来（宿主改 `sessionsOpen`）。会话列表是 nb-ui 的 `Popover`，锚在中列的按钮上，送进标题区时锚在 `targets.anchor` 上；Escape 关掉后焦点回到锚点。悬停标题显示会话摘要。
- 右列：`trailing` 插槽、常驻的顶栏动作（发 `header-action`）、“⋯”（选了发 `overflow`，值是菜单项 id）。没选会话时没有“⋯”。
- 宿主自绘窗口头时（`windowDrag`，工作台浮动窗的“自绘头”）：根上写 `data-window-drag`，宿主把按住空白、标题文字与头像的拖动当成拖窗口（按钮照旧），拖动区 `touch-action: none`。高度读 `--acv-head-height`（缺省 40px，与消息列表的切换行一样；不作拖动区时缺省 32px），右内边距加 `--acv-head-inset-end`（缺省 0，宿主盖在右端的按钮的宽度），标题随之按剩下的宽度居中。头上的文字不能选（`user-select: none`），头像不能被浏览器拖走（`draggable="false"`，原生的图片拖动会取消指针手势）。

## 数据

```ts
type AgentConversationHeadProps = {
    ctx: AgentConversationContext;
    /** 送到视图之外的位置；null 时画在原处。 */
    targets: {start: HTMLElement; title: HTMLElement; end: HTMLElement; anchor: HTMLElement} | null;
    /** 顶层会话时左列放新建。 */
    newSession: boolean;
    /** 有会话列表（视图的 `sessions` 插槽）。 */
    hasSessions: boolean;
    /** 会话列表开着没有；受控。 */
    sessionsOpen: boolean;
    /** 没选会话时中列的图标：新会话会用的 Profile。不给时不画图标。 */
    draftProfile: {name: string; icon: string} | null;
    /** 常驻的顶栏动作，已按 `order` 取好。 */
    pinned: ReadonlyArray<{id: string; icon: string; label: string}>;
    /** “⋯”的菜单项，已排好；空数组时不画“⋯”。 */
    overflowItems: ReadonlyArray<DropdownMenuItemData>;
    /** 右列最后画“关闭”（`data-header-close`），点了发 `close`。 */
    closable: boolean;
    /** 头是宿主窗口的拖动区；默认 false。 */
    windowDrag?: boolean;
};

type AgentConversationHeadEmits = {
    (e: "select", sessionId: string): void;
    (e: "create"): void;
    (e: "update:sessionsOpen", open: boolean): void;
    (e: "header-action", id: string): void;
    (e: "overflow", value: string): void;
    (e: "close"): void;
};

type AgentConversationHeadSlots = {
    /** 会话列表的内容。 */
    sessions?: () => unknown;
    /** 右列最前面，宿主放的入口（对话里是子代理入口）。 */
    trailing?: () => unknown;
};
```

没有 expose；未声明的 attrs 落在内容里的那个头上（根是头加浮层两个节点）。

## 状态

- 没选会话：中列写“新对话”，左列空，右列只有 `trailing`。
- 会话标题为空：写“未命名会话”。

## 不支持

不画面包屑：祖先只经返回一级一级回去。不知道自己被送到哪里，也不处理位置之外的点击。

## 隐藏通道理由

- `state:inject`：经 `useAgentText` 读翻译端口取界面文字，与视图的其它零件相同。
- `env:portal`：三列经 `Teleport` 送到 `targets` 的元素里，那是宿主（工作台面板头）渲染的位置；`targets` 为 null 时就地渲染。会话列表与“⋯”是 nb-ui 的浮层，渲染到 `body`。
