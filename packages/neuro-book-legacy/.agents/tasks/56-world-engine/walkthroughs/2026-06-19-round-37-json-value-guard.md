# Round 37 - 通用 JSON value 防线

## 背景

Round 36 收紧了 `float` 和 `add` 的 finite number 校验，但继续审查发现：动态未声明属性的 `set` 路径不走具体 schema type 校验，只要 op 合法就会进入 settle / 持久化。

HTTP API、Preview helper 和 Agent 工具通常会把输入约束成 JSON 值，但 facade/service 是最终业务边界，未来内部调用也可能直接传入 `NaN`、`Infinity`、函数或嵌套非法值。如果这些值进入 `toJsonValue()` / `JSON.stringify()`，可能被静默转成 `null`，或者在 reduce 状态里留下非 JSON 值。

## 本轮计划

1. 保留动态属性 `set` / `unset` 的宽松策略。
2. 在 service 层补通用 JSON value 校验。
3. 增加动态属性回归测试。

## 实现

- 更新 `server/world-engine/world-engine.service.ts`：
  - 所有非 `unset` mutation 在通过“必须显式提供 value”后，会先检查 value 是否为 JSON 值。
  - `add` 和 `float` 的具体数值错误仍保留更明确的错误文案。
  - JSON 值递归校验数组和对象，拒绝非有限 number、函数、`undefined` 等不可持久化值。
- 更新 `server/world-engine/world-engine.facade.test.ts`：
  - 新增测试：`动态属性 set 也拒绝非 JSON value`。
  - 覆盖动态属性直接写 `NaN` 和嵌套对象包含 `Infinity` 两条路径。
- 更新文档：
  - `README.md` 记录第三十七轮进展。
  - `schema-design.md` 补充所有非 `unset` mutation value 必须是 JSON 值。
  - `PROJECT-STATUS.md` 同步当前状态。

## 验证

- `bunx vitest run server/world-engine/world-engine.facade.test.ts`
  - 1 个测试文件通过。
  - 27 个测试用例通过。
- `bunx vitest run server/world-engine/world-engine.facade.test.ts server/api/projects/world-engine/[...segments].test.ts server/agent/tools/world-engine-tools.test.ts app/utils/world-engine-preview.test.ts`
  - 4 个测试文件通过。
  - 46 个测试用例通过。
- `bun run typecheck`
  - 通过。

## 与计划的出入

本轮按计划修复动态属性 JSON value 边界。过程中调整了一次校验顺序，让 `add` / `float` 仍优先返回更具体的错误文案。

没有自动浏览器验证；项目指令要求必须用户确认后才能打开浏览器。

## 后续

- 继续审查 service 与 HTTP/Agent 边界是否还有“外层挡住了、核心层没挡住”的输入不一致。
- 浏览器验证仍待用户确认后执行。
