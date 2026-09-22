---
标签: [state:local]
---

# AgentLinkedAgentPanel

当前会话的关联 Agent 面板，展示当前 session 拥有（owned）和被绑定（linkedBy）的子/父 Agent 列表。每条 Agent 行包含标题、Profile 标签、运行状态圆点与 sessionId，点击可切换至对应会话。

## 数据

```typescript
type Props = {
    /** 当前活跃会话 ID。 */
    sessionId: number | null;
    /** 当前 session 绑定出去的下游 Agent 列表。 */
    ownedAgents: AgentLinkedSessionDto[];
    /** 绑定当前 session 的上游 Agent 列表。 */
    linkedByAgents: AgentLinkedSessionDto[];
    /** 数据是否正在加载中。 */
    loading: boolean;
};

type Emits = {
    (e: "select", sessionId: number): void;
    (e: "refresh"): void;
    (e: "close"): void;
};

type Slots = {};
```

- **扩展面**：无 slots，无 expose。
- **不支持**：不发起网络请求，所有会话切换、刷新和关闭通过 emits 委托父级。
