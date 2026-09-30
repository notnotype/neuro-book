---
标签: [state:local, env:clipboard, env:portal]
---

# AgentSessionTreeDialog

会话分支树弹窗。以树形 + 导引线可视化展示当前会话的全部分支历史节点，支持搜索过滤、折叠/展开分支、键盘方向键导航、选中节点查看详情（Entry ID、父节点、类型、子节点数、状态），以及激活选中节点以切换对话分支。

## 隐藏通道理由

- `env:clipboard`：点击节点 Entry ID 或父节点 ID 时调用 `navigator.clipboard.writeText` 复制到系统剪贴板，同时通过 `copy-id` 事件上报。
- `env:portal`：底层 `Dialog` 默认 teleport 到 `.novel-ide-theme`（在 Component Lab 中可通过 `teleportTarget: false` 内联挂载）。

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
    /** Dialog teleport 目标选择器；传 false 时禁用 teleport 内联渲染。 */
    teleportTarget?: string | boolean;
};

type Emits = {
    (e: "update:modelValue", value: boolean): void;
    (e: "select", entryId: string): void;
    (e: "copy-id", value: string): void;
};

type Slots = {};
```

- **扩展面**：无自定义 slots，无 expose。
- **不支持**：不直接发起网络请求，节点激活通过 emits 委托父级。

