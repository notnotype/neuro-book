# World Engine 工具集：清理旧协议 + 四项优化（P0–P3）

> Completed task. 本文记录 World Engine 工具集旧协议清理、P0-P3 落地与验证结果。

## Relative documents refs

- `docs/tasks/67-world-engine-zod-schema-codeact/README.md` —— 8→2 工具 / Zod schema / CodeAct 迁移的来源任务（本任务是它的收尾）。
- `docs/tasks/64-world-engine-prompt-engineering/README.md` —— 提示词侧已对齐 2 工具 API。
- `reference/world-engine/schema-system.md`、`reference/world-engine/calendar-system.md`、`reference/world-engine/subject-lifecycle.md`、`reference/world-engine/workflow.md` —— World Engine 契约参考。
- `docs/archived/reference/world-engine-api-migration-zod.md` —— 旧→新迁移指南（已从 active reference 归档）。
- `scripts/seed-world-engine-demo.ts` —— 现成的端到端验证夹具（用 agent 工具种 13 subject / 11 切面，已可跑通）。

## User Request / Topic

- 用户先让用脚本调 agent 的 World 工具给 `workspace/ming-ding-zhi-shi-2` 种典型示范数据（已完成，见 seed 脚本），借此**实测工具好不好用**。
- 随后要求**评估工具集**并**清理旧代码/旧工具/旧协议**，同时落地评估中提出的四项优化 P0–P3。
- 用户明确：本任务**交给下一个 agent 执行**；本文档即交付物。

## Goal

/goal 让 World Engine 工具集端到端只剩一套新协议（`patches`/`path`/4-op，术语统一为 `patch`），并落地 P0–P3 优化，verified by `bun test server/world-engine server/api/projects/world-engine server/agent/tools` 全绿 + 重跑 `scripts/seed-world-engine-demo.ts`（含新增的「集合按值删」演示）E issues=0 + `bun run typecheck` 通过，同时不回归 Workbench 前端的 timeline / 全量状态视图。边界：只动 `server/world-engine/**`、`server/agent/tools/world-engine-tools*`、`server/api/projects/world-engine/**`、`prisma/project.schema.prisma` + 生成 client、相关 reference/profile 文档与 seed 脚本；前端只动必要的 API 调用点。每步先证后写：改一层补一层测。若 prisma 改名导致生成 client 断裂或前端契约无法兼容，停下报告卡点。

## Current State（上一轮已查证的事实）

- **运行时代码已干净**：只读 `patches`/`path`，op 仅 `{replace, increment, remove, append}`。`SliceInput.patches`（`server/world-engine/types.ts:383`，注释「当前运行时唯一写入格式」），service 全程 `input.patches`。
- **旧协议残留几乎全在测试**：`server/world-engine/world-engine.facade.test.ts`（~40 例用 `mutations`/`attr`/`collectionAdd`/`collectionRemove`/`set`/`add`/`listAppend`/`withMutations`，大概率红）、`server/api/projects/world-engine/[...segments].test.ts`（~140+ 旧 op、`TestSliceMutation` 用 `attr`）、`server/world-engine/codeact.test.ts`（3 处 `mutations`）、`server/workspace-files/workspace-files.test.ts`（L2072-2082 一段旧 blob）。`app/utils/world-engine-preview.test.ts:74,120` 还提到旧工具 `edit_world_slice`。
- **术语漂移**：DB 表 `WorldMutation` 实存 patch；`server/world-engine/world-engine.repository.ts` 用**裸 SQL** 引用表名（L124/136/143/182/225/233/268/294/299 等 ~10 处）+ 类型 `WorldMutationRow`/`WorldMutationSqlRow`/`toMutation`/`findMutationsForSubject`。表由 `prisma/project.schema.prisma` 定义，client 生成在 `server/generated/project-prisma/**`。
- **P0 体验坑（实测）**：`remove` 对集合数组只能按下标删（`patch-operations.ts:153` `applyRemove` 仅 index/key）。旧 API 本有按值删的 `collectionRemove`（见 facade.test:140），迁移后丢失。service 层 `validateValue`（`world-engine.service.ts:754-758`）对所有 remove 一律拒 value；HTTP `PatchSchema.superRefine`（`[...segments].ts:27-34`）同样 blanket 拒。
- **P2 冗余**：`getWorldState` = 无过滤 `queryState`。前端 `app/components/novel-ide/world-engine/WorldEngineWorkbenchDialog.vue` 同时用 `GET /state`（loadFullSnapshot，L585-611）和 `POST /state/query`（loadSelectedSliceSnapshots，L543）。
- **P3 冗余**：`execute_world_query` 的 `codePath` 分支（`world-engine-tools.ts:21,158-178`）仅测试用到（`world-engine-tools.test.ts:78-98`），无生产使用；inline `code` 才是常态。沙盒读 API（`world.get/getMany/list/findRefs/searchText/slices/now`）与 facade 读方法（`listWorldSubjects/listSlices/getWorldState/queryState`）命名有漂移。

