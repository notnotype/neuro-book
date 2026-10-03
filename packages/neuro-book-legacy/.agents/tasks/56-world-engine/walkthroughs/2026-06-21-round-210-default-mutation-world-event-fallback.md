# Round 210: 默认手写切片回退到 world.events

## Summary

继续按作者真实流程对账 `ming-ding-zhi-shi-2`：项目级 `world-engine/schema.yaml` / `calendar.yaml` 已存在，后端 facade 可读到 5 类 schema、7 个 World Engine subject、6 个初始化 slice，`player` 查询 issues 为空。但当前真实 Project 还没有 `event/backstory` 推演切片；如果作者在主 Workbench 选中 `player` 后点击“新建 Slice”，默认 mutation 会因为 `character` 没有 `events` 字段而落到第一个属性 `hp`，第一屏显示 `player.hp set 100`，不符合“继续推演下一步剧情”的入口预期。

## Changes

- `app/utils/world-engine-preview.ts`
  - `defaultMutationForPreviewSubject()` 仍优先使用当前 subject 类型的 `events` 字段。
  - 如果当前 subject 没有 `events`，但项目里存在 `world` subject 且 `world` schema 有 `events` 字段，则默认 mutation 回退到 `world.events listAppend`。
  - 如果没有 `world.events`，继续使用当前 subject 的第一个属性，避免跨到其它角色的 `events`。
- `app/utils/world-engine-preview.test.ts`
  - 补一条行为断言：当前选中 `player`，`character` 只有 `hp`，但项目存在 `world.events` 时，默认草稿应写到 `world.events`。

## Verification

- `bunx vitest run app/utils/world-engine-preview.test.ts`
  - 1 file passed, 19 tests passed.
- `bun run typecheck`
  - passed.

## Notes

- 本轮没有修改真实 Project 数据，也没有自动执行浏览器验证。
- 实际计划与结果的出入：原本只是检查保存草稿是否残留；读侧对账后发现更靠近作者流程的卡点是“选中真实角色后默认新建 slice 指向 hp”，因此改为修默认 mutation 生成规则。
