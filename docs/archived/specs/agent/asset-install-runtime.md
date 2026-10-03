---
schema: nbook.spec/v1
kind: behavior
status: implemented
capability: agent.assets.install-runtime
owners:
  - workspace-assets
  - agent-runtime
  - product-runtime
---

# Agent 资产运行期安装与 Catalog 根

本文把随版本发布的 Agent/Reference 资产从只读 Seed Source 投影到 State Root，并定义运行期 Catalog、Profile 编译与失败恢复的唯一目标合同。它承接已获用户拍板的 [Agent Asset Install Protocol](../../../packages/neuro-book/assets/reference/agent/agent-asset-install.md)，但不把该协议的目标描述当作当前实现证据。

## 目标与非目标

目标：

- 显式 Runtime 启动前，把 Application/Product 发布输入中的 Agent Seed 安装到 State Root；运行期 Catalog、Profile 编译和 Profile Import 不再把 Application Root 的 Seed 当作 system catalog 层。
- 统一 `Skill`、`Workflow`、`Profile` 的覆盖顺序为 **Install Root → Project Root**；同一 id/key 由 Project Root 覆盖 Install Root，不能逐文件合并。
- 保持 `templates/` 与 `agent/variables/` 的旧投影边界：它们不是三类可安装 Agent 包，不进入 `agent/installed.json`，仍由既有 system-to-user projection 负责。
- 使 Profile artifact 的依赖与 freshness 以稳定逻辑根标识解析，不因 State Root、Product Image 或测试临时根移动而误报 `dependency_changed`。
- 保持逻辑 Reference Import 协议 `reference/**` 不变；显式 Runtime 的物理 Reference 来源必须是 State Root 中经验证的运行期副本，不得回退 checkout 根 `reference/` 或 Application Seed 副本。

非目标：

- 本 Spec 不开放 Workshop/git 下载、第三方包执行、依赖安装 UI、恢复内置包的设置页入口或跨来源 takeover；这些仍由安装协议保留为后续能力。
- 本 Spec 不改变 Project 内容 `reference/`、用户正文、Session、SQLite、日志和配置的所有权。
- 本 Spec 不删除 checkout 根历史 `assets/`、`workspace/` 或旧同步文件；历史数据迁移必须另有可审计的迁移入口，且不能作为本能力的静默副作用。
## 术语与参与者

- **Application/Product Seed Root**：随源码或 Product Image 发布的只读输入。Agent Seed 为 `Application Root/assets/workspace/.nbook/agent/{skills,workflows,profiles}`；Product 使用 Runtime Image 中对应的 `server/assets/workspace/.nbook/agent`。Reference Seed 为 Application/Product 中的 `assets/reference`。
- **Install Root**：`State Root/workspace/.nbook/agent`。其下的 `skills/`、`workflows/`、`profiles/` 是三类 Agent 包的唯一运行期安装层；该目录不是 Application Seed 的别名。
- **Provenance Ledger**：`Install Root/installed.json`，即 `State Root/workspace/.nbook/agent/installed.json`。它记录三类 Agent 包的来源、状态、版本（若有）和 content hash。
- **Project Root**：`State Root/workspace/{project}/.nbook/agent`。只有已经由 Project Lifecycle 解析并通过 containment 的当前 Project 才能参与 Catalog；Project 包不进入 Install Root 账本。
- **Runtime Reference Root**：`State Root/workspace/.nbook/reference`。它是启动期由 Reference Seed 投影得到的独立运行期书架；不属于 Agent 包槽位，也不写入 `agent/installed.json`。其 manifest/hash 独立记录。Project 内的 `reference/` 仍是用户内容，不是该根。
- **Legacy Projection Root**：仍由旧投影协议管理的 `State Root/workspace/.nbook/templates` 与 `State Root/workspace/.nbook/agent/variables`，以及对应的 Application/Product Seed 输入。
- **Seeder**：持有 State Root 安装锁、读取 Seed、校验/阶段化/提交 Install Root 与 Runtime Reference Root 的启动期领域入口。
- **Catalog Adapter**：为 Harness、HTTP、CLI、Profile worker 和测试提供 Install Root、可选 Project Root 及对应逻辑标签；不得从 cwd 猜根。

