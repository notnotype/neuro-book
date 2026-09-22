# t47 迁移门禁与备份边界的独立审查（t49）

审查者：`MigrationReview`。被审 revision：**`8263726e`**（t47 增量）。只读审查：未改产品代码、产品测试与 t47 目录；
新增文件只在本 Task 的 `walkthroughs/` 下。

---

## 一、结论先行

> **后续更新**：本节是 `8263726e` 的首轮裁定。t47 已按 R1–R5 返工，追加复核（见文末「追加复核（修复后）」）
> 的最终裁定是 **修复成立、建议合并**（F1/F2/F3/F5 闭合；F4 残留为 F6）。

**首轮裁定：需修复 1 项后再合并（F1）；其余部分建议合并。**

被审增量最核心的两件事——「原件先于任何重写被固化」与「逐目标条件导入」——我无法证伪：

- **Q1 时序**：用一个**真实迁移控制器**（真实 HTTP 宿主 + 真实 data 导入 + 真实 `installLegacyBucketWriterPolicy`）
  给**被审 revision 的 store** 装门禁，写回确实只保留捕获值；同时给出逆向对照：门禁缺失时同一路径会把运行期值写回旧桶
  （探针能看见缺陷，正向结论才有意义）。
- **Q5 幂等**：在**真实重启语义**（每次都是新的迁移控制器 + 新的 HTTP 访问）下，目标写入中断后重启只补未完成项；
  已写入目标不重复写；已回收（墓碑被 reclaim 成"从未创建"）的目标不复活；完成标记只写一次。
- **Q4 条件导入**：另一客户端先写的目标值保持权威；用户重置后的目标不被旧值覆盖。

需要修复的是**「原件保护」这条边界上的核验承诺**：

- **F1（P2）**：清单已存在时，续跑路径**完全不碰备份边界**（探针 2 实测：零读零写），因此被截断/被交换/缺失的分块
  不会被发现，而快照仍报 `phase: complete`。也就是说"data 原件备份 + 回读核验"只在第一次写入时成立。
- **F2（P2，dev 路径）**：模块被重新实例化（HMR 语义）时，生产注册插件会抛 `STORAGE_DEFINITION_INVALID`，
  与 `product-definitions.ts` 注释里"dev HMR 重新执行插件不会产生重复注册冲突"的说法不符（探针 4）。
- F3/F4/F5（P3）：容量声明不闭合、交付证据的用例数不实、一处对应用例在完成态是空操作（断言强度空洞）。

另外有 8 条非阻断观察（第八节），其中第 1、2、6、8 条对 t48 的接线最直接。

---

## 二、被审范围与工作树状态

| 项 | 值 |
| --- | --- |
| 被审 revision | `8263726e84ca96b7c07d5c0b1bab535bb855c58b` |
| worktree | `.worktree/w00003-neurobook-ui-foundation-migration`（分支 `refactor/w00003-nb-ui-adoption`） |
| 探针配置 | `walkthroughs/probes/vitest.probes.config.ts`（并列配置，未改产品 `vitest.config.ts`） |
| 探针统一命令 | `cd <worktree>/packages/neuro-book && bun x vitest run --config <worktree>/.agents/works/w00003-neurobook-ui-foundation-migration/tasks/t49-migration-review/walkthroughs/probes/vitest.probes.config.ts` |

### 被审文件 SHA256

取的是**被审 blob**（`git show 8263726e:<path> | sha256sum`）。工作树中这些文件以 CRLF 检出，
因此工作树文件的哈希与其 blob 哈希不同，这是行尾差异，不是内容漂移（`git status` 中它们未被标记为修改）。

| SHA256 | 文件 |
| --- | --- |
| `0c3fcf416abde3bd8436f13aa68699545227733775420cf7ecfc38311ad0696d` | `.agents/works/w00003-neurobook-ui-foundation-migration/tasks/t47-legacy-state-migration/README.md` |
| `41f42d76000deecaed06ff0d063311b2deed03f6eafc18802b712e451611a5aa` | `.../t47-legacy-state-migration/walkthroughs/implementation.md` |
| `642df0db1ae15e1e1f541263c20ad236511a047f03868add942efb6e35fcd5b1` | `packages/neuro-book/app/plugins/storage-migration.client.ts` |
| `68a74562ac18762b2c5d19b954aa8df004d33db5b57aef83b35bf17d1076eb11` | `packages/neuro-book/app/stores/novel-ide-legacy-writer.test.ts` |
| `a5490f74d4f72af857a546a531fbced15a0f3f3687bddf1b5fb634dd09093828` | `packages/neuro-book/app/stores/novel-ide.ts` |
| `3e325609f84170afa188d6a52d7841e561faf46a4238dbd336d4757b6e1b5bac` | `packages/neuro-book/app/utils/workbench/layout.ts` |
| `7b14f060f487ed6765350ae2f84f67f916ade6daec656e166316f7488e7b7045` | `packages/neuro-book/app/utils/workbench/storage-migration-legacy-bucket.test.ts` |
| `9205c1b1e89a1e608cf27cff56bc7659e7d5489710f461996e20ca861c6b9c48` | `packages/neuro-book/app/utils/workbench/storage-migration-legacy-bucket.ts` |
| `736cf04877e6f2a3af27d24f34e524f1a479551453a0744ef6c30a621d732859` | `packages/neuro-book/app/utils/workbench/storage-migration.test.ts` |
| `9f65157a0627bd119163d2d384e9a5fb8600747353ab783fcd31451e1f301744` | `packages/neuro-book/app/utils/workbench/storage-migration.ts` |
| `2e80723c1e55030c6f4497a822ef355615c96cf01a5687e29e5cd1b06f5b53f1` | `packages/neuro-book/server/plugins/storage-definitions.ts` |
| `8362e74b5b045934591ce6b0e6777245e43782b0c44e4f5627ea237af8c8e23c` | `packages/neuro-book/server/storage/product-definitions.ts` |
| `0c8c9f6042d25b3272493fdef858f8770fb67824350dda21b8dd98aa3f31eb15` | `packages/neuro-book/server/storage/workbench-migration-e2e.test.ts` |
| `b3af998a7f567f22711e8ba4c68ebb164013e8e58a346337cf556962d263da3f` | `packages/neuro-book/shared/storage/workbench-migration.ts` |
| `8919332cc4a7b5573555a9a850ed80202af479832b6765bbb616cf37279604d7` | `packages/neuro-book/shared/storage/workbench-state.ts` |

