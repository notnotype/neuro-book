# Round 02 — 延伸探索：harness wiring / 三条编译路径 / 多写入方 / blast radius

> 在 round-01 的基础上向 Harness 级和编译生命周期延伸，确定重构必须满足的真实约束。

## 1. Harness wiring 与 watcher 门控

- HTTP runtime 单例：`server/agent/http.ts:30` `globalForAgentHttp.agentHarness = new NeuroAgentHarness({watchProfiles: true})`。**watcher 只在这里开**。
- harness 构造（`neuro-agent-harness.ts:381-408`）：`this.profiles = options.profiles ?? new AgentProfileCatalog()`；注册 `defaultAgentProfile` / `summarizerProfile` 两个内存 builtin；仅当 `options.watchProfiles`（`:401`）才 `startWatching()`。
- 测试和 worker 内的 harness 都不带 watcher（用显式 `invalidate()` 或一次性 snapshot）。

## 2. 编译触发全貌 + 双重作废风暴

编译只由三个 HTTP 端点 + 启动预热触发，**没有「保存即编译」**：

| 触发点 | 调用 | 编译后 |
| --- | --- | --- |
| `POST /api/agent/profiles/compile` | worker `.compile(single)` | 端点 `:12` `useAgentHarness().profiles.invalidate()` |
| `POST /api/agent/profiles/compile-all` | worker `.compileAll()` | 端点 `:12` `invalidate()` |
| `POST /api/agent/profiles/save` | `saveProfileSource` 内 `:185` invalidate | 端点 `:12` 再 invalidate（**不编译**） |
| `POST /api/agent/profiles/create` | `createProfileSource` 内 `:227` invalidate | 端点 `:12` 再 invalidate（**不编译**） |
| 启动预热 | `prepareSystemAssets`（system-assets-preflight.ts:23）全量编译 system root | — |

**双重作废风暴的精确机制**：编译 worker 跑在 **worker_thread**（`profile-compile-worker.ts`），它**在另一个线程写盘** `.compiled/`。主线程 catalog 的 chokidar watcher 看到这些写入 → 每个文件事件 `invalidate()`；worker 跑完后 HTTP 端点又**显式** `invalidate()`。于是 compile-all 期间主线程 catalog 被 watcher（N×多文件）+ 端点（1 次）反复作废，而用户的 editor-snapshot 请求正好打在主线程上。worker 与主 catalog 跨线程、只能靠「写盘 + 观察盘」通信，是抖动的结构性来源。

## 3. 两种 compile-all 语义：故障隔离 vs 原子发布（重要张力）

- **CLI** `profile compile --all`（`scripts/build/profile.ts:177-198` `runCompile`）：`compileProfileArtifacts({fileName: undefined})` → **一次全量编译、一次 commit**。但任一文件编译抛错会中断整批。
- **Runtime worker** `runProfileCompileAll`（`profile-compile-worker-runtime.ts:109-130`）：**逐文件**循环 `compileProfileArtifacts({fileName})`，try/catch 每个文件 → 一个坏 profile 不阻塞其它，但代价是 **N 次非原子 commit**。

> 这揭示了核心设计张力：**故障隔离（逐文件、坏的不连累好的）** 与 **原子发布（一次性、读者永不见半成品）** 当前是二选一。新架构必须同时给：每个 profile 独立编译到 staging（隔离失败），然后**一次性发布整批**（原子）。这正是 ProfileReleasePublisher 的职责。

## 4. `.compiled/` 有多个写入方（不止编译器）

- 写入方 1：编译器 `commitCompiledArtifacts`（profile-artifact-compiler.ts:498）。
- 写入方 2：assets 同步 `syncCompiledProfileArtifact`（novel-workspace.ts:861-915）——系统 profile 同步到用户 root 时，它**直接操作用户 `.compiled/manifest.json`**：`rehomeProfileArtifactItem` 重写依赖路径（`:871`），把 source hash 改成用户侧源码 hash（`:883-887`），filter+merge 进用户 manifest，再 `stageVerifiedArtifact` 替换 artifact（`:897`，比编译器的 copyFile 更谨慎，带校验）。
- 写入方 3（间接）：worker-runtime 编译后 `new AgentProfileCatalog(undefined, userProfileRoot).snapshot()`（runtime.ts:132）回读结果、报告 loadStatus。

