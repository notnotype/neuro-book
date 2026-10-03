# Round 114 - Review Fixes

## Context

本轮是在 round-113 新路线收敛后做代码审查补漏。核心契约保持不变：无旧值字段、写入 / 编辑 / 删除 / 查询都通过 `issues` 暴露 E/A 问题，前端不再提供旧后续处理入口。

## Changes

- 修复主 IDE Workbench 的一键示例世界：示例 slice 写入现在读取 `SliceWriteResultDto`，把返回的 `issues` 写入 `lastActionIssues` 并在成功提示中显示 issue 数。
- Workbench 一键示例世界在随后自动查询示例状态后会恢复写入返回的 `lastActionIssues`，避免 `querySelectedState()` 清空本次操作 issue 展示。
- 修复独立 Preview 的一键示例世界：最终成功提示会保留写入返回的 issue 数，不再只显示“已创建示例世界”。
- 移除 Workbench mock 预览中残留的 `correction` kind：Inspector 下拉只保留 `init` / `event` / `backstory`，mock 示例 slice 也改为 `backstory`。
- 清理 Preview 代码注释和当前状态文档中残留的旧交互表述；历史 walkthrough 文件名和历史链接保留。
- 静态入口测试补充断言，覆盖 Preview / Workbench 一键示例 issue 反馈的关键代码片段。

## Verification

- `bunx vitest run app/utils/world-engine-preview.test.ts app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-workbench-preview.test.ts`：通过，3 files / 18 tests。
- `bun run typecheck`：通过。
- `bunx vitest run server/world-engine/world-engine.facade.test.ts 'server/api/projects/world-engine/[...segments].test.ts' server/agent/tools/world-engine-tools.test.ts server/agent/profiles/world-engine-profile.test.ts`：通过，4 files / 52 tests。
- 关键词核查：旧字段 / 旧交互词只剩历史 walkthrough 链接和 `old-sword` 示例；`correction` / `bootstrap` 在 active World Engine 文档与前端中无命中。
- 浏览器验收未自动执行；需用户明确允许后再跑 Preview 与主 IDE Workbench 真实流程。