### 工作树并行编辑（影响证据采集方式，不影响被审结论）

审查期间 t48 正在同一 worktree 编辑 `app/stores/novel-ide.ts`、`app/pages/index.vue`、`WorkbenchShell.vue`、
`server/storage/product-definitions.ts` 等（`git status` 可见）。16:10 起工作树的 `novel-ide.ts` 出现
重复声明而无法解析（`[PARSE_ERROR] Identifier 'WorkspaceEditorKind' has already been declared`，见第三节命令 2），
因此：

- Q1 探针**不直接 import 工作树的 store**，而用被审 revision 的逐字节副本
  `walkthroughs/probes/fixtures/novel-ide-8263726e.ts`（提取命令与哈希见文件头与上表）。
- 第三节命令 2 的 5 例失败是 t48 半成品导致的加载失败，**不是**被审 revision 的缺陷；
  同一命令在我开始审查时（t48 尚未落盘该文件）为 4 文件 44 例 exit 0。

---

## 三、命令与退出码

| # | 命令（cwd = `<worktree>/packages/neuro-book`） | 退出码 | 结果 |
| --- | --- | --- | --- |
| 1 | `bun run test app/utils/workbench/storage-migration.test.ts app/utils/workbench/storage-migration-legacy-bucket.test.ts app/stores/novel-ide-legacy-writer.test.ts server/storage/workbench-migration-e2e.test.ts`（16:01，t48 未落盘前） | 0 | 4 文件 / 44 例通过 |
| 2 | 同上（16:10，t48 改了 store 之后） | 1 | 3 文件 / 39 例通过；`novel-ide-legacy-writer.test.ts` 5 例因 `novel-ide.ts` 解析失败未运行（t48 半成品） |
| 3 | `bun run test app/stores app/utils/workbench server/storage/workbench-migration-e2e.test.ts shared/storage` | 0 | 12 文件 / 139 例通过 |
| 4 | 探针统一命令（5 文件 9 例），连跑两次 | 0 / 0 | 5 文件 / 9 例通过，两次一致 |

（命令 3 与命令 1 的差异很关键：t47 交付记录写的是"聚焦测试 49 例（22 + 20 + 5 + 2）"，
实际 `storage-migration-legacy-bucket.test.ts` 是 **15** 例，合计 **44** 例。见 F4。）

---

## 四、探针（每个都先写"它试图证伪哪条声明"）

夹具：`walkthroughs/probes/probe-harness.ts`（真实 HTTP 宿主 + 真实浏览器适配器 + 动作流水 + 可注入写入失败）。

| 探针 | 试图证伪的声明 | 结果 |
| --- | --- | --- |
| `q1-staging-before-writer.probe.test.ts` | 「暂存早于旧 writer」「门禁在写回前生效」「固定三字段」「退役后回到默认」 | 未能证伪（含逆向对照） |
| `q3-backup-integrity.probe.test.ts` | 「分块 + 清单 + 回读核验能发现截断/缺块/块被改写/顺序错乱」「续跑只补未完成项」 | **证伪**（清单存在时续跑完全不核验） |
| `q3-capacity-boundary.probe.test.ts` | 「8 MiB 原件 + 元数据嵌在 9 MiB 分区内」 | **证伪**（转义后超容量；真实宿主上永久 `backup-failed`） |
| `q5-completion-retry.probe.test.ts` | 「重启后只续跑未完成项、不重复导入、不回滚已有目标」「完成后重置不重新迁入」 | 未能证伪；另证伪一条对应用例的断言强度 |
| `q7-registration-hmr.probe.test.ts` | 「同一实例重复登记幂等 ⇒ dev HMR 重复执行插件不冲突」 | 前半成立、**后半证伪**（模块重载后抛 `STORAGE_DEFINITION_INVALID`） |

