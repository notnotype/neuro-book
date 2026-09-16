# t47 旧状态迁移门禁与原件保护 — 实现记录

Task：[t47-legacy-state-migration](../README.md)。合同依据：[迁移合同](../../../../../packages/neuro-book/docs/migrations/storage-state.md)、
[storage.persistence](../../../../../docs/specs/storage/persistence.md)、[storage.boundaries](../../../../../docs/specs/storage/boundaries.md)。
工作位置：worktree `.worktree/w00003-neurobook-ui-foundation-migration`，分支 `refactor/w00003-nb-ui-adoption`。

## 结果

应用启动时按固定顺序完成三字段旧值保护与导入：浏览器暂存（含回读核验）→ 写回门禁 → data 原件备份（分块 + 清单 + 回读核验）→
逐目标条件初始化 → 进度登记 → 完成标记。全程可中断可续跑：已有记录/墓碑/未知高版本不被旧值覆盖，非法字段只记诊断并保留原件，
暂存失败才冻结整桶，后端不可达只阻断本次导入、不影响未迁字段 writer。

```
启动：插件（enforce: pre）─ 等 staged ─► 应用挂载 ─► useNovelIdeStore()（首次水合 + 注册写回订阅）
             │                                              │
             ├─ 浏览器暂存（IndexedDB，单事务读-判-写 + 回读核验）
             └─ 安装写回门禁（pinned / locked）  ←───────────┘ 门禁先于任何写回生效

后台：user 会话 ─► workbench.migration 句柄 ──► 完成标记? ─► 进度 ─► 原件备份（块→清单→核验）
                                              └► workbench.layout 句柄 ─► 逐目标读分类 → 条件初始化 → 进度
                                              最后写完成标记（只写一次）
```

## 变更清单

新增（12 个文件）：

| 文件 | 作用 |
| --- | --- |
| `packages/neuro-book/shared/storage/workbench-state.ts` | 迁移目标定义（`workbench.layout`）：显式 user 工作面尺寸 + 书架模式；面板默认宽度的唯一来源 |
| `packages/neuro-book/shared/storage/workbench-migration.ts` | `workbench.migration` 专用备份边界定义：原件清单/分块/进度/完成标记与容量 |
| `packages/neuro-book/app/utils/workbench/storage-migration-legacy-bucket.ts` | 旧 `novel.ide.local` 原件暂存（IndexedDB 互斥）、度量与分块、迁移期写回门禁（storage + serializer） |
| `packages/neuro-book/app/utils/workbench/storage-migration.ts` | 迁移适配器：阶段推进、data 备份、逐项条件导入、进度/完成标记、快照与订阅、`retry()` |
| `packages/neuro-book/app/plugins/storage-migration.client.ts` | 启动接线：`enforce: "pre"` + 等暂存结算，data 导入转后台 |
| `packages/neuro-book/server/storage/product-definitions.ts` | 单一定义清单模块（模块级实例，重复注册幂等）+ `registerProductStorageDefinitions()` |
| `packages/neuro-book/server/plugins/storage-definitions.ts` | 唯一的 Nitro 注册插件（只调用清单模块） |
| `app/utils/workbench/storage-migration.test.ts` | 迁移适配器单测（21 例） |
| `app/utils/workbench/storage-migration-legacy-bucket.test.ts` | 暂存与门禁单测（20 例） |
| `app/stores/novel-ide-legacy-writer.test.ts` | 真实 persist 运行时下的写回门禁与启动时序（5 例） |
| `server/storage/workbench-migration-e2e.test.ts` | 生产注册入口 + 真实 HTTP 的迁移链路（2 例） |

修改（2 个文件）：

- `packages/neuro-book/app/stores/novel-ide.ts`：`novel.ide.local` 持久化条目增加 `storage: legacyBucketStorage()` 与
  `serializer: legacyBucketSerializer`（迁移期写回门禁）。`pick` 列表**未改**——移除三个字段属 t48。
- `packages/neuro-book/app/utils/workbench/layout.ts`：`SHELL_LEFT_PANEL_DEFAULT_WIDTH` / `SHELL_RIGHT_PANEL_DEFAULT_WIDTH`
  改为从 `shared/storage/workbench-state.ts` 读同一份常量（迁移合同要求"默认尺寸从产品唯一常量读取"）。

