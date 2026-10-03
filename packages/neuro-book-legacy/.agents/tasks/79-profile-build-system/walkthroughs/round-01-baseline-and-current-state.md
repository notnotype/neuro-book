# Round 01 — 现状基线与问题（代码级证据）

> 目的：把当前 profile 编译/加载系统摸到代码级，作为后续架构设计的事实基线。所有结论附 `file:line`。本轮只读、未改代码。

## 1. 系统全景与数据流

```
┌─ 源码真相源 ──────────────┐         ┌─ 运行真相源 ──────────────────────┐
│ workspace/.nbook/agent/   │  编译   │ <root>/.compiled/                 │
│   profiles/*.profile.tsx  │ ──────► │   <stem>.mjs        (产物)        │
│   + helper/依赖文件        │         │   <stem>.types.d.ts (类型)        │
└───────────────────────────┘         │   manifest.json     (账本+hash)   │
                                       └───────────────────────────────────┘
                                                      │ 只读
                                                      ▼
            ┌──────────────────── AgentProfileCatalog ────────────────────┐
            │ 运行加载(dynamic import) + 源码freshness + 依赖签名 + issue聚合 │
            │ 内存 cache(signature 键) + dirty/generation + chokidar watcher │
            └──────────────────────────────┬───────────────────────────────┘
                                            ▼
              readConfigEditorSnapshot() ── profiles.snapshot() ──► 大包 DTO
                                            ▼
        前端 6 个面板 + AgentChatSurface 都打 GET /api/config/editor-snapshot
```

关键文件：
- 编译器 `server/agent/profiles/profile-artifact-compiler.ts`
- 编译 worker `server/agent/profiles/profile-compile-worker.ts` + `profile-compile-worker-runtime.ts`
- catalog `server/agent/profiles/catalog.ts`
- 类型/状态 `server/agent/profiles/types.ts`
- API `server/config/config-service.ts` + `server/api/config/editor-snapshot.get.ts`
- 前端 `app/components/novel-ide/settings/NovelIdeAgentProfileModelSettingsPanel.vue`、`app/components/novel-ide/agent/AgentChatSurface.vue`
- 观测 `server/utils/server-timing.ts` + `server/plugins/server-timing.ts`

## 2. 现状逐组件

### 2.1 产物格式（可变扁平目录 + 单 manifest）

`profile-artifact-compiler.ts:11-43`。常量 `PROFILE_COMPILED_DIR_NAME = ".compiled"`、`PROFILE_ARTIFACT_COMPILER_VERSION = 5`。

- 产物文件名由 `stableArtifactStem()`（`:670-679`）从源码相对路径稳定派生，**不带 hash** → 新版本原地覆盖旧版本。
- manifest item（`ProfileArtifactManifestItem` `:21-36`）记 `sourceSha256 / sourceBytes / artifactSha256 / artifactBytes / typeSha256 / dependencyHash / dependencies[]`。
- 没有不可变 artifact store、没有 release、没有 current 指针。**产物目录本身就是「当前状态」**。

### 2.2 编译提交（非原子 — 病根之一）

`compileProfileArtifacts()`（`:67-115`）**先**编译到临时 build 目录 `.agent/workspace/profile-artifact-build/<uuid>`（`:71`），这点是好的。**但 commit 非原子**：`commitCompiledArtifacts()`（`:498-514`）搬进 live `.compiled/` 的顺序：

```
1. for each profile: copyFile(.mjs → live)        :500-504
2. for each profile: copyFile(.types.d.ts → live) :505-510
3. writeJsonIfChanged(manifest.json)              :512
4. pruneCompiledArtifacts()                        :513
```

> 第 1 步换了 `.mjs`、第 3 步才换 manifest → 中间 live 目录里 `.mjs` 是新 hash、manifest 还是旧 hash。这是「半提交窗口」。

### 2.3 compile-all 是 N 次独立非事务 commit