### 探针 1（Q1）— 未能证伪，且带逆向对照

- 逆向对照：不装门禁时，改 `leftPanelWidth = 999` 后写回为 `999`（探针确实能看见"泄漏"）。
- 真实路径：`await migration.staged` 之后 `legacyBucketWriterPolicy()` 为 `pinned` 且字段等于捕获值；
  store 水合得到 `427 / 488 / compact`；改三个字段 + `activeLeftTab` 后写回是
  `{leftPanelWidth: 427, agentPanelWidth: 488, projectPickerLayoutMode: "compact", activeLeftTab: "search"}`。
- 退役：调用 `retireLegacyBucketWriterPolicy()` 后同一路径写回 `leftPanelWidth: 999`
  ——**retired 之后 serializer 与 storage 都是直通**（见第八节第 6 条）。

### 探针 2（Q3）— 证伪「续跑会核验原件备份」

1.8 MiB 旧桶（含中文与 emoji，5 块）跑完一次迁移后，用**产品写动作**制造损坏，每次都用**新的控制器**重跑：

| 损坏 | 重跑快照 | 对备份边界的动作 | 损坏是否仍在 |
| --- | --- | --- | --- |
| `chunk-000` 截断成 16 字符 | `complete`（`backup: "none"`） | **零读零写** | 仍在（拼接摘要 ≠ 原件摘要） |
| `chunk-000` 与 `chunk-001` 交换 | `complete` | **零读零写** | 仍在 |
| 回收 `chunk-002` | `complete` | **零读零写** | 仍缺块 |

对照：只有把**清单与完成标记**都回收掉（回到"这次迁移还没结束"）才会重写分块并核验，此时拼接结果恢复为原件、
摘要相等。变体：备份边界的**墓碑**（`remove` 未 reclaim）在清单缺失时被按"不存在"重建（deviation 5 成立），
但在清单存在时同样不会被处理。

### 探针 3（Q5）— 未能证伪

- 书架目标写入失败 → `blocked: import-failed`、两个工作面各写 1 次、进度 4 条（全 `imported`）；
  重启前把 `user-assets` 工作面重置并回收 → 新控制器续跑：只写书架目标 1 次，工作面**零写**、记录未复活、
  进度 5 条、完成标记 1 次。
- 另一客户端先写 `idle={300,320}` 与 `editorial` → 迁移不覆写（`idle` 零写、书架零写），
  逐目标结论为 `already-present`；随后用户重置并回收这两个目标 → 新控制器 `complete` 且记录仍不存在、
  完成标记未被改写。
- 对照（断言强度）：`phase === "complete"` 后调用 `retry()`，动作流水**为空**。

### 探针 4（Q7）— 前半成立，后半证伪

- 同一模块实例连续执行插件两次 → 注册幂等，`bind` 正常。
- `vi.resetModules()` 重新实例化模块图（HMR 的语义：Vite 失效一个模块会连带失效 importer，
  而宿主注册表按仓库自己的 `storage-host-hmr.test.ts` 设计跨重载存活于全局槽）后执行插件 →
  抛 `STORAGE_DEFINITION_INVALID`；重载后的定义实例 ≠ 注册表里的实例；老实例仍可服务（`bind` 仍 200）。

### 探针 5（Q3 边界）— 证伪容量声明

用产品自己的分块器与 `serializeStorageRecord` 计算：8 MiB 原文（全是 `"`）虽被暂存接受、每块都在 1 MiB 单条上限内，
但按记录文件字节合计**超过** 9 MiB 分区（也超过 8 MiB 原文本身）。真实宿主上的后果：`blocked: backup-failed`、
`retryable: true`，第二次运行同样失败（原件没进 data 备份，迁移永不完成）。

---

## 五、逐问题裁定

| 问题 | 裁定 | 主要证据 |
| --- | --- | --- |
| Q1 暂存早于旧 writer | **成立**（多标签互斥与门禁时序均未被证伪） | 探针 1；`useNovelIdeStore(` 全部调用点都在组件 `setup`/composable 内（27 处，无插件/模块级）；`novel.ide.local` 全仓只有 store 一个写者 |
| Q2 冻结语义 | **成立** | 探针 1；损坏 JSON 的三字段按"都缺失"固定、其它字段照常保存（产品用例）；未迁字段仍按新值写回 |
| Q3 备份完整性 | **不成立**（写时成立、续跑不成立） | 探针 2、探针 5；F1、F3 |
| Q4 条件导入 | **成立** | 探针 3；六分类映射与墓碑/高版本保护由产品用例覆盖；目标墓碑与备份边界墓碑的相反处理有明确注释依据（deviation 5），探针 2 的变体证明"必要时重建"确实生效 |
| Q5 进度与完成标记 | **成立** | 探针 3；完成标记只写一次、属于其它版本时不改写也不当已完成 |
| Q6 状态可观察 | **成立（分类不混同、无静默成功）** | 探针 3（`import-failed` + `retryable`）、探针 2（`backup` 字段语义见第八节第 2、3 条）；未注册时的失败经真实 HTTP 可见（夹具初次运行即暴露 `STORAGE_STATE_UNREGISTERED`） |
| Q7 生产注册入口 | **部分不成立（HMR）** | 探针 4；t48 已在同一数组追加定义且未新建第二个插件（`git diff 8263726e -- server/storage/product-definitions.ts`） |
| Q8 断言强度 | **存在空洞** | F4、F5；另有第八节第 1、2、7 条（`fields` 折叠、`backup` 语义、8 MiB 用例的输入类） |