无变更：`shared/storage/**` 既有合同文件未改（只新增两个定义模块）；`server/storage/**` 既有实现、`app/utils/storage/**` 生产适配器、
`packages/nb-ui/**` 均未改；两个用户 dirty 文件 `app/utils/workbench/descriptors{,.test}.ts` 未被触碰。

### Leader 补充约定的落实

- **单一定义清单 + 一个 Nitro 插件**：新增 `server/storage/product-definitions.ts`（模块级 `productStorageStates` 数组 +
  `registerProductStorageDefinitions()`）与唯一的 `server/plugins/storage-definitions.ts`（只调用前者）。**不**为每个 owner 建插件；
  t48 把 grid 布局等定义追加到同一个数组（格式与位置写在该文件顶部注释和本文的「t48 接线约定」）。
- **迁移备份定义放能被 Nitro 与 app 同时 import 的位置**：`shared/storage/workbench-migration.ts`（迁移原件/进度/完成标记）与
  `shared/storage/workbench-state.ts`（迁移目标）都是纯定义模块，不 import Vue/Pinia/Nuxt；`app/utils/workbench/storage-migration.ts`
  只消费它们。
- `shared/storage/**` 既有合同文件（`contract.ts`、`definition.ts`、`bounded-json.ts`、`projection.ts`、`action.ts`、`host.ts`、
  `storage-errors.ts`）**未修改**，本次只在同目录新增上述两个定义模块。

## 实现要求 1–6 的落地

1. **暂存早于旧 writer** — `storage-migration-legacy-bucket.ts` 的 `createIndexedDbLegacyBucketStaging`：
   `readwrite` 事务内"读已有记录 → 缺失时读旧桶、写记录"，提交后再用第二个事务回读核验；原件带 `source`/`version`/`capturedAt`/
   `byteLength`（UTF-8 字节）/`digest`，上限 8 MiB。既有记录直接复用（`已有原件时不再读旧桶、不覆盖` 用例），
   属于其它迁移版本的记录按 `conflict` 拒绝。启动顺序证据见下一节。
2. **迁移期冻结** — `legacyBucketSerializer` 把 `pick` 输出的三个源字段替换为捕获值（原本缺失的保持缺失），
   `legacyBucketStorage` 在 `locked` 时拒绝 `setItem`；完整旧 JSON 损坏时三字段按"都缺失"固定、其它字段继续按默认保存
   （`完整旧 JSON 损坏时…` 用例）。后端不可达只在导入阶段阻断，桶仍为 `pinned`（`后端不可达…` 用例）。
3. **data 原件备份** — `ensureOriginalBackup()`：先写 `chunk-000…` 分块（单块原文预算 384 KiB），最后写清单，随后逐块读回拼接比对
   `digest` + `byteLength`；身份不可恢复时不签发任何句柄、不开始导入、不登记完成、不清源（`身份不可持久恢复…` 用例）。
   备份记录在 `workbench.migration` 的 user/local 分区，不与尺寸目标同分区，也不被目标的删除/回收影响。
4. **逐项条件导入** — `importTarget()`：读分类 → `value`/`legacy-value` ⇒ `already-present`、`deleted` ⇒ `tombstoned`、
   `unsupported-version`/`corrupt` ⇒ `protected`、`missing` ⇒ 用合法源值按 `read.credential` 条件初始化；
   条件写冲突时重读目标并按目标权威值记录，不用源覆盖（`已有目标…`、`墓碑目标…`、`未知高版本目标…` 用例）。
   目标记录字段可缺省：源里没有的字段记 `source-missing` 且不写默认值。
5. **进度与完成标记** — 每个目标确认写入后 `tracker.record()` 追加（目标 × 字段）条目；重跑按终态条目跳过，未完成项续跑
   （`目标写入中断…`、`进度登记中断…`、`完成标记写入中断…` 用例）。完成标记只写一次（`expected.revision === null`），
   冲突后不改写；属于其它版本/来源时按 `completion-unprotected` 报告且 `retryable: false`。