`runProfileCompileAll()`（`profile-compile-worker-runtime.ts:98-175`）核心循环（`:109-130`）：

```js
for (const file of files) {
    await compileProfileArtifacts({ profileRoot, fileName: file.fileName, ... }); // 逐文件单文件编译
}
```

每个文件一次 commit（copy + **重写整个 manifest.json** + prune）。N 个 profile = N 次 commit、N 次重写 manifest、N×多个文件事件。worker 本身单线程串行（`profile-compile-worker.ts:107-133` `pump()`），没问题；问题是它驱动的**文件副作用是 N 次非原子提交**。

### 2.4 catalog 四合一 god-object

`catalog.ts` 的 `AgentProfileCatalog` 同时扛：
- 运行加载：`importCompiledProfile()`（`:617-628`）动态 `import()` 每个 `.mjs`；为绕过 Bun 的 file URL query 缓存，先 `prepareCompiledProfileImportPath()`（`:864-874`）把 artifact 复制到 `.agent/workspace/profile-import-cache/<name>.<sha16>.mjs` 再 import。
- 源码/产物 freshness：`validateProfileArtifact()`（`profile-artifact-compiler.ts:205-258`）比 source/artifact/type/dependency 四类 hash + 两个 shim 检查（Nitro importMeta shim、product require shim）。
- 依赖签名：`catalogSignature()`（`:603-615`）→ `dependencySignatures()`（`:836-853`）对**所有 profile 的所有依赖逐个 `stat`**。
- issue 聚合：`loadInventory()`（`:468-505`）收集，`snapshot()`（`:363-399`）暴露。

加载状态机 `AgentProfileLoadStatus`（`types.ts:25-30`）：`loaded / not_compiled / compile_stale / compiled_load_failed / source_error`。**没有运行态 `compiling` / `compile_failed`**——只有「产物缺/旧/坏」的静态判断，没有「正在编译」「这次编译失败了」的账本。

issue code（`types.ts:32-45`）更细：含 `source_stale / dependency_stale`（容忍态）和 `not_compiled / compile_stale / compiled_load_failed / source_error`（不可运行态）。`statusFromIssue()`（`catalog.ts:822-830`）把 `source_stale/dependency_stale/filename_mismatch/builtin_schema_locked/system_profile_shadowed` 映射回 `loaded`。

### 2.5 watcher：全 root 递归监听 + 无差别 invalidate

`catalog.ts:185-255` `startWatching()`：chokidar `watch([systemRoot, userRoot])`（`:204-211`），递归监听整个 profile root，**包含 `.compiled/` 子目录**，`awaitWriteFinish.stabilityThreshold = 200ms`（`PROFILE_WATCH_AWAIT_WRITE_MS` `:100`）。

`:221-227` `watcher.on("all", ...)` **对任何事件无条件** `this.invalidate()`——不区分 `.profile.tsx` 源码、`.compiled/*.mjs`、`manifest.json`。

`invalidate()`（`:175-180`）= `catalogGeneration += 1` + `dirty = true` + **清空 catalogCache** + 清空 pendingCatalogLoad。

watcher 在 HTTP harness 单例启动（`neuro-agent-harness.ts:402` `this.profiles.startWatching()`，Task 74 设计），且 repo 内编译/保存/创建还会**额外**显式 `invalidate()` → 运行时 commit 期间是 watcher + 显式**双重**作废。

### 2.6 catalog 冷加载昂贵 + 缓存被反复击穿

`loadAll()`（`:401-450`）非 memory_hit 时：
1. `readProfileInventory()`（`:565-573`）：readdir + stat 每个 profile 文件 + 读 2 个 manifest。
2. `catalogSignature()`：stat **所有 profile 的所有依赖**（bundled profile 的依赖 = esbuild metafile 的全部输入，可能上百个，见 `readArtifactDependencies` `profile-artifact-compiler.ts:449-458`），再 `JSON.stringify` 一个内嵌完整 manifest 的大对象。
3. `loadInventory()` → `loadDirectory()`（`:507-563`）每个 profile：`hashFile(source)` + `hashFile(artifact)` + 读 artifact 头部 shim + `hashFile(每个依赖)` + **`import()` 动态加载 .mjs**（拉起一大块 agent runtime）。

