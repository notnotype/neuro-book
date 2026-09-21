---
标签: [state:local, state:inject, io:read, io:mutate]
---

# AgentWorkspaceChanges

在 Agent Composer 上方以折叠栏形式展示当前工作区的文件变更摘要（未审阅的 Agent 历史变更）。支持展开查看分组变更、差异比对导航、单文件或全量接受/拒绝。

## 隐藏通道理由

- `state:inject`：通过 `useNotification` 弹出接受与拒绝操作的成功/失败提示。
- `io:read`：调用 `useWorkspaceHistoryInbox` 读取当前项目的历史未接受变更列表及 diff 详情。
- `io:mutate`：直接调用服务端 API 执行接受单个变更、全部接受或放弃变更操作。变更属于底层工作区文件系统真实写操作。

## 数据

```typescript
type Props = {
    /** 当前打开的项目根目录绝对路径。 */
    projectRoot: string | null;
    /** 刷新触发键。 */
    refreshKey: string | number;
    /** 工作区变更面板是否处于激活关注状态。 */
    active: boolean;
};

type Emits = {
    /** 打开完整的历史审阅收件箱。 */
    (e: "open-full"): void;
    /** 打开指定文件的差异比对编辑器。 */
    (e: "open-file", path: string): void;
};

type Slots = {};
```

- **扩展面**：无 slots，无 expose，attrs 透传至根元素。
