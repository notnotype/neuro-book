# Round 22 - Schema Structure Validation

## Scope

本轮继续审查 `world-engine/schema.yaml` 的配置输入边界。Round 21 已补齐 attr `kind` 和 `fields` 校验；本轮继续补 subject type 与 attrs 容器结构校验。

## Finding

`schema-loader.ts` 原本只用 `typeof === "object"` 判断 `subjectTypes`，这会让数组或错误结构进入 normalize 流程。具体风险：

- `subjectTypes.character: nope` 会在访问 `subjectType.desc / attrs` 时依赖 JS 运行时行为。
- `attrs: []` 会被当成 object 遍历，错误信息不清楚。

## Actual Changes

- 更新 `server/world-engine/schema-loader.ts`：
  - 新增 `readRecord(input, pathLabel)`。
  - `subjectTypes` 存在时必须是非数组 object。
  - 每个 `subjectTypes.<type>` 必须是非数组 object。
  - `subjectTypes.<type>.attrs` 存在时必须是非数组 object。
  - 非法结构抛出明确错误：`schema 字段必须是 object：<path>`。
- 更新 `server/world-engine/world-engine.facade.test.ts`：
  - 覆盖 `character: nope` 报错 `subjectTypes.character`。
  - 覆盖 `attrs: []` 报错 `subjectTypes.character.attrs`。

## Verification

- `bunx vitest run server/world-engine/world-engine.facade.test.ts server/api/projects/world-engine/[...segments].test.ts server/agent/tools/world-engine-tools.test.ts app/utils/world-engine-preview.test.ts`
  - 通过：4 个测试文件，29 个用例。
- `bun run typecheck`
  - 通过。

## Browser Testing

仍未自动浏览器验证。项目指令要求不要自动浏览器验证；本轮是 schema loader 配置边界修复，不替代页面验收。

## Code Review Notes

- 这轮不改变合法 schema 行为。
- 入口层仍会把 loader 错误包装为 `世界 schema 解析失败：...`，保持 400 边界。

## Walkthrough Delta

计划与实际一致。本轮没有遇到堵塞或绕道。
