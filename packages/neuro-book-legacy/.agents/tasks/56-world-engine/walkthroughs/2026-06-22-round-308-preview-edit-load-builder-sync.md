# Round 308 - Preview Edit Load Builder Sync

## 背景

独立 `/world-engine.preview` 已经支持从 timeline 载入已有 slice 编辑，也在 round 305 接上了多 mutation 单条编辑控件。但复查真实编辑路径时发现：点击“载入编辑”只会替换 textarea 里的 mutations JSON，Builder 表单仍可能停在之前的 subject / attr / op / value。

作者看到的结果是：textarea 已经是目标 slice，但 Builder 和 mutation selection 指向旧上下文，下一次“替换所选”或“追加”容易误操作。

主 IDE Slice Composer 之前已经补过载入编辑时同步 Builder，本轮把独立 Preview 对齐。

## 实际变更

- `app/pages/world-engine.preview.vue`
  - `loadSliceForEdit()` 设置 `mutationLoadIndex = "0"`。
  - 如果目标 slice 有 mutations，载入后静默调用 `loadMutationToBuilder(0, false)`。
  - `fillMutation()` 通过 schema 快捷填充时同步重置 selection。
  - `applyDefaultSliceMutation()` 生成默认草稿时同步重置 selection。

- `app/utils/world-engine-ide-entry.test.ts`
  - 增加静态契约断言，确认 Preview 载入 slice 编辑后会同步第一条 mutation 到 Builder。

## 验证

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts`

通过。

## 与计划出入

- 本轮没有修改后端、API 或主 Workbench。
- 本轮没有自动浏览器验证，符合当前约定。