## Decisions / Discussion（已与用户确认）

1. **范围 = 全部 P0–P3**。
2. **旧测试：删除后写精简新套件**（不逐例搬运；只覆盖关键路径，旧特性映射到新等价行为，如 `collectionAdd 去重` → `append 去重`）。
3. **`WorldMutation` 连表一起改名 `WorldPatch`**：prisma schema + 重生成 client + repository 裸 SQL + 类型/函数名全改；现有 `project.sqlite` 世界数据丢弃可接受，靠 seed 脚本重建。
4. 前端 `WorldEngine*Mutation*Editor/Builder.vue` 等 UI 命名**本轮不做大规模改名**（已有 `*PatchEditor.vue` 并存）；仅改 P2/P3 必需的 API 调用点。组件命名统一 + 可能的 mock/preview 死代码清理列为后续单独一轮。

## Execution Notes（补充分析 / 2026-06-27）

- 任务启动时仓库仍能查到本文描述的主要残留：`WorldMutation` 表/类型/裸 SQL、`getWorldState`、`listWorldSubjects`、`execute_world_query.codePath`、旧 `mutations/attr/6-op` 测试大片存在。因此本任务不是纯文档清理，而是协议收口 + 测试收口。
- **P2 边界要谨慎**：`reference/world-engine/subject-lifecycle.md` 仍把「Agent / 业务查询必须传 `subjectIds` 或 `type`」作为防全量倾倒契约。执行 Phase 4 时可以让 service/facade 的 `queryState({at})` 具备内部全量能力，但 `POST /state/query` 公开入口建议继续保留收窄校验；`GET /state` 作为 UI/debug alias 内部调用全量 query 即可。除非用户再次明确改变 Agent 查询边界，否则不要让 Agent 可裸拉全世界。
- **P0 语义钉死**：`remove + value` 只补回 collection 按值删除；list 按值删应返回 issue / 拒绝，不能改变 list 的时间顺序语义。无 `value` 的 remove 继续保持原本按 path/index 删除和路径不存在幂等。实现时必须用 `navigateToValue(state, parts)` 取 path 处数组本身，不要用 `navigateToParent` 误删整个属性。
- **旧测试删除前先立覆盖矩阵**：精简新套件至少覆盖写切面 + 首写自动创建/default init、4 op（含 collection 按值删）、ref 校验与 dangling-ref、E/A issues、`queryState` 投影/listLimit、calendar 时间边界、slice edit/delete、subject filter、HTTP 入参校验。避免把旧大测试删掉后丢失这些核心行为证据。
- **术语清理范围要分层**：运行时、DB、repository、types、seed、reference 应统一为 patch；前端 `Mutation*` 组件名和 preview/mock 的历史命名本轮只处理阻断测试或公开文案，不做大规模 UI 文件改名。

## Completion Update（完成状态 / 2026-06-27）

