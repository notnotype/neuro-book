# @notnotype/nb-layout

布局工具：布局树、尺寸求解、落点与拖动。决策见 [ADR 0044](../../docs/adr/0044-workbench-single-layout-tree.md) 与 [ADR 0054](../../docs/adr/0054-nb-layout-general-library.md)，行为合同见 [`docs/specs/ui/nested-grid.md`](../../docs/specs/ui/nested-grid.md)。工作台的布局文档与标签条在 [`@notnotype/nb-workbench-layout`](../nb-workbench-layout/README.md)。

```ts
import {createGrid} from "@notnotype/nb-layout";                 // 纯 TS：树、尺寸、落点，不依赖 Vue 与 DOM
import {NestedGrid, Splitter} from "@notnotype/nb-layout/vue";   // 组件与组合式函数，依赖 nb-ui
```
