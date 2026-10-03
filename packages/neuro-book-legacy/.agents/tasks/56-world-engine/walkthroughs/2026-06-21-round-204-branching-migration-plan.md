# Round 204: P2 append-only 分叉迁移与实现计划

## 背景

P0/P1 已把真实驾驶测试暴露的首轮使用卡点基本收口。下一档是 P2：append-only 分叉。这会改 Project SQLite schema、Prisma generated client、repository 查询、service 语义、HTTP API、Agent 工具和稳定文档；按任务约束，本轮只出计划，等待用户明确确认后再实现。

当前代码证据：

- `prisma/project.schema.prisma` 中 `WorldSlice.instant` 仍是全局 `@unique`。
- `server/workspace-files/project-workspace.ts` 的 Project SQLite 初始化 SQL 仍创建 `WorldSlice_instant_key` 全局唯一索引，并把 `schemaVersion` 写为 `1`。
- `WorldEngineRepository.findSliceByInstant()` 使用 `findUnique({where:{instant}})`；`latestInstant()`、`listSlices()`、`findMutationsForSubject()` 都是全局 timeline 查询。
- `op-behavior-matrix.md` 已声明分叉尚未落地，落地后要把「instant 全局唯一」改成「active path 内唯一」，并补「跨分支 × op」行为表。

## 目标语义

### 推荐定义

- **WorldBranch**：一个 Project 内的世界线分支。Root branch 承载现有数据；rollback 不删除旧 slice，而是创建新 branch 并把 active branch 指向它。
- **activeBranch**：Project 当前选中的分支，存到 `ProjectMetadata`，例如 key = `worldEngine.activeBranchId`。
- **active path**：从 root branch 到 active branch 的祖先链。查询状态和 timeline 时只 reduce active path 上可见的 slice。
- **forkInstant**：子分支继承父 active path 的截断点。子分支自己的 slice 必须位于 `instant > forkInstant`，`instant <= forkInstant` 属于继承历史，不能在子分支里直接改写。
- **active path 内 instant 唯一**：不同分支可以复用同一 instant；同一 active path 上不能出现两个可见 slice 落在同一 instant。

### rollback 推荐语义

`rollback(sliceId)` 不删除任何 slice：

1. 找到 `sliceId` 在当前 active path 中的所属 branch 与 instant。
2. 创建新 branch，`parentId = owningBranch.id`，`forkInstant = slice.instant`。
3. 把 `ProjectMetadata.worldEngine.activeBranchId` 更新为新 branch id。
4. 新 active path 继承到目标 slice 为止；目标之后的旧未来仍保留在旧分支，但不再出现在当前 active path。

这等价于“从这里开一条新时间线”，不是当前 `deleteSlice` 的物理删除。

### switchBranch / listBranches

- `listBranches()` 返回分支树或扁平列表：`id / name / parentId / forkInstant / forkTime / active / sliceCount / latestInstant / createdAt`。
- `switchBranch(branchId)` 只改 active branch，不改 slice，不重算落库状态。
- 第一版不做 per-request `branchId` 查询；HTTP / Agent / Workbench 都默认作用于 active branch。需要看其他 branch 时先 `switchBranch`。

## 数据模型计划

### Prisma schema 推荐形态