## 输入与前置条件

启动期输入必须包含：

- 规范化且互不越界的 `applicationRoot`、`stateRoot`；Product 还必须提供经过 Runtime Contract 验证的 Product Image 根。
- Seed 类型与来源身份（Source 或 Product），以及可读的 Agent Seed、Reference Seed 真实目录。Seed 路径必须是非空字符串；不接受数组、对象、空白路径或未声明字段。
- State Root 可写，Install Root 的父目录可创建；所有 Install/Project/Reference 目录必须拒绝符号链接、特殊文件和越界路径。
- 若已有 Install Root，必须能读取有效 `installed.json`，或进入有明确诊断的账本恢复流程；不能把缺失账本静默解释为“全部是 local”。
- 运行期 Catalog 加载前，Agent Seed 安装、Reference seed 校验和旧 `templates/variables` projection 必须已完成。没有显式 State Root 的源码构建/隔离测试可以直接读取包内 Seed，但一旦显式提供 State Root，就禁止该例外成为静默 fallback。
- Project Root 只有在调用方提供已解析的 `ResolvedProjectWorkspace` 且通过 workspace containment 后才可加入 Catalog；未绑定 Project 时只加载 Install Root。

## 输出与可观察行为

- 首次安装在 State Root 下产生：
  - `workspace/.nbook/agent/{skills,workflows,profiles}`；
  - `workspace/.nbook/agent/installed.json`；
  - `workspace/.nbook/reference/` 及经验证的 Reference manifest。
- 重复启动在 Seed 内容、Install 内容和账本一致时幂等，不改写用户/Project 文件，返回 `seeded: false` 或等价的 no-op 结果。
- Seed 内容变化时，仅对 `origin.kind = bundled` 且当前磁盘内容未 dirty 的条目执行升级；升级后账本的 content hash 与磁盘内容一致。`removed` 墓碑不被自动重新安装；非 bundled takeover 不被 Seed 接管。
- `SkillCatalog`、`WorkflowCatalog`、`AgentProfileCatalog` 的可观察来源只允许 `install` 或 `project`（以及既有的内存测试 profile）；不再把 Application Seed 暴露为 `system` catalog 层，也不保留 `systemRoot/userRoot` 的兼容双真相。
- 同 id/key 时 Project Root 条目整体覆盖 Install Root 条目；无同名 Project 条目时使用 Install Root 条目；无 Project 时绝不读取其他 Project 的资产。
- Profile worker、preflight、CLI 和 server Harness 使用同一 Install Root；Profile artifact manifest 的 `profilesRoot` 与 dependency entries 使用稳定逻辑 label，而不是 `process.cwd()` 相对路径或临时绝对路径。
- Profile Import 的逻辑字符串仍为 `reference/<relative-path>`；显式 Runtime 下读取 `workspace/.nbook/reference/`。缺失、损坏或未完成验证时返回明确错误，不读取 Seed 副本或 checkout 根。
- `templates/` 和 `agent/variables/` 继续按旧投影协议产生其既有结果；它们不会因为 Agent 包安装迁移而出现在 `installed.json` 或 Catalog 的 Install/Project 覆盖层。

## 状态与转换

