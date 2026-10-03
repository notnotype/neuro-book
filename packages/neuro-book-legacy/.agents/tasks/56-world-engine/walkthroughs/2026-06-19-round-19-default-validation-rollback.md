# Round 19 - Default Validation Rollback

## Scope

本轮审查 World Engine 写操作事务边界，重点看 `createSubject` 这种“创建 subject 身份 + 写 init slice”的复合写入是否可能留下半成功状态。

## Finding

- facade 的写操作已经走 `Prisma.$transaction`：
  - `createSubject`
  - `writeSlice`
  - `editSlice`
  - `resettleTimeline`
- 但 `createSubject` 写 schema default 时没有校验默认值类型。
- 普通 mutation 校验不能直接复用，因为 init default 会用 `set` 初始化 list/collection，例如 `events: []`，而运行时普通 list 属性只允许 `listAppend`。
- 风险：schema 里把 `hp:int default` 写成字符串时，`createSubject` 可能先创建 subject 身份，再在后续写入时出现不一致；即便 transaction 会回滚，也缺少明确默认值校验与测试证据。

## Actual Changes

- 更新 `server/world-engine/world-engine.service.ts`：
  - `createSubject()` 在创建 subject 后、写 init slice 前调用 `validateDefaultMutations()`。
  - 新增默认值专用校验：
    - scalar default 按 `int / float / text / bool / enum / ref(...)` 校验。
    - list / collection default 必须是 array，并按 `itemType` 校验元素。
    - object default 必须是 object。
  - 保留 init default 用 `set` 初始化 list/collection 的能力，不把它误判成普通运行时 mutation。
- 更新 `server/world-engine/world-engine.facade.test.ts`：
  - 构造 `hp:int default: bad` 的 schema。
  - 验证 `createSubject()` 抛出 `hp default 必须是 int`。
  - 验证失败后 `listWorldSubjects()` 为空。
  - 验证失败后 `listSlices()` 为空。

## Verification

- `bunx vitest run server/world-engine/world-engine.facade.test.ts server/api/projects/world-engine/[...segments].test.ts server/agent/tools/world-engine-tools.test.ts app/utils/world-engine-preview.test.ts`
  - 通过：4 个测试文件，26 个用例。
- `bun run typecheck`
  - 通过。

## Browser Testing

仍未自动浏览器验证。项目指令要求不要自动浏览器验证；本轮是后端默认值校验与事务回滚证据，不替代页面验收。

## Code Review Notes

- 这轮没有改变正常模板行为：`events: []` 这类 list default 仍可作为 init `set` 写入。
- 默认 ref 校验会要求目标 subject 已存在；如果未来需要支持“默认引用稍后创建的 subject”，需要额外设计 bootstrap 顺序或延迟校验。

## Walkthrough Delta

计划从事务边界审查开始；实际确认 transaction 已存在，但发现默认值校验缺口，于是补了默认值专用校验和失败回滚测试。本轮没有其他绕道。
