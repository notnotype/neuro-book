# Round 126 - Profile Default Contract

## Context

上一轮已完成 World Engine 新路线的大部分收口：旧 re-settle UI / DTO / 请求已移除，Preview 与 Workbench 改为展示 `issues`，后端已支持 `deleteSlice`、读时 `dangling-ref` E issue 和 `createSubject` 空 default 不创建空切面。

本轮继续做静态收尾核查，重点确认当前代码、稳定文档和 profile 中是否还有旧 re-settle / old 值 / rollback 语义残留。

## Work Done

- 复查当前代码与文档关键词：
  - `resettle` / `re-settle` / `needsResettle` / `affectedSubjects` / `affectedMutations` / `reSettledMutations` 当前只剩任务 README 的历史 walkthrough 链接和历史说明。
  - `correction` / `bootstrap` 在当前 World Engine 代码和稳定任务文档范围内没有命中。
  - `old` 命中均为 `old-sword` 示例、无关测试文本或非 World Engine 文件工具语义，不是 mutation old value 字段。
- 修正 `assets/workspace/.nbook/agent/profiles/builtin/world.engine.profile.tsx`：
  - 原提示词写成 `create_world_subject` 会把 schema default 写入 init slice。
  - 现改为：只有 schema default 非空时才写入 init slice，空 default 类型只注册 subject 身份。
- 更新 `server/agent/profiles/world-engine-profile.test.ts`，断言 profile system prompt 包含这条第一版边界。
- 运行单文件 profile 编译器，重新生成 `world.engine` runtime artifact，避免 catalog 继续加载 stale compiled profile。
- 更新 `docs/tasks/56-world-engine/README.md` 与 `PROJECT-STATUS.md` 到 round-126。

## Verification

- `bunx vitest run server/world-engine/world-engine.facade.test.ts server/api/projects/world-engine/[...segments].test.ts server/agent/tools/world-engine-tools.test.ts server/agent/profiles/world-engine-profile.test.ts`
  - 4 files / 53 tests passed
- `bunx vitest run app/utils/world-engine-preview.test.ts app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-workbench-preview.test.ts`
  - 3 files / 21 tests passed
- `bun run typecheck`
  - passed

## Notes

- 本轮没有执行浏览器验收；按项目规则，真实 Preview / 主 IDE Workbench 浏览器验收仍等待用户明确授权。
- 这次实际结果与计划一致，只额外发现并修复了 profile 提示词与 round-117 `createSubject` 后端契约之间的小偏差。
