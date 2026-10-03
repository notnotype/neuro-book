# Round 04 — 推荐架构（详细设计）

> 最终交付（**已并入 round-05 审查**：F1 多进程双模 Publisher + per-root advisory lock、F2 sha=编译输出字节哈希、F3 boot 对账 sweep；以及 B1 内容寻址 sync、B2/B3 读路径与表单契约）。推荐 **E + C 叠加**：内容寻址不可变 artifact + server 进程内存权威指针 + 原子持久化 + Coordinator/Worker(staging,池)/双模 Publisher/BuildState + 读路径硬切。release 历史账本（B）作为后续增量。本文为可实施终稿；与早期 round-01~03 冲突处以本文为准。

## 1. 组件分解（拆掉 catalog god-object）

当前 `AgentProfileCatalog` 一个类干 6 件事。拆成职责单一的组件，**对外保留 `AgentProfileCatalog` facade**（`get/resolveMany/snapshot/parseInitial/parsePayload/register/invalidate/startWatching/dispose`），让 harness 的 ~30 个调用点几乎不改：

| 新组件 | 职责 | 替代现状 |
| --- | --- | --- |
| **ProfileArtifactStore** | 只读：给定 sha → 解析 artifact 路径 → import（import cache 按 sha）。无状态、无 watcher、无编译。5 类调用方共用。 | catalog `importCompiledProfile` + `prepareCompiledProfileImportPath` |
| **ProfileReleaseStore** | 磁盘指针持久化：原子读写 `manifest.json`（E）/ `current.json`+`releases/`（B 增量）。只它懂磁盘格式。 | `readProfileArtifactManifest` + `commitCompiledArtifacts` |
| **ProfileRegistry** | 内存权威（**仅 server 进程持有**）：持有已解析 current release 的 `Map<key, Resolved|Failed>` + 内存 builtin。`get/resolveMany/snapshot` O(1) 读。暴露 `epoch`。只由 Publisher 翻转。 | catalog 的 `loadAll`/cache/`memoryProfiles` |
| **ProfileFreshnessChecker** | 给定源码+依赖 vs current release，算哪些 profile stale。供 Coordinator 决策 + 严格模式标不可运行。 | `validateProfileArtifact` + `catalogSignature` |
| **ProfileBuildCoordinator** | 按 root 串行排队、debounce 合并（500ms 单窗口）、**发布前重校验 generation**、enqueue 触发（保存/外部编辑/helper变更/手动/**boot 对账 sweep**）。可向 worker **池**并行派发。持有 BuildState。 | `ProfileCompileWorkerService` 队列（升级） |
| **ProfileBuildWorker** | worker_thread（**可多实例组成池**）：把目标 profile 各自编到**内容寻址 staging** `artifacts/<sha>.tmp`→rename，`<sha>` = **编译输出字节 sha256（F2）**。回传 {sha, sourceHash, deps, issues} 或 {failed}。**不发布**。 | `profile-compile-worker-runtime.ts`（瘦身） |
| **ProfileReleasePublisher** | `.compiled` 唯一写入入口，**双模（F1）**：进程内（server）合并 next release（改的换 sha、没改的留旧 sha、失败记 compile_failed、删的移除）→ 原子替换指针 → 翻转 Registry 内存（只 import 改动 sha）→ bump epoch；进程外（CLI/preflight）只写盘、不翻 Registry。发布前抢 **per-root advisory lock**。 | `commitCompiledArtifacts` + 端点 invalidate |
| **ProfileBuildState** | 内存 running/pending/lastResult per root，供 UI「编译中/失败/已加载」。 | 无（新增） |
| **ProfileSourceWatcher** | chokidar 只监听**源码文件** + 指针文件 fallback；源码变 → Coordinator.enqueue +（严格）标 stale；**忽略 `artifacts/**`**。 | catalog 全目录 watcher（收敛） |

> harness 仍以 `this.profiles`（facade）持有 Registry；`watchProfiles` 时额外 wiring Coordinator/Publisher/Watcher。worker 单例升级为 Coordinator。

## 2. 磁盘布局（E 核心）

```
<root>/.compiled/
  artifacts/
    <sha>.mjs            # 内容寻址、不可变、写一次（tmp→rename 到不存在目标）
    <sha>.types.d.ts     # dev-authoring 旁路，runtime 不读
  manifest.json          # 唯一指针，原子替换；compilerVersion=6
  manifest.json.tmp      # 发布中间态（同目录，rename 前）
  .publish.lock          # per-root 跨进程 advisory lock（proper-lockfile，需 bun add 为直接依赖），仅发布/替换指针时持有
```

`manifest.json`（指针）结构：

```jsonc
{
  "compilerVersion": 6,
  "publishedAt": "ISO",
  "profilesRoot": "workspace/.nbook/agent/profiles",
  "profiles": {
    "writer": {
      "fileName": "builtin/writer.profile.tsx",
      "status": "loaded",            // loaded | compile_failed
      "artifactSha": "<sha>",        // status=compile_failed 时为 null
      "typeSha": "<sha>",
      "sourceSha256": "...", "sourceBytes": 123,
      "dependencyHash": "...",
      "dependencies": [{ "path": "...", "sha256": "...", "bytes": 1 }],
      "issues": [ /* compile_failed 时的错误 */ ]
    }
  }
}
```

要点：profile→sha 是**映射而非文件名**；同一 artifact 可被多 profile 共享；失败 profile 也在 manifest 里（带 issues、无 sha），实现「整批发布、坏的记账、好的可用」。

> **F2 — `<sha>` 必须是「编译输出字节」的 sha256，不能是「输入哈希」**。只有输出哈希才让「写一次、永不覆盖」安全：编译器/DSL 变更导致产物字节变 → sha 变 → 新文件，旧文件作废待 GC；绝不会出现「输入没变但编译器变了，命中旧 `<sha>.mjs` → 永久 import 到旧产物」的 stale 投毒。`manifest.compilerVersion` gate 作粗粒度兜底：bump 即整本作废、重新 derive 映射。**配套测试**：同输入、不同 compilerVersion → 必须产出不同 artifact 且不复用旧文件。

> **B 增量（后续）**：把 `manifest.json` 升级为 `current.json`（指向 `releases/<id>.json`），`releases/` 存不可变历史，支持回滚/审计。E→B 只是把「当前指针」从内联改为间接，artifacts/ 与 Publisher 不变。

## 3. 发布时序（E + C，HTTP runtime）

```
保存源码 / 外部编辑 / helper变更 / 手动重编
        │
        ▼
