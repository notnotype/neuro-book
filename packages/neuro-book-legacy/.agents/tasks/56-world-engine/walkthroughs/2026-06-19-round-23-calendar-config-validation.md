# Round 23 - Calendar Config Validation

## Scope

本轮审查 `world-engine/calendar.yaml` 的配置输入边界。Calendar 是 Agent / HTTP / UI 的时间字符串边界，如果用户显式写错日历单位，系统不应该静默回退默认值。

## Finding

- `calendar.ts` 原本对 `secondsPerMinute / minutesPerHour / hoursPerDay / daysPerMonth / monthsPerYear` 使用 `readConfigBigInt(input, fallback)`。
- 如果用户显式配置非法值，例如 `hoursPerDay: nope`，会静默回退到默认 `24`。
- 这会制造危险错觉：用户以为项目使用自定义历法，实际底层仍按默认历法 parse/format。

## Actual Changes

- 更新 `server/world-engine/calendar.ts`：
  - 缺省值仍使用默认 12x30 奇幻简明历。
  - 只要用户显式配置日历单位，就必须是正整数 number 或正整数字符串。
  - 非法单位抛出明确错误：`<key> 必须是正整数`。
  - `format` 必须是非空字符串。
  - `format` 必须包含 `{year}`、`{month}`、`{day}` 三个必要 token。
- 更新 `server/world-engine/world-engine.facade.test.ts`：
  - 覆盖非法 `hoursPerDay` 会报错。
  - 覆盖缺少 `{month}` / `{day}` token 的 format 会报错。
  - 覆盖合法固定进位日历可 format/parse 对称。

## Verification

- 第一次运行：
  - `bunx vitest run server/world-engine/world-engine.facade.test.ts server/api/projects/world-engine/[...segments].test.ts server/agent/tools/world-engine-tools.test.ts app/utils/world-engine-preview.test.ts`
  - 失败：测试中把 1000 秒错误预期为“下一个月”，实际配置下 1000 秒是一整天。实现行为正确，测试预期已修正。
- 修复后运行：
  - `bunx vitest run server/world-engine/world-engine.facade.test.ts server/api/projects/world-engine/[...segments].test.ts server/agent/tools/world-engine-tools.test.ts app/utils/world-engine-preview.test.ts`
  - 通过：4 个测试文件，31 个用例。
- `bun run typecheck`
  - 通过。

## Browser Testing

仍未自动浏览器验证。项目指令要求不要自动浏览器验证；本轮是 calendar loader 配置边界修复，不替代页面验收。

## Code Review Notes

- 这轮不改变默认 calendar 行为。
- 这轮收紧了显式配置的错误边界：配置写错会更早失败，而不是静默使用默认值。
- 第一版仍是固定进位 calendar；复杂不规则历法留待后续。

## Walkthrough Delta

计划与实际基本一致。唯一偏差是第一次测试暴露了测试预期里的单位换算错误，已修正并记录。
