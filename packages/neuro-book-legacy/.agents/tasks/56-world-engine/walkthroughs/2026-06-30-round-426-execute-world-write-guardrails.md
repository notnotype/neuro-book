# Round 426: execute_world Write Guardrails

## 用户需求

Session 307 实跑暴露三类误用：

- 同一时间点被拆成多个 `world.slice.write()`，触发 `instant` 唯一冲突。
- 冲突错误里出现 `existingSliceId`，但后续 `world.slice.list()` 为空，容易被误判成 session 缓存。
- `world.subject.get()` 被误当成 `{attrs:{...}}` 返回结构，导致访问 `subject.attrs.xxx` 报错。

用户已决策本轮只做“提示词 + 错误信息”层级修复，不新增 merge/upsert API，不改变 `world.slice.write()` 的严格语义。

## 实际变更

- `execute_world` 工具描述补齐写入防错规则：
  - `world.subject.get()` / `gets()` 返回 attrs 本体，示例强调 `hero.hp` 而不是 `hero.attrs.hp`。
  - 同一 `instant` 只能有一个 slice，同刻多 subject / 多事件必须合并到一次 `world.slice.write({patches:[...]})`。
  - 写入前可用 `world.slice.list({from: time, to: time, withPatches: true})` 查询目标时间。
  - 已有 slice 且 subject 已登记时，用 `world.slice.editPatches(existingSliceId, [{add:{...}}])` 合并补充 patch。
  - `editPatches({add})` 不负责首写创建 subject，新 subject 必须在第一次 `write` 中一起合并。

- World Engine 冲突错误保留 409 与 `existingSliceId/time/title`，但修复建议改成优先合并 patches；删除重写只作为整条切面作废时的最后手段。

- `reference/world-engine/quick-reference.md` 补充 `subject.get()` 直接属性访问、同 instant 合并写入示例，以及 `editPatches({add})` 的新 subject 边界。

## 验证结果

- `bunx vitest run server/agent/tools/world-engine-tools.test.ts server/world-engine/codeact.test.ts server/world-engine/world-engine.facade.test.ts --testTimeout 60000 --hookTimeout 60000 --exclude "product/**"`
  - 3 个测试文件通过，58 个测试通过。
- `bun run typecheck`
  - 通过。
- 审查后补漏：
  - `createSubject()` 撞上非 init slice 的初始化冲突不再提示 `editSlice`，改为引导读取 `existingSliceId` 并显式合并初始化 patches。
  - `formatWorldEngineConflictMessage()` 测试改用新后端冲突文案，确认 UI 仍翻译成“载入这个时间的 slice”动作。
- 补漏验证：
  - `bunx vitest run server/world-engine/world-engine.facade.test.ts app/utils/world-engine-preview.test.ts server/agent/tools/world-engine-tools.test.ts server/world-engine/codeact.test.ts --testTimeout 60000 --hookTimeout 60000 --exclude "product/**"`：4 个测试文件通过，76 个测试通过。
  - `bun run typecheck`：通过。

## 与计划出入

- 与计划一致：没有新增 merge/upsert API，没有改变 `writeSlice()` / HTTP / Facade 的同 instant 冲突语义。
- 与计划一致：新增测试锁定工具描述、冲突错误、同脚本同 instant 冲突后的事务回滚。
- 未做浏览器验证；本轮是后端工具契约、错误信息和文档修复。