缓存键是 signature（`catalogCache` `:72-75`）。但 `invalidate()` 每次 watch 事件都清 cache + bump generation；`loadAll()` 里 `:432-434` 要求 generation 一致才回写 cache，`:422-426` pendingCatalogLoad 去重也要求 generation 一致。**compile-all 期间 generation 一直在变 → cache 写不进、并发去重失效 → 每个请求都付完整冷加载**。慢阈值 `PROFILE_CATALOG_SLOW_MS = 500`（`:99`）天天击穿，日志 `agent.profileCatalog.slow.loadInventory` 飙到 3s/9s/14s。

### 2.7 editor-snapshot 大包 + 无条件读 catalog

`config-service.ts:94-131` `readConfigEditorSnapshot()`：`:102` **无条件** `await profiles.snapshot()`——即使 `includeAgentProfileSettings=false`、即使调用方只要模型列表（因为 `buildDefaultProfileSettingsDto` `:869-893` 要每个 profile 的 `loadStatus`）。

settings 何时 null：`buildProfileSettingsDto()`（`:515-532`）：

```js
if (definition.loadStatus !== "loaded") return null;  // ← 不是 loaded 直接 null
if (!definition.hasSettingsForm)        return null;
```

轻量替代 `readConfigBootstrap()`（`:136-156`）**不读 catalog** 却也能给 `enabledModels` + `effectiveProfileKey` + `ui.costCurrency`。

### 2.8 前端调用点（大包传染面）

`editorSnapshot()` 调用方（`app/**`）：
- `NovelIdeAgentProfileModelSettingsPanel.vue:519`（带 includeAgentProfileSettings）
- `NovelIdeModelSettingsPanel.vue:775`、`NovelIdeWebSettingsPanel.vue:256`、`NovelIdeCostSettingsPanel.vue:97`、`NovelIdeEmbeddingSettingsPanel.vue:193`（都不要 settings，但仍触发后端全量 `profiles.snapshot()`）
- `AgentChatSurface.vue:616` `loadSelectableModels()` 用完整 `editorSnapshot()` 只为读 `modelSettings.enabledModels` + cost currency
- `AgentChatSurface.vue:638` `loadResolvedLeaderProfileKey()` 已用轻量 `bootstrap()`（证明轻接口可行）

`NovelIdeAgentProfileModelSettingsPanel.vue` `onMounted`（`:701`）+ `watch` scope/workspaceKind/projectPath（`:705`）都会重新 `loadSettings()`。

### 2.9 前端丢状态 + 静默消失

`NovelIdeAgentProfileModelSettingsPanel.vue`：
- 草稿类型 `AgentProfileDraft`（`:36-42`）只留 `profileKey/name/canResetHome/model/settings`，**丢掉 `loadStatus/issue/hasSettingsForm`**（`applySettings :457` / `applyProjectSettings :474` 映射时丢）。
- 模板 `:883` `<div v-if="profile.settings">`——settings 为 null 时**整个低代码区块不渲染**，无状态块、无原因。
- 对比 `:112-128` 默认 profile 下拉有红绿点状态（数据来自 `defaultProfileSettings.profiles[].loadStatus`）→ **后端有送 loadStatus，是这个 settings 卡片自己丢的**。

### 2.10 Server-Timing 观测不可靠

