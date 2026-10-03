# Round 21 - Schema Kind Validation

## Scope

本轮审查 `world-engine/schema.yaml` 的配置输入边界。World Engine 很依赖项目 schema，如果用户写错 attr kind，错误应在 schema loading 阶段明确暴露，而不是进入运行时后变成内部异常。

## Finding

- `schema-loader.ts` 原本信任 YAML 中的 `kind`。
- 如果用户写出 `kind: numberish` 这类非法值，`normalizeAttrKind()` 会把它当成 `WorldAttrKind` 返回。
- 后续 service 层按 kind 查询允许的 op 时可能拿到 `undefined`，形成不清晰的运行时错误。

## Actual Changes

- 更新 `server/world-engine/schema-loader.ts`：
  - 新增 `ATTR_KINDS` 白名单：`scalar / list / collection / object`。
  - `normalizeAttr()` 会校验 attr 必须是 object。
  - `readAttrKind()` 会在非法 kind 时抛出明确错误：`属性 kind 不合法：<path>=<value>`。
  - `readFields()` 会校验 `fields` 必须是 object。
  - 嵌套 fields 会带路径归一化，便于定位错误。
- 更新 `server/world-engine/world-engine.facade.test.ts`：
  - 覆盖 `kind: numberish` 会在 `getWorldSchema()` 时失败，并报告具体属性路径。

## Verification

- `bunx vitest run server/world-engine/world-engine.facade.test.ts server/api/projects/world-engine/[...segments].test.ts server/agent/tools/world-engine-tools.test.ts app/utils/world-engine-preview.test.ts`
  - 通过：4 个测试文件，28 个用例。
- `bun run typecheck`
  - 通过。

## Browser Testing

仍未自动浏览器验证。项目指令要求不要自动浏览器验证；本轮是 schema loader 配置边界修复，不替代页面验收。

## Code Review Notes

- 这轮不改变合法 schema 行为。
- 错误会被 `WorldSchemaLoader.load()` 包装为 `世界 schema 解析失败：...`，入口层仍以 400 暴露给调用方。

## Walkthrough Delta

计划与实际一致。本轮没有遇到堵塞或绕道。