```prisma
model WorldBranch {
  id          String        @id @default(cuid())
  parentId    String?
  name        String        @default("")
  forkInstant BigInt?
  createdAt   DateTime      @default(now())
  parent      WorldBranch?  @relation("WorldBranchTree", fields: [parentId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  children    WorldBranch[] @relation("WorldBranchTree")
  slices      WorldSlice[]

  @@index([parentId, forkInstant])
  @@index([createdAt])
}

model WorldSlice {
  id        String          @id @default(cuid())
  branchId  String
  instant   BigInt
  title     String          @default("")
  summary   String          @default("")
  kind      String          @default("event")
  createdAt DateTime        @default(now())
  branch    WorldBranch     @relation(fields: [branchId], references: [id], onDelete: Restrict, onUpdate: Cascade)
  mutations WorldMutation[]

  @@unique([branchId, instant])
  @@index([branchId, instant])
  @@index([instant])
}

model WorldMutation {
  id        String       @id @default(cuid())
  branchId  String
  sliceId   String
  subjectId String
  instant   BigInt
  seq       Int          @default(0)
  attr      String
  op        String
  value     String?
  slice     WorldSlice   @relation(fields: [sliceId], references: [id], onDelete: Cascade)
  subject   WorldSubject @relation(fields: [subjectId], references: [id], onDelete: Cascade)

  @@index([branchId, subjectId, instant, seq])
  @@index([branchId, subjectId, attr, instant])
  @@index([subjectId, instant, seq])
  @@index([subjectId, attr, instant])
  @@index([attr])
}
```

说明：

- `WorldMutation.branchId` 是冗余字段，推荐保留。它和当前冗余 `instant` 一样，目的是让 reduce 能直接按 `(branchId, subjectId, instant, seq)` 查，不依赖 join。
- `WorldBranch.id = "main"` 可作为迁移后 root branch 的固定 id，便于现有数据与测试识别。
- `WorldSlice.id` 仍全局唯一；`editSlice/deleteSlice` 继续靠 sliceId 精确定位，但必须检查 slice 是否属于当前 active branch 可写段。

## Project SQLite 迁移计划

当前 Project DB 没有正式迁移 runner，`initProjectDatabaseAtRoot()` 只是执行一串 `CREATE TABLE IF NOT EXISTS` 和 `CREATE INDEX IF NOT EXISTS`，最后把 `schemaVersion` 写成 `1`。P2 不能只改 `CREATE TABLE IF NOT EXISTS`，因为已有 DB 里已经存在旧表和旧 unique index。

### 推荐步骤

1. 把 Project DB 初始化改成“schema version aware”：
   - 读取 `ProjectMetadata.schemaVersion`。
   - 空库走 fresh schema v2。
   - v1 库执行 `migrateProjectDatabaseV1ToV2()`。
   - 成功后写 `schemaVersion = 2`。
2. v1 → v2 migration 在单事务内执行：
   - `CREATE TABLE IF NOT EXISTS WorldBranch (...)`。
   - `INSERT OR IGNORE INTO WorldBranch(id, name, parentId, forkInstant) VALUES ('main', 'Main', NULL, NULL)`。
   - 重建 `WorldSlice`：
     - 新表含 `branchId TEXT NOT NULL DEFAULT 'main'`、`FOREIGN KEY(branchId) REFERENCES WorldBranch(id)`。
     - 复制旧 `WorldSlice` 数据到新表，`branchId='main'`。
     - 删除旧表，rename 新表。
   - 重建或迁移 `WorldMutation`：
     - 新表含 `branchId TEXT NOT NULL DEFAULT 'main'`。
     - 从旧 mutation 复制数据，`branchId='main'`。
   - 删除旧 `WorldSlice_instant_key` 全局唯一索引。
   - 创建新索引：`WorldSlice_branchId_instant_key`、`WorldSlice_branchId_instant_idx`、`WorldMutation_branchId_subjectId_instant_seq_idx` 等。
   - 写 `ProjectMetadata.worldEngine.activeBranchId = 'main'`。
3. fresh schema v2 的 `PROJECT_MIGRATION_SQL` 直接创建 `WorldBranch` 与带 `branchId` 的 World tables。
4. 运行 `bunx prisma generate --schema prisma/project.schema.prisma` 更新 generated client。

### 迁移风险

- SQLite 对既有表补 `NOT NULL + FK` 不适合简单 `ALTER TABLE ADD COLUMN`，推荐重建 `WorldSlice` / `WorldMutation`，不要留下 Prisma schema 与真实表约束不一致。
- 迁移时要处理 `PRAGMA foreign_keys`：重建表期间需要明确关闭/开启并做 `PRAGMA foreign_key_check`。
- `schemaVersion` 不能继续无条件写 `1`，否则未来无法判断 Project DB 是否完成分叉迁移。

