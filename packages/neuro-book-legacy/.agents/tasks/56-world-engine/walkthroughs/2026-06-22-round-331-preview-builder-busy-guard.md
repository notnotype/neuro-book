# Round 331 - Preview Builder Busy Guard

## Context

Round 330 已让主 IDE Workbench 的 Slice Composer Mutation Builder 在父层回流 busy 中禁用。继续检查独立 `/world-engine.preview` 时，发现 Preview 的 Builder 仍有同类旁路。

Preview 的 Project 切换、`loadWorld()`、写入 / 编辑 / 删除 / 查询会让 `loadingWorld` 或 `actionBusy` 进入请求飞行状态。Actions 表单外层已有 disabled，但 Builder 的父页面事件函数仍可被组件事件绕过，且通用 mutation 列表按钮组件没有显式 disabled prop。作者在 Preview 写入或加载世界回流期间继续点 Builder，可能改写正在自动更新的 `sliceForm.mutations` / `mutationBuilder`。

## Changes

- `world-engine.preview.vue`
  - 新增 `previewBuilderDisabled = loadingWorld || actionBusy`。
  - Preview Builder 入口统一检查 `previewBuilderDisabled`：
    - subject 载入查询
    - schema attr 快捷填充
    - slice 载入编辑
    - mutation 追加 / 替换 / 插入 / 复制 / 删除 / 移动
    - mutation 载入 Builder
    - Builder 字段更新
    - mutation load index 更新
  - `update-mutation-load-index` 事件改为走 `updateMutationLoadIndex()`，不再在模板里直接赋值。
- `WorldEnginePreviewActions.vue`
  - 向 `WorldEnginePreviewMutationBuilder` 传入 `:disabled="loadingWorld || actionBusy"`。
- `WorldEnginePreviewMutationBuilder.vue`
  - 新增 `disabled?: boolean` prop，并用 fieldset 包住内部表单。
  - 向 mutation list controls / action buttons 透传 disabled。
- `WorldEngineMutationListControls.vue` / `WorldEngineMutationActionButtons.vue`
  - 新增可选 `disabled` prop。
  - 载入、上下移动、追加、替换、插入、复制、删除等按钮在 disabled 时视觉和行为都禁用。
- `WorldEngineMutationBuilder.vue`
  - 主 Workbench Builder 也把已有 disabled 状态透传给通用 list controls / action buttons，保持视觉一致。
- `world-engine-ide-entry.test.ts`
  - 更新静态契约，锁住 Preview Builder 的函数层 guard 和事件 wrapper。

## Verification

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts` 通过：1 个测试文件、3 个测试。
- 未自动执行浏览器验收。

## Notes

本轮没有改变 Preview 的 API 请求顺序，也没有新增请求。只是把 Preview Builder 的可编辑入口和请求飞行状态对齐，减少作者在世界数据回流时改写草稿的错位风险。