- **P0 已完成**：collection `remove + value` 贯通 `patch-operations` / service value 校验 / HTTP `PatchSchema` / Agent 工具描述；collection 按 stable JSON 值删除，找不到幂等；list `remove + value` 被拒绝。
- **P1 已完成**：Project SQLite 表、Prisma schema/client、repository 裸 SQL、types、service/facade、seed reset 统一为 `WorldPatch`；Project DB 初始化会删除旧 `WorldMutation` 表，seed 对旧库会先初始化再重置。
- **P2 已完成**：service/facade 删除 `getWorldState`，内部 `queryState({})` 支持全量；HTTP `GET /state` 作为 UI/debug alias 内部调用全量 `queryState`；公开 `POST /state/query` 继续要求 `subjectIds` 或 `type` 收窄。
- **P3 已完成**：`execute_world_query` 删除 `codePath` schema/分支，只保留 inline `code`；失败代码落盘 `.temp/` 行为保留。facade/service 读 API 命名收敛到 `listSubjects`。
- **测试已收口**：`world-engine.facade.test.ts`、HTTP route test、`codeact.test.ts`、`world-engine-tools.test.ts`、`patch-operations.test.ts` 已使用 `patches/path/4-op`；`workspace-files.test.ts` 的旧示例 blob 已改新协议；`world-engine-preview.test.ts` 不再拒绝所有 `remove + value`。
- **文档/Profile 已收口**：`PROJECT-STATUS.md`、`reference/world-engine/schema-system.md`、`subject-lifecycle.md`、`reference/agent/leader-default.md`、`profile-routing.md`、`leader.default.profile.tsx`、`world.engine.profile.tsx` 已同步；`reference/world-engine/api-migration-zod.md` 与 `.claude/workflows/implement-world-engine-zod-refactor.js` 已归档到 `docs/archived/`。
- **最终审计补洞**：repository 残留的 `updateMutationVector` 已改为 `updatePatchVector`，service 内部校验 mode 从 `"mutation"` 改为 `"patch"`；重跑目录级 `server/world-engine` 时发现 Gregorian calendar 公元前日期往返会卡住，已修复内部 `year=0`（公元前 1 年）正反向换算。

## Implementation Walkthrough（执行步骤）

### Phase 0 — 基线
跑 `bun test server/world-engine server/api/projects/world-engine`（沙盒外提权），存档哪些红哪些绿，作为删/重写依据。

### Phase 1 — P0：集合按值删
- `server/world-engine/patch-operations.ts`：dispatch（~L77）`case "remove"` 传入 `patch.value` 和 `uniqueArrays`；`applyRemove`（L153）新增**前置分支**——`value !== undefined` 时用 `navigateToValue(state, parts)` 取 `path` 处**数组本身**（**不是 `navigateToParent`**，否则会删掉整个属性），判集合性（复用 append 同款 `attrPath = path.slice(1).replace(/\//g,".")` + `uniqueArrays.has(attrPath)`）：collection 则 `stableJson(item)===stableJson(value)` 找到并 `splice`（找不到幂等）；list 则返回 `invalid-path` issue「list 不支持按值删」。`value===undefined` 走原逻辑。复用现成 `stableJson`/`navigateToValue`/`parseJsonPointer`。
- `server/world-engine/world-engine.service.ts`：`validateValue`（L754-758）改条件——`remove+value` 仅 `collection` 放行并 `validateTypedValue` 校验元素类型，其余 kind 仍拒 value。`validateOp`（L744 collection 已含 remove）不动。
- `server/api/projects/world-engine/[...segments].ts`：`PatchSchema.superRefine`（L27-34）删「remove 不能提供 value」这条，交给 service 判；保留「非 remove 必须有 value」。
- `server/agent/tools/world-engine-tools.ts`：`value` 已 optional；更新 `write_world_slice` description，写明 collection 可按值删。

### Phase 2 — P1a：术语统一 + 表改名 WorldPatch
- `prisma/project.schema.prisma`：`model WorldMutation` → `WorldPatch`（含 `WorldSlice` 关系字段），重跑 prisma generate 刷新 `server/generated/project-prisma/**`。
- `server/world-engine/world-engine.repository.ts`：裸 SQL `"WorldMutation"` → `"WorldPatch"`；类型/函数 `WorldMutationRow`/`toMutation`/`findMutationsForSubject` → patch 词。
- `server/world-engine/types.ts`：`WorldMutationRow` → `WorldPatchRow`。
- `scripts/seed-world-engine-demo.ts`：`reset()` 的 `DELETE FROM WorldMutation` → `WorldPatch`。
- `app/utils/world-engine-preview.test.ts`：去掉/改写 `edit_world_slice` 旧工具断言（L74/120）。
- 归档过期文档：`reference/world-engine/api-migration-zod.md`、`.claude/workflows/implement-world-engine-zod-refactor.js` 移到 `docs/archived/`，同步 `reference/world-engine/README.md` 去链接。