**Leader 修正的那处测试类型断言**：`app/stores/novel-ide-legacy-writer.test.ts` 的
`let installedStorage: FakeWebStorage | undefined` + `installLocalStorage()` 与 `preparePinia()` 中的
`if (storage === undefined) throw new Error("测试未安装 localStorage 替身")` —— 语义未变：
校验仍在、用的仍是同一个替身对象，且 store 与门禁仍经 `globalThis.localStorage` 解析（`installLocalStorage` 同时写两处），
5 例在 t48 改动之前的运行中全绿。

---

## 六、缺陷清单

### F1（P2）续跑时不再核验 data 原件备份 —— 截断/错序/缺块会静默通过

`app/utils/workbench/storage-migration.ts:518-526`：清单读到 `value` 且与浏览器暂存一致时直接 `return`，
既不读分块也不再核验。叠加 `runImport` 的完成标记短路（`:373`），已完成迁移的任何一次重启
**对备份边界零动作**（探针 2 实测），却报 `phase: complete`。
后果：用户原件在 data 侧的副本被截断/改序/丢失时，迁移照常宣告完成，且 `verifyOriginalBackup` 永远不会发现。
对照：浏览器暂存侧每次启动都会重算摘要（`parseStoredOriginal`），同一份原件的两份副本核验策略不一致。

### F2（P2，dev 路径）模块重载后注册插件抛错

`server/storage/product-definitions.ts:9`（注释）与 `:28`（模块级数组）：注释断言"同一实例重复登记是幂等操作，因此 dev HMR 重新执行插件不会产生
重复注册冲突"，但注册表按实例身份判定（`shared/storage/definition.ts` 的 `register`/`resolve`），
模块级数组在**模块重新实例化**后就是新实例。探针 4 用仓库自己的 HMR 机制（全局槽保留注册表 + `vi.resetModules()`）
复现：插件抛 `STORAGE_DEFINITION_INVALID`。而"编辑定义文件（t48 被要求追加定义的位置）→ 重载"正是会触发该路径的流程。

### F3（P3）8 MiB 暂存上限与 9 MiB 备份分区声明不闭合

