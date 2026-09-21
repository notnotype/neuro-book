---
标签: [state:local]
---

# AgentComposerStatusBar

Composer 底部状态与统计芯片条。集中展示上下文使用量（Token Gauge）、输入/输出/缓存/费用累积统计、网络连接状况与重连动作、运行中状态指示器以及非普通模式下的模式徽标。

## 数据

```typescript
type Props = {
    /** 精确上下文使用量悬停说明。 */
    contextUsageExactLabel: string;
    /** 紧凑上下文使用量展示文本。 */
    contextUsageCompactLabel: string;
    /** 紧凑上下文占用百分比。 */
    contextPercentCompactLabel: string;
    /** 精确累积 Token 与费用说明。 */
    cumulativeUsageExactLabel: string;
    /** 紧凑累积输入 Token 文本。 */
    cumulativeInputCompactLabel: string;
    /** 紧凑累积输出 Token 文本。 */
    cumulativeOutputCompactLabel: string;
    /** 紧凑累积缓存读 Token 文本。 */
    cumulativeCacheCompactLabel: string;
    /** 紧凑累积缓存写 Token 文本。 */
    cumulativeCacheWriteCompactLabel: string;
    /** 缓存命中率文本。 */
    cumulativeCacheHitRateLabel: string;
    /** 紧凑累积费用文本。 */
    cumulativeCostCompactLabel: string;
    /** 连接状态描述文本。 */
    connectionStatusLabel: string;
    /** 连接异常是否需要重连/刷新动作。 */
    connectionNeedsAction: boolean;
    /** 当前会话是否正在运行中。 */
    running: boolean;
    /** 运行阶段描述文本。 */
    runPhaseLabel: string;
    /** 当前 Agent 模式。 */
    agentMode: AgentMode;
};

type Emits = {
    /** 打开上下文检查器抽屉/面板。 */
    (e: "open-context-inspector"): void;
    /** 重新连接 SSE 事件流。 */
    (e: "reconnect-events"): void;
    /** 刷新会话历史记录。 */
    (e: "refresh-history"): void;
};

type Slots = {};
```

- **扩展面**：无 slots，无 expose，attrs 透传至根元素。
- **不支持**：不在组件内直接发起重连逻辑，统一通过 emits 传递给宿主。
