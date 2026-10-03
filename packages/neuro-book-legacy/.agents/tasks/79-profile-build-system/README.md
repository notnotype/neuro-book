# Profile Build System 底层重构

> 2026-07-31 authoring/CLI 所有权补充：本任务冻结的 Profile artifact/Publisher 合同继续有效；作者 import 面与命令交付路径由 Task 130 进一步收窄。作者使用 `nbook/profile-sdk`；需要文风/参考预设能力时可显式使用正式 `nbook/profile-sdk/writing` 子入口。Agent 稳定入口为 `.nbook/agent/bin/profile`；Source checkout wrapper 调 Product-owned source entry，发行物通过 Product Runtime Contract 解析 `profile` 逻辑命令。下属 walkthrough 中项目根 build script、asset script 或 `.output/server/scripts/**` 路径均是历史证据，不是 fallback。

> Active task。每一轮探索/设计记录在 `walkthroughs/`。本 README 是任务契约 + 索引 + 最终架构落点。
>
> **当前状态**：设计已定稿、全部决策锁定，Phase 0–3 已实现并完成 round-14 final guard + test isolation 收口；一次性贯通 Phase 0–3 的自包含执行契约见 [IMPLEMENTATION-GOAL.md](IMPLEMENTATION-GOAL.md)。

## Relative documents refs

- [04 TSX Profile Workbench](../04-tsx-profile-workbench/README.md) — 确立「`.profile.tsx` 是编辑真相源，`.compiled` 是运行真相源；普通 runtime API 只读产物、不在热路径编译」的硬合同。
- [58 Agent Profile Settings Low-Code](../58-agent-profile-settings-low-code/README.md) — profile 低代码 settings 表单。
- [73 Agent Session List Performance](../73-agent-session-list-performance-pagination/README.md) — 列表热路径移出完整 snapshot、profileKey 批量解析。
- [74 Agent Command Performance](../74-agent-command-performance/README.md) — profile catalog watcher 显式生命周期 + dirty cache generation race 防护。
- [29 Agent Profile Import Node](../29-agent-profile-import-node/README.md) — profile 编译/import 节点契约（如存在）。
- [37 System Assets Preflight](../37-system-assets-preflight/README.md) — 系统 assets 预热与 profile 预编译。
- [125 Runtime Artifact Storage Lifecycle](../125-runtime-artifact-storage-lifecycle/README.md) — 延续本任务的 current manifest/Publisher 合同，补齐 orphan 硬预算、重复 import cache 移除与 Profile artifact 减重；不重开本任务已冻结的原子发布决策。

## User Request / Topic

用户观察到三个症状叠在一起：

1. profile 的 lowcode 设置表单「有时有有时没有」，疑似 profile 编译不成功时才消失。
2. `GET /api/config/editor-snapshot?workspaceKind=user-assets` 变慢，且前端访问频繁。
3. 设置界面无法展示 profile 编译/加载状态。

用户判断这是 profile 编译这一块长期反复出问题的系统性表现，要求：先理清现状与问题，再**设计多种架构方案并对比**，最终给出一个 profile 系统的宏观架构。分析可延伸到 Harness 级。

## Goal

产出并落地一个 profile 编译/加载系统的**宏观架构设计**，verified by：

- 至少 3 个独立架构方案 + 一张横向对比矩阵（一致性、性能、复杂度、迁移成本、可测试性、对 Agent 约束力）。
- 一个推荐架构，能在**设计层面**消灭「半提交窗口」根因，并满足下列已锁定决策。
- 配套迁移路径、测试计划、对现有 build/preflight/product-runtime 路径的影响评估。

Constraints（设计必须满足，不得回归）：

- 维持 Task 04 硬合同：普通 runtime 请求只读产物、绝不在热路径编译。
- 不破坏 build-time / system-assets-preflight / product-runtime 三条预编译路径。
- runtime 严格阻止使用 stale/failed profile，不静默回退上次成功产物。

