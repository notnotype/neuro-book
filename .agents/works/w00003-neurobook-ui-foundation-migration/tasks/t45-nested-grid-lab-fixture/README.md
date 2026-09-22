---
schema: nbook.task/v2
taskId: t45-nested-grid-lab-fixture
---

# 嵌套 grid 的 Lab 静态 fixture 与真实浏览器验收

**状态：待实现。** [实施计划](../../storage-implementation-plan.md) 切片 3 的 Lab 验收增量：t37 收口几何/快照、t38 收口 Splitter 手势、t44 收口持久化宿主之后，用 nb-ui playground 的 Component Lab 提供**静态确定性**嵌套 grid fixture，并补齐四主题组合与桌面/`390 × 844` 的真实浏览器证据。
闭合后检查点 A（独立审查公共类型、身份、生命周期与插件消费）才能由 Leader 收口。

Work：[w00003](../../README.md)。
合同：[ui.nested-grid](../../../../../docs/specs/ui/nested-grid.md)（验收与 Smoke 节）、[grid API](../../../../../packages/nb-ui/src/components/layout/grid.md)、[Splitter](../../../../../packages/nb-ui/src/components/layout/Splitter.md)。
参考实现：`packages/nb-ui/e2e/splitter.spec.ts`（手势与主题/视口矩阵已固定）、`playground/app/component-lab/fixtures/SplitterFixture.vue`、`playground/app/component-lab/registry.ts`。

## 结果

Lab 里有一个可交互的确定性嵌套 grid fixture：外层左右分栏、右侧内层上下分栏，用户拖动/键盘调整 sash 时几何按两轴合同变化，页面给出**提交次数与主动/被动字段**的可观察事实；未知引用、畸形与高版本快照的恢复行为在同一 fixture 内以内存记录演示，不写任何产品存储。
真实浏览器（Playwright）在 nbook/macos 两主题各浅深色、桌面与 `390 × 844` 下验证几何与手势合同。

## 范围

- `packages/nb-ui/playground/app/component-lab/registry.ts`：登记新组件（建议 id `nested-grid`，中文名、分组、描述、场景、控件、事件名单、`targetSelector`）。
- `packages/nb-ui/playground/app/component-lab/fixtures/NestedGridFixture.vue`（新增；可用同目录 helper）。
- `packages/nb-ui/e2e/nested-grid.spec.ts`（新增）。
- 只在 fixture 内使用 `createGrid`/`Splitter` 的公开 API；允许给 Lab 新增纯展示 helper，不新增第二套几何或手势实现。

## 排除

- 不改 `packages/nb-ui/src/**`（t37/t38 已收口）；发现原语缺陷写复现报告，由 Leader 分派修复，不在本 Task 改。
- 不改 NeuroBook 主应用、`app/utils/**`、服务端与 Storage 合同；Lab fixture 不读写产品存储、不发 HTTP、不落 localStorage 产品键。
- 不动 `packages/nb-ui/e2e/visual.spec.ts` 既有截图基线（除非新增截图属于本 Task 自己的新文件）。
- 不联网、不提交/push、不访问 `http://localhost:3001/`；用户两个 dirty descriptors 与本 Task 无关。

## 实现要求

1. **确定性 fixture**：默认布局、容器尺寸与初始记录固定可复述；同一 scene 两次加载呈现一致；不依赖随机、时间或外部数据。
2. **两轴几何可观察**：外层主要求与内层高分别可见（例如总宽、各叶尺寸、每条 sash 的实际像素）；外层调整只改变外层轴，内层调整不改变外层列宽；`issues`/降级诊断在不可满足约束时可见，不制造负值或溢出。
3. **手势边界可观察**：鼠标拖动、键盘连发、`Escape`、`Enter` 各自产生一次或零次提交；主动字段与被动补偿分别展示（消费 `gesture-end.active`/`compensated`，不用整份 sizes 冒充偏好）；程序布局、挂载、视口变化、测量不产生提交。
4. **快照恢复场景**：至少三个静态 scene 用内存记录演示——(a) 未知引用：呈现过滤但记录原件保留，后续调整已知节点不抹掉未知部分；(b) 畸形/重复身份：整体拒绝、不半更新、不抛未捕获异常；(c) 不兼容高版本（v1 与更高版本）：拒绝恢复并保留原件。三者都不得写盘。
5. **窄屏**：`390 × 844` 下结构与桌面一致、无横向溢出；约束不足时给诊断而不是负值。
6. **主题**：只消费 nb-ui 语义 token；两主题各浅深色呈现正常（不硬编码颜色）。
7. **不新增第二约定**：事件与检查器接线沿用 `FixtureShell` 与既有 Lab 规范。

## 验证与交付

- `packages/nb-ui/e2e/nested-grid.spec.ts` 覆盖：外层拖动守恒与内层高不变、内层拖动不改外层宽、键盘连发单次提交、`Escape` 零提交、程序布局零提交、三个恢复场景、四主题组合 × 桌面/`390 × 844` 的几何与一次键盘调整。
- 开发期按 `bunx playwright test e2e/nested-grid.spec.ts`（`packages/nb-ui` 绝对 cwd）跑到通过；全量 `bun run test:e2e` 与 `bun run test` 由 Leader 统一复跑。
- 报告写 `walkthroughs/implementation.md`：真实命令、cwd、退出码、用例数、场景清单、截图或几何证据、未运行项与偏差；不得高于实际覆盖。
- 最终回复具体结果，不返回空文本或句点。

## 继续条件

检查点 A 由独立 Reviewer 复核宿主边界与消费者；本 Task 只提供 Lab 与浏览器证据，不声明 `ui.nested-grid` 仍为 planned 的状态被晋升。
