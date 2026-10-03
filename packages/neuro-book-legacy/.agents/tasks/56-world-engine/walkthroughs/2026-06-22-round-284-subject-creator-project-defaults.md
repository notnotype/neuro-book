# Round 284: Subject Creator Project 默认值重置

## Context

继续检查“作者从新 Project 起步”的最早卡点。模板与 `ming-ding-zhi-shi-2` 的 `world-engine/schema.yaml` / `calendar.yaml` 都已存在，新 Project 能拿到基础 World Engine 配置；但手动创建 Subject 的表单只在 `time` 为空时套用 schema calendar example。

如果作者在同一个 Workbench 生命周期里切换 Project，Subject Creator 可能沿用上一个 Project 的 id/name/time。对自定义 calendar 的 Project，这会让第一步“创建 subject”带着旧项目时间提交，错误会晚到后端才出现。

## Changes

- `WorldEngineSubjectCreator.vue`
  - 增加 `lastAppliedDefaultTime`，区分“系统默认时间”和“作者手动改过的时间”。
  - schema 刷新时，只有当前 time 为空或仍等于旧默认值，才替换成新 schema 的默认 example。
  - Project 切换时重置表单为 `world / 世界 / 当前 schema 默认时间`，避免沿用上一个 Project 的 subject id/name/time。
- `world-engine-ide-entry.test.ts`
  - 补静态契约断言，确认 Subject Creator 有 Project 切换重置和 schema 默认时间保护。

## Validation

- `bunx vitest run app/utils/world-engine-ide-entry.test.ts`
- `bun run typecheck`

两项均通过。本轮未自动执行浏览器验证。

## Plan Diff

计划是核对新 Project / schema / subject 起步路径。实际发现并修复的是 Subject Creator 在 Project/schema 切换后的默认值残留问题；没有改 schema 文件格式、后端 API 或主体系统同步逻辑。
