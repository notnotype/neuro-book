# nb-workflow

`@notnotype/nb-workflow` is a journaled scripted workflow engine. A workflow is an ordinary `async` function. Activity identity, input and output are written to a journal, so completed steps are not repeated after process recovery.

```ts
import {MemoryActivityExecutor, WorkflowRunner} from "@notnotype/nb-workflow";

const activities = new MemoryActivityExecutor();
activities.registerAction("math.double@1", ({value}: {value: number}) => ({value: value * 2}));
const runner = new WorkflowRunner({}, {}, {activities});
```

Activity references require explicit versions. Memory implementations are for tests and demos only. Agent, Session and Workspace capabilities enter through `SessionPort`, `AgentPort` and `WorkspacePort`. Continue with [Activities and replay](https://github.com/notnotype/neuro-book/blob/master/packages/nb-workflow/docs/concepts/activity.md), [wait and recovery](https://github.com/notnotype/neuro-book/blob/master/packages/nb-workflow/docs/features/waits.md), and the [API reference](https://github.com/notnotype/neuro-book/blob/master/packages/nb-workflow/docs/api.md).
