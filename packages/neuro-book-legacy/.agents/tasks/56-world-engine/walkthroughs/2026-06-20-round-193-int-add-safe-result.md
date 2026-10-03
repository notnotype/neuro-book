# Round 193：int add 结果溢出显形为 broken-relative

## 背景

本轮继续按用户最新范围只做后端/API，不进入前端。

上一轮已经要求 `type: int` 的 default 与 mutation value 必须是 JS safe integer。但继续巡检 reduce 阶段时发现一个下游缺口：

- base 是安全整数。
- delta 也是安全整数。
- `base + delta` 仍可能超出 JS safe integer。

如果直接把结果写入 reduce 状态，就会让世界状态出现已经无法可靠表达的整数。

## 决策

不新增 issue code，继续复用 `broken-relative`。

原因：`add` 是相对 op。缺基、基准类型错误、集合删除目标不存在，当前都通过 `broken-relative` 表示“这个相对 op 在当前历史链上无法安全应用”。`int add` 结果超出安全整数范围同样属于相对 op 无法安全应用。

## 实现

- `server/world-engine/world-engine.service.ts`
  - `reduceWithIssues()` 在 apply mutation 前按 subject type 解析 attr schema。
  - `applyAndDetect()` 接收 attr schema。
  - 对 `type: int` 的 `add`：
    - base / delta 必须是 safe integer。
    - `base + delta` 也必须是 safe integer。
    - 溢出时返回 `broken-relative`，message 为 `add <attr> 结果超出安全整数范围`。
  - 溢出时不更新状态，保留原安全基准值。

- `server/world-engine/world-engine.facade.test.ts`
  - 覆盖 `hp = Number.MAX_SAFE_INTEGER` 后 `add 1`：
    - `writeSlice()` 返回 `broken-relative` issue。
    - `queryState()` 继续返回原安全 `hp`。
    - `queryState()` issues 中保留同一 E issue。

- `server/api/projects/world-engine/[...segments].test.ts`
  - 覆盖 HTTP `POST /slices` 写入该溢出 add 时，返回 `{issues}`。

## 文档同步

- `docs/tasks/56-world-engine/schema-design.md`
  - 记录 `int add` reduce 结果也必须保持 safe integer。

- `docs/tasks/56-world-engine/sqlite-and-api.md`
  - 记录 `int add` 溢出会作为 `broken-relative` E issue 返回。

- `docs/tasks/56-world-engine/README.md`
  - 增加 round-193 状态与 walkthrough 链接。

- `PROJECT-STATUS.md`
  - 增加 round-193 仓库级状态说明。

## 验证

- `bun run test server/world-engine/world-engine.facade.test.ts 'server/api/projects/world-engine/[...segments].test.ts' server/agent/tools/world-engine-tools.test.ts server/agent/profiles/world-engine-profile.test.ts`
  - 4 files passed
  - 132 tests passed

- `bun run typecheck`
  - passed

## 与计划出入

本轮没有引入新的 E issue code；按现有相对 op 语义复用 `broken-relative`，避免扩大 API 枚举面。

