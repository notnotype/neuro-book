# Round 26 - schema enum/default 配置校验

## 背景

Round 25 把 `enum` 与 `default` 暴露进 `getWorldSchema` 投影，Agent 和 Preview 可以用这些信息生成更合法的 mutation。本轮继续审查这条链路的上游输入边界。

发现的问题：

- `schema-loader.ts` 会校验 `kind`、`fields`、`subjectTypes`、`attrs` 的结构，但此前没有校验 `enum` / `default` 的结构。
- 如果用户把 `enum` 写成标量（例如 `enum: active`），坏值会被投影给 Agent/Preview，或在运行时 enum 校验里变成不清晰错误。
- YAML 可以把 `.nan` 解析成 `NaN`，也能通过 tag 产生 `Set` / `Uint8Array` 这类非 JSON 值；这些不应该进入 World Engine 的 schema 投影与 mutation 默认值。

## 本轮计划

1. 在 schema loading 阶段校验 `enum` 必须是 array。
2. 校验 `enum` 内元素和 `default` 都必须是 JSON 值。
3. 补回归测试覆盖坏配置提前失败。

## 实现

- 更新 `server/world-engine/schema-loader.ts`：
  - `normalizeAttr()` 读取并规范化 `enum` / `default`。
  - 新增 `readEnum()`：`enum` 存在时必须是 array，元素必须是 JSON 值。
  - 新增 `readDefault()`：`default` 存在时必须是 JSON 值。
  - 新增 JSON 值判断，拒绝 `NaN`、非有限数字、函数、非普通对象、`Set`、`Uint8Array` 等非 JSON 数据。
- 更新 `server/world-engine/world-engine.facade.test.ts`：
  - 覆盖 `enum: active` 会在 `getWorldSchema()` 阶段报错。
  - 覆盖 `default: .nan` 会在 `getWorldSchema()` 阶段报错。
- 更新 `docs/tasks/56-world-engine/schema-design.md`：
  - 明确 `enum` 必须是 JSON array。
  - 明确 `default` 是 JSON 初值。

## 验证

- `bunx vitest run server/world-engine/world-engine.facade.test.ts server/api/projects/world-engine/[...segments].test.ts server/agent/tools/world-engine-tools.test.ts app/utils/world-engine-preview.test.ts`
  - 4 个测试文件通过。
  - 34 个测试用例通过。
- `bun run typecheck`
  - 通过。

## 与计划的出入

本轮原计划是审查 `enum/default` 配置边界，实际修复范围与计划一致。没有启动浏览器验证；项目指令要求必须用户确认后才能打开浏览器，本轮属于 schema loader 后端输入边界修复，不替代页面验收。

## 后续

- 继续等待用户确认后做 `/world-engine.preview` 浏览器验证。
- schema loader 仍可继续审查 `type/itemType` 字段合法性；当前重点先保证已投影给 Agent/Preview 的结构不携带坏 JSON。
