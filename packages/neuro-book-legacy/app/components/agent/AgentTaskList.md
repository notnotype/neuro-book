---
标签: [state:local]
别名: ["任务清单", "Task List"]
---

# Agent 任务清单

消息流里一次任务清单调用的呈现。Agent 每改一次清单都会出现一张，让人知道它改了什么。

- 新建的清单（`changes` 为 null）：完整列出每一项。
- 更新的清单：只列出这次变化的项，写成“状态图标、项目文字、新状态”。底部一个“查看完整清单”按钮，展开后显示这一刻的完整清单。
- 标题行右端是进度“已完成数/总数”。
- 每项的状态图标：待办为虚线圆，进行中为强调色圆点，已完成为勾。项目带备注时，备注淡色跟在文字后面。

“当前清单”是另一件事，由独立于对话视图的面板负责，不在本组件里。

## 数据

```ts
import type {TaskChange, TaskItemView} from "./task-list";

type AgentTaskListProps = {
    /** 清单标题；null 时只显示“任务清单”。 */
    title: string | null;
    /** 这次调用之后的完整清单，必填，按显示顺序。 */
    items: TaskItemView[];
    /** 相对上一版的变化；null 表示新建，完整列出。 */
    changes: TaskChange[] | null;
};
```

没有 emits、插槽和 expose。未声明的 attribute、`class` 与 `style` 落到根节点。

## 隐藏通道理由

`state:local`：更新卡片是否展开了完整清单。纯界面状态，重新挂载时回到收起。