| 当前状态 | 事件 | 下一状态 | 可观察副作用与拒绝条件 |
| --- | --- | --- | --- |
| 未安装 | 启动期读取有效 Seed | 已安装 | 同卷 staging 完整复制、校验通过后提交 Install Root、写入 bundled ledger；任一校验失败不发布半成品。 |
| 已安装且 clean | Seed hash 相同 | 已安装且 clean | no-op；不重写包内容或账本时间。 |
| 已安装且 clean | bundled Seed hash 改变 | 已升级且 clean | 阶段化新包，提交成功后更新账本；Profile 的共享 `.compiled` 由既有 Publisher 处理，安装器不直接篡改共享 manifest。 |
| 已安装且 dirty | 启动对账发现本地 hash 与账本不同 | dirty/待用户处理 | 拒绝静默覆盖，保留本地内容并输出结构化冲突；不能自动升级。 |
| bundled 已移除 | 自动 Seed 对账 | removed | 保留墓碑，不重新安装；只有未来显式 restore 才允许复活。 |
| 账本缺失或损坏 | 启动对账 | recovered 或 needs-review | 以磁盘包和 Seed content hash 重建可证明的条目；无法证明来源时标为 local/needs-review 并诊断，不能静默当作 bundled 或删除磁盘内容。 |
| staging/previous 残留 | 持锁启动恢复 | restored/cleanup-pending/failed | 先验证 current 与 previous；current 无效且 previous 有效时恢复 previous；无法证明安全时保留残留并 fail closed。清理失败不删除有效安装，但必须标记下一次重试。 |
| 任意状态 | Project Root 绑定 | Install Root → Project Root 视图 | 只在当前 Project containment 成功时启用；Project 条目不写 Install ledger。 |

并发语义：同一 State Root 的 seed/install、账本读改写和恢复共用 Install Root 排他锁；拿不到锁时不得绕过锁写文件。Profile `.compiled` Publisher lock 与 Install Root lock 独立，禁止反向嵌套。

## 副作用与数据

- Seed Root 只读；任何启动期生成物、安装包、ledger、staging、trash、恢复 marker 和 Runtime Reference manifest 都位于 State Root 下。
- Agent ledger 使用 `schemaVersion: 1` 与 `assets[]`；每项至少包含 `type`、`id`、`state`、`origin`、`contentHash`，可选 `version`、`installedAt`、`removedAt` 和依赖状态。写入使用临时文件 + 同目录原子 rename，账本写入是安装事务提交点。
- Skill/Workflow 的 commit unit 是 `<id>` 目录；Profile 的 commit unit 是入口 `.profile.tsx` 与同名资料目录，不包含共享 `.compiled/` 与 manifest。旧 commit unit 先进入有界 `.trash`，便于失败恢复；`.staging/.trash` 不进入 Studio、File History、备份或下载包。
- Reference Runtime Root 采用与 Seed hash 绑定的独立 manifest；Reference 文件不得写入 Agent ledger，也不得与 Project `reference/` 合并。
- 旧 `templates/variables` projection 的用户状态继续由原 owner 维护；本能力不得通过清空或覆盖用户文件来“迁移”其内容。
- 结构化日志只记录 root label、状态、hash 摘要、条目 id、错误 code 和恢复阶段，不记录 Reference 正文、Profile 源码、Session 或秘密。

## 失败与恢复

- Seed 不存在、不是目录、包含符号链接/特殊文件、managed Agent parent 不是真实目录、固定 Agent package entry 缺失、manifest schema 无效、root 越界、Product Image 身份不符或 State Root 不可写：启动期 fail closed；Catalog 不得加载旧 Seed 或 checkout 根来掩盖失败。
- staging 复制/校验失败：删除仅由本次创建且可证明属于本次 token 的 staging；既有 Install Root 不受影响。
- 旧根到 trash、staging 到 Install Root 或发布后完整性校验失败：若 previous 可验证，恢复旧根并校验；恢复或安全清理失败时返回聚合诊断并保留可恢复残留，下一次持锁启动重试，不把“目录存在”视为成功。
- 当前 Install Root 内容 hash 与 ledger 不一致，或 ledger 中已安装 bundled package 在磁盘缺失：标记 dirty/conflict 并拒绝 bundled upgrade；不覆盖、不删除、不静默回退或“复活”缺失包。
- ledger 写入失败：按协议处理“磁盘已提交、账本未提交”的对账恢复；启动以可验证磁盘事实为准重建 ledger，不回滚已发布 Profile source 使 artifact manifest 指向不存在路径。
- Reference Runtime Root 缺失或 hash 不一致：Profile Import 明确失败；不得改读 Application Seed、Product image 内只读副本或 checkout 根。
- Project Root 越界、当前 Project 未 ready 或被外部替换：拒绝 Project 层加载并保持 Install Root 视图；不得把绝对路径写入 durable Catalog state。
- 迁移/恢复失败不删除用户数据、checkout 历史目录或未由本事务创建的文件；所有未决残留必须有 marker/report，供下一次启动或显式迁移命令继续。

