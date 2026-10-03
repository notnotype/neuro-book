---
标签: [state:local]
---

# AgentQueuedMessageList

排队消息提示列表，展示在 Agent Composer 上方。当存在排队中的 steer 转向消息或顺序队列消息时，以紧凑胶囊徽章列出，并提供内容预览与提示信息。

## 数据

```typescript
type Props = {
    /** 当前会话中排队等待发送的消息列表。 */
    queuedMessages: AgentQueuedMessageDto[];
};

type Emits = {};

type Slots = {};
```

- **扩展面**：无 slots，无 expose，attrs 透传至根容器元素。
- **不支持**：不支持在组件内部就地删除排队消息（由服务端状态或主流程控制）。