## Repository / Service 改造计划

### Branch context

新增内部类型：

```ts
type WorldBranchPathSegment = {
    branchId: string;
    ownAfter?: bigint;     // 子分支只拥有 forkInstant 之后
    ownUntil?: bigint;     // 祖先分支只贡献到下一段 forkInstant
};

type WorldBranchContext = {
    activeBranchId: string;
    path: WorldBranchPathSegment[];
};
```

每次 service 操作先解析 active branch context：

- `getActiveBranch()` 从 `ProjectMetadata.worldEngine.activeBranchId` 读 active branch；缺失时创建/回填 `main`。
- `resolveActivePath()` 从 active branch 向上追 parent，生成 root → active 的 path segments。

### 查询算法

- `latestInstant()`：只看 active path 可见 slice 的最大 instant。
- `listSlices()`：按 active path segments 查可见 slice，合并后按 instant 排序；`limit` 仍表示最近 N 个 active path slice。
- `findMutationsForSubject()`：按 active path segments 查 mutation：
  - root 段：`branchId=root AND instant <= childForkInstant`
  - 中间段：`branchId=branch AND instant > parentForkInstant AND instant <= childForkInstant`
  - active 段：`branchId=active AND instant > parentForkInstant AND instant <= at`
- `findSliceByInstant()`：先根据 instant 定位它属于 active path 的哪个 segment，再按 `(branchId, instant)` 查询。

### 写入 / 编辑 / 删除

- `writeSlice()`：
  - 目标 instant 必须位于 active branch 可写段：root branch 无下界；子分支必须 `instant > activeBranch.forkInstant`。
  - 冲突检查改为 active path 内冲突；不同 inactive branch 同 instant 允许存在。
  - 新 slice 写入 active branch，mutation 同步写 `branchId`。
- `createSubject()`：
  - subject 身份仍全局唯一，不分支。
  - schema default init slice 写入 active branch；若 active branch 是子分支且 init time `<= forkInstant`，应拒绝并提示切换到拥有该历史的 branch 或选择更晚 time。
- `editSlice()`：
  - 只能编辑 active branch 自己拥有的 slice。
  - 如果 slice 来自祖先继承段，返回 409：这是 inherited slice，不能在当前 branch 原地改；需要 rollback 到该点开新分支，或 switch 到 owning branch 后编辑。
  - 移动 instant 时也必须保持在 active branch 可写段。
- `deleteSlice()`：
  - 仍是物理删除 cleanup，但只允许删除 active branch 自己拥有的 slice。
  - inherited slice 不能从子分支删除，避免影响其他分支。

### issues 行为

- A/E issues 的 op 规则不变，但扫描范围从全局 timeline 改为 active path。
- backfill 写到 active branch `forkInstant` 之前或等于 forkInstant：硬拒绝，不进入 issue 通道。
- `listSlices` 的 slice issues 只对当前 active path 可见 slice 现算。

## Facade / HTTP / Agent 计划

### Facade 新增方法

```ts
listBranches(projectPath: string): Promise<WorldBranchListResult>;
switchBranch(projectPath: string, branchId: string): Promise<WorldBranchSwitchResult>;
rollback(projectPath: string, input: {sliceId: string; name?: string}): Promise<WorldBranchRollbackResult>;
```

现有 `writeSlice/editSlice/deleteSlice/getWorldState/queryState/listSlices/createSubject` 默认使用 active branch，不增加必填参数。

### HTTP API

新增：

- `GET /api/projects/world-engine/branches`
- `POST /api/projects/world-engine/branches/:branchId/switch`
- `POST /api/projects/world-engine/branches/rollback`
  - body: `{ sliceId: string, name?: string }`

现有 API 返回可考虑增补：

- `listSlices` 每个 slice 返回 `branchId`。
- `getWorldState` / `state/query` 可选返回 `branchId` / `activeBranchId`，但第一版可以先通过 `listBranches` 查看。

### Agent 工具

新增：

