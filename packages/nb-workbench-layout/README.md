# @notnotype/nb-workbench-layout

工作台的布局层，建在 [`@notnotype/nb-layout`](../nb-layout/README.md) 的公开入口上；不发布。决策见 [ADR 0054](../../docs/adr/0054-nb-layout-general-library.md)，行为合同见 [`docs/specs/ui/workbench-layout.md`](../../docs/specs/ui/workbench-layout.md)。

```ts
import {projectLayoutDoc, resolveLayoutDrop} from "@notnotype/nb-workbench-layout";   // 纯 TS：布局文档、投影、落点规则
import {TabStrip} from "@notnotype/nb-workbench-layout/vue";                          // 标签条，依赖 nb-ui
```
