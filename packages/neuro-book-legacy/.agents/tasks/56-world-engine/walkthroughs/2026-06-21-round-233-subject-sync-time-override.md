# Round 233: 主体系统同步初始化时间可覆盖

继续沿同步主体系统的真实恢复路径推进。Round 231 已把“初始化时间已有非 init slice”的错误文案转成 UI 行动，提示作者可以载入该时间 slice 显式合并，或把初始化时间改到相邻时间。但当时面板只有只读时间，没有可编辑入口；这会让“改初始化时间”成为半截提示。

本轮补齐最小交互：默认策略不变，仍优先使用 schema calendar 的第一个示例时间；作者需要恢复冲突时，可以在待接入面板里覆盖本次同步时间。

## Changes

- `WorldEngineWorkbenchDialog.vue`
  - 新增 `subjectSystemSyncTimeOverride`。
  - 新增 `subjectSystemDefaultSyncTime`，保留原默认时间来源：`schema.calendar.examples[0]`，缺失时回退当前选中 slice 时间。
  - `subjectSystemSyncTime` 改为优先使用用户输入的覆盖时间，空输入时使用默认时间。
  - `主体系统待接入` 面板把“初始化时间”从只读文本改为输入框，placeholder 显示默认时间。
  - Project 切换或关闭 Dialog 时清空覆盖时间，避免跨 Project 串线。
- `world-engine-ide-entry.test.ts`
  - 补静态契约断言，确认 override 状态、默认时间和输入框仍存在。

## Validation

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts`
- `bun run typecheck`

两项均通过。本轮未自动执行浏览器验证。

## Plan Diff

计划是补齐上一轮错误提示指向的真实操作入口。实际改动没有改变后端 `createSubject` 规则，也没有把默认初始化时间改成当前 slice；只是让作者可以在必要时覆盖本次批量同步的 time。
