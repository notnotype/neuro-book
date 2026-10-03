---
标签: [state:local, env:global]
---

# AgentModeSessionSidebar

Agent Mode 左侧会话导航侧边栏。以可搜索、可置顶的列表展示当前 Project Workspace 的所有会话，支持拖拽调节宽度。选中、置顶、新建、重命名、归档等操作均通过受控 props/emits 委托父级执行。

## 隐藏通道理由

- `env:global`：通过 `useResizablePanel` 在拖拽调节侧边栏宽度期间监听全局指针移动与释放事件。

## 数据

```typescript
type Props = {
    /** 会话摘要列表。 */
    sessions: AgentSessionSummaryDto[];
    /** 当前活跃会话 ID。 */
    activeSessionId: number | null;
    /** 列表是否正在加载中。 */
    loading: boolean;
    /** 正在执行操作的会话 ID（归档、重命名等）。 */
    actionId: number | null;
    /** 置顶会话 ID 列表（v-model:pinnedSessionIds）。 */
    pinnedSessionIds?: number[];
    /** 侧边栏是否展开（默认 true）。 */
    open?: boolean;
    /** 受控侧边栏像素宽度（v-model:width）；省略时自适应撑满外层容器宽度。 */
    width?: number;
};

type Emits = {
    (e: "update:width", value: number): void;
    (e: "update:pinnedSessionIds", value: number[]): void;
    (e: "select", sessionId: number): void;
    (e: "create"): void;
    (e: "archive", session: AgentSessionSummaryDto): void;
    (e: "rename", session: AgentSessionSummaryDto): void;
    (e: "refresh"): void;
};

type Slots = {};
```

- **扩展面**：无 slots，无 expose。
- **不支持**：不直接发起网络请求或读写 `localStorage`，所有会话操作与置顶偏好通过 emits 委托父级。