`shared/storage/workbench-migration.ts:11`（容量注释）、`:33-34`（原件上限）、`:41-42`（分区常量）声明"8 MiB 原件 + 元数据嵌在 9 MiB"，
但暂存上限按**原文 UTF-8 字节**、分区容量按**记录文件字节**，`"`/`\` 各占两字节：
只要原文里这两类字符占比超过约 12.5%，被暂存接受的 8 MiB 原件就放不进声明的分区（探针 5）。
后果限于"接近上限且转义密集"的旧桶（真实旧桶只有几 KiB），但按该声明做验收会得到错误结论。

### F4（P3）交付证据的用例数不实

`tasks/t47-legacy-state-migration/walkthroughs/implementation.md:168` 记录聚焦测试为"49 例（22 + 20 + 5 + 2）"，
在 `8263726e` 上实际是 **44** 例（该文件 15 例，`git show 8263726e:... |
grep -c '^\s*it('`）。退出码与"12 文件 139 例"的域级记录均可复现。

### F5（P3）"完成后目标被重置并回收墓碑"用例在完成态调用 retry()，是空操作

`app/utils/workbench/storage-migration.test.ts:580-591`：`start()` 已把 `phase` 带到 `complete`，
而 `:591` 的 `retry()` 在 `phase === "complete"` 时直接返回快照，
因此该用例的两处断言（`saveCount` 仍为 1、目标仍为空）**不依赖被声称的机制**即可通过
（探针 3 的对照用例证明该重跑零动作）。
完成标记真正生效的路径由同文件"第二个标签页读取同一完成标记"覆盖，因此这是断言强度问题而非覆盖空洞。

---

## 七、未验证项

1. **真实浏览器**：未启动 dev server、未访问 3001，因此"书架 / A-B 尺寸 / 双标签刷新"仍需 t48 的浏览器验收；
   本审查的启动顺序结论是"源码事实 + 真实 persist 运行时的隔离测试"（与 t47 deviation 2 相同口径）。
2. **两个真实标签页的 IndexedDB 并发**：环境无 `fake-indexeddb`，且不联网安装；暂存互斥沿用产品单测的
   手写 IDB 替身（顺序化调用），因此"同源重叠事务由浏览器串行化"这一条我**没有**独立实测，只有产品用例与规范依据。
3. **全包 `nuxt typecheck` 与全量测试**：未跑（Leader 统一执行，且 t48 正在并行编辑）。
4. **版本降级/共存**：分块地址 `chunk-000` 不随迁移版本隔离（`workbenchMigrationChunkResource`），
   `ensureBackupChunk` 对 `unsupported-version` 走 `repair`。今天的 v1 只有一份迁移，未实测跨版本影响。
5. **完成标记属于其它版本的实时 HTTP 行为**、**身份不可持久恢复的真实浏览器表现**：只读了产品用例与源码。

---

## 八、非阻断观察

1. **快照的逐字段结论是跨目标折叠的**：同一字段在 `surface:user-assets` 上 `imported`、在 `surface:idle` 上
   `already-present` 时，快照报 `imported`（`OUTCOME_PRIORITY` 把"写入过"排在前）；逐目标真相只在进度记录里。
   用 `fields[].outcome` 做"哪个目标被保护/墓碑"的判断会失真（探针 3 有实测值）。
2. **`backup` 字段是"本次运行"的，不是"本次迁移"的**：已完成迁移的新一次启动报 `backup: "none"`
   （完成标记短路，根本不走到备份步骤），而 data 侧备份其实存在。消费者不能用它判断"原件是否已备份"。
3. **导入阶段的网络错误分类为 `import-failed` 而不是 `backend-unreachable`**：`backend-unreachable` 只覆盖
   上下文签发失败；两者都可重试、诊断文本仍带原因，但文案分派会与 Q6 的分类说明略有出入。
4. **"清单与暂存不一致""完成标记属于其它版本"这两条 guard 报 `retryable: true`，但任何重试都不会成功**
   （清单不会被覆盖、标记不会被改写）。`retryable` 在这里更接近"可再点一次"而非"能解决"。
5. **原件与身份分别在两个 IndexedDB 库**（`nbook.storage-migration` / `nbook.storage-client`），
   与清单不一致的 guard 只有在"只清掉其中一个库"时才会触发；真实浏览器通常按源清空，因此该路径罕见但不可自愈。
6. **`retireLegacyBucketWriterPolicy()` 之后 serializer 与 storage 都是直通**（探针 1 实测）：
   t48 文档里"必须同时移除 `storage`/`serializer`，否则 serializer 会把捕获值重新写回旧桶"只在
   `pinned` 窗口内成立；退役后留着它们不会重新固定字段。移除仍更干净，但这条措辞会让人误判风险等级。
7. **"8 MiB 分块后单条不超 1 MiB"的用例只喂了 `"x".repeat(...)`**：
   注释声称覆盖"最坏逐字符转义"，但最坏情况是控制字符（6 字节/字符）与 `"`/`\`（2 字节/字符），
   输入类与声明类不等价（探针 5 用同一条推理算出分区溢出）。
8. **给 t48 的现场提醒（被审 revision 之外）**：工作树里 `app/stores/novel-ide.ts` 把
   `export type {WorkspaceEditorKind, ...}` 改成了 `import type`，与同文件已有的 `type WorkspaceEditorKind`
   重复声明（当前该文件无法解析，5 例 t47 store 用例因此跑不起来）。另外该文件新增了**模块级无条件**的
   `retireLegacyBucketWriterPolicy()`：它不等 `storageMigrationSnapshot().fields` 终态、也不看 `phase`，
   t47 文档要求的"移除前确认"这一步被省掉了；顺序上它发生在暂存之后（store 由组件 `setup` 实例化），
   因此不破坏"暂存早于旧 writer"，但迁移期固定会在 store 首次实例化时结束——消费切换若尚未完成，
   用户在旧桶上的尺寸调整就既进不了旧桶也进不了新 authority。

---

# 追加复核（修复后，R1–R5）

**最终裁定：修复成立，建议合并（`correct`）。F1、F2、F3、F5 经独立复测确认闭合；F4 的残留是证据数字的时点问题（见 F6）。**

被审状态：t47 返工为**未提交的工作树改动**（基线仍为 `8263726e`）。返工要求见
[`t47/.../leader-rework-requirements.md`](../../t47-legacy-state-migration/walkthroughs/leader-rework-requirements.md)（R1–R5），
实现记录见 [`t47/.../implementation.md`](../../t47-legacy-state-migration/walkthroughs/implementation.md) 的「返工记录」小节。
下列哈希是**工作树内容**的 SHA256（未提交；工作树为 CRLF 检出，与 blob 哈希不可比）。