Boundaries：本任务已从设计推进到 Phase 0–3 实施收口；探索和实现范围以 `server/agent/profiles/**`、`server/config/**`、`server/api/config/**`、`app/components/novel-ide/settings/**`、`scripts/build/**` 为主，必要时延伸 harness。

Iteration policy：每轮探索/设计写入 `walkthroughs/round-NN-*.md`，README 只维护契约、已锁决策和最终架构。

Blocked stop condition：若某方案无法在不破坏三条预编译路径的前提下成立，记录为何不成立 + 解锁条件。

## Current State（摘要，详见 walkthroughs/round-01）

核心病根：profile 的「运行真相源」是**逐文件、非原子**地写进一个**被 chokidar 全量递归监听**的 `.compiled/` 目录，每次编译都制造「文件已换、manifest 未换」的半提交窗口；watcher 把窗口里的每个文件事件都翻译成 `catalog.invalidate()`，导致 catalog 反复冷加载（dynamic import + 全依赖 stat/hash），普通请求撞上窗口就把 profile 判成 `compile_stale`，settings 返回 null，前端低代码表单静默消失。

叠加两个独立问题：editor-snapshot 大包即使不要 settings 也无条件 `profiles.snapshot()`（把 models/web/cost/embedding 轻面板绑死在 profile catalog 上）；前端面板丢弃 `loadStatus/issue/hasSettingsForm`，用 `v-if="settings"` 把失败渲染成「消失」。

详细代码级证据（含 file:line）见 [round-01 现状基线](walkthroughs/round-01-baseline-and-current-state.md)。

## Decisions / Discussion（用户已锁定）

- 源码保存后**自动编译**（后台 eventual consistency；source view 立即生效，runtime 只在 build success 后可用）。
- runtime 严格阻止 stale/failed profile，不回退上次成功产物。
- 接受破坏旧 `.compiled` 产物格式，做底层重构。
- editor-snapshot 直接硬切拆分专用轻接口，不保留 profile settings 大包兼容。
- 允许本轮调整 profile 编译 API wire shape、设置页 API 和前端调用点。
- **跨进程写入纪律（round-05 F1 / Q1）**：运行态 `.compiled/` 只由 server 进程经其单例 Publisher 写；preflight 仅在 server 未起时由 CLI 进程写；不允许 server 运行时另起进程并发写运行态产物；per-root advisory lock（`<root>/.compiled/.publish.lock`；**实现时新增直接依赖：`bun add proper-lockfile@latest`，不要依赖 Prisma 的传递依赖**）作为兜底防交错。
- **升级首启重编策略（round-05 F3 / Q2）**：compilerVersion bump 等「整本 manifest 作废」场景，用**非阻塞 boot 对账 sweep**——server 正常启动，后台 enqueue 重编失效的 user 自定义 profile；重编完成前这些 profile **短暂不可运行（严格无 stale），以前端 `compiling` 状态诚实呈现**。**不做阻塞式预编**；单个 profile 编译失败只标 `compile_failed`，**绝不阻塞 App 启动或其它 profile**。
- **release 历史后置**：先上 manifest 当前指针（E-core），需要回滚/审计时再加 `releases/`（B 增量）。
- **自动编译去抖 = 500ms 单窗口**：保存与自动保存统一合并 + generation 去重，暂不拆显式/自动。
- **freshness 降级**：boot/热路径只验「源码 sha + compilerVersion」，不全量 rehash 依赖；全依赖 rehash 放 CLI `profile check`；依赖变化运行期靠 watcher 触发重编；配「编译器/DSL 变更必 bump compilerVersion」纪律。
- **Phase 0 先行**：读路径硬切 + 前端状态先独立发，再做格式重构。

## Verification / Test（设计阶段先列方向，落地时细化）

