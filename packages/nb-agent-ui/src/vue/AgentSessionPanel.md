---
标签: [state:inject]
别名: ["会话面板", "会话列表"]
---

# AgentSessionPanel

切换会话的面板：同一个组件放在点标题弹出的下拉和左栏视图里。行为合同见 [`conversation.md`](../../../../../docs/specs/agent/conversation.md) 输出 2、3。

## 布局与交互

顶部是搜索、作品范围（`scope` 为 null 时没有）、过滤按钮、新建。过滤菜单选 Profile、显示已归档；选了的条件显示成可去掉的标签。每行是 Profile 图标（名字在悬停提示）、标题、时间、说明、状态（运行中、等你处理、已中断），按今天、昨天、更早分组。改名、归档、恢复在每行悬停的菜单里。

## 数据

```ts
type SessionPanelFilter = {id: string; label: string; icon?: string; active: boolean};
type AgentSessionPanelProps = {
    items: readonly AgentSessionListItem[];
    selectedId: string | null;
    /** 分组与时间列按它算，宿主要定期更新。 */
    now: number;
    query?: string;
    scope?: {value: "project" | "all"} | null;
    profiles?: readonly SessionPanelFilter[];
    showArchived?: boolean;
    loading?: boolean;
    error?: string | null;
    locale?: AgentLocale;
};
```

事件：`action`（`session.select`、`session.create`、`session.rename`、`session.archive`、`session.restore`）、`update:query`、`update:scope`、`toggle-profile`、`update:show-archived`。纯受控，筛选由宿主做。

## 隐藏通道理由

`state:inject`：翻译端口。放在视图之外时自己按 `locale` 建缺省端口，同 `AgentSessionList`。
