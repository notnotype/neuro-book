# t20 计划

## Context

开发者 2026-11-27 看 t19 合入后的页面提了 6 点，三处缺陷已在 t19 收尾修掉。本计划先写第 1 项“归位后再浮动记住尺寸”（开发者同意做）；第 2、3 项等评审板定了再补进来。

合同：[`ui/workbench-layout.md`](../../../../../docs/specs/ui/workbench-layout.md) 输出 39 的“记住矩形”（planned，本 Task 写）。

## 技术选型

无。

## 关键设计

### `packages/nb-workbench-layout/src/layout-doc.ts`

- `LayoutDoc` 加正式可选字段 `floatRects?: Readonly<Record<string, LayoutFloatRect>>`，键是工具视图的标签键 `view:<id>`。按视图记，不记在分节或锚上：视图在区域之间、容器之间搬来搬去时记录不丢，也不用在每种搬法里各搬一次。
- 结算放在结构操作的出口 `finish`，与 `settleRails` 并列的 `settleFloatRects(original, next)`：`original` 里的浮动窗在 `next` 里不再浮动，它的每个工具视图标签在 `next` 里落在树里（不是别的浮动窗）时，写 `floatRects[key] = 窗的记录矩形`（收着的矩形，不含侧轨展开的差值）；然后删掉 `next` 里已经没有这个标签的键；删空了整个字段不写。拖回、按钮归位、并进树里的面板都经 `finish`，不在各操作里各写一份。
- `sameLayoutShape` 的比较形加上 `floatRects`（键排序后比矩形）。

### `packages/nb-workbench-layout/src/layout-doc-validate.ts`

- 归一 `floatRects`：不是对象整个丢；键不是 `view:` 开头、是禁用 id、值不是合法矩形（`isFloatRect`）的项丢掉，记进 `repairs`；修完空了不写。标签不在文档里的项读入时不删（视图目录还没交进来时也会这样），等下一次提交的出口清。

### `packages/neuro-book/src/plugins/workbench/web/state/layout-doc-store.ts`

- `floatTab(key)`：`key` 是工具视图、`doc.floatRects?.[key]` 在时用它，不调 `defaultFloatRect`；编辑器标签照旧。呈现的夹取与侧轨差值照旧在 `renderedFloats`。

## Spec 与文档改动

- `docs/specs/ui/workbench-layout.md` 输出 39 加“记住矩形”（planned），“副作用与数据”加一句不改版本。
- `nb-workbench-layout` 的 README 或文档模型说明里有字段清单的话同步。

## 切片

1. 库：字段、结算、形状比较、校验归一，单测（`layout-doc.test.ts`、`layout-doc-validate` 的用例）。
2. store：`floatTab` 用记下的矩形；store 的真实存储往返用例（浮出、调大小、归位、再浮出，刷新后再浮出）。
3. e2e：`agent-messages-float` 加一条：调宽、归位、再浮出是调过的宽，展开状态照旧带着。

## 验收映射

- 输出 39“记住矩形”：库单测（归位、拖回、并进树里的面板记；并进别的浮动窗不记；视图没了清掉；编辑器不记）、校验单测（坏项丢掉给诊断）、store 用例（再浮出用记下的、刷新后还在）、e2e 一条。

## 验证

- `bun test` 跑 `nb-workbench-layout` 与工作台 store；`agent-messages-float.e2e.ts`、`workbench-float` 相关 e2e 文件。
- 数据格式改动：实现审查按快速审查（Opus 先审，omp `@review` 后台）。

## 不做与风险

- 编辑器标签不记：编辑器的浮出与归位走编辑器区，标签是动态的。
- 多标签的窗每个视图记同一个矩形，之后单独浮出其中一个时用整窗的大小。
