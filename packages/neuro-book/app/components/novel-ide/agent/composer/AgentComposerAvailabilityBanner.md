---
标签: [state:local]
---

# AgentComposerAvailabilityBanner

Composer 可用性状态横幅，在会话不可交互（未选择会话、会话已归档、会话加载失败、模型不可用等）时持续展示说明原因和恢复动作按钮。

## 数据

```typescript
type Props = {
    /** 当前 Composer 可用性状态。 */
    availability: AgentComposerAvailability;
};

type Emits = {
    /** 点击恢复动作按钮时触发。 */
    (e: "action", action: AgentComposerAvailabilityAction): void;
};

type Slots = {};
```

- **扩展面**：无 slots，无 expose，attrs 透传至根元素。
- **不支持**：不在组件内直接执行会话创建/恢复逻辑，统一向上冒泡 action 由宿主处置。
