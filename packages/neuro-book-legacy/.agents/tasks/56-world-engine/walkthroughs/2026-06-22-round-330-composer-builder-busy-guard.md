# Round 330 - Composer Builder Busy Guard

## Context

继续按作者连续推演路径检查 Slice Composer：写入并继续下一步后，父 Workbench 会刷新 timeline、state、issues 和已知时间窗口。此时 `props.busy` 会传进 `WorldEngineMutationEditor`。

保存、载入所选 slice、切回新建模式等入口已经会在 `props.busy || saving` 中返回，但 Mutation Builder 的字段更新、schema shortcut、追加 / 替换 / 插入 / 复制 / 删除 / 移动 mutation、object 行编辑等入口仍只看 `saving`。作者在回流期间继续点 Builder，可能改到刚由“写入并继续下一步”生成的自动草稿，随后又被 usedTimes / schema / subject 回流影响，形成草稿错位。

## Changes

- `WorldEngineMutationEditor.vue`
  - 新增 `builderDisabled = props.busy || saving`。
  - Schema attr 快捷填充按钮在 `builderDisabled` 时禁用。
  - `WorldEngineMutationBuilder` 子组件的 `disabled` 改为接收 `builderDisabled`。
  - Builder 入口函数统一检查 `builderDisabled`：
    - `fillMutation`
    - `addBuilderMutation`
    - `insertAfterSelectedBuilderMutation`
    - `duplicateSelectedBuilderMutation`
    - `replaceSelectedBuilderMutation`
    - `deleteSelectedBuilderMutation`
    - `moveSelectedBuilderMutation`
    - `loadMutationToBuilder`
    - `updateBuilderField`
    - `updateMutationLoadIndex`
    - object row 增删改入口
- `world-engine-ide-entry.test.ts`
  - 更新静态契约，确认 Builder 入口不再只看 `saving`，而是对齐父层 `props.busy`。

## Verification

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts` 通过：1 个测试文件、3 个测试。
- 未自动执行浏览器验收。

## Notes

本轮没有禁止作者在父层回流期间继续阅读当前草稿；只禁用会改写 Builder / mutations JSON 的入口，减少连续推演保存回流与手动 Builder 操作抢状态。