| SHA256（工作树内容） | 文件 |
| --- | --- |
| `7d72e90e6fc885c15ab4969324cff85e779de701797c49e194ab5b06e6608cd1` | `packages/neuro-book/app/utils/workbench/storage-migration.ts` |
| `4c48204617a8db361539fbaaec2263637e30f4db6ffb13914ab9126cfa1dc269` | `packages/neuro-book/shared/storage/workbench-migration.ts` |
| `e76f5a93beb625be3ac21b5855667f741791ee0066076e0862cb85bfd264db32` | `packages/neuro-book/server/storage/product-definitions.ts` |
| `c85a5456d6ea1e906ed409bba936ba24d17f36f655931c54005ec07cc26500b8` | `packages/neuro-book/app/utils/workbench/storage-migration.test.ts` |
| `400a0eccc8e03bb44525e29947b956b8e500dcb2edf88057206a0221904cc012` | `packages/neuro-book/server/storage/workbench-migration-e2e.test.ts` |
| `9757a1c23af4018ce4aa8a551d28890613e68fd371c1bf90dda43444422281e8` | `packages/neuro-book/app/utils/workbench/storage-migration-legacy-bucket.ts`（未改） |
| `b5af6377025247edc5902c4841102a964b6c26687adfdcf4ffdaa036b387e2a3` | `packages/neuro-book/app/stores/novel-ide-legacy-writer.test.ts`（t48 增量重写，非本 Task） |
| `6409d077c5ac0d9c50d4235270d11b625a5276450031af2393b81b164a43b242` | `t47/.../walkthroughs/implementation.md` |
| `02a142e72deec6ca18deefc77c6aaaf1fc7b7aca7076fbe8e9de8853b19c7741` | `t47/.../walkthroughs/leader-rework-requirements.md` |

探针文件（本 Task，已按新合同改写并扩例）：
`4c503e77564794740e084d5dc3f88ad0b87a6176063e137bbfe4324514bd3306` `probe-harness.ts`、
`9970b9209cb2dc0264c7946e88d3c4b302c2080504103c9264c702589877247e` `vitest.probes.config.ts`、
`b22d9d12cdec30d081d5ca1d4294220dc4fa1b16b02d4876f686c1fc52acba32` `q1-staging-before-writer.probe.test.ts`、
`4a2827210640da62933a4b87dd3c4eb36df7d825ebf824c9a10dfd25e0a119a1` `q3-backup-integrity.probe.test.ts`、
`677d9b8ac5ec16d898552f2a8d3efe085481f6143b1a7e7fdea9029c77717877` `q3-capacity-boundary.probe.test.ts`、
`119f45ae054faf74466eefe1c2e0c9f26a197185bc2f919a1bb0ad11d9c8669d` `q5-completion-retry.probe.test.ts`、
`11f25206d57b91d197475a4c4f21126554d8c443819d330be4e48c43f34581d7` `q7-registration-hmr.probe.test.ts`。

## R1–R5 逐条裁定

| # | 裁定 | 我的独立证据 |
| --- | --- | --- |
| R1 续跑核验 | **成立** | 见下「R1」小节：5 类损坏 × 自动路径全部 `blocked/backup-failed` 且**零写**；显式 `retry()` 才重写并恢复摘要；健康续跑只读不写；清单缺失但未完成时仍**自动**续跑完成 |
| R2 HMR 幂等 | **成立** | 重载后插件不抛错、`productStorageDefinitions()` **同一数组实例**、注册表解析回同一实例、两个 owner 仍可 `bind`；连续两次重载仍幂等 |
| R3 容量口径 | **成立** | 估算 ≥ 真实记录文件字节（14 个样本含代理对/控制字符/引号密集）；~7.5 MiB 旧桶：投影 ≤ 9 MiB 且**磁盘实际记录字节 ≤ 9 MiB 且 ≤ 投影**、迁移完成、分块拼回一致；超容原件给 `backup-capacity-exceeded`/`retryable:false`/零写/`pinned` |
| R4 数字如实 | **部分成立** | 本 Task 自有文件复现正确（`storage-migration.test.ts` 26、`legacy-bucket` 15）；但表里的 `novel-ide-legacy-writer.test.ts` 现值 **6 例**（非 4，t48 增量又加了 2 例），故该命令现为 **4 文件 51 例**（26+15+6+4），见 F6 |
| R5 用例走机制 | **成立** | 两处收尾断言已改为新建控制器（`controller(harness, staging)` + `start()`），完成标记被忽略时目标会被重新导入 ⇒ 断言可失败；机制本身在真实宿主上的等价路径由探针 3 覆盖 |

### R1（探针 2，真实隔离根 + 真实 HTTP，每步都是新控制器）

| 场景 | 自动路径（`start()`） | 备份边界动作 | 显式 `retry()` |
| --- | --- | --- | --- |
| 健康续跑（完成标记存在） | `complete`、`backup: "saved"` | **只有 read**（含 `read:original-chunk/chunk-000`） | — |
| `chunk-000` 截断 | `blocked/backup-failed`、`retryable: true`、诊断指认 `chunk-000` | 零写 | 重写并用摘要复核后 `complete` |
| `chunk-000` 被换成 `chunk-001` 文本 | 同上，诊断含「顺序错乱」 | 零写 | 同上 |
| `chunk-002` 被回收 | 同上，诊断指认 `chunk-002` | 零写 | 同上 |
| `chunk-000` 文件被写成不可解析内容 | 同上（读回 `corrupt`） | 零写 | 走 `repair` 后 `complete` |
| `chunk-001` 为删除标记 | 同上（读回 `deleted`） | 零写 | 走条件 `save` 后 `complete` |
| 清单写入中断（有块、无清单、无完成标记） | **自动续跑**：补写清单 → 核验 → `complete`，分块拼回原件 | 有写（补缺失部分） | — |
| 完成后清单被回收 | `complete`、`backup: "none"`，**不重建**、零写；且完成态 `retry()` 是空操作 | 只有 `read:original` | 无恢复路径（见遗留观察 2） |

