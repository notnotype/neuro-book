# Round 38 - attr path 空段校验

## 背景

本轮审查 `queryState` 投影、`listLimit` 和属性路径处理。检查时发现一个路径解释不一致的问题：`findAttrSchema()` 会过滤空 path 段，因此 `profile..tags` 在 schema 查询时可能被当成 `profile.tags`；但状态写入的 `setPath()` 不过滤空段，会写成 `profile[""].tags`。

这会让同一条 attr path 在“schema 校验”和“状态写入”两个阶段含义不同。真实使用时，Agent 或 Preview 一旦传入多余点号，状态会出现很隐蔽的空 key 嵌套。

## 本轮计划

1. 保持点分路径语义。
2. 拒绝包含空段的 attr path。
3. 增加回归测试。

## 实现

- 更新 `server/world-engine/world-engine.service.ts`：
  - `validateMutations()` 在 op/schema/value 校验前调用 `assertAttrPath()`。
  - `assertAttrPath()` 拒绝任何空路径段。
  - 例如 `profile..tags`、`.profile`、`profile.` 都会返回 400。
- 更新 `server/world-engine/world-engine.facade.test.ts`：
  - 新增测试：`拒绝带空段的 attr 路径`。
  - 覆盖 `profile..tags` 不再进入状态写入。
- 更新文档：
  - `README.md` 记录第三十八轮进展。
  - `schema-design.md` 补充 attr path 每个段必须非空。
  - `PROJECT-STATUS.md` 同步当前状态。

## 验证

- `bunx vitest run server/world-engine/world-engine.facade.test.ts`
  - 第一次 28 个用例都通过，但 Vitest worker 收尾异常退出。
  - 复跑通过：1 个测试文件通过，28 个测试用例通过。
- `bunx vitest run server/world-engine/world-engine.facade.test.ts server/api/projects/world-engine/[...segments].test.ts server/agent/tools/world-engine-tools.test.ts app/utils/world-engine-preview.test.ts`
  - 4 个测试文件通过。
  - 47 个测试用例通过。
- `bun run typecheck`
  - 通过。

## 与计划的出入

本轮按计划从查询 / 路径处理审查进入，实现上修的是写入侧 attr path 防线。这样可以从源头阻止畸形路径进入状态，后续查询投影自然不会遇到空段路径造成的歧义。

没有自动浏览器验证；项目指令要求必须用户确认后才能打开浏览器。

## 后续

- 继续审查 query attrs 是否也需要更严格的路径校验，尤其是未来主 UI 允许用户手写投影路径时。
- 浏览器验证仍待用户确认后执行。
