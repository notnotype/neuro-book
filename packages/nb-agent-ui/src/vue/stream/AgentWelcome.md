---
标签: [state:inject]
---

# AgentWelcome

对话还没有消息时的第一屏（[`ui/agent-conversation-view.md`](../../../../../docs/specs/ui/agent-conversation-view.md) 的“空状态”）：欢迎、最近对话、试试这些。与只写一句“还没有消息”不同，它把用户最可能的下一步摆出来：回到最近的会话，或者点一条开场指令填进输入框。版式照旧应用的第一屏（`AgentChatEmptyState`）。

它是 `AgentConversationView` 的零件，不单独导出；数据由视图的 `welcome` 属性给。

## 布局

自上而下：欢迎（图标、标题、一句说明）、最近对话、试试这些，竖直居中在消息区里，宽度不超过 460px。

- 最近对话：标题行左边“最近对话”，右边“查看全部（N）”；下面至多 3 张卡片，每张一行：图标、会话标题（单行截断）、时间、箭头。时间的写法与会话列表相同（同一天写时刻，前一天写“昨天”，同一年写月日）。
- 试试这些：标题行左边“试试这些”，右边“点击填入输入框”；下面至多 3 行，每行图标加指令，单行截断，悬停显示全文。图标都用强调色。

`390×844` 下结构不变，卡片标题与指令先截断，时间不让。

## 交互

- 点卡片发 `select`，带会话 id。
- 点“查看全部”发 `open-sessions`；`canOpenSessions` 为假时不画它。
- 点一条指令发 `starter`，带指令全文；视图把它交给宿主（`composer.fill`）并聚焦输入框。

## 数据

```ts
type AgentWelcomeView = {
    /** 欢迎的标题；不给时写“开始一段对话”。宿主写自己的品牌（NeuroBook 写“NeuroBook 创作工作区”）。 */
    title?: string;
    /** 最近对话，最近的在前；只显示前 3 条。空数组时这一块不画。 */
    recent: ReadonlyArray<{id: string; title: string; at: number}>;
    /** “查看全部（N）”的 N。 */
    total: number;
    /** 开场指令；只显示前 3 条。空数组时这一块不画。 */
    starters: ReadonlyArray<{text: string; icon?: string}>;
};

type AgentWelcomeProps = {
    welcome: AgentWelcomeView;
    /** 卡片的时间按它算，同视图的 `ctx.now`。 */
    now: number;
    /** 有会话列表可开（视图有 `sessions` 插槽）。 */
    canOpenSessions: boolean;
};

type AgentWelcomeEmits = {
    (e: "select", sessionId: string): void;
    (e: "open-sessions"): void;
    (e: "starter", text: string): void;
};
```

没有插槽、没有 expose；attrs 落在根 `section` 上。

## 状态

- 欢迎下面那句说明随内容变：有最近对话时“从最近对话继续写，或试试下面的指令”，只有指令时“在下面输入，或试试下面的指令”，都没有时“在下面输入，开始一段对话”。
- 会话标题为空写“未命名会话”。

## 不支持

不取数、不刷新：最近对话由宿主取好给它。不显示已归档的、子会话（宿主不给）。指令文字不翻译，Profile 声明里写什么就显示什么。

## 隐藏通道理由

- `state:inject`：经 `useAgentText` 读翻译端口取界面文字，与视图的其它零件相同。