6. **状态可观察** — `StorageMigrationSnapshot { phase, blocked, diagnosis, retryable, bucket, original, backup, fields }` +
   `subscribe()` / `retry()`；`blocked` 用互不混同的分类：`original-staging-failed` / `identity-unrecoverable` /
   `backend-unreachable` / `backup-failed` / `import-failed` / `progress-unreadable` / `progress-unprotected` /
   `completion-unreadable` / `completion-unprotected`（`暂存失败与后端不可达、身份不可恢复互相可区分` 用例）。

## 启动顺序证据（实际核对方式与结果）

**为什么暂存一定早于旧 writer（源码事实，非文件名排序推断）：**

1. `pinia-plugin-persistedstate` 的水合与写回订阅都发生在 **store 首次实例化**：
   `node_modules/pinia-plugin-persistedstate/dist/index.js:83-96` 里 `persistences.forEach(...{ hydrateStore(store, p, context);
   store.$subscribe((_mutation, state) => persistState(state, p), {detached: true}) })`——水合本身不写回，写回来自随后的状态变更订阅。
2. Nuxt 在挂载前逐个 await 客户端插件：`node_modules/nuxt/dist/app/entry.js:60-67`（`await applyPlugins(nuxt, plugins)` →
   `app:beforeMount` → `vueApp.mount(...)`）；`node_modules/nuxt/dist/app/nuxt.js:150-185` 的 `applyPlugins` 对非 `parallel`
   插件按列表顺序 `await promise`。
3. 插件顺序由 `enforce` 决定：`node_modules/nuxt/dist/index.mjs:6402-6406`（`orderMap.pre/default/post`）与 `:8436`（按 `order` 排序）
   → 本插件声明 `enforce: "pre"`，排在所有默认插件之前。
4. 应用侧没有任何模块在导入期或插件里实例化该 store：`useNovelIdeStore(` 的全部调用点都在组件 `setup`/composable 内
   （`WorkbenchShell.vue:57`、`app/pages/index.vue:116`、`ProjectPickerScreen.vue:49` 等）。

**实际核对（测试，不是推断）：** `app/stores/novel-ide-legacy-writer.test.ts` 用**真实** `pinia-plugin-persistedstate`
（`createPersistedState`，并安装进一个空 Vue 应用，因为 Pinia 在安装前只把插件排队）跑**真实** `novel-ide` store 定义：

- `旧桶的读取与写回都发生在 store 首次实例化时，模块加载不碰旧桶`：模块加载后 `localStorage` 读次数为 0，首次实例化才出现读取
  → 插件的 `staged` 等待确实发生在旧 writer 首次动作之前。
- `安装门禁后水合与写回都只保留捕获值…`：改 `leftPanelWidth`/`agentPanelWidth`/`projectPickerLayoutMode` 三点后写回仍是捕获值，
  未迁字段（`activeLeftTab`）按新值保存。
- 负向对照 `未安装门禁时旧 writer 会把运行期尺寸写回源字段`：不安装门禁时同一路径写出 `leftPanelWidth: 999`
  → 反证"冻结必须在任何写回之前生效"不是形式要求。
- `整桶冻结时不写回旧桶（偏好仅内存生效）`：`locked` 下写入被拒、内存值仍生效。

未运行的真实浏览器核对（偏差 4）。

## 端到端可达性证据

`server/storage/workbench-migration-e2e.test.ts`（隔离临时根 + 真实 `127.0.0.1` 端口 + 真实 H3 路由）：

- `注册前 workbench.migration 不可达，Nitro 插件注册后经真实 HTTP 可读写`：注册前 `bind` 返回 `STORAGE_STATE_UNREGISTERED`；
  以 `defineNitroPlugin` 恒等替身调用**产品插件本体** `server/plugins/storage-definitions.ts` 后，`bind` 成功、`save`/`read`
  往返成功，且记录文件落在 `fixture.root` 内的 Storage 分区（`host.recordPath` 断言）。
