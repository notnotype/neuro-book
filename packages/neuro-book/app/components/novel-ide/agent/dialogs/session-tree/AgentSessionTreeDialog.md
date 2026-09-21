---
标签: [io:read]
---

# AgentSessionTreeDialog

会话分支树弹窗。以树形 + 导引线可视化展示当前会话的全部分支历史节点，支持搜索过滤、折叠/展开分支、选中节点查看详情（Entry ID、父节点、类型、子节点数、状态），以及激活选中节点以切换对话分支。

## 数据

```typescript
type Props = {
    /** 弹窗开关状态（v-model）。 */
    modelValue: boolean;
    /** 完整分支树数据。 */
    tree: SessionTreeNode[];
    /** 当前活跃的叶节点 ID。 */
    activeLeafId: string | null;
    /** 当前是否有会话正在运行。 */
    running: boolean;
    /** 当前交互上下文是否允许激活节点。 */
    canActivate: boolean;
};

type Emits = {
    (e: "update:modelValue", value: boolean): void;
    (e: "select", entryId: string): void;
};

type Slots = {};
```

- **阻断原因**：Dialog teleport 到 `.novel-ide-theme` 容器；依赖 `session-tree` 模块的树形推导函数与完整 `SessionTreeNode` 数据。
- **不支持**：不直接发起网络请求，节点激活通过 emits 委托父级。
