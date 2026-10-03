---
标签: []
别名: ["任务清单节点"]
---

# Agent 任务清单节点

任务清单工具（`task_create`、`task_set_status`）在工具渲染器里登记的 `node` 组件。它从调用结果解析这一刻的完整清单，从 `ctx.messages` 里找上一版清单算出变化，再交给 `AgentTaskList` 显示；`task_create` 整张替换清单，按新建显示。结果还没回来或解析失败时，退回通用卡片（名称、标题、运行状态）。

解析与比对规则见 `task-list.ts`。

## 数据

```ts
import type {ToolNodeProps} from "./agent-view-registry";

/** 与所有 node 组件相同：这次调用，以及对话视图的 ctx。 */
type AgentTaskListNodeProps = ToolNodeProps;
```

没有 emits、插槽和 expose。未声明的 attribute、`class` 与 `style` 落到根节点。