- Compiler/publisher：全量编译只发布一次 current pointer；写 artifact 中途读不到半成品；单文件编译不破坏其它 profile，且只能由 Publisher 在 publish lock 内合并 manifest；失败仍发布状态；源码在编译期再变则旧 build 标 stale 丢弃；删 profile 后 release 移除。
- Catalog：只从 current release 加载；非 loaded 调 get() 失败；helper/依赖变化触发受影响 profile 重编；`.compiled/artifacts/**` 事件不 invalidate。
- API/frontend：editor-snapshot 不再返回 settings 大包；profile settings 接口带状态；保存源码后 UI compiling→loaded/failed；Agent 面板不再打完整 editor-snapshot。

## 最终架构（推荐）

完整设计见 [round-04](walkthroughs/round-04-recommended-architecture.md)；方案对比见 [round-03](walkthroughs/round-03-architecture-options.md)。

**推荐 = 方案 E + C 叠加**（内容寻址不可变 artifact + server 进程内存权威指针 + 原子持久化 + 编排四件套 + 读路径硬切）。在 5 个候选方案（A 止血 / E 内容寻址+原子manifest / B 完整release账本 / C 内存权威叠加 / D 主线程同步〔否决〕）中，E+C 以「80% 的 B 收益、40% 的 B 成本」胜出。

核心原语：
1. **内容寻址不可变 artifact** `.compiled/artifacts/<sha>.mjs`——同一 sha 只写一次（tmp→rename 到不存在目标），永不覆盖 → 读者永不见半写文件。
2. **原子指针** `manifest.json`（profile→sha 映射 + per-profile 状态）——发布时 tmp→rename 一次替换 → 永不见「账本旧」。
3. **双模 Publisher + 内存权威 Registry（仅 server 进程）**——worker 只写 artifacts/ 并回传 sha 映射；**server 进程内** Publisher 按 profile root 串行执行 manifest 发布 + 内存 Map 翻转（in-process），**CLI/preflight 只 disk-only 写 manifest、不翻 Registry**；发布前抢 per-root advisory lock。根除跨线程「写盘/观盘」双重作废风暴；热路径只读内存 O(1)。Registry 内存权威**仅限 server 进程**。
4. **故障隔离 + 原子批**——每个 profile 独立编到 staging（坏的记 compile_failed），整批一次性发布。
5. **严格无 stale 状态机**——含运行态 `compiling/compile_failed`；源码一变即不可运行直到新 build 成功（配合保存即自动编译）。
6. **读路径硬切**——editor-snapshot 去 settings 大包、不再无条件读 catalog；新增 `/api/agent/profiles/settings` + `/build-status` 轻接口；前端保留 `loadStatus/issue/hasSettingsForm`，失败渲染状态块而非静默消失。

组件分解（拆 god-object，对外保留 `AgentProfileCatalog` facade 以最小化 ~30 调用点改动）：ProfileArtifactStore / ProfileReleaseStore / ProfileRegistry / ProfileFreshnessChecker / ProfileBuildCoordinator / ProfileBuildWorker / ProfileReleasePublisher / ProfileBuildState / ProfileSourceWatcher。

分期：**Phase 0** 读路径硬切 + 前端状态（独立、最快见效、不需新格式，**已定先做**）→ **Phase 1** 新格式 + Store/Registry/双模 Publisher + 原子 manifest + 发布锁（`bun add proper-lockfile`）→ **Phase 2** Coordinator + 自动编译 + 内存权威 + boot 对账 sweep + 严格状态机 → **Phase 3** assets 同步经 Publisher（copy-if-absent）+ GC +（可选）releases/ 历史。

## Implementation Walkthrough