ProfileBuildCoordinator.enqueue(root, reason, gen = hash(源码+依赖))
        │  debounce 合并快速连续变化（500ms 单窗口，已锁定）
        ▼
派发 build job 到 ProfileBuildWorker（目标 = 变化的 profile 集合 + current release 供未变 sha 复用）
        │  worker 逐个编到 artifacts/<sha>.tmp → rename <sha>.mjs（内容寻址、加性、不碰 manifest）
        ▼  回传 per-profile {ok,sha,sourceHash,deps,issues} | {failed,issues}
Coordinator 重校验 gen：源码已再变？→ 丢弃本次(标 stale) + re-enqueue
        │ 否
        ▼
ProfileReleasePublisher（server 进程内）
   1. 合并 next manifest = 未变(留旧sha) + 编译成功(新sha) + 失败(compile_failed,无sha) − 已删
   2. 写 manifest.json.tmp → rename manifest.json   ← 原子提交点
   3. 翻转 Registry：import 改动的 sha → 构建 Map → 失败项记 Failed → epoch++  ← import 成本付一次
   4. BuildState.lastResult = {manifestHash, perProfile status, issues}
        ▼
GC（延后、有 grace）：删 artifacts/ 中未被 current manifest 引用的 sha
```

- **热路径**（editor-snapshot / agent prepare / get）：只读 Registry 内存 Map，O(1)，永不编译/重 stat/重 import。
- **跨线程竞态根除**：worker 只写 `artifacts/`（加性、内容寻址，读者永不见半成品）；manifest 由 server 进程内 in-process Publisher 原子写并翻 Registry（CLI/preflight 走 disk-only Publisher，不翻 Registry）→ round-02 §2 的「双重作废风暴」消失（不再靠 watcher 观盘）。
- **多进程双模发布（F1）**：真实拓扑是「preflight 独立 CLI 进程（server 未起）→ server 进程」。运行态 `.compiled/` 只由 server 进程经其单例 Publisher 写；preflight 仅在 server 未起时由 CLI 进程以 disk-only 模式写。任何写者发布前抢 **per-root advisory lock**（`<root>/.compiled/.publish.lock`，**`proper-lockfile` 需 `bun add` 为直接依赖、勿赖 Prisma 传递依赖**），杜绝并发写者交错；读者经内容寻址永不需要锁。
- **并行编译（worker 池）**：内容寻址使各 profile 互不撞车 → Coordinator 可向 `min(核数-2, 待编数)` 个 worker 并行派发（**fan-out 编译**），Publisher 把整批结果**一次原子发布**（**fan-in**）。单 profile 编辑自然退化为 1 个 worker；compilerVersion 全量重编时削平延迟尖峰。
- **重启持久化 + boot 对账 sweep（F3）**：启动时 Registry 读 manifest → import 引用的 sha → 建 Map；随后 Coordinator 对每个 root 比对「源码集合 vs manifest 命中」，对**缺失/失配**的源码 profile 后台 enqueue 重编（**非阻塞**，前端显示 compiling）。这让 compilerVersion bump（manifest 整本作废）后 system + user（含用户改过/自创的）全部**自愈**，不再像现状那样删了不重编。
- **外部发布 fallback**（CLI 在 server 运行时改了 manifest）：Watcher 监听 manifest（原子 rename = 一次干净事件）→ 谨慎 re-resolve。

## 4. catalog 状态机（严格无 stale）

| loadStatus | 判定 | 可运行 |
| --- | --- | --- |
| `loaded` | manifest 有该 profile、status=loaded、sha import 成功、源码+依赖 hash 与 manifest 一致 | ✅ |
| `compiling` | BuildState 显示该 profile running/pending（含「源码刚变、重编已入队」与「boot 对账 sweep 入队」） | ❌ |
| `compile_failed` | 最近一次 build 该 profile 失败，manifest 记 compile_failed | ❌ |
| `compile_stale` | 源码/依赖变了且尚无成功重编（严格模式不可运行；自动编译会很快转 compiling） | ❌ |
| `not_compiled` | 源码存在但从未进过 manifest | ❌ |
| `compiled_load_failed` | manifest 引用 sha 但 import 抛错 | ❌ |
| `source_error` | 源码无法解析/定位 | ❌ |

**关键硬切**（round-02 §9）：取消现状对 user `source_changed/dependency_changed` 的「容忍→loaded」（catalog.ts:823）。源码一变 → `compile_stale`/`compiling`，**不可运行**，直到新 build 成功。`get()` 非 loaded 仍抛错。

## 5. Watcher 策略（轴 2b + C）

- 监听：**源码文件**（`*.profile.*` + 已知 helper/依赖）+ `manifest.json`（external fallback）。
- 忽略：`artifacts/**`、`*.tmp`、`.types.d.ts`。
- 源码事件 → Coordinator.enqueue（去抖）+（严格）立即把该 profile 标 `compile_stale`（从内存视图下线，hot path 立刻拒绝运行）。
- manifest 事件（仅外部发布）→ 谨慎 re-resolve（原子 rename → 一次干净事件）。
- 进程内发布**不经 watcher**（Publisher 直接翻 Registry）。

### 5.1 freshness 契约（三个时机，消除「不 rehash 怎么知道 helper 变了」的歧义）

| 时机 | 谁判定 | 怎么判 | 依赖变化如何被发现 |
| --- | --- | --- | --- |
| **hot-path（读）** | Registry | **不 rehash**，只读内存 `Resolved/Failed`，O(1) | 不在此判；reader 永不 stat/hash |
| **watch-time（server 运行中）** | SourceWatcher + Coordinator | 源码 / 已知 helper 文件事件 → enqueue 受影响 profile 重编 → Publisher 翻 Registry | **靠 watcher**：helper 在监听列表内，改了就触发重编（兑现「helper 变化触发重编」） |
| **boot-time（server 刚起，watcher 之前没跑）** | boot 对账 sweep | **只验「源码 sha + compilerVersion」**（已锁定默认），失配即 enqueue | compilerVersion bump 兜住「打包依赖行为变更」；关机期间手改 helper 而源码没变的极少数情况，留给下次编译触发或 CLI 校验 |
| **显式校验（CLI `profile check`）** | FreshnessChecker | **全依赖 rehash**（manifest 存的 `dependencyHash` 全量比对） | 唯一逐个 rehash 依赖的路径，正确性优先、不在热路径 |

要点：**「依赖变化触发重编」由 watcher 在 watch-time 兑现，不靠 reader 在每次读时 rehash**。所以 §4 的 `loaded`（**编译/发布那一刻**确认源码+依赖+artifact 一致）与「hot-path 不 rehash」并不矛盾——前者是编译时的一致性，后者是读时信任内存 Registry；运行期依赖漂移由 watcher 捕获。manifest 仍持久化 `dependencyHash` 供 CLI 全量校验与（可选）更严格的 boot 模式。

## 6. API 与前端硬切（轴 4b）

### 后端

- `GET /api/config/editor-snapshot`：**移除** `agentProfileSettings` 重型构造与无条件 `profiles.snapshot()`。`defaultProfileSettings`（只要 key/name/loadStatus）改读 Registry O(1) 内存。models/embedding/web/cost/ui/editor 不再触碰 profile catalog。
- **新增** `GET /api/agent/profiles/settings?scope=&profileKey?=`：返回 per-profile `{model, settingsForm+value+inherited, loadStatus, hasSettingsForm, issue, sourcePath, buildState}`。**只有这里读 settings**。
- **新增** `GET /api/agent/profiles/build-status`（或 SSE）：返回 BuildState（running/pending/lastResult per profile），供「编译中/失败」实时显示。
- 保存/创建端点：写源码后 `Coordinator.enqueue`（自动编译），返回里带初始 buildState；不再用「保存即 invalidate 等手动编译」。

### 前端

- `NovelIdeAgentProfileModelSettingsPanel.vue`：
  - `AgentProfileDraft` **保留** `loadStatus/issue/hasSettingsForm`（撤销 `:36-42` 的丢弃）。
  - 模板 `:883` 从 `v-if="profile.settings"` 改为：loaded+有表单 → 渲染 LowCodeForm；否则渲染**状态块**（compiling spinner / compile_failed 原因 / not_compiled 提示），**绝不静默消失**。
  - 改打新 `/api/agent/profiles/settings`，并轮询/订阅 `build-status` 显示 compiling→loaded/failed。
- `AgentChatSurface.vue:616` `loadSelectableModels`：`editorSnapshot()` → `bootstrap()`（`enabledModels` 已在 bootstrap）。
- models/web/cost/embedding 面板：继续用（已轻量化的）editor-snapshot，或给一个专用轻 config 接口（最小改动下 editor-snapshot 轻量即可）。
- **表单数据来源拆分（B3）**：lowcode 表单**结构**来自编译后的 profile（`profile.settingsForm`，经 Registry 拿 `Resolved`）；表单**值/inherited**来自 config（global/project patch，`config-service.ts:533-535,543`），**不在产物里**。含义：profile `compile_failed`/`compiling` 时取不到结构 → 渲染状态块，但**用户已填的值安全躺在 config**，结构恢复后带旧值重渲染，**失败绝不等于丢设置**。
- **状态驱动刷新（B3）**：profile 处于 `compiling` 时前端订阅/轮询 `build-status`；翻 `loaded` 后自动重取 `/settings` 显示表单 → 体验是「编译中…→ 表单出现」，不再忽隐忽现。

## 7. 迁移路径

1. **格式硬切**：`PROFILE_ARTIFACT_COMPILER_VERSION` 5 → 6。旧 manifest 被 `ProfileReleaseStore` 判为不兼容 → 视为空 → 所有 profile not_compiled。**注意（F3 修正）**：preflight 只重编 **system root** + sync；**user root（含用户改过/自创 profile）不由 preflight 重生**，而是由 server 启动后的 **boot 对账 sweep** 后台重编自愈（否则升级后用户自定义表单会消失）。**旧 `.compiled` 直接弃用重建**（用户已接受）。
2. **5 类编译调用方统一经 Publisher**：
   - HTTP runtime user 编译：Worker 编到 staging → 回传 server 主线程 → Publisher 发布 + 翻内存（C）。
   - CLI `profile compile`（scripts/build）：单进程，编到 staging → Publisher 写 manifest（无需内存 Registry，写盘即可）。
   - system-assets-preflight：编 system root → Publisher 发布。
   - dry-run 源码检查（profile-source-check）：临时 root + ArtifactStore，不发布到真实 `.compiled`（不变）。
   - test：直接用组件，断言原子边界。
3. **assets 同步改造（B1）**：`syncCompiledProfileArtifact`（novel-workspace.ts:861）不再逐文件重写/覆盖用户 manifest。新流程：用户未改的受管副本与系统**字节相同 → 同一 `<sha>`**，sync 只 **copy-if-absent** 把 system `<sha>.mjs` 落入用户 `artifacts/`（幂等、无覆盖），再经 Publisher 一次性发布用户 manifest（单写入方）。用户**改过**的副本源码不同 → 编出自己的 `<sha>`、manifest 指自己的 sha，系统更新**不覆盖**（源码级冲突沿用现有 3-way：`upstreamHash`/`lastSyncedUserHash`/用户当前，冲突可在前端看 diff 后由用户决定接受上游）。**退役** `stageVerifiedArtifact`/`replaceFilesWithRollback`/`replaceFileWithRollback` 这套覆盖式回滚机器（variable definition 路径同理可跟进）。
4. **product 打包**：`scripts/build/profile.ts compile --all --system` 产出新格式（artifacts/ + manifest），product:stage 原样复制 `.compiled/`。require/importMeta shim 仍由 compiler banner 注入 artifact 内；shim 校验从「validateProfileArtifact 热路径」移到「发布/import 时一次校验」。

## 8. 测试计划（映射用户原 Test Plan）

- **Compiler/Publisher**：全量编译只原子替换一次 manifest；写 artifact 中途读 manifest 读不到半成品（内容寻址保证）；单文件编译基于 current release 生成新 manifest，不破坏其它 profile；失败 profile 记 compile_failed 仍发布、成功的可运行；源码在编译期再变 → 旧 build 丢弃标 stale + re-enqueue；删 profile → manifest 移除。
- **Catalog/Registry**：只从 current manifest 加载；非 loaded `get()` 抛错；helper/依赖变 → 受影响 profile 进 compiling/stale + 自动 enqueue；`artifacts/**` 事件不 invalidate；manifest 替换后才刷新。
- **API/Frontend**：editor-snapshot 不再含 settings 大包且不触发 catalog；profile settings 接口带状态；保存源码 → UI compiling → loaded/failed；AgentChatSurface 不再打完整 editor-snapshot。
- **Regression/Smoke**：compile-all 期间反复请求 settings 不闪；`editor-snapshot?workspaceKind=user-assets` 热路径不触发 profile catalog；外部编辑 writer 后自动编译、完成前不可运行、完成后恢复 loaded；记录 Server-Timing 分段（config/profileStatus/profileBuild/registryLoad/releasePublish）并修复自定义 mark 写不出的问题。

## 9. 风险与缓解

- **Windows rename 原子性**：内容寻址 artifact 用「rename 到不存在目标」（安全）；manifest 用「同目录 tmp → rename 覆盖」（NTFS 上 Node fs.rename 对文件是替换语义，原子）。避免目录 rename（方案 1c 的坑）。
- **import cache 简化**：artifact 路径已含 sha → import 天然按 sha 唯一，可去掉额外 copy-to-cache（或保留以绕 Bun query 缓存，但 key 已是 sha）。
- **GC 竞态 / 非单写者残留**：保留 grace period；绝不 GC current 引用的 sha；GC 只按「current manifest 是否引用」判定，**不假设自己是唯一写者**（覆盖降级/多版本/外部进程写入留下的残留 sha）。
- **worker→main 通道**：回传仅小 JSON（sha 映射 + issues），开销可忽略。
- **自动编译刷屏**：Markdown Studio 类自动保存可能高频触发 → Coordinator 必须 debounce + 合并 + generation 去重（已在设计内）。
- **严格无 stale 的 UX**：源码编辑后短暂 compiling 窗口内，需要该 profile 的 agent 运行会被拒（决策已接受）；前端要明确显示 compiling，避免用户困惑。
- **F1 跨进程并发写**：原子 rename 只防读者撕裂，不防两个写进程 lost update → 必须 per-root advisory lock + 「运行态只 server 单写」纪律（已锁定）。
- **F2 sha 语义**：见 §2；务必输出哈希 + 加测试，否则不可变性反成 stale 投毒。
- **F3 升级删 user 产物**：现状 compilerVersion bump 会删用户改过/自创产物且不重编 → boot 对账 sweep 兜底自愈（已锁定：非阻塞 + compiling 状态 + 单 profile 失败不阻塞启动）。

## 10. 分期落地（建议顺序）

- **Phase 0（独立、最快见效、低风险，不需新格式）**：读路径硬切（轴 4b）+ 前端状态可见（B2/B3）。直接缓解「表单静默消失」和「editor-snapshot 慢」，不依赖格式重构。**已确认先做（推荐）**。
- **Phase 1（一致性核心）**：新格式 + ArtifactStore/ReleaseStore/Registry/**双模 Publisher（F1）**+ 原子 manifest + **per-root advisory lock** + **sha=输出哈希语义锁定 + 测试（F2）**；重路由 5 类编译调用方；Watcher 收敛到只盯源码 + manifest。
- **Phase 2（自动化 + 内存权威）**：Coordinator + BuildState + 保存即自动编译（去抖 500ms 单窗口，已锁定）+ **worker 池并行** + **boot 对账 sweep（F3）** + C 叠加（内存发布）+ 严格无 stale 状态机。
- **Phase 3（收尾）**：assets 同步经 Publisher 改 copy-if-absent（B1，退役 rollback 机器）；**GC（非单写者残留回收）**；（可选）releases/ 历史账本（B 增量，已定后置：需要回滚/审计时再加）。

## 11. 决策（全部已锁定）

见任务 README 的 Decisions。round-05 F1/Q1 + F3/Q2 已锁定（跨进程单写 + advisory lock；非阻塞 boot sweep + compiling 状态、不阻塞预编、单 profile 失败不阻塞启动）。本轮 4 个默认也已确认：

1. **release 历史后置**：先上 E-core（manifest 即当前、无历史），需要回滚/审计时再加 releases/（B 增量）。
2. **自动编译去抖 500ms 单窗口** + 合并 + generation 去重，保存与自动保存统一合并，暂不拆显式/自动。
3. **freshness 降级**：启动/热路径只验「源码 sha + compilerVersion」、不重算整张依赖图（全量 rehash 留给 CLI `profile check`；依赖变化运行期靠 watcher 触发重编，见 §5.1），配「编译器/DSL 变更必 bump compilerVersion」纪律。
4. **Phase 0 先行**：读路径 + 前端状态独立先发拿即时收益，再做格式重构。
