# Round 192：int 值必须是 safe integer

## 背景

本轮继续按用户最新范围只做后端/API，不进入前端。

上一轮补了 `listSlices.limit` 的 safe integer 边界后，继续巡检数值类型时发现：schema `type: int` 只用 `Number.isInteger()` 校验。对于 `9007199254740992` 这类超过 JS safe integer 的 JSON number，它仍会被视为整数并进入世界状态，但这个数值在 JS / JSON 边界已经可能丢精度。

## 实现

- `server/world-engine/schema-loader.ts`
  - schema default 的 `type: int` 先保持原有类型 / 小数校验。
  - 如果是整数但不是 JS safe integer，返回 400：`<attr> default 必须是安全整数`。

- `server/world-engine/world-engine.service.ts`
  - mutation / default 的运行时 `type: int` 校验同步要求 safe integer。
  - 保留原有错误区分：
    - 非数字或小数：`必须是 int`
    - 超出安全整数范围：`必须是安全整数`

- `server/world-engine/world-engine.facade.test.ts`
  - 补 schema int default 不安全整数回归。
  - 补 mutation `set` / `add` 写入不安全整数回归。

- `server/api/projects/world-engine/[...segments].test.ts`
  - 补 HTTP `POST /slices` 写入不安全 int 回归。

## 代码审查 / 修复

第一次跑目标测试时发现错误文案生成了 `hp 必须是 安全整数`，中间多了一个空格。原因是复用了英文类型名用的 `valueErrorSuffix()`。随后新增 `safeIntegerErrorSuffix()`，把中文文案修成 `hp 必须是安全整数`。

## 文档同步

- `docs/tasks/56-world-engine/schema-design.md`
  - 记录 `int` 值必须是 JS safe integer，`float` 只要求有限数。

- `docs/tasks/56-world-engine/sqlite-and-api.md`
  - 记录 `type: int` 的 default / mutation 必须是 JS safe integer。

- `docs/tasks/56-world-engine/README.md`
  - 增加 round-192 状态与 walkthrough 链接。

- `PROJECT-STATUS.md`
  - 增加 round-192 仓库级状态说明。

## 验证

- 首次目标测试：失败 2 条，原因是中文错误文案多空格；已修复。

- 复跑：
  - `bun run test server/world-engine/world-engine.facade.test.ts 'server/api/projects/world-engine/[...segments].test.ts' server/agent/tools/world-engine-tools.test.ts server/agent/profiles/world-engine-profile.test.ts`
  - 4 files passed
  - 130 tests passed

- `bun run typecheck`
  - passed

## 与计划出入

本轮没有改变 `float` 语义；`float` 仍允许任意 finite number。只收紧 `int`，因为 JSON number 超出 safe integer 后无法可靠表达整数状态。