- [round-01 — 现状基线与问题（代码级证据）](walkthroughs/round-01-baseline-and-current-state.md)
- [round-02 — harness wiring / 三条编译路径 / 多写入方 / blast radius](walkthroughs/round-02-harness-and-build-lifecycle.md)
- [round-03 — 5 架构方案枚举 + 横向对比矩阵](walkthroughs/round-03-architecture-options.md)
- [round-04 — 推荐架构详细设计（组件/布局/时序/状态机/API/迁移/测试/风险/分期）](walkthroughs/round-04-recommended-architecture.md)
- [round-05 — 多场景/多进程/git 版本更新/启动 CLI 审查（F1/F2/F3 + CLI 重构）](walkthroughs/round-05-multi-scenario-and-update-review.md)
- [round-06 — Implementation Phase 0：读路径硬切 + 前端状态](walkthroughs/round-06-implementation-phase-0.md)
- [round-07 — Implementation Phase 1–3：内容寻址发布 + Coordinator + profile assets sync](walkthroughs/round-07-implementation-phase-1-3.md)
- [round-08 — Implementation 收口：主线程发布 seam + 组件拆分 + GC + 并发护栏](walkthroughs/round-08-implementation-closeout.md)
- [round-09 — Implementation 收尾：全量 worker 池 fan-out + freshness/delete/stale 契约补齐](walkthroughs/round-09-worker-fanout-and-contract-closeout.md)
- [round-10 — Implementation 收尾：single entry publish-time merge](walkthroughs/round-10-single-entry-publish-merge.md)
- [round-11 — Implementation 收尾：release atomicity + Registry 顺序](walkthroughs/round-11-release-atomicity.md)
- [round-12 — Implementation 收尾：user-assets sync release consistency](walkthroughs/round-12-user-assets-sync-release-consistency.md)
- [round-13 — Implementation 收尾：release consistency final patch](walkthroughs/round-13-release-consistency-final-patch.md)
- [round-14 — Implementation 收尾：final guard + test isolation](walkthroughs/round-14-final-guard-and-test-isolation.md)

### round-05 审查结论（E+C 内核成立，但补三个必修缺口）

- **F1 多进程 ≠ 多线程**：真实启动是「preflight 独立进程 → server 进程」，sync API 又在 server 进程内复用同一段编译代码，且全仓库**无任何跨进程锁**（`async-mutex`/`proper-lockfile` 仅 prisma 传递依赖、零引用）。round-04「主进程唯一 Publisher」假设不够 → 需双模 Publisher（进程内翻 Registry / 进程外只写盘）+ per-root advisory lock。
- **F2 content-address 的 `<sha>` 必须是「编译输出字节哈希」**（`artifactSha256`），不能是输入哈希；否则 write-once 不可变在编译器变更时会 stale 投毒。compilerVersion gate 作粗粒度兜底，须加测试。
- **F3 compilerVersion bump 会删用户自定义 profile 产物且不自动重编**（manifest 版本 gate 返回空 → sync 以空为基底重写 → prune 删未列产物；preflight 只编 system root）→ 升级后用户自定义 profile 表单消失，需手动 compile-all。**极可能是「表单忽隐忽现」的升级类根因之一**。修正 = **boot 对账 sweep**（启动比对源码集合 vs manifest，缺失/失配的后台 enqueue 重编，自愈）。
- **CLI 不推倒重写**：把 runtime 与 CLI 共用的「逐文件非原子提交 / 覆盖式 sync rollback」内核换成 Publisher 的「批量 staging→原子发布 + copy-if-absent」，可整体退役 `stageVerifiedArtifact`/`replaceFilesWithRollback` 机器，并把 user 重编移出 preflight 阻塞段。

## TODO / Follow-ups