## 边界与兼容

- 本能力的唯一 Agent root 模型是 Seed Root → Install Root → Project Root。`.system-assets/workspace/.nbook` 不属于 canonical Install Root，不得继续作为 catalog、ledger、Profile compiler 或 system preflight 的长期入口。
- `State Root/workspace/.nbook/agent/installed.json` 是 Agent 包 provenance 的唯一账本；`.system-assets-sync-state.json` 只能作为一次性旧投影迁移输入，不能继续驱动三类 Agent 的覆盖或升级。
- `SkillCatalog`、`WorkflowCatalog`、`AgentProfileCatalog`、`NeuroAgentHarness`、Profile worker、Profile source checker、system preflight、CLI 和相关 DTO/测试必须一次性切换到 Install/Project 语义；不保留 system/user alias、re-export、隐式 cwd fallback 或双读路径。
- `templates/variables` 是明确保留的旧投影边界；其同步状态不能被误并入 Agent ledger，也不能把其用户覆盖层当成 Project Root 包目录。
 - Source/Product 启动路径已接入显式 seed/install；聚焦证据覆盖安装器、legacy projection、Authoring Kit 和启动合同。真实 Product image、Windows portable 与完整启动 smoke 仍是本轮未运行的环境门禁，不能以本地 focused test 代替。

## 验收与 Smoke

1. **首次安装**：Given 空 State Root、有效 Source/Product Seed；When 执行启动前 prepare；Then Install Root、`agent/installed.json` 和 Runtime Reference Root 均存在，catalog 只返回 Install Root 条目，Seed Root 字节未改变。
2. **覆盖顺序**：Given 同 id 的 Install Root 与当前 Project Root 包；When 绑定 Project 查询 Skill/Workflow/Profile；Then Project 条目整体胜出；解绑后恢复 Install 条目；另一个 Project 不可见。
3. **升级与墓碑**：Given bundled 包 hash 改变、clean ledger；When 重启；Then 只更新对应包并原子更新 ledger。Given `removed` 或 non-bundled takeover；When 重启；Then 不被 Seed 静默接管。
4. **dirty fail-closed**：Given 用户修改 Install Root 包；When Seed hash 改变；Then 保留用户字节、返回 dirty/conflict，Catalog 不读取 Seed 替代内容。
5. **恢复注入**：Given publish/校验失败、删除坏 current 失败、previous 有效；When 下一次持锁启动；Then 识别无效 current、恢复 previous、验证 ledger/hash，并保留清理失败诊断；不得把坏 current 阻断 previous 分支。
6. **Profile freshness 移动**：Given Profile artifact 在 Source、Product、测试临时根和移动后的 State Root 生成；When 在另一进程/根执行 freshness；Then 相同逻辑依赖 hash 保持 fresh，不出现 cwd 造成的 `dependency_changed`。
7. **Reference fail-closed**：Given State Root Reference 缺失、损坏或 manifest 不匹配；When Profile Import `reference/**`；Then 明确失败，且 checkout 根 `reference/`、Application Seed 和 Product image 不被读取。
8. **旧投影边界**：Given `templates/` 或 `agent/variables` 存在用户修改；When Agent 包 seed/upgrade；Then 不覆盖这些用户文件，不为其创建 Agent ledger 条目，旧 projection 的结果仍可读取。

聚焦验证入口：

- `bunx vitest run server/workspace-files/system-asset-installation.test.ts server/workspace-files/system-workspace-assets.test.ts server/workspace-files/system-assets-preflight.test.ts`
- `bunx vitest run server/agent/skills/skill-catalog.test.ts server/agent/workflow/workflow-catalog.test.ts server/agent/profiles/catalog.test.ts server/agent/profiles/profile-artifact-dependency-gate.test.ts`
- `bun run typecheck` 与 `bun run runtime:typecheck`
- Product/Source 启动 smoke 必须实际观察“seed/legacy projection 完成后才启动 Nitro”；未运行真实 Product、Windows portable、浏览器和 Provider 验收前不得宣称这些门禁通过。

