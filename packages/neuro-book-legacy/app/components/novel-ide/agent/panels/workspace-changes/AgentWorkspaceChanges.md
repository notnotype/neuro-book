---
标签: []
---

# AgentWorkspaceChanges

在 Agent Composer 上方以折叠栏形式展示当前工作区的文件变更摘要（未审阅的 Agent 历史变更）。支持展开查看分组变更、内联安全差异比对预览、打开完整收件箱或文件差异编辑器，以及单文件或全量接受变更。所有数据与动作通过受控 props/emits 交互。

## 数据

```typescript
type Props = {
    /** 当前打开的项目根目录绝对路径。 */
    projectRoot: string | null;
    /** 待审阅的文件变更分组列表（最多展示前 6 项）。 */
    groups: WorkspaceHistoryInboxGroupDto[];
    /** 是否正在检查或加载工作区变更。 */
    loading: boolean;
    /** 加载或操作失败时的错误信息。 */
    error: string | null;
    /** 折叠栏是否展开（v-model:expanded）。 */
    expanded: boolean;
    /** 当前展开内联 diff 预览的文件路径。 */
    selectedPath: string | null;
    /** 当前正在执行单文件接受操作的文件路径。 */
    busyPath: string | null;
    /** 是否正在执行全部接受操作。 */
    acceptingAll: boolean;
    /** 按变更分组查询当前 revision 的内联 diff 状态。 */
    diffStateFor: (group: WorkspaceHistoryInboxGroupDto) => WorkspaceHistoryDiffState;
};

type Emits = {
    (e: "update:expanded", value: boolean): void;
    (e: "select-group", group: WorkspaceHistoryInboxGroupDto): void;
    (e: "accept-group", group: WorkspaceHistoryInboxGroupDto): void;
    (e: "accept-all"): void;
    (e: "refresh"): void;
    (e: "open-full"): void;
    (e: "open-file", path: string): void;
};

type Slots = {};
```

- **扩展面**：无 slots，无 expose，根元素受 Transition 控制显隐。