### Phase 3 — P1b：删旧测试 + 写精简新套件
- 删/重写：`world-engine.facade.test.ts`、`[...segments].test.ts`、`codeact.test.ts`、`workspace-files.test.ts`（L2072-2082 blob）。
- 新套件（lean）只盖关键路径：写切面 + 首写自动创建、4 op（含 collection 按值删）、ref 校验、issue E/A 分类、`queryState`（含空过滤=全量，见 Phase 4）、日历串时间边界。
- `patch-operations.test.ts` 在 remove 区块补 P0 用例：collection 按值删成功/幂等、list 按值删报错、object 元素深相等删。

### Phase 4 — P2：合并 getWorldState → queryState
- `world-engine.service.ts` + `world-engine.facade.ts`：`queryState` 接受可空过滤（无 `subjectIds`/`type` ⇒ 全量），删 `getWorldState`。
- HTTP：**保留 `GET /state` 端点但内部改调 `queryState({at})`**（前端零改动，最低风险）。
- `POST /state/query` 继续拒绝无 `subjectIds` 且无 `type` 的公开查询，保留 Agent / 业务侧防全量倾倒契约；若决定放开，必须同步更新 `reference/world-engine/subject-lifecycle.md` 并重新评估 CodeAct 查询说明。
- 验证 `WorldEngineWorkbenchDialog.vue` 的 full / narrowed 两条快照路径仍正常。

### Phase 5 — P3：去 codePath + 读 API 命名对齐
- `world-engine-tools.ts`：移除 `execute_world_query` 的 `codePath` 分支与 schema 字段，只留 inline `code`；删 `world-engine-tools.test.ts:78-98` 两个 codePath 用例（失败落盘 `.temp/` 保留）。
- 命名对齐（轻量）：facade `listWorldSubjects` → `listSubjects`（与 `world.list` 同词），同步 HTTP route + 前端调用点；沙盒 `world.*` 不变。

### Phase 6 — 文档/提示词 + 重灌验证
- `reference/world-engine/schema-system.md`：更新 op 表补「collection 按值删」；`WorldMutation` 字样改 `WorldPatch`。
- `assets/workspace/.nbook/agent/profiles/builtin/leader.default.profile.tsx`：patch op 说明补集合按值删。
- `PROJECT-STATUS.md`：记录协议收尾 + 表改名 + P0–P3。

## Verification / Test

1. `bun test <abs>/server/api/projects/world-engine`：通过，5 pass。
2. `bun test <abs>/server/agent/tools`：通过，112 pass。
3. `bun test <abs>/server/world-engine`：通过，111 pass。说明：最终审计前曾因 `gregorian.test.ts` 的「公元前 1 年」往返进入无限循环导致多文件测试不退出；修复 Gregorian calendar 内部 `year=0` 边界后，目录级测试已能正常退出。
4. `bun scripts/seed-world-engine-demo.ts workspace/ming-ding-zhi-shi-2`：通过；写入 11 个切面，E issues=0，collection `remove + value` 删除「初级治疗药水」后 inventory 只剩「学院通行证」「古代徽记」。
5. `bun scripts/seed-world-engine-demo.ts workspace/ming-ding-zhi-shi-2 --verify-only`：通过。
6. 表检查：`SELECT COUNT(*) FROM WorldPatch` 成功，`WorldPatch` 行数 209；查询 `WorldMutation` 抛错，确认旧表不存在。
7. `bun run typecheck`：通过。
8. 验证出入：相对路径形式 `bun test server/world-engine server/api/projects/world-engine server/agent/tools` 可能被当前工作区的 `product/` staged output 镜像测试污染；本轮按源码绝对路径验收。额外跑 `server/workspace-files/workspace-files.test.ts` 大套件时，仍有用户 assets 同步慢测/旧模板覆盖导致的既有失败；与本任务主链路无关，未纳入完成门槛。

## Final Audit（最终残留边界 / 2026-06-27）