## 实现合同

已实现：Product wrapper 在 Nitro 子进程启动前调用 `seedSystemAssets({applicationRoot, stateRoot, seed: seedPaths})`；Source Dev 通过 `scripts/cli/source-runtime.ts` 执行同一安装入口。Runtime legacy projection 显式区分 source/target，排除 `skills`、`workflows`、`profiles` 三类 Agent package，仅保留旧 templates/bin/config/variables 边界；Runtime Variable compiled projection 可显式关闭，由受控 compiler 负责生成 Install Root artifact。

账本恢复与显式迁移已实现：Seeder 在启动对账中发现 Install Root 有包但 `installed.json` 缺失或损坏时，在安装锁内按磁盘包与 Seed 同 id 包的 contentHash 比对重建账本——一致记 bundled、不一致保留磁盘字节并写 `dirtyAt`（不参与自动升级）、无同 id 记 local，并通过 `SeedSystemAssetsResult.legacyAdoption` 返回结构化报告；removed 墓碑无法从重建恢复，必须经报告显式告知。显式 legacy migration 由 `planLegacyAgentAssetMigration` / `applyLegacyAgentAssetMigration` 提供：触发条件是「账本缺失/损坏」「磁盘上仍存在旧投影孤儿」或「sync-state 仍含三类 Agent 包条目」。孤儿删除语义与旧投影 owner 逐类对齐：普通 exact/前缀/STALE 墓碑仅删除 sync-state 有记录且磁盘 hash 等于 `lastSyncedUserHash` 的文件，未记录的保留待人工处理；hard-cut 名单允许无 state 删除但 state 证明手改的一律保留；所有候选以当前 Seed 清单兜底过滤。sync-state 按真实结构 `{profiles, assets?}` 解析（profiles 条目映射 `agent/profiles/<fileName>`）；任一键存在但非数组或两类键均缺失视为损坏，fail closed（needs-review）不删除不写账本。旧投影写该文件不持安装锁，剥离的提交前校验若发现 state 被并发改坏（解析/结构失败）同样抛 needs-review，不得虚报清理成功；apply 提交后原子剥离三类条目并原样保留 templates/variables 条目，失败时旧 state 原样保留并由触发条件在下次运行自动重试。迁移全程持有 Install Root 排他锁并在读盘、每次破坏性删除和账本写入前后检查锁失所有权（与 Seeder 同一 fail-closed 合同）。墓碑名单数据统一由 `legacy-agent-asset-tombstones.ts` 持有，旧投影同步继续消费同一份数据。

实现入口：

- `packages/neuro-book/server/workspace-files/system-asset-installation.ts`
- `packages/neuro-book/server/workspace-files/system-workspace-assets.ts`
- `packages/neuro-book/server/workspace-files/system-assets-preflight.ts`
- `packages/neuro-book/server/workspace-files/legacy-agent-asset-tombstones.ts`
- `packages/neuro-book/scripts/cli/migrate-legacy-agent-assets.ts`
- `packages/neuro-book/server/workspace-files/novel-workspace.ts`
- `packages/neuro-book/server/runtime/product-start-command.mjs`
- `packages/neuro-book/scripts/cli/source-runtime.ts`

验证证据：

