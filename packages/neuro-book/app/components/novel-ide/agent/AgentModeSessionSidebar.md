---
标签: [io:read]
---

# AgentModeSessionSidebar

Agent Mode 左侧会话导航侧边栏。以可搜索、可置顶的列表展示当前 Project Workspace 的所有会话，支持拖拽调节宽度。选中某会话后通过 emit 通知父级切换。

## 数据

```typescript
type Props = {
    /** 会话摘要列表。 */
    sessions: AgentSessionSummaryDto[];
    /** 当前活跃会话 ID。 */
    activeSessionId: number | null;
    /** 列表是否正在加载中。 */
    loading: boolean;
    /** 当前是否有会话正在运行。 */
    running: boolean;
    /** 正在执行操作的会话 ID（归档、重命名等）。 */
    actionId: number | null;
    /** localStorage 置顶偏好的作用域键。 */
    sessionScopeKey: string;
    /** 侧边栏是否展开。 */
    open: boolean;
    /** 侧边栏宽度（px）。 */
    width: number;
};

type Emits = {
    (e: "update:width", value: number): void;
    (e: "select", sessionId: number): void;
    (e: "create"): void;
    (e: "archive", session: AgentSessionSummaryDto): void;
    (e: "rename", session: AgentSessionSummaryDto): void;
    (e: "refresh"): void;
};

type Slots = {};
```

- **阻断原因**：读写 `localStorage` 存储会话置顶偏好；使用 `useResizablePanel` 与 DOM 拖拽交互。
- **不支持**：不发起网络请求，所有会话操作通过 emits 委托父级。
