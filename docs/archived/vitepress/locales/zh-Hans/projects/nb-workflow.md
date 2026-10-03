# nb-workflow

`@notnotype/nb-workflow` 是会记账的脚本式 Workflow 引擎。Workflow 是普通 `async` 函数；Activity 的输入、输出和身份写入 journal，进程恢复后不会重复已完成步骤。

```ts
import {MemoryActivityExecutor, WorkflowRunner} from "@notnotype/nb-workflow";

const activities = new MemoryActivityExecutor();
activities.registerAction("math.double@1", ({value}: {value: number}) => ({value: value * 2}));
const runner = new WorkflowRunner({}, {}, {activities});
```

Activity 引用必须显式带版本。内存实现只用于测试和 demo；Agent、Session、Workspace 通过 `SessionPort`、`AgentPort`、`WorkspacePort` 注入。进一步阅读：[Activity 与重放](https://github.com/notnotype/neuro-book/blob/master/packages/nb-workflow/docs/concepts/activity.md)、[等待与恢复](https://github.com/notnotype/neuro-book/blob/master/packages/nb-workflow/docs/features/waits.md)、[API](https://github.com/notnotype/neuro-book/blob/master/packages/nb-workflow/docs/api.md)。