> 一个可变目录 + 一个 manifest 被「编译器 / assets 同步 / 回读」多方读写，且各自的一致性策略不同（编译器 copyFile，同步 stageVerified）。新架构的 **ProfileReleasePublisher 应成为 `.compiled` 的唯一写入入口**，assets 同步也走它发布，而不是各写各的 manifest。

## 5. blast radius：snapshot 不只喂设置页，也在 Agent 热路径

`this.profiles.snapshot()` / `get()` 的消费点（harness grep）：
- `get()`：run/invoke/resume/sidecar/summarizer 等 ~12 处（`:475/532/1144/1195/2410/2499/4286/4508/4803/4976/5741`）。
- `snapshot()` 进 profile prepare ctx：`:1799/2435/3438/4809` —— **每个 agent turn 的 prepare 都拿一份 catalog snapshot**。
- `resolveMany()`：session 列表批量解析（Task 73，`:1383`）。

> 含义：catalog 抖动/变慢不仅让设置页表单忽隐忽现，也会拖慢**每一次 Agent 运行的 prepare**。所以 catalog 的「热路径只读内存、永不在请求里编译」必须是硬性质，且 snapshot 必须是 O(1) 内存读。

## 6. 一次性 / 临时 catalog 实例遍地

`new AgentProfileCatalog(...)` 短生命周期实例（无 watcher、每次冷 snapshot）：`workbench-service.ts:52`（listProfileFiles）、`profile-compile-worker-runtime.ts:35/132/197`、`profile-source-check.ts:44`、`scripts/build/profile.ts:251/263/265`、各测试。这些都付一次冷加载成本（dynamic import + 全依赖 stat/hash）。新架构若把「读 current release → import」抽成轻量 ReleaseStore，这些临时实例可共享同一份廉价读路径。

## 7. 类型产物是 dev-authoring，不是 runtime 依赖

`<stem>.types.d.ts` 由 `generateVariableTypes`（profile-artifact-compiler.ts:345）生成，只被 **CLI typecheck**（`scripts/build/profile.ts:496-531` `collectProfileSessionTypes`）和 Workbench 变量面板消费，**runtime 加载只需 `.mjs`**。新格式可把 types 作为 release 的旁路 artifact，不进 runtime 关键路径。

## 8. product-runtime / 跨环境约束（新格式不得破坏）

- product require shim：`runtimeRequireBanner`（compiler:552-565）给 artifact 注入 `__nbookResolveProductRequireRoot`，`validateProfileArtifact` 会校验其存在（`:228`）。
- Nitro importMeta shim 检测：`artifactHasNitroImportMetaShim`（`:388`）——带 `globalThis._importMeta_` 的 artifact 视为 stale。
- import cache：`prepareCompiledProfileImportPath`（catalog:864）复制到 `.agent/workspace/profile-import-cache/<name>.<sha16>.mjs` 再 import，绕过 Bun file URL query 缓存。
- worker 入口解析：`resolveProfileCompileWorkerPathsForRoot`（worker:231）区分 product `.output/server` 与源码 root，需 tsx vendor。

新格式必须同时服务 **5 类编译调用方**：dev/build CLI、system-assets-preflight、product-runtime user 编译、HTTP runtime user 编译、test；并兼容 **assets 同步 rehome** 与上述 shim 校验。

## 9. 关键行为变更点（设计需显式决策）

当前对 **user profile 的 `source_changed`/`dependency_changed`** 是「容忍」：继续加载旧产物，`statusFromIssue` 映射回 `loaded`（catalog:823）。但用户锁定决策是「runtime 严格阻止 stale，不回退上次成功产物」。

> 这意味着新语义：**源码一变，该 profile 立即变为不可运行（compiling/stale），直到新 build 成功才恢复**。配合「保存即自动后台编译」，不可运行窗口很短。这是与现状不同的硬切，必须在状态机里把 `source_stale/dependency_stale` 从「loaded」改判为「非可运行」。

## 10. round-03 设计要解决的轴（小结）

把问题拆成 4 条半独立的轴，供方案枚举时正交组合：

1. **发布原子性**：runtime 视图如何从旧到新原子翻转。
2. **变更检测/失效**：catalog 如何在不抖动的前提下得知视图变了。
3. **编译编排**：谁决定何时编译什么、故障隔离、staleness、自动编译。
4. **读路径解耦**：editor-snapshot / settings / 模型列表 如何不再绑死 catalog。