- `迁移适配器经真实浏览器适配器走完备份与导入（隔离根 + 真实端口）`：`createStorageMigration` 配真实
  `openStorageUserContext` / `openStorageOwnerHandle` / `createStorageHttpTransport`（仅注入身份替身与浏览器暂存替身），
  跑完得到 `phase: complete`、`backup: saved`；随后直接读盘核验 `original` 清单含原件摘要、`original-chunk/chunk-000` 含原文、
  `workbench.layout` 的 `surface-sizes/{idle,user-assets}` 与 `shelf-mode` 记录、`completion` 标记均已写入。

## t48 接线约定

**目标定义（t48 消费，勿改 owner/key/schemaVersion）** — `shared/storage/workbench-state.ts`：

| 目标 | 地址 | 形状 |
| --- | --- | --- |
| 显式 user 工作面尺寸 | `workbench.layout` / `surface-sizes`（user/local，identified，resource ∈ `idle`、`user-assets`） | `{leftPanelWidth?: number, agentPanelWidth?: number}`，字段缺省 = 没有已确认值，显示回落产品默认且不落盘 |
| 书架模式 | `workbench.layout` / `shelf-mode`（user/local，single） | `"grid" \| "compact" \| "editorial"` |

产品默认尺寸的唯一常量是 `WORKBENCH_LEFT_PANEL_DEFAULT_WIDTH` / `WORKBENCH_AGENT_PANEL_DEFAULT_WIDTH`（同文件），
`app/utils/workbench/layout.ts` 以 `SHELL_*_DEFAULT_WIDTH` 重新导出。

**主工作台 Project 内尺寸**由 t48 自己的 grid 定义承担（project/local），迁移**不会**把旧全局值复制给 Project；
Project 首次进入使用产品默认。

**迁移状态消费** — `app/utils/workbench/storage-migration.ts`：

- `storageMigrationSnapshot(): StorageMigrationSnapshot`、`subscribeStorageMigration(listener)`、`storageMigrationController()`（含 `retry()`）。
- `phase`：`idle | staging | staged | running | complete | blocked`；`staged` 表示原件已固化、门禁已装（可开始读新 authority）。
- `fields: {field, outcome, diagnosis}[]`，`outcome` 为 `null` 表示本次尚未处理；非 null 即为该字段的终态
  （`imported | already-present | tombstoned | protected | invalid-source | source-missing`）。
- 门控不必阻塞写入：导入是**条件初始化**（`revision: null`），t48 先写会以 `STORAGE_REVISION_CONFLICT` 收口为 `already-present`，
  不会覆盖 t48 的值。`blocked` 分类可直接用于加载/未保存反馈的文案。

**旧 writer 退役（t48 第 5–6 步）** — `app/stores/novel-ide.ts` 的 `novel.ide.local` 条目：

- 从 `pick` 移除三个字段后，必须同时移除 `storage: legacyBucketStorage()` 与 `serializer: legacyBucketSerializer`
  （否则 serializer 会把捕获值重新写回旧桶）；随后调用 `retireLegacyBucketWriterPolicy()`（同文件导出，语义 = 迁移期结束）。
- 移除前请确认 `storageMigrationSnapshot().fields` 三个字段都已终态或 `phase === "complete"`。

**服务端定义追加（唯一注册入口）** — `server/storage/product-definitions.ts`：把 t48 的 grid 布局等定义
（`defineStorageState` / `defineGridLayoutState` 的实例）追加到模块级 `productStorageStates` 数组；文件顶部注释已写明该约定。
**不新建第二个 Nitro 插件**：`server/plugins/storage-definitions.ts` 保持只有 `registerProductStorageDefinitions()` 一行。
实例只在模块级构造一次，dev HMR 重复执行插件是幂等注册（E2E 用例已连续调用两次插件验证）。

## 测试与命令

cwd：`packages/neuro-book`（worktree 内）。命令：`bun run test <path...>`（`vitest run`）。

