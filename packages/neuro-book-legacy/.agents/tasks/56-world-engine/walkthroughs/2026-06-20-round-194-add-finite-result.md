# Round 194：add 结果必须是有限数

## 背景

本轮继续按用户最新范围只做后端/API，不进入前端。

上一轮让 `int add` 的 reduce 结果必须保持 JS safe integer。继续巡检后发现 `float` / 未声明数值属性仍有相邻缺口：

- base 是 finite number。
- delta 也是 finite number。
- `base + delta` 仍可能得到 `Infinity`。

如果直接写入 reduce 状态，会让世界状态携带非 JSON number。

## 实现

- `server/world-engine/world-engine.service.ts`
  - `applyAndDetect()` 在 `add` 分支计算结果后，先要求 `Number.isFinite(result)`。
  - 非有限结果返回 `broken-relative` issue：
    `add <attr> 结果不是有限数`
  - 对 `type: int` 继续执行上一轮 safe integer 结果校验。
  - 溢出时不更新状态，保留原有限基准值。

- `server/world-engine/world-engine.facade.test.ts`
  - 覆盖 `score = Number.MAX_VALUE` 后 `add Number.MAX_VALUE`：
    - `writeSlice()` 返回 `broken-relative` issue。
    - `queryState()` 继续返回原有限 `score`。
    - `queryState()` issues 中保留同一 E issue。

- `server/api/projects/world-engine/[...segments].test.ts`
  - 覆盖 HTTP `POST /slices` 写入该溢出 add 时，返回 `{issues}`。

## 文档同步

- `docs/tasks/56-world-engine/schema-design.md`
  - 记录所有 `add` 的 reduce 结果必须仍是有限数。

- `docs/tasks/56-world-engine/sqlite-and-api.md`
  - 记录 `add` 非有限结果会作为 `broken-relative` E issue 返回。

- `docs/tasks/56-world-engine/README.md`
  - 增加 round-194 状态与 walkthrough 链接。

- `PROJECT-STATUS.md`
  - 增加 round-194 仓库级状态说明。

## 验证

- `bun run test server/world-engine/world-engine.facade.test.ts 'server/api/projects/world-engine/[...segments].test.ts' server/agent/tools/world-engine-tools.test.ts server/agent/profiles/world-engine-profile.test.ts`
  - 4 files passed
  - 134 tests passed

- `bun run typecheck`
  - passed

## 与计划出入

本轮延续 round-193 的策略，不新增 issue code。`add` reduce 后无法得到安全 JSON number 时，统一作为相对 op 无法安全应用，通过 `broken-relative` 显形。