修复后 `retry()` 真能恢复：`measureLegacyOriginal(拼接结果).digest === measureLegacyOriginal(BUCKET).digest`，
且 `backupActionsSince(...)` 里出现了非 read 动作（重写发生）。

### 命令与退出码（追加复核，cwd = `packages/neuro-book`）

| # | 命令 | 退出码 | 结果 |
| --- | --- | --- | --- |
| 1 | 探针统一命令（5 文件） | 0 | **5 文件 / 12 例通过**（改写后扩例：9 → 12） |
| 2 | `bun run test app/utils/workbench/storage-migration.test.ts app/utils/workbench/storage-migration-legacy-bucket.test.ts app/stores/novel-ide-legacy-writer.test.ts server/storage/workbench-migration-e2e.test.ts` | 0 | **4 文件 / 51 例**（26 + 15 + 6 + 4；作者记录为 49，见 F6） |
| 3 | `bun run test app/utils/workbench/storage-migration.test.ts app/utils/workbench/storage-migration-legacy-bucket.test.ts shared/storage` | 0 | **4 文件 / 56 例**（与作者记录一致） |

## 遗留观察（追加复核新增）

1. **`retry()` 在运行中到达时不会升级为修复模式**：`run()` 在 `running !== null` 时先返回在途 promise，
   再才设置 `repairBackup`。用户在自动运行尚未收口前点一次"重试"不会触发重写；状态仍为
   `blocked/backup-failed`（`retryable: true`），需要第二次点击。属单飞行语义的取舍，建议 t48 的文案不要假设"点一次必修复"。
2. **完成态的副本丢失没有恢复路径**：清单被回收后自动路径按设计不重建（`backup: "none"`），
   而 `retry()` 在 `phase === "complete"` 时是空操作（探针 2 实测零动作）。
   原件此时仍在浏览器暂存（每次启动重算摘要核验），因此不是"原件丢失"，但 data 侧这份副本无法再生；
   若后续切片（t48 第 6 步）退役浏览器暂存，这条边会变成唯一的恢复来源，建议那时补一个"完成后重建备份"的入口。
3. **完成态的 `phase` 也会因为副本损坏变成 `blocked`**：这是 R1 的刻意效果（不再静默报 complete），
   但 t48 的加载/未保存反馈不要把 `blocked` 一律说成"迁移未完成"——迁移本身可能早已完成，需要修的是原件副本。
4. **每次启动都读回备份分块**（≤ 22 条记录）：作者已声明这是价格；实测健康续跑的分块读取动作数与分块数一致，无写。

## 前次缺陷的闭合状态

- **F1（P2）续跑不核验副本**：闭合（探针 2 全部场景复测，含五类损坏与显式修复路径）。
- **F2（P2）模块重载后注册抛错**：闭合（探针 4：不抛错 + 同实例复用 + 宿主继续服务）；代价如实记录在文件头注释与实现记录里。
- **F3（P3）容量声明不闭合**：闭合（探针 5：投影上界成立、真实分区不越界、超容给不可重试分类且不写半份）。
- **F4（P3）交付数字**：本 Task 自有文件的两处数字已如实；跨任务文件（t48 重写）的计数仍是时点值，见 F6。
- **F5（P3）完成态空操作 retry**：闭合（两处用例改为新控制器；机制在真实宿主上由探针 3 复核）。

## F6（P3）交付表里的合计用例数是时点值，当前不可复现（49 → 51）

`t47/.../implementation.md` 的「返工后的命令与用例数」表记录 `4 文件 / 49 例`（26 + 15 + 4 + 4）。
其中本 Task 自有文件的两项**复现正确**（`storage-migration.test.ts` 26、`storage-migration-legacy-bucket.test.ts` 15），
但 `app/stores/novel-ide-legacy-writer.test.ts` 已被 **t48 增量**再次重写并扩展到 **6 例**
（`grep -c '^\s*it('` = 6：含"装载 store 模块不退役门禁""store 装载前后都不主动写旧桶"等新用例），
因此现在跑同一条命令得到：

```
Test Files  4 passed (4)
      Tests  51 passed (51)
```

影响：复核者按表核对会得到"比记录多 2 例"的结论，无法判断是记录错还是漏跑。
修复只需要一行：在表里注明该文件的用例数由 t48 增量拥有（或交付时点重取）。

---

# 追加复核（第二轮：F6 闭合 + 在途 retry 修复）

**裁定：两处都已闭合，最终结论仍为「修复成立、建议合并」（`correct`），无遗留缺陷。**

第二轮改动位置：`walkthroughs/implementation.md`（数字与已知后续项）、
`app/utils/workbench/storage-migration.ts`（`retry()` 在途语义）、`app/utils/workbench/storage-migration.test.ts`（新增在途用例）。
只读复核，我未改任何产品文件。

## 1. F6（交付数字）——已闭合

作者把两张表改为「本 Task 自有文件 27 + 15」并注明另两个文件的计数归 t48 增量、交付时点复测。我复测：

