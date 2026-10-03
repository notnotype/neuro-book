# Round 116 - Preview Action Issues

## Context

继续按“实现 -> 测试 -> 浏览器测试 -> 代码审查”的循环推进 World Engine 新路线。浏览器验收仍需要用户明确允许，因此本轮先做静态代码审查和完成度审计。

审查时发现独立 `/world-engine.preview` 虽然已经读取 `{sliceId, issues}` / `{issues}`，但写入结果主要藏在右侧 JSON，删除 slice 返回的 issues 还会临时写进 `stateIssues`。这会把“本次操作反馈”和“State Query 结果问题”混在一起，真实使用时容易误判 issue 来源。

## Changes

- `world-engine.preview.vue` 增加 `actionIssues` 状态，写入 slice、编辑 slice、一键示例世界和删除 slice 都把返回的 issues 放入该通道。
- 手动 `queryState()` 成功后清空 `actionIssues`，避免旧操作反馈长期占据页面；删除 slice 后触发的自动查询会保留删除返回 issues。
- 删除 slice 不再把删除返回值写入 `stateIssues`，`stateIssues` 只表示当前 State Query 返回的问题。
- `WorldEnginePreviewStatePanel.vue` 增加“本次操作 issues”展示区，与 “State Query issues” 分开。
- `world-engine-ide-entry.test.ts` 增加静态入口断言，确认 Preview 页面和 State Panel 保留 action issues 展示。

## Verification

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-preview.test.ts`：通过，2 files / 17 tests。
- `bunx vitest run app/utils/world-engine-workbench-preview.test.ts server/world-engine/world-engine.facade.test.ts 'server/api/projects/world-engine/[...segments].test.ts' server/agent/tools/world-engine-tools.test.ts server/agent/profiles/world-engine-profile.test.ts`：通过，5 files / 53 tests。
- `bun run typecheck`：通过。
- 静态核查确认 `stateIssues.value = deleteIssues` 已不存在，Preview action issues 入口存在。

## Browser Validation

未执行。项目指令要求不要自动浏览器验证，本轮没有获得用户明确授权。

授权后下一轮应在真实浏览器中跑：

- 独立 Preview：新建 Project、创建示例世界、写 slice、编辑 slice、删除 slice、查询 state、观察 action issues 与 State Query issues 是否分离。
- 主 IDE Workbench：从当前 Project 打开工作台，重复写 / 编辑 / 删除 / 查询链路，确认 issues、Timeline badge 和 Selected Slice 检查器体验。

## Notes

本轮属于代码审查后的可用性修复，不改变后端 DTO、API 路由或 World Engine 数据模型。