- `bunx tsc --noEmit --pretty false -p packages/neuro-book/tsconfig.json`：通过。
- `bunx tsc --noEmit --pretty false -p scripts/tsconfig.json`：通过。
- `bunx vitest run server/workspace-files/system-assets-preflight-options.test.ts server/workspace-files/system-assets-preflight.test.ts server/workspace-files/system-assets-projection.test.ts server/workspace-files/test-workspace-fixture.test.ts server/workspace-files/system-asset-installation.test.ts server/workspace-files/system-workspace-assets.test.ts --pool=forks --maxWorkers=1 --reporter=dot --silent`：6 files / 52 tests passed（含安装器套件扩至 34 项后的当前总数）。
- `bunx vitest run server/workspace-files/workspace-files.test.ts -t "Runtime legacy projection 不复制 Agent package|同步系统 assets 会补齐 Agent runtime bin 和 config|同步系统 assets 会补齐 writer 默认 home" --pool=forks --maxWorkers=1 --reporter=dot --silent`：3 tests passed。
- `bunx vitest run app/composables/agent-jobs-wiring.test.ts --pool=forks --maxWorkers=1 --reporter=dot --silent`：6 tests passed。
- `bunx vitest run --config scripts/vitest.config.ts scripts/build/product-runtime-contract.test.ts`：2 tests passed。
- `node --check packages/neuro-book/server/runtime/product-start-command.mjs`：通过。
- `bunx vitest run ./server/workspace-files/system-asset-installation.test.ts --pool=forks --maxWorkers=1 --reporter=dot`：34 tests passed（含账本缺失/损坏启动重建、dirty 不被 Seed 升级覆盖、显式迁移 preflight/apply 幂等、sync-state 手改保留与无 state 保留、sync-state 损坏/结构畸形/条目畸形 fail closed、Seed 仍携带的墓碑路径不删、hard-cut exact 受管残留清理且 `agent/scripts` 不触碰、state 残留独立触发剥离并保留 templates 条目、启动恢复后迁移不短路）。
- `bunx vitest run ./server/workspace-files/system-workspace-assets.test.ts ./server/workspace-files/system-assets-preflight.test.ts --pool=forks --maxWorkers=1 --reporter=dot`：7 tests passed。
- `bunx vitest run ./server/workspace-files/workspace-files.test.ts -t "Runtime legacy projection 不复制 Agent package|同步系统 assets 会补齐 Agent runtime bin 和 config" --pool=forks --maxWorkers=1 --reporter=dot`：2 tests passed（novel-workspace 改为消费 tombstone 模块后回归）。
- 真机 Source Dev smoke：对存在旧投影 Install Root（无账本）的 Windows State Root 执行 `bun run dev --port=3000`，11 秒内就绪；`installed.json` 生成 40 条目（38 clean bundled + 2 dirty bundled），`/api/hello` 返回 200；二次调用 `seedSystemAssets` 幂等（seeded=false 且无重建报告）；迁移 CLI 在孤儿清零后 `--apply`/`--preflight` 均报告无需迁移。

未运行：真实 Product image、Windows portable、浏览器、Provider 和完整启动 smoke；这些需要构建产物/外部运行环境，不能由 focused test 推断。

## 证据

- 实现入口：[`system-asset-installation.ts`](../../../packages/neuro-book/server/workspace-files/system-asset-installation.ts)
- 合同测试：[`system-asset-installation.test.ts`](../../../packages/neuro-book/server/workspace-files/system-asset-installation.test.ts)
- Smoke：不适用——安装事务只在真实 Product image 或 Windows portable 启动时发生，仓库内没有覆盖它的 smoke 入口（未运行项见上）。
- 批准依据：[Task 135 Agent 资产安装协议](../../../packages/neuro-book/.agents/tasks/135-agent-asset-install-protocol/README.md)，其中记录了 Seed Root、Install Root、Project Root、`agent/installed.json`、七阶段事务、失败恢复和 `templates/variables` 保留边界的用户决策。
 - 本 Spec 已登记为 `implemented`：实现与聚焦验证覆盖本轮已交付的安装事务、Reference manifest、legacy projection、Agent package exclusion、Authoring Kit 形状及启动合同。
 - 未运行项仍是独立环境门禁：真实 Product image、Windows portable 与完整启动 smoke；历史 checkout 数据迁移及 Runtime consumer 全量根审计也不在本轮授权范围内，不得用 status 字段替代这些验收证据。
 - Product compiled artifact 策略：Product image 构建时生成并携带自包含 Authoring Kit，Runtime `prepareSystemAssets()` 对 Runtime artifact 采用受控 authoring context；Seeder 只处理三类 Agent package 与 Reference，不从 Seed 回退读取 compiled artifact。
