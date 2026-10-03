# Round 180：补齐 Calendar format 重复时间字段校验

## 背景

上一轮修复了默认 Calendar 对零点前时间的 `format()` / `parse()` 往返。继续审查自定义 `calendar.yaml` 时发现一个配置边界问题：

如果项目把 `format` 写成重复时间字段，例如：

- `{year}` 出现两次。
- 同时使用 `{hour}` 和 `{hour:02}`。

当前 `regexFromFormat()` 会在 parse 阶段构造出重复命名捕获组，错误表现为 JS `RegExp` 异常，而不是稳定的 Calendar 配置错误。

## 本轮目标

- 在加载 Calendar 配置时拒绝重复的可解析时间字段。
- 补 facade 回归测试。
- 同步任务文档与仓库状态。
- 不改前端，不做浏览器验证。

## 实现

- `server/world-engine/calendar.ts`
  - 新增 `FORMAT_TIME_FIELDS`，把 `hour` / `hour:02`、`minute` / `minute:02`、`second` / `second:02` 归并为同一语义字段。
  - `readFormat()` 增加 `assertUniqueTimeFields(format)`。
  - 重复时返回稳定 400：`format 时间字段不能重复：<previous> / <current>`。

- `server/world-engine/world-engine.facade.test.ts`
  - 扩展 Calendar 配置校验测试：
    - 重复 `{year}` 被拒绝。
    - 同时使用 `{hour}` 与 `{hour:02}` 被拒绝。

- `docs/tasks/56-world-engine/README.md`
  - 追加 round-180 记录。
  - 在 Calendar 决策段补充自定义 `format` 时间字段不能重复。

- `docs/tasks/56-world-engine/sqlite-and-api.md`
  - 补充 `calendar.yaml` 的 `format` 重复字段约束。

- `PROJECT-STATUS.md`
  - 追加 round-180 后端/API 补充。

## 验证

- `bun run test server/world-engine/world-engine.facade.test.ts 'server/api/projects/world-engine/[...segments].test.ts' server/agent/tools/world-engine-tools.test.ts server/agent/profiles/world-engine-profile.test.ts`
  - 4 files passed
  - 125 tests passed

- `bun run typecheck`
  - passed

## 与计划出入

- 本轮没有做前端。
- 本轮没有自动做浏览器验证。
- 本轮没有改变默认 Calendar 格式，只补配置错误的提前校验。
