---
标签: [state:inject]
别名: ["会话面板", "会话列表"]
---

# AgentSessionPanel

切换会话的面板：同一个组件放在点标题弹出的下拉和左栏视图里。行为合同见 [`conversation.md`](../../../../../docs/specs/agent/conversation.md) 输出 2、3。

## 布局与交互

顶部一行是搜索框（放大镜图标，提示“搜索”，读屏名“搜索标题和说明”）与新建；过滤按钮在搜索框里的右端。过滤菜单最上面一组单选是作品范围（当前作品、全部作品；`scope` 为 null 时没有这一组），下面选 Profile、显示已归档。选了的条件是过滤按钮上的条数，“全部作品”也算一个；菜单里能一次清除（范围回到当前作品），有没有选都不改变高度。搜索行右端按 `--acv-list-inset-end`（缺省 0）让位，放在消息视图的列表里时让出视图段的展开收起按钮。每行是 Profile 图标（名字在悬停提示）、标题、时间、说明、状态（运行中、等你处理、已中断），按宿主给的顺序（最近活动在前），不按日分组。改名、归档、恢复在每行悬停的菜单里。

子会话（条目带 `parentId`，且父会话也在条目里）挂在父会话下；父会话不在条目里的子会话不列出。父会话第二行右边“N 个子代理”是折叠开关，是与打开会话的按钮并列的兄弟按钮（`aria-expanded`、`aria-controls`），左边不留空槽；收起时有后代在等用户（`childWaiting`），第二行写“子代理等你处理”；子会话都被筛掉、没有可展开的行时也写（提醒按全部子会话算），这时没有开关。子会话由 [`AgentSessionChildRows`](AgentSessionChildRows.md) 画，每个一行，图标对齐父会话的标题，一条细线连着。只因后代命中筛选才列出的上级（`dimmed`）弱化显示，读屏说明它是上级。

展开有三种来源：用户手动展开或收起；选中会话的祖先、`expandFor` 里会话的祖先、有后代在等用户的父会话自动展开——自动只对新进入这个集合的会话生效一次（发一次 `update:expanded`），之后用户手动的优先；面板挂载时（关掉再打开）只补记录里没有的，用户收起过的不改回来。组元素的 id 带每个面板自己的前缀，下拉与左栏同时展开同一个父会话时不重复；收起时开关不带 `aria-controls`。展开记录受控（`expanded`），由宿主持有，面板关掉再打开还在；不给时面板自己记。

## 数据

```ts
type SessionPanelFilter = {id: string; label: string; icon?: string; active: boolean};
type AgentSessionPanelProps = {
    items: readonly AgentSessionListItem[];
    selectedId: string | null;
    /** 时间列按它算，宿主要定期更新。 */
    now: number;
    query?: string;
    scope?: {value: "project" | "all"} | null;
    profiles?: readonly SessionPanelFilter[];
    showArchived?: boolean;
    loading?: boolean;
    error?: string | null;
    locale?: AgentLocale;
    /** 子会话的展开记录：true 展开、false 收起，没有的跟随自动规则。 */
    expanded?: Readonly<Record<string, boolean>>;
    /** 要露出的会话：它们的祖先自动展开一次。 */
    expandFor?: readonly string[];
};
```

条目里与嵌套有关的字段（`AgentSessionListItem`）：`parentId?`、`childCount?`（宿主按未过滤的会话算）、`childWaiting?`（同上）、`dimmed?`。

事件：`action`（`session.select`、`session.create`、`session.rename`、`session.archive`、`session.restore`）、`update:query`、`update:scope`、`toggle-profile`、`update:show-archived`、`update:expanded`。纯受控，筛选由宿主做。

## 隐藏通道理由

`state:inject`：翻译端口。放在视图之外时自己按 `locale` 建缺省端口，同 `AgentSessionList`。
