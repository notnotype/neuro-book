# 2026-06-20 Snapshot Tree And Draft Fixes

## Context

用户针对 `/world-engine.workbench-preview` mock 页面指出了 7 个具体问题：未编辑也进入草稿队列、Inspector State Snapshot 只显示一层、缺少 `sliceContext` i18n、Schema excerpt 价值低、Slice Card 的 subject 卡片只能点按钮聚焦、重复缺 key warning，以及 Sidebar 顶部 Schema 四个统计卡占用首屏。

本轮范围继续限定在 preview mock 页面，不接真实 API，不改后端 DTO。目标是先修掉错误行为和低价值 UI，再让状态检查与 subject 聚焦更接近真实工作台使用方式。

## Changes

- 修复 Inspector metadata draft 误入队列：
  - 切换 slice 时不再用当前 `props.slice` 比较旧 slice。
  - `persistMetadataDraft(previousSliceId, baseline)` 会按 `previousSliceId` 找到旧 slice baseline。
  - 只有 `time / title / summary / kind` 真正变化时才写入 `metadataDrafts`。
  - Draft Queue 和 Slice Card 的 metadata draft badge 不再因单纯选中切片而误出现。
- Inspector State Snapshot 改成多层可读结构：
  - 新增 Inspector 内部 `SnapshotTreeKind` / `SnapshotTreeNode` 展示模型。
  - 新增本地 `SnapshotTreeView`，支持 object / array / primitive / null。
  - object 显示字段数量，array 显示 item count，并可继续展开 index / key 层级。
  - raw JSON 折叠区保留为完整兜底。
- i18n 补齐：
  - `zh-CN.ts` 增加 `worldEngine.workbenchPreview.sliceContext: "切片上下文"`。
  - `en-US.ts` 增加 `worldEngine.workbenchPreview.sliceContext: "Slice Context"`。
- 删除低价值 UI：
  - 删除 Inspector 底部 `Schema excerpt` 区块。
  - 删除 Sidebar 顶部 Schema 的四个 type / attr 统计小卡片，只保留更轻的 Schema 标题与类型数量。
- Slice Card subject group 改为整卡可聚焦：
  - subject group 增加 `role="button"`、`tabindex="0"`。
  - 点击 subject group 主体即可聚焦对应 subject。
  - Enter / Space 键盘操作也会触发聚焦。
  - 原有“聚焦”和“只看 subject timeline”图标按钮继续 `stop`，避免冒泡触发整卡点击。
- 静态契约测试同步更新：
  - 覆盖 metadata draft baseline 比较路径。
  - 覆盖 Snapshot Tree helper / DOM 标识。
  - 覆盖 `sliceContext` locale key。
  - 移除 Schema excerpt、Sidebar schema type cards 的旧断言。
  - 覆盖 Slice Card subject group 的整卡点击与键盘聚焦。

## Verification

- `bunx vitest run app/utils/world-engine-workbench-preview.test.ts`：通过，5 个测试全部通过。
- `bun run typecheck`：通过。
- HTTP route smoke：`http://localhost:3000/world-engine.workbench-preview` 返回 200。

## Browser Verification

已用本机 Chrome + Playwright 做 headless smoke，关键结果如下：

```json
{
    "initialDraftQueue": 0,
    "draftQueueAfterSelect": 0,
    "snapshotTreeCount": 3,
    "schemaExcerptVisible": 0,
    "subjectGroupCount": 17,
    "mutationEditorExpanded": 1,
    "intlifyWarnings": []
}
```

这次 smoke 覆盖了：

- 选中 slice 后不修改 metadata，Draft Queue 不再出现 metadata 草稿。
- State Snapshot tree 正常渲染。
- Inspector 不再显示 Schema excerpt。
- Slice Card subject group 可点击聚焦，并能联动展开 Mutation Editor。
- 页面没有 `sliceContext` 缺失导致的 intlify warning。

## Notes

- 本轮实际结果与计划一致，所有 7 个问题都在 mock preview 范围内处理完成。
- Snapshot Tree 仍是 Inspector 内部展示结构，暂不抽通用组件；等真实 API 接入后再根据状态 DTO 和性能策略决定是否复用。
- 删除 Schema excerpt 后，右侧 Inspector 的第一屏更专注于当前 slice 元信息、触及主体和 State Snapshot。