- `list_world_branches`
- `switch_world_branch`
- `rollback_world_branch`

描述必须强调：

- `rollback_world_branch` 是非破坏性开新分支，不是 delete。
- `switch_world_branch` 会改变 Project 当前 active branch，影响后续世界工具调用。
- 所有时间仍使用项目日历字符串；但 rollback 第一版按 `sliceId` 操作，避免自然语言时间歧义。

## 测试计划

只在最合适层加测试，不三层重复同一断言。

### Facade / service 层

覆盖核心语义：

- v1 数据迁移成 `main` branch 后，旧世界状态 / listSlices / queryState 保持不变。
- rollback 到旧 slice 后：
  - 新 branch 继承目标 slice 之前的状态。
  - 旧未来 slice 不出现在新 active path。
  - 在新 branch 写同 instant（旧未来曾使用过）允许，只要 active path 内不冲突。
- 子分支写 `instant <= forkInstant` 被拒绝。
- 子分支不能 edit/delete inherited slice。
- A/E issues 只扫描 active path；inactive branch 不污染当前结果。

### HTTP 层

只测边界序列化与 active branch 持久化：

- `GET /branches` 返回 active branch。
- `POST /branches/rollback` 返回新 branch 并切换 active。
- rollback 后 `GET /slices` 只返回新 active path。

### Agent 工具层

只测工具暴露和关键副作用：

- `rollback_world_branch` / `switch_world_branch` / `list_world_branches` 可调用。
- `switch_world_branch` 后 `list_world_slices` 走新 active branch。

## 文档计划

实现完成后同步：

- 新增 `docs/tasks/56-world-engine/branching.md`。
- 更新 `op-behavior-matrix.md`：
  - 表 1/2/3 前提从「instant 唯一」改成「active path 内 instant 唯一」。
  - 新增「跨分支 × op」行为表。
- 更新 `sqlite-and-api.md`：
  - 写入 `WorldBranch`、`branchId`、active branch、migration v2。
- 更新 `agent-tools.md`：
  - 新增三个 branch 工具。
- 更新 `worked-example.md`：
  - 增加 rollback 开新分支的作者使用示例。
- 更新 `PROJECT-STATUS.md` 和任务 README。

## 推荐实施顺序

1. 数据层迁移：
   - Prisma schema + Project SQLite v2 migration + generated client。
2. Repository branch context：
   - `WorldBranchRepository` 或并入 `WorldEngineRepository`。
   - active path resolve / slice visible query helper。
3. Service 写入 / 查询改造：
   - 所有 read path 先 branch-aware。
   - 再改 write/edit/delete 权限与冲突检查。
4. Facade + HTTP branch API。
5. Agent branch tools + profile 文案。
6. 文档与测试收口。

## 需要用户确认的决策

1. **子分支是否禁止写 `instant <= forkInstant`**  
   推荐：禁止。子分支只拥有 fork 之后的历史；要改 fork 前历史，应 rollback 到更早 slice 或 switch 到 owning branch。

2. **inherited slice 是否只读**  
   推荐：只读。子分支中编辑/删除 inherited slice 会影响其他分支，破坏 append-only 心智。

3. **rollback 的 target 是否只支持 `sliceId`**  
   推荐：第一版只支持 `sliceId`。按时间 rollback 容易落在两个 slice 之间，需要额外定义“继承到哪个切面”；等 UI/Agent 真实用起来再加。

4. **active branch 是否存 ProjectMetadata**  
   推荐：存 `ProjectMetadata.worldEngine.activeBranchId`。Project SQLite 当前没有 Project 表，metadata 是最小侵入点。

5. **deleteSlice 是否继续保留物理删除**  
   推荐：保留，但只允许删除 active branch 自己拥有的 slice。真正“回退”走 rollback branch，不再鼓励用 deleteSlice 表达回退。

## 本轮未做

- 未修改 Prisma schema。
- 未写迁移 SQL。
- 未改 repository / service / API / Agent 工具。
- 未运行测试；本轮是 P2 实现前计划文档。
