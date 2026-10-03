# Round 181：补齐 Calendar 单位安全整数校验

## 背景

继续审查 `world-engine/calendar.yaml` 的配置输入边界时发现：Calendar 单位既允许 YAML number，也允许正整数字符串。字符串可以精确表达任意大整数；但 YAML number 会先进入 JS `number`，超过 `Number.MAX_SAFE_INTEGER` 时已经可能丢失精度。

旧逻辑只检查 `Number.isInteger(input)`，会接受不安全整数并 `BigInt(input)`，等于把一个已经丢精度的值固化进 Calendar 配置。

## 本轮目标

- YAML number 形式的 Calendar 单位必须是 JS safe integer 正整数。
- 正整数字符串继续允许，用于表达超过 safe integer 的大整数。
- 补 facade 回归测试。
- 同步任务文档与仓库状态。
- 不改前端，不做浏览器验证。

## 实现

- `server/world-engine/calendar.ts`
  - `readConfigBigInt()` 对 number 输入改用 `Number.isSafeInteger(input)`。
  - 不安全 number 返回稳定 400：`<key> 必须是安全正整数`。
  - 字符串正整数通道保持不变，继续 `BigInt(input)`。

- `server/world-engine/world-engine.facade.test.ts`
  - 扩展 Calendar 配置校验：
    - `hoursPerDay: 9007199254740992` 这种 YAML number 被拒绝。
    - `hoursPerDay: "9007199254740992"` 这种字符串正整数可用于解析大 hour 值。

- `docs/tasks/56-world-engine/README.md`
  - 追加 round-181 记录。
  - 补充 Calendar 单位配置 number / string 的精度边界。

- `docs/tasks/56-world-engine/sqlite-and-api.md`
  - 补充 `calendar.yaml` 单位配置安全整数约束。

- `PROJECT-STATUS.md`
  - 追加 round-181 后端/API 补充。

## 验证

- `bun run test server/world-engine/world-engine.facade.test.ts 'server/api/projects/world-engine/[...segments].test.ts' server/agent/tools/world-engine-tools.test.ts server/agent/profiles/world-engine-profile.test.ts`
  - 4 files passed
  - 126 tests passed

- `bun run typecheck`
  - passed

## 与计划出入

- 本轮没有做前端。
- 本轮没有自动做浏览器验证。
- 本轮不限制字符串大整数本身；真正进入写入 / 查询边界的 `Instant` 仍由 service 层 SQLite 64 位范围校验负责。
