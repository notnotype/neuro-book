# Round 250: Save And Continue Subject Focus

## Context

继续审查 `写入并继续下一步` 的连续推演路径。Round 249 已避免父层刷新后重挂 Composer，但多 subject slice 还有一个默认目标漂移点：

- 子编辑器在继续模式下会把下一条草稿默认到刚保存 slice 的最后一个 mutation subject。
- 父层刷新 timeline 后会根据 selected slice 对齐 `focusedSubjectId`。
- 如果旧 focused subject 仍被刚保存的 slice 触及，父层会保留旧焦点。
- 子编辑器收到新的 `selectedSubjectId` 后，如果草稿仍是 clean，就会把下一条默认 mutation 改回旧 subject。

结果是作者写完一个跨 subject slice 后，下一条草稿可能从“刚刚操作的最后主体”跳回旧主体。

## Changes

- `WorldEngineWorkbenchDialog.vue`
  - `handleSliceComposerSaved()` 在 `continueAfterSave` 为真时，取本次保存 mutations 的最后一个 `subjectId`。
  - 如果该 subject 已注册到 World Engine，就先写入 `focusedSubjectId`。
  - 后续 `refreshWorldForCurrentTimeline()` / `applyDefaults()` 会沿用该焦点，避免刷新后把下一条草稿默认目标改掉。

- `world-engine-ide-entry.test.ts`
  - 增加静态契约断言，覆盖继续模式用最后一个 mutation subject 对齐父层焦点。

## Verification

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts`
- `bun run typecheck`

均通过。

## Browser

本轮未自动执行浏览器验证。后续实跑可覆盖：

- 新建一个包含多个 subject mutation 的 slice。
- 点击 `写入并继续下一步`。
- 确认下一条草稿默认 subject 保持为上一条最后一个 mutation 的 subject，刷新完成后不漂移。

## Result

实际结果与计划一致：只修连续推演时的 subject 默认目标漂移，不改后端、不新增测试面。
