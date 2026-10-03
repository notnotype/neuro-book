# Round 130 - Create Subject Source Comments

## Context

继续做真实浏览器验收前的静态审查。本轮审查 Workbench / Preview 状态同步时，顺手发现源码层仍有旧注释暗示 `createSubject` 会把 schema default 写入 init slice，但没有表达“没有 default 不创建空切面”的当前契约。

运行逻辑在 round-117 已经正确：无 default 时只注册 subject 身份；有 default 时才创建或追加 init mutation。本轮只收口源码注释和类型说明。

## Work Done

- 更新 `server/world-engine/world-engine.service.ts`：
  - `createSubject()` 注释改为“只有 schema default 非空时才写入 init slice，空 default 类型只注册身份”。
- 更新 `server/world-engine/types.ts`：
  - `CreateWorldSubjectResult` 注释改为“创建（非空 default 写 init slice）时产生的问题”。
- 更新 `docs/tasks/56-world-engine/README.md` 与 `PROJECT-STATUS.md` 记录 round-130。

## Verification

- `bunx vitest run app/utils/world-engine-preview.test.ts app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-workbench-preview.test.ts`
  - 3 files / 21 tests passed
- `bunx vitest run server/world-engine/world-engine.facade.test.ts server/api/projects/world-engine/[...segments].test.ts server/agent/tools/world-engine-tools.test.ts server/agent/profiles/world-engine-profile.test.ts`
  - 4 files / 53 tests passed
- `bun run typecheck`
  - passed
- 旧表述核查：
  - `rg -n "创建 subject，并把 schema default|创建（写 init default）|subject 创建生成「初始化切面」|when schema defines defaults|总会创建初始化切面" server/world-engine docs/tasks/56-world-engine server/agent assets/workspace/.nbook/agent/profiles/builtin/world.engine.profile.tsx -g '!docs/tasks/56-world-engine/walkthroughs/**'`
  - no matches

## Notes

- 本轮没有执行浏览器验收；真实 Preview / 主 IDE Workbench 验收仍等待用户明确授权。
- 实际结果与计划一致：这是源码注释契约收口，没有改变后端行为。
