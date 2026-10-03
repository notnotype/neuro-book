# Round 127 - Create Subject Tool Doc Contract

## Context

Round 126 已修正 `world.engine` profile：`create_world_subject` 只有 schema default 非空时才写入 init slice；空 default 类型只注册 subject 身份。

本轮继续静态核查时发现，稳定文档和 Agent 工具描述中仍有几处容易被读成“创建 subject 总会创建初始化切面”的表述。

## Work Done

- 更新 `docs/tasks/56-world-engine/README.md`：
  - `default 进切面` 决策改为：subject 创建时如果 schema 声明了非空 `default`，生成或追加 init mutation；没有 default 时只注册 subject 身份，不创建空切面。
- 更新 `docs/tasks/56-world-engine/sqlite-and-api.md`：
  - `createSubject()` facade 注释同步为“非空 default 才写 init；没有 default 不创建空切面”。
- 更新 `server/agent/tools/world-engine-tools.ts`：
  - `create_world_subject` 工具描述改为 non-empty schema defaults 写入 init slice，否则只注册 subject identity。
- 更新 `server/agent/tools/world-engine-tools.test.ts`：
  - 在工具注册测试中断言 `create_world_subject` 描述包含 `otherwise only the subject identity is registered`，避免后续提示词 / 工具描述漂回旧语义。
- 更新 `PROJECT-STATUS.md` 记录 round-127 状态。

## Verification

- `bunx vitest run server/agent/tools/world-engine-tools.test.ts`
  - 1 file / 6 tests passed
- 首次组合运行：
  - `bunx vitest run server/world-engine/world-engine.facade.test.ts server/api/projects/world-engine/[...segments].test.ts server/agent/tools/world-engine-tools.test.ts server/agent/profiles/world-engine-profile.test.ts`
  - 出现 Vitest worker 异常退出，3/4 test files passed，未出现业务断言失败。
- 拆分复跑：
  - `bunx vitest run server/world-engine/world-engine.facade.test.ts`
    - 1 file / 39 tests passed
  - `bunx vitest run server/api/projects/world-engine/[...segments].test.ts`
    - 1 file / 6 tests passed
  - `bunx vitest run server/agent/tools/world-engine-tools.test.ts server/agent/profiles/world-engine-profile.test.ts`
    - 2 files / 8 tests passed
- `bunx vitest run app/utils/world-engine-preview.test.ts app/utils/world-engine-ide-entry.test.ts app/utils/world-engine-workbench-preview.test.ts`
  - 3 files / 21 tests passed
- `bun run typecheck`
  - passed

## Notes

- 本轮仍未执行浏览器验收；真实 Preview / 主 IDE Workbench 验收等待用户明确授权。
- 这次是文档与工具描述收口，没有改变后端运行逻辑。实际结果与计划一致；额外记录了组合 Vitest worker 异常与拆分复跑通过的验证路径。
