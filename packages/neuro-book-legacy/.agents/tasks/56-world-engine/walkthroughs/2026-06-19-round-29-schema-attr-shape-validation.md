# Round 29 - schema attr shape 组合约束

## 背景

Round 27 已经补了 `type/itemType` 的值合法性，Round 28 补了 object 整体 `set/default` 的子值校验。本轮继续审查 schema loader 的 attr 形状约束。

发现的问题：

- loader 会拒绝非法 `type` 字符串，但还允许一些语义不清楚的字段组合。
- 例如 `scalar + itemType`、`scalar + fields`、`list + type`、`object + type` 都不是当前 schema 设计允许的组合。
- 这些组合如果进入投影，会让 Agent / Preview 不知道该按哪个字段生成 mutation；如果进入 service，也会让校验逻辑出现意外分支。

## 本轮计划

1. 在 schema loading 阶段拒绝跨 kind 混用字段。
2. 保持已有合法模板不变：
   - `scalar` 使用 `type`。
   - `list/collection` 使用 `itemType`。
   - `object` 使用 `fields` 或 `itemType`，也允许第一版无类型 object 作为宽松调试结构。
3. 补测试覆盖坏组合提前失败。

## 实现

- 更新 `server/world-engine/schema-loader.ts`：
  - `scalar` 不能声明 `itemType`。
  - 非 `object` 不能声明 `fields`。
  - `list/collection` 不能声明 `type`，只能使用 `itemType`。
  - `object` 不能声明 `type`。
  - 保留既有约束：`list/collection` 必须有 `itemType`；`object` 不能同时声明 `fields` 和 `itemType`。
- 更新 `server/world-engine/world-engine.facade.test.ts`：
  - 覆盖 `scalar + itemType` 报错。
  - 覆盖 `list + type` 报错。
  - 覆盖 `scalar + fields` 报错。
  - 覆盖 `object + type` 报错。

## 验证

- `bunx vitest run server/world-engine/world-engine.facade.test.ts server/api/projects/world-engine/[...segments].test.ts server/agent/tools/world-engine-tools.test.ts app/utils/world-engine-preview.test.ts`
  - 4 个测试文件通过。
  - 38 个测试用例通过。
- `bun run typecheck`
  - 通过。

## 与计划的出入

本轮原计划是补 attr kind 与 `type/itemType/fields` 的组合约束，实际范围与计划一致。仍未自动浏览器验证；项目指令要求必须用户确认后才能打开浏览器，本轮属于 schema loader 输入边界修复。

## 后续

- 浏览器验证仍是总任务缺口。
- schema loader 后续如继续收紧，可考虑 subject type 名称、attr 名称格式，但这会影响用户自定义空间，需要另行权衡。
