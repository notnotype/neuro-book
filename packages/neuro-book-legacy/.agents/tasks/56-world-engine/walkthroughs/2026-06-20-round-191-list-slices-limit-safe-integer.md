# Round 191：listSlices.limit 必须是 safe integer

## 背景

本轮继续按用户最新范围只做后端/API，不进入前端。

巡检 timeline 查询资源边界时注意到一个旧决策：HTTP `GET /slices` 是否设置业务最大上限属于资源策略，round-177 已记录“不擅自变更”。因此本轮没有给 HTTP timeline 查询新增最大条数上限。

但还有一个更底层的数值精度问题：`listSlices.limit` 与 HTTP `GET /slices?limit=` 只要求正整数。对于 `9007199254740992` 这类超过 JS safe integer 的纯数字字符串，HTTP 格式校验会通过，随后转换成可能已经不可靠的 JS number 继续进入查询。

## 实现

- `server/world-engine/world-engine.service.ts`
  - `assertPositiveInteger()` 改为要求 `Number.isSafeInteger(value) && value > 0`。
  - 错误文案调整为：`limit 必须是安全正整数`。

- `server/api/projects/world-engine/[...segments].ts`
  - `readPositiveIntQuery()` 在纯数字格式校验后，也要求转换结果是 JS safe integer。

- `server/world-engine/world-engine.facade.test.ts`
  - 补 `Number.MAX_SAFE_INTEGER + 1` 的 service / facade 回归。

- `server/api/projects/world-engine/[...segments].test.ts`
  - 补 `GET /slices?limit=9007199254740992` 的 HTTP 回归。

## 文档同步

- `docs/tasks/56-world-engine/sqlite-and-api.md`
  - `listSlices.limit` 标注为 safe integer 正整数。

- `docs/tasks/56-world-engine/README.md`
  - 增加 round-191 状态与 walkthrough 链接。

- `PROJECT-STATUS.md`
  - 增加 round-191 仓库级状态说明。

## 验证

- `bun run test server/world-engine/world-engine.facade.test.ts 'server/api/projects/world-engine/[...segments].test.ts' server/agent/tools/world-engine-tools.test.ts server/agent/profiles/world-engine-profile.test.ts`
  - 4 files passed
  - 129 tests passed

- `bun run typecheck`
  - passed

## 与计划出入

本轮没有修改 HTTP timeline 的业务最大上限策略，因为这属于资源策略决策；只补了数值精度边界，避免超出 JS safe integer 的 limit 丢精度后进入查询。

