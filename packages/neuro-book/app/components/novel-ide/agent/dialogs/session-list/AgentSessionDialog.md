---
标签: [io:read]
---

# AgentSessionDialog

全功能会话管理弹窗。以 Dialog 承载会话列表，支持多维度筛选（Profile 组、运行状态、关系类型）、搜索、翻页、新建（可选 Profile 下拉）、归档、恢复与重命名。

## 数据

```typescript
type CreateProfileOption = {
    profileKey: string;
    label: string;
    iconClass: string;
};

type Props = {
    /** 弹窗开关状态（v-model）。 */
    modelValue: boolean;
    /** 当前页会话摘要列表。 */
    sessions: AgentSessionSummaryDto[];
    /** 符合筛选条件的总数。 */
    total: number;
    /** 是否有更多数据可翻页。 */
    hasMore: boolean;
    /** 下一页偏移量。 */
    nextOffset: number | null;
    /** 当前活跃会话 ID。 */
    activeSessionId: number | null;
    /** 列表是否正在加载中。 */
    loading: boolean;
    /** 当前是否有会话正在运行。 */
    running: boolean;
    /** 正在执行操作的会话 ID。 */
    actionId: number | null;
    /** 可创建的 Profile 选项列表。 */
    createProfileOptions: CreateProfileOption[];
    /** 是否允许选择 Profile 创建会话（否则直接创建默认）。 */
    canChooseCreateProfile: boolean;
};

type Emits = {
    (e: "update:modelValue", value: boolean): void;
    (e: "select", sessionId: number): void;
    (e: "create", profileKey?: string): void;
    (e: "archive", session: AgentSessionSummaryDto): void;
    (e: "restore", session: AgentSessionSummaryDto): void;
    (e: "rename", session: AgentSessionSummaryDto): void;
    (e: "refresh", query: AgentSessionListQueryDto): void;
    (e: "loadMore", query: AgentSessionListQueryDto): void;
};

type Slots = {};
```

- **阻断原因**：Dialog teleport 到 `.novel-ide-theme` 容器；内部维护复杂筛选/翻页状态与防抖刷新。
- **不支持**：不直接发起网络请求，所有列表查询与会话操作通过 emits 委托父级。
