# Round 241: 空 subject 过滤路径补齐 mode 复位

继续收口 subject filter 的隐藏模式残留。Round 240 已处理“清空 subject 过滤”和“进入 Drafts 草稿视角”两条显式回到整体世界的路径；本轮继续扫描所有直接改 `selectedSubjectIds` 的入口，补齐剩余三个空 subject 视角。

这些路径都不改变当前数据，但会让一个看不见的 `all` 模式留在会话态里，下一次多 subject 选择时突然生效。

## Changes

- `WorldEngineWorkbenchDialog.vue`
  - `applyDefaults()` 刷新数据后如果当前 selected subjects 被过滤成空，会把 `subjectFilterMode` 复位为 `any`。
  - 典型场景：Project 刷新、subject discovery 变化、切换 Project 后旧 subject id 不再存在。
- `world-engine.workbench-preview.vue`
  - `removeSubjectFilter()` 移除最后一个 subject chip 后复位 `subjectFilterMode` 为 `any`。
  - `restoreLocalDraft()` 恢复浏览器草稿时，如果草稿里的 subject ids 已全部失效，忽略草稿里的旧 subject mode，复位为 `any`。
- `world-engine-ide-entry.test.ts`
  - 补真实 Workbench 静态契约断言。
- `world-engine-workbench-preview.test.ts`
  - 补 mock preview 静态契约断言。

## Validation

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-workbench-preview.test.ts`
- `bun run typecheck`

两项均通过。本轮未自动执行浏览器验证。

## Plan Diff

计划是继续沿清空 / 移除 subject 过滤路径查隐藏状态残留。实际没有改变 timeline 查询、slice 选择或后端 API，只把 subject filter 为空时的隐藏 mode 统一收敛到默认“任一 subject”。
