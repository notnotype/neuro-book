# 2026-06-19 Mock Preview

## Scope

- 新增 `/world-engine.workbench-preview`，用于验证 World Engine Workbench 的新 UI / UX。
- 本轮只做 mock 数据，不接真实 API，不替换旧 `/world-engine.preview` 调试台，也不修改主 IDE 内嵌 Workbench。
- mock 数据尽量贴近实际 World Engine DTO：schema projection、`WorldSubjectDto`、`WorldSliceDto`、mutation、reduce 后 state snapshot。

## Changes

- 新增页面：
  - `app/pages/world-engine.workbench-preview.vue`
- 新增 mock 数据与测试：
  - `app/utils/world-engine-workbench-preview-mock.ts`
  - `app/utils/world-engine-workbench-preview.test.ts`
- 新增组件：
  - `app/components/novel-ide/world-engine/workbench-preview/world-engine-workbench-preview.types.ts`
  - `app/components/novel-ide/world-engine/workbench-preview/WorldEngineWorkbenchPreviewSidebar.vue`
  - `app/components/novel-ide/world-engine/workbench-preview/WorldEngineWorkbenchPreviewSliceList.vue`
  - `app/components/novel-ide/world-engine/workbench-preview/WorldEngineWorkbenchPreviewSliceCard.vue`
  - `app/components/novel-ide/world-engine/workbench-preview/WorldEngineWorkbenchPreviewInspector.vue`
  - `app/components/novel-ide/world-engine/workbench-preview/WorldEngineWorkbenchPreviewMutationEditor.vue`

## UX Result

- 左侧栏展示 schema 摘要、subject type / attr 快捷信息和 subjects；支持多 subject 过滤与收起。
- 中间上半区展示世界切片列表，支持整体世界视角和 subject 过滤；切片卡片突出 `title` / `summary` / `kind`，并将 mutations 按 subject 分组。
- 中间下半区是可收起 Mutation Editor；支持总视图和 subject 视图，subject 视图展示当前 slice 时刻该 subject 的状态与 mutation 变更，并支持跳到上 / 下一个相关 slice。
- 右侧 Inspector 可隐藏；展示 slice 元信息、可本地编辑并“应用到预览”，同时展示当前触及 subjects 的 snapshot，并提供完整世界状态展开。

## Technical Workbench Refinement

- 视觉方向改为 World Engine 专属技术工作台：浅灰 / 白底、绿色选中态、蓝灰数据区；preview route 内局部映射主题变量，不影响全局 IDE 主题。
- 顶栏压实为 project、calendar、同步状态、reset 和 Inspector 开关；mock 标签降权。
- 左侧栏改为 subject-first：Schema 只保留紧凑摘要，Subjects 行项目展示 name / id / type，选中态使用绿色描边和浅绿底。
- 切片列表增加时间轴竖线和节点；切片卡片改为紧凑数据卡，按 subject 展示 `attr / op / value` 表格。
- Mutation Editor 降低最大高度，subject 视图与总视图都改成更密的数据面板。
- Inspector 改为 `Slice Context`，State Snapshot 默认聚焦触及 subjects，raw state JSON 折叠；新增 `Schema excerpt` 展示当前触及 subject types 的 attr chips。

## Verification

- `bun run typecheck`：通过。
- `bunx vitest run app/utils/world-engine-workbench-preview.test.ts`：通过。

## Notes

- 页面顶层的 slice / snapshot 状态使用 `shallowRef`，避免递归 JSON 状态触发 Vue 深层类型展开。
- 本轮没有做浏览器真实验收；项目规则要求用户确认后再执行浏览器验证。