| 命令 | 退出码 | 结果 |
| --- | --- | --- |
| `bun run test app/utils/workbench/storage-migration.test.ts app/utils/workbench/storage-migration-legacy-bucket.test.ts app/stores/novel-ide-legacy-writer.test.ts server/storage/workbench-migration-e2e.test.ts` | 0 | 4 文件 / 49 例通过（22 + 20 + 5 + 2） |
| `bun run test app/stores app/utils/workbench server/storage/workbench-migration-e2e.test.ts shared/storage` | 0 | 12 文件 / 139 例通过（含既有 storage/workbench/store 套件回归） |
| `bun x tsc -p tsconfig.t47.json`（临时配置，只含本次改动闭包；已删除该临时配置） | 2 | 剩余错误全部是既有环境噪声（`nb-ui` 的 `.vue` 模块解析、`jsdom`/`turndown` 缺声明、`app/composables/useDialog.ts` 的 `.vue` 导入）；本次改动文件 0 错误 |

临时 `tsconfig.t47.json` 仅用于本次自查，已删除；全包 `nuxt typecheck` 按 Task 要求留给 Leader。

覆盖矩阵（Task README 的验证清单 → 用例）：

- 正常旧值 / 缺失字段 / 非法 JSON / 非法字段 / 已有目标 / 墓碑 / 未知高版本 → `data 原件备份与逐项导入` 7 例。
- 四处中断续跑：原件保存、目标写入、进度登记、完成标记写入 → `中断续跑` 4 例（映射说明见偏差 1）。
- 两标签并发：另一标签先写目标（条件写冲突后重读，不覆盖）+ 第二个标签读同一完成标记不重复导入 → `并发与身份` 2 例；
  暂存互斥（已有原件不重读旧桶、不覆盖）→ 暂存 1 例。
- 身份不可持久恢复（刷新两次不产生导入、恢复稳定身份后只导入一次、完成后不再重新导入）→ 1 例；
  完成后目标被重置并**回收墓碑**后旧值不重新迁入 → 1 例。
- 暂存回读核验失败（`readback-mismatch`）、data 备份失败（`backup-failed`，保留暂存与源字段、可重试、不误判完成）→ 各 1 例。
- 完成标记/进度读取失败不得当作未迁移 → 各 1 例。

## 未运行项与偏差

1. **"旧桶清理处中断"未实现为 t47 用例。** 迁移合同第 6 步（清理旧桶内已迁字段、退役浏览器暂存）依赖 t48 的 `pick` 移除与
   目标核验，属下一增量；本 Task 的第四处中断改用**完成标记写入中断**（同样验证"重启后续跑、不重复导入、不回滚已有目标"）。
   t47 不清理任何旧桶字段：序列化器只做固定，暂存记录保留至完成步骤退役。
2. **未运行真实浏览器/Source Dev 宿主。** 启动顺序用真实 persist 运行时的隔离测试 + Nuxt 源码调用点证明；
   真实浏览器验收（书架、A/B 尺寸、双标签刷新）是 t48 的必做项。本 Task 未访问 3001，也未启动任何 dev server。
3. **8 MiB 上限按 UTF-8 字节度量。** 存储层单条上限就是序列化字节数（`captureStorageJsonValue`），分块预算同样按字节，
   中文旧桶会被更早判定为超限（此时按"无法先保留原件"冻结整桶并给出重试），不会产生写不进去的备份。
4. **损坏 JSON 的三字段按"都缺失"固定**（不写回运行期值）。合同只说"其它字段用各自默认并允许正常保存"；
   这样做的效果是：迁移期旧 writer 永远不会把运行期尺寸/书架意图写成旧桶里的新值，损坏原件仍完整保留在浏览器暂存与 data 备份里。
5. **备份区的 `deleted`（墓碑）按"不存在"处理**（必要时重建），与迁移**目标**的墓碑语义相反：
   目标墓碑是用户重置的证据（不重新导入），备份边界是迁移器自己拥有的原件副本，重建才符合"原件保护"。
6. **冲突后进度合并策略**：另一个标签页并发写进度时，合并后只再提交一次；同键冲突保留本标签页记录（两者描述同一事实）。
   目标本身仍由条件写裁决，不依赖进度。
7. 未写 `shared/storage/workbench-*.ts` 的专属单测：它们的校验/容量/分块行为由适配器测试与 E2E 覆盖
   （注册校验、分块往返、非法值分类、真实 HTTP 读写）。