`editor-snapshot.get.ts:2683-2692` handler 包了 `timing.measure("config.editor", ...)`，但只 push mark 到 `event.context`、不 `commit()`；靠 `server/plugins/server-timing.ts:6-9` 的 `beforeResponse` hook 调 `flushServerTiming` 写头。用户实测响应头只剩 Nitro 的 `Generate`、无自定义 mark。**仅读代码未运行时验证**，可疑点：单一 `beforeResponse` 提交点在 dev runtime 下可能被覆盖；且即便写出，粒度只有一个 `config.editor` 大段，无法区分 `readConfigFiles / profileCatalog / lowCodeForm`。

## 3. 半提交窗口的精确复现（病根）

```
compile commit 中：
  copyFile(writer.mjs) 已执行 → live .mjs = 新hash
  writeJsonIfChanged(manifest) 未执行 → manifest = 旧hash
此刻 editor-snapshot 进来：
  validateProfileArtifact() :221-224  artifactHash(新) !== item.artifactSha256(旧)
    → reason = "artifact_changed"
  loadDirectory :525-531  非 user-source_changed/dependency_changed → continue 分支
    → compile_stale → unloadedSources
  loadStatus = "compile_stale"
  buildProfileSettingsDto :523  loadStatus !== "loaded" → settings = null
  前端 v-if="profile.settings" = false → 表单消失
```

> 关键细节：对 **user profile 的 `source_changed` / `dependency_changed`**，catalog 是**容忍**的（`:527` 排除这两种，走 `loadIssue` 继续加载旧产物，`statusFromIssue` 映射回 `loaded`）→ 所以「保存源码」本身不会让表单消失。**真正让表单消失的是 `artifact_changed/artifact_missing/type_*`，而这几种恰是 commit 半成品窗口制造的** → 解释了「编译期间」才忽隐忽现。

## 4. 三条预编译路径（重构必须不破坏）

除运行时用户编译外，`compileProfileArtifacts()` 还被这些路径调用（grep 证据）：
- build-time：`scripts/build/profile.ts:183/240/502` + `scripts/build/generate-profile-variable-types.ts:15`。
- 系统 assets 预热：`server/workspace-files/system-assets-preflight.ts:23`。
- dry-run 源码检查：`server/agent/profiles/profile-source-check.ts:39`（用临时 root，不污染真实 `.compiled`）。
- 测试：`workspace-files.test.ts`、`catalog.test.ts`、`workbench-service.test.ts`。

这些路径多数没有 HTTP watcher 在跑，所以「半提交窗口」主要伤运行时用户编译；但**新格式必须同时服务这五类调用方**（dev/build、preflight、product-runtime、user-runtime、test）。product-runtime 还有额外复杂度：`runtimeRequireBanner()`（`:552-565`）和 import.meta shim 校验（`:388-391`）。

## 5. 为什么是「系统性」问题

profile 的「真相」需要两类东西同时一致：源码/依赖 hash ⟷ 产物/manifest hash。当前有三个力同时拉扯：
1. 写入方（编译器）逐文件、非原子地改产物 + 账本；
2. 读取方（catalog）用 hash 严格校验，不一致即降级；
3. 观察方（watcher）把任何中间态立即翻译成「作废重读」。

只要三者共享「一个可变目录 + 一个 manifest」且无原子发布边界，**任何一次编译都必然制造三方不一致窗口**。前端重试盖症状、watcher debounce 缩窗口，都不根治。这正是后续架构设计要从根上消灭的对象。

## 6. 待延伸探索（round-02 计划）

- harness 如何 wiring profiles + watcher + compile worker（`neuro-agent-harness.ts`）。
- build/preflight/product-runtime 三条路径细节 + `rehomeProfileArtifactItem`（系统 profile 复制到用户 root 的 hash 重写）。
- variable-types 生成（`generateVariableTypes`）与 profile-home / profile-registry 对产物的依赖。
- import cache（`profile-import-cache`）与 Bun/Node import 语义、HMR、worker 版本（`profile-compile-worker.ts` `WORKER_VERSION`）。
- catalog/snapshot 的全部读取面（config-service / harness / agent tools），评估硬切影响。
