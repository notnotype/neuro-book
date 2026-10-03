# Round 24 - queryState.listLimit schema-aware 裁剪

## 背景

本轮继续按「代码审查 -> 修复」推进 World Engine。此前 `queryState.listLimit` 的设计目标是限制 `events` 这类会持续增长的 `list` / `collection` 属性，避免 Agent 或 UI 一次拉出过长列表。

审查 `WorldEngineService` 时发现当前实现会递归裁剪所有数组。风险是：如果某个普通 `object` 属性里保存数组形数据（例如 profile.aliases、tags、外部导入结构），只要查询传了 `listLimit`，这些数组也会被误裁剪。

## 本轮计划

1. 将 `listLimit` 改为 schema-aware：只裁剪 schema 声明为 `list` / `collection` 的属性。
2. 保留 object 内字段递归能力：只有 object.fields 里明确声明成 `list` / `collection` 的子字段才裁剪。
3. 补回归测试，证明普通 object 内数组不会被误裁。

## 实现

- 更新 `server/world-engine/world-engine.service.ts`：
  - `queryState()` 在应用 `listLimit` 时传入当前 subject type 和 world schema。
  - 移除原先无 schema 的 `limitArrays()` 递归裁剪。
  - 新增 `limitBySchema()`，按 `WorldAttrSchema.kind` 判断是否裁剪。
  - 对未声明属性、普通 scalar、普通 object 内数组只做 JSON clone，不裁剪。
- 更新 `server/world-engine/world-engine.facade.test.ts`：
  - 新增用例：`events` 是 schema 声明的 `list`，会被 `listLimit: 1` 裁成最近一条。
  - `profile` 是普通 `object`，其中 `aliases/tags` 数组保持完整。

## 验证

- `bunx vitest run server/world-engine/world-engine.facade.test.ts server/api/projects/world-engine/[...segments].test.ts server/agent/tools/world-engine-tools.test.ts app/utils/world-engine-preview.test.ts`
  - 4 个测试文件通过。
  - 32 个测试用例通过。
- `bun run typecheck`
  - 通过。

## 与计划的出入

本轮原本是继续审查 World Engine 的查询语义，实际修复点集中在 `queryState.listLimit`。没有启动浏览器验证；项目指令要求不要自动浏览器验证，仍需用户确认后再打开 `/world-engine.preview` 做真实页面验收。

## 后续

- 继续等待用户确认后做浏览器验证：新建 Project、跑一键示例世界、编辑过去 slice、显式 re-settle，并从用户视角评估体验。
- 后续正式 UI 里，`listLimit` 可以暴露成“长列表取最近 N 条”，但不应让用户误以为会裁剪所有数组。
