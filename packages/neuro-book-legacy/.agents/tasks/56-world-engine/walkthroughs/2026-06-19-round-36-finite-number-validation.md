# Round 36 - finite number 校验

## 背景

本轮先审查 API / Agent 的时间边界，确认外部工具和 HTTP 返回值没有向调用方暴露 raw `instant`。现有边界基本符合之前定论：Agent `list_world_slices` 输出格式化 `time` 并隐藏 `instant`，HTTP slices/state 也会 format 成项目日历字符串。

继续审查相邻输入边界时发现：service 层对 `float` 和 `add` 只检查 `typeof number`，没有拒绝 `NaN` / `Infinity`。这些值不是合法 JSON number，若从内部 facade 或未来工具调用漏入，可能在持久化时被 JSON 序列化成 `null`，或在 reduce 中污染状态。

## 本轮计划

1. 不改变 HTTP / Agent API 形态。
2. 在 service 层补充数值最后防线。
3. 增加 facade 回归测试。

## 实现

- 更新 `server/world-engine/world-engine.service.ts`：
  - `add` 的 value 必须是 `number` 且 `Number.isFinite(value)`。
  - `type: float` 的 value 必须是 `number` 且 `Number.isFinite(value)`。
  - `int` 已由 `Number.isInteger()` 自然拒绝 `NaN` / `Infinity`。
- 更新 `server/world-engine/world-engine.facade.test.ts`：
  - 新增测试：`拒绝 NaN / Infinity 这类非 JSON 数字进入数值 mutation`。
  - 覆盖 `add NaN` 与 `float Infinity` 两条路径。
- 更新文档：
  - `README.md` 记录第三十六轮进展。
  - `schema-design.md` 补充数值必须是有限 JSON number。
  - `PROJECT-STATUS.md` 同步当前状态。

## 验证

- `bunx vitest run server/world-engine/world-engine.facade.test.ts`
  - 1 个测试文件通过。
  - 26 个测试用例通过。
- `bunx vitest run server/world-engine/world-engine.facade.test.ts server/api/projects/world-engine/[...segments].test.ts server/agent/tools/world-engine-tools.test.ts app/utils/world-engine-preview.test.ts`
  - 第一次所有用例通过，但 Vitest worker 收尾异常退出。
  - 复跑通过：4 个测试文件通过，45 个测试用例通过。
- `bun run typecheck`
  - 通过。

## 与计划的出入

本轮原计划审查时间边界。时间边界没有发现需要修改的点，随后绕道修复了同一输入/输出边界里的数值合法性问题。该绕道与总目标一致，因为它能避免非法数值污染世界状态。

没有自动浏览器验证；项目指令要求必须用户确认后才能打开浏览器。

## 后续

- 继续审查动态属性 `set` 的 JSON 值边界，确认是否也需要 service 层显式 JSON value 校验。
- 浏览器验证仍待用户确认后执行。