| 命令 | 退出码 | 我实测到的结果 | 与记录一致 |
| --- | --- | --- | --- |
| `bun run test app/utils/workbench/storage-migration.test.ts app/utils/workbench/storage-migration-legacy-bucket.test.ts app/stores/novel-ide-legacy-writer.test.ts server/storage/workbench-migration-e2e.test.ts` | 0 | 4 文件 / **52 例**（26→**27** + 15 + 6 + 4） | ✅ 一致 |
| `bun run test app/utils/workbench/storage-migration.test.ts app/utils/workbench/storage-migration-legacy-bucket.test.ts shared/storage` | 0 | 4 文件 / **57 例**（27 + 15 + 7 + 8） | ✅ 一致 |

（逐文件 `grep -c '^\s*it('`：27 / 15 / 6 / 4，与表一致。）

## 2. 在途 `retry()`（我上一轮遗留观察 1）——已修复，且我独立复测成立

新实现（`storage-migration.ts`）：`retry()` 先 `await` 在途运行收口，再按 `repairBackup: true` 跑一次；
`phase === "complete"` 的短路保持不变。**新的风险面**是"这一次点击到底有没有真的修复、会不会跑两遍"，
因此我用**读取闸门**（挂在完成标记读取上）把自动运行卡在途，再派发一次 `retry()`：

| 断言（探针 `q3-backup-integrity.probe.test.ts`，真实 HTTP + 真实磁盘） | 结果 |
| --- | --- |
| 自动运行先按"只报告不修复"收口：`phase: blocked`、`blocked: backup-failed`，`chunk-000` 仍是坏值 | ✅ |
| 同一次点击的重试最终 `complete`、`blocked: null`、`backup: "saved"` | ✅ |
| 损坏之后 `chunk-000` 上的写动作**恰好 1 次**（既没被当成重复调用丢掉，也没跑两遍） | ✅ |
| 完成标记写**恰好 1 次**（没有因为两次运行而改写） | ✅ |
| 分块拼回原件与摘要复核通过 | ✅ |

作者新增的等价单测（`storage-migration.test.ts` 的"在途运行时到达的显式重试…"）用的是同一套时序注入
（`holdNextRead`）并断言"自动路径先收口、重试随后修复"，与我的真机探针结论一致。

## 3. 第二轮的其它确认

- 我上一轮的遗留观察 2（完成后清单被回收时无重建入口）已被作者记为**已知后续项**并绑定到第 6 步退役浏览器暂存的前提
  （`implementation.md:257-259`），与我的判断一致：本增量不重建有完成标记语义，但退役暂存前必须补"从现存原件重建备份"的入口。
- 遗留观察 3（完成态因副本损坏而 `phase: blocked`）与观察 4（每次启动读回分块）仍是**刻意取舍**，无新增证据要求改变。
- 完成态 `retry()` 仍是空操作（探针 `q5` 的对照用例继续通过）；`start()` 仍永不修复（探针 `q3` 的五类损坏自动路径零写继续通过）。

## 4. 第二轮命令与退出码

| # | 命令（cwd = `packages/neuro-book`） | 退出码 | 结果 |
| --- | --- | --- | --- |
| 1 | 探针统一命令（5 文件，含新增在途用例） | 0 | **5 文件 / 13 例通过**，连跑两次一致 |
| 2 | t47 聚焦命令（含 t48 重写文件） | 0 | 4 文件 / 52 例 |
| 3 | t47 scope 命令 | 0 | 4 文件 / 57 例 |

探针文件哈希（第二轮，仅增例与闸门夹具）：
`q3-backup-integrity.probe.test.ts` = `879bae0c624a74f71623919627828aa87ee33645871b5ab19774e1daff02fbb0`、
`probe-harness.ts` = `8d0927ceef87c9374f688817f5296a6785f88b8df40ead0a6e78d824a9cd277d`。

### 第二轮复核锚定的确切内容（工作树 SHA256）

下面的哈希是我第二轮**实际跑过命令**的内容（首轮表里 `storage-migration.ts` 等文件的哈希是 R1–R3 改动前，
与这里不同是正常的：那几行在第二轮被改过）。第二轮的探针与产品用例都在这份内容上 exit 0：

| SHA256（工作树内容） | 文件 |
| --- | --- |
| `d9f13da82384b99ece35aec5cd3a5720677f05272a6b1982c0d2e89e1da12163` | `packages/neuro-book/app/utils/workbench/storage-migration.ts`（含在途 `retry()`） |
| `87fb74f56feddfbbd4c008ce7748f2844de6f6fa9fade9222c0736be390e3f68` | `packages/neuro-book/app/utils/workbench/storage-migration.test.ts`（27 例，含在途用例） |
| `f0300abefc8ffb798e38f89c1c265ee9f3d8325fab2ec111b3ac81032488e806` | `t47/.../walkthroughs/implementation.md`（数字 + 已知后续项） |

复核收尾时的实测（对上述内容）：探针 **5 文件 / 13 例 exit 0**；t47 聚焦命令 **4 文件 / 52 例 exit 0**。
