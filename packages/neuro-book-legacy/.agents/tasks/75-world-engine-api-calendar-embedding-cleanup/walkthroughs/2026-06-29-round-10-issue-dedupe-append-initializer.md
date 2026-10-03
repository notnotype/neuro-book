# Round 10：Issue 去重与 append 自动初始化

## 背景

session 268 复测暴露两个真实问题：

- 同一个脚本连续写入时，同一条历史 E issue 会被多次推入 `execute_world` 的最终 `issues[]`。
- Agent 写 `list` / `collection` 时仍容易忘记先建立数组基准，导致 `append ... 缺少已存在的数组基准`。

用户确认采用公共 issue 去重，并采用“写入层自动插入显式 `replace []`”的 append 初始化策略；不改 reducer 严格语义，不做现有 Project SQLite 迁移。

## 改动

- `world-issue-builder.ts`
  - 新增 `worldIssueIdentity()` 与 `dedupeWorldIssues()`。
  - 有 `patchId` 时按具体 patch 行去重；无 `patchId` 时按 slice / subject / path / message 去重。
- `world-engine.service.ts`
  - write / edit / delete / query / getSlice / listSlices 的 issue 汇总改用公共去重。
  - 写入和编辑切面前扫描 patch 序列：对 schema 明确声明的数组字段，如果 append 执行前缺少数组基准，自动插入真实 `replace []` patch。
  - reducer 仍保持严格，历史坏数据不会被 reduce 隐式兜底。
- `world-engine.facade.ts`
  - `executeCodeActWorld()` 最终返回前再做一次去重兜底，避免同一脚本多次写入重复推送同一持久 E issue。
- `reference/world-engine/issues.md`
  - 增加 Issue Identity / Dedupe 说明，明确去重不修复历史坏 patch，也不丢失 `sliceId` / `patchId` 定位。
- `world-engine.facade.test.ts`
  - 新增 append 自动初始化与 issue 去重回归。
  - 测试直接访问 SQLite 的 Prisma helper 改用 `TrackedPrismaLibSql`，并把临时 Project 清理从整文件末尾集中清理改为每个用例后即时清理，避免 Windows 下 libsql/Prisma 文件句柄积压导致 EBUSY。

## 验证

- 新增/更新 facade 回归：
  - 已有 subject 缺少数组基准时，append 会落库为 `replace []` + `append`。
  - 已有数组基准时，后续 append 不重复插入 `replace []`。
  - `editSlice` 添加 append 同样自动补基准并保持顺序。
  - 历史非数组基准不会被自动覆盖，仍返回定位到新 append patch 的 E issue。
  - `executeCodeActWorld` 连续写入时同一历史 issue 只返回一次，同时不同 `patchId` 的问题仍分别保留。
- 已运行：
  - `bun test server/world-engine/world-engine.facade.test.ts`：29 pass。
  - `bun test server/world-engine`：262 pass。
  - `bunx vitest run server/agent/tools`：118 pass。
  - `bun run typecheck`：通过。
  - 静态检查 `.world-engine-*.ts`：无临时文件残留。

## 与计划出入

运行时行为与计划一致。为了覆盖“path 已存在但不是数组”这种正常 service 写入会被类型校验挡住的情况，测试使用直接插入旧坏数据的方式模拟历史损坏；运行时不新增 SQL 直写入口。

验证时额外发现全量 `bun test server/world-engine` 在 Windows 上会因 facade 测试集中清理临时 Project 而偶发 EBUSY。本轮一并修正测试资源释放：使用已有 tracked Prisma adapter 关闭底层 libsql client，并改为每个用例后释放临时 Project。该修正不改变 World Engine 运行时协议。