- [x] round-01 现状基线；round-02 延伸探索；round-03 方案对比；round-04 推荐架构；round-05 多场景/版本更新/启动 CLI 审查。
- [x] round-05 Q1 跨进程写入纪律（单写者 + advisory lock）、Q2 升级首启非阻塞 sweep + compiling 状态：**已锁定**（见 Decisions）。
- [x] 剩余开放问题已锁定（见 Decisions）：release 历史后置、去抖 500ms 单窗口、freshness 降级（源码 sha + compilerVersion）、Phase 0 先行。
- [x] round-05 的 F1/F2/F3 + B1/B2/B3 已回写进 round-04 终稿（双模 Publisher + per-root 锁、sha=输出哈希+测试、boot 对账 sweep、内容寻址 sync、读路径/表单契约、GC 非单写者残留回收）。round-04 现为可实施终稿。
- [x] Phase 0 已实现：editor-snapshot 不再返回/触发 profile settings 大包；新增 `/api/agent/profiles/settings` 与 `/build-status`；settings 面板状态可见；AgentChatSurface 改用 bootstrap。
- [x] Phase 1–3 主体已实现：新 `.compiled` 格式、profileKey 映射 manifest、内容寻址 artifact、`compile_failed` 记账、Publisher + `proper-lockfile` 发布锁、自动编译 Coordinator、boot sweep、严格无 stale、profile assets sync 经 Publisher。
- [x] round-08 收口：HTTP runtime worker 只生成 staging release，server 主线程用 in-process Publisher 发布并翻 Registry；`ProfileArtifactStore` / `ProfileFreshnessChecker` / `ProfileRegistry` / `ProfileSourceWatcher` 已从 catalog facade 拆出；worker service 已扩为受互斥约束的 worker 池；内容寻址 artifact GC 已加 grace；profile 编译与依赖 hash 并发已加句柄护栏。
- [x] round-09 收尾：`compileAll()` 改为 worker 池单文件 entry fan-out、主线程 fan-in 一次发布；发布前源码重校验，stale build 丢弃并由 Coordinator 重排；runtime catalog freshness 降级为不重扫依赖；删除用户 profile 后显式 enqueue 全量 build 移除 manifest entry。
- [x] round-10 收尾：single compile 改为 worker 只产单 entry staging，Publisher 在 publish lock 内读取当前 manifest 并合并发布；watcher unlink 与 stale source-missing 升格 full build；cleanup 失败不再卡住 worker 队列。
- [x] round-11 收尾：Publisher 增加 per-root in-process 发布队列，把磁盘 release 与 Registry 翻转纳入同一 root 串行 release seam；single-entry release 保持稳定 `profilesRoot`；补齐 Registry 并发与 cleanup 回归。
- [x] round-12 收尾：HTTP runtime user-assets sync 改为 in-process 强一致发布；profile assets sync 改为单次 batch release；corrupt artifact 修复下沉到 Store publish lock 内。
- [x] round-13 收尾：user-assets sync 磁盘发布成功后不再 rollback source；Publisher 用 committed error 表达“磁盘已提交但 Registry 失败”；所有 full replacement 入口发布前校验 source file set；staging cleanup/rename 失败语义收敛。
- [x] round-14 收尾：full replacement 发布前统一校验 source file set + entry source hash/bytes；profile/workspace 测试 root 隔离支持嵌套恢复；worker service 与旧 runtime 均覆盖同名源码内容变化 stale 回归。
- [x] 2026-07-11 发布一致性补充：`profile status` 检测到 `compile_stale` 时返回非零退出码；Product staging 在隔离副本完成 system assets prepare 后立即删除 manifest 未引用的 Profile artifacts，不改变运行时内容寻址产物 7 天 grace GC。Product staging 与 Windows portable 发布前校验统一按 manifest 引用读取嵌套 artifact，并拒绝 manifest 引用缺失或写入构建机绝对路径的产物。
- [x] 部署 manifest 归一化 3 tests 通过；真实 system manifest 验证为 14 Profiles / 28 referenced files / 0 missing。审查中修复了磁盘压缩字段 `artifactSha/typeSha` 与 runtime `artifactFileName/typeFileName` 之间的派生契约，避免 staging 清理误判空引用集合。
- [x] 2026-07-11 发布前诊断：Profile 通用 settings wrapper 语义变化后，旧 system artifact 仍因“Profile 源码 sha + compilerVersion”门禁显示 loaded，导致运行时继续使用旧 bundle、覆盖调用方 settings。原始 `leader.assets` 回归在全量重编后恢复 15/15；`PROFILE_ARTIFACT_COMPILER_VERSION` 提升到 7，确保所有安装环境升级时旧 bundle 自动 stale 并重编。通用 defaults < 调用方 settings 回归已固化在 `profile-dsl.test.ts`。