- 运行时主链路已无旧入口：`server/world-engine/**`、`server/api/projects/world-engine/**`、`server/agent/tools/**` 中不再保留 `getWorldState`、`listWorldSubjects` 或 `execute_world_query.codePath` 运行分支；`execute_world_query` 作为当前只读工具名继续保留。
- DB / repository 已收口到 `WorldPatch`。`WorldMutation` 的剩余运行时代码命中仅为旧表清理与负向断言：`server/workspace-files/project-workspace.ts` 初始化时 `DROP TABLE IF EXISTS "WorldMutation"`，`scripts/seed-world-engine-demo.ts` seed reset 时删除旧表，`world-engine.facade.test.ts` 断言旧表不存在。repository 向量回填方法已改名为 `updatePatchVector`。
- 仍能搜索到的 `WorldMutation` / `mutations` 命名主要来自前端 Preview / Workbench 的历史 UI draft 名称、旧任务记录、归档 workflow 与本任务说明。前端 `WorldEngine*Mutation*` 组件大规模改名已按本任务决策留作后续，不代表旧写入协议仍可用。
- 仍能搜索到的 `getWorldState`、`listWorldSubjects`、`codePath` 主要来自旧任务文档、归档文档或本任务的历史背景说明。稳定 reference 与 `PROJECT-STATUS.md` 已记录新契约：`queryState` 内部可全量，公开 `POST /state/query` 仍需 `subjectIds` 或 `type` 收窄，`execute_world_query` 只接受 inline `code`。

## Follow-up Update（delete_world_slice + summary / 2026-06-27）

- Agent 工具新增 `delete_world_slice`：输入 `projectPath` 与 `sliceId`，直调 `worldEngineFacade.deleteSlice(projectPath, sliceId)`，只返回 `{issues}`；slice 不存在时抛出明确的友好错误，提示 `sliceId` 不存在或已删除。
- 工具注册已同步到 `server/agent/tools/index.ts` 与 `server/agent/profiles/profile-tools.ts`；`leader.default` 与 `world.engine` profile 可见该工具，`writer` 仍保持 World Engine 只读边界。
- profile 文案已从“两工具 / 无删除工具”收口到当前三工具契约：删除是物理删除、不可恢复，只用于剧情回退或修正错误切面，必须先用 `execute_world_query` 的 `world.slices()` 获取 `sliceId`。
- `summary` 保持当前非 nullable 契约：`WorldSlice.summary` 为必有字符串，DB schema 继续使用 `String @default("")`，HTTP/API/Agent 写入与读取测试覆盖带 summary 的 slice；未引入 `null`。
- 为旧 Project SQLite 增加幂等补列：缺少 `WorldSlice.summary` 时自动执行 `ALTER TABLE "WorldSlice" ADD COLUMN "summary" TEXT NOT NULL DEFAULT ''`。
- profile 测试同步当前契约：`leader.default` settings 缺省值不再因空 settings 崩溃；默认 persona 使用 `personas/caihui-lite.md`；writer payload 继续只注入目标文件、`lorebookEntries` 和 `readablePaths`，不注入旧 Plot IDs。
- 验证结果：
  - `bun test C:/Users/notnotype/Documents/CodeRepository/GithubProjects/neuro-book/server/agent/tools/world-engine-tools.test.ts C:/Users/notnotype/Documents/CodeRepository/GithubProjects/neuro-book/server/agent/tools/builtin-tools-smoke.test.ts`：13 pass。
  - `bun test C:/Users/notnotype/Documents/CodeRepository/GithubProjects/neuro-book/server/world-engine/world-engine.facade.test.ts C:/Users/notnotype/Documents/CodeRepository/GithubProjects/neuro-book/server/api/projects/world-engine/[...segments].test.ts`：15 pass。
  - `bun test C:/Users/notnotype/Documents/CodeRepository/GithubProjects/neuro-book/server/agent/profiles/world-engine-profile.test.ts C:/Users/notnotype/Documents/CodeRepository/GithubProjects/neuro-book/server/agent/profiles/leader-assets-profile.test.ts`：16 pass。
  - `bun run typecheck`：通过。

## TODO / Follow-ups

- [ ] 前端 `WorldEngine*Mutation*Editor/Builder.vue` 等 UI 命名统一为 Patch + 清理可能的 mock/preview 死代码（单独一轮）。
- [ ] `world.searchText`（向量搜索）本轮未实测；可在 seed 脚本造带 embedding 的样本验一遍。
- [ ] 评估 facade 读面与沙盒 `world.*` 是否值得进一步收敛为单一读语义（本轮只做轻量命名对齐）。

## 风险

- 表改名必须重跑 prisma generate，漏跑会 `worldPatch` 类型缺失。
- 旧 `project.sqlite` 世界数据丢弃仅影响 dev；如有需保留的真实项目要提前确认（默认无）。
