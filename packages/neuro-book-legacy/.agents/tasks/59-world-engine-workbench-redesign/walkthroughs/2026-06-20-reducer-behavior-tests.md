# 2026-06-20 Reducer Behavior Tests

## Scope

本轮继续优化 `/world-engine.workbench-preview` 的 mock 编辑底座，不接真实 API，不改后端 DTO。重点把上一轮抽出的 mock reducer 从静态契约检查推进到真实行为测试。

## Finding

`world-engine-workbench-preview-state.ts` 已经承载 mutation value patch 和 mock snapshot reduce，但测试仍主要检查文件中是否包含关键字符串。对于编辑型 workbench 来说，这不足以证明用户改 mutation value 后，右侧 State Snapshot 会保持正确。

尤其需要保护的路径是相对 mutation：

- `add`
- `listAppend`
- `collectionAdd`
- `collectionRemove`

如果 reducer 从已经 reduce 后的 snapshot 再叠加 mutation，第一张或中间 slice 的相对变更会被重复应用。

## Changes

- `app/utils/world-engine-workbench-preview.test.ts` 引入 mock 数据和 reducer util。
- 新增 reducer 行为测试：
  - 从 schema default 和 slices reduce 出稳定 snapshots。
  - `erina` 在初始 slice 继承 `hp / inventory / events` 默认值。
  - `slice-erina-arrives` 后 `old-sword.durability` 为 95。
  - `slice-east-tower-opened` 后 `old-sword.durability` 为 80。
  - `slice-old-sword-backstory` 后 `old-sword.durability` 被绝对值 set 回 82。
- 新增 mutation value patch 行为测试：
  - 修改 `capital.name` 后，当前及后续 snapshot 都显示 `新王都`。
  - 修改 `slice-erina-arrives` 的 `old-sword.durability add -5` 为 `-10` 后，后续 snapshot 为 90 / 75 / 82，证明相对 mutation 没有重复叠加。
  - `collectionAdd` 后 `erina.inventory` 仍只有一个 `subject://old-sword`。

## Verification

- `bunx vitest run app/utils/world-engine-workbench-preview.test.ts`
  - 1 file passed
  - 3 tests passed
- `bun run typecheck`

## Browser Check

- 本轮做了浏览器挂载确认。
- 页面正文可读到完整 Workbench 内容，包括 `World Engine Workbench Preview`、Slice List、Subjects 和 Mutation 内容。
- 自动化 selector 读数仍混有旧 HMR 日志和 tab 上下文不一致，未作为完整浏览器交互通过记录。

## Plan Deviation

- 原本计划先做轻量浏览器确认；由于上一轮已经发现 reducer 行为风险，本轮优先补强行为测试。这个偏移是为了让 mock 编辑闭环更可信，避免 UI 看起来能编辑但底层状态不可靠。

## Next Notes

- 后续可以继续把 Mutation Editor 的 value parser 抽成 util 并补行为测试，特别是 JSON-like 字符串、数字、布尔、null 的解析边界。
- 浏览器自动化环境最好在下一轮先清理旧 tab 或重启 dev server 后再做完整点击链路。
