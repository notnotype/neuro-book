# t51 计划：分隔线的显示名（第 2 稿）

第 1 稿把三样放在一起，设计审查（Claude Sonnet，阻断 1、重要 5、建议 4，[证据](evidences/design-review.txt)）与 API 形状审查（Claude Sonnet，重要 6、建议 5，[证据](evidences/api-review.txt)）找出结构操作与离开的内容两样牵连很深：展平与拆分丢掉 `sizing`、按比例分的意图没有稳定单位、离开的内容与叶的保留互相依赖。三样难度差得远，拆成三个 Task 各自审：

- t51（本 Task）：分隔线的显示名；
- [t52](../t52-grid-structure-semantics/README.md)：结构操作的语义与 `setSize`（审查的结构那几条交给它）；
- [t53](../t53-leaving-contents/README.md)：离开的内容由库留住（审查的离开那几条交给它）。

## Context

- **为什么做**：开发者 2026-11-22 定的三样之一（[README](README.md) 的“决定”）。t44 的接入记录：`NestedGrid` 与 `Splitter` 都把相邻两块的 id 代进“调整 {before} 与 {after} 的宽度”，nb-story 读出来是“调整 nav 与 main 的宽度”，工作台是 `section:…`、`g0`。宿主只能把 id 起成人话，而 id 同时是身份。
- **依据**：`ui/nested-grid` 输出 143（文案）；`src/vue/NestedGrid.vue` 的 `sashProps`（两处 `text(...)`）与 `sashLookOf`（离开、冻结的分隔线沿用上一次的样子）；`src/vue/Splitter.vue:339`。
- **工作方式**：worktree `.worktree/w00026-t51-layout-api`。只改 `packages/nb-layout/`；宿主不改（nb-story 在 t45 用，工作台要用时另提：它的五个 e2e 与 `scripts/perf/layout-frames.ts` 按 id 匹配）。

## 关键设计

- `NestedGrid` 加属性 `paneLabel?: (id: string) => string | undefined`：读屏名称里相邻两块取它的返回；没给、返回 `undefined` 或空串时用节点 id（同现在）。分隔线挨着分支时同样问分支 id，宿主不给就是 id（文档写明）。
  - 形状取“按节点 id 问名字”，不学 `sashKind` 的“按分隔线问”：名字是节点的属性，同一块挨着几条线时名字一样，宿主一张表就够（API 形状审查第 9 条问过这一点）。
  - 冻结与离开的分隔线（交换里滑出去的、留着缩回去的）两侧已不在宿主的布局里，宿主按 id 查可能查不到：并进 `sashLooks` 的“上一次的样子”，用上一次的显示名（设计审查第 9 条）。
- `Splitter` 的面板配置加 `label?: string`，只用于读屏名称，缺省是面板 id。
- 文字仍经 `LAYOUT_TEXT_KEY`：显示名由宿主翻译好再给，库只代进 `{before}`、`{after}`。

## 测试

- `NestedGrid.dom.test.ts`：给了 `paneLabel` 时读屏名称用显示名；返回 `undefined` 或空串时用 id；挨着分支时问分支 id；冻结的分隔线用上一次的显示名。
- `splitter.dom.test.ts`：面板配置的 `label` 进读屏名称，没给时用 id。

## Spec 与文档改动

- `ui/nested-grid` 新增输出 152（分隔线的显示名，planned，实现后去掉）。
- nb-layout：`src/vue/NestedGrid.md`（属性与数据一节）、`src/vue/Splitter.md`（面板配置）、README 的“我要做 X”表加一行。
- `CHANGELOG.md` 的 `[Unreleased]` 新增一行：插件 SDK 重导出的 `NestedGrid` 多了 `paneLabel`。

## 切片

1. 全部改动一个提交；验证：nb-layout `typecheck`、`test`；应用的 `typecheck`（SDK 重导出）；`docs:check`。
2. 实现审查（Claude Sonnet，不阻塞）。

## 验收映射

| Spec | 覆盖 |
|---|---|
| `ui/nested-grid` 输出 152 | 上面两份 dom 测试 |

## 不做与风险

- 不做：宿主采用显示名（nb-story 在 t45；工作台另提）。
- 风险：无（缺省行为不变，属性可选）。
