# Round 05 — 设计审查:多场景 / 多进程 / git 版本更新 / 启动 CLI

> 对 round-04 推荐架构(E+C)做对抗式审查。新读了启动链路与编译/同步内核(launcher、product-start、prepare-system-assets、profile-artifact-compiler、novel-workspace sync、product-runtime stage、.gitignore、package.json),按「多角度 + 多使用场景 + git 版本更新 + 启动 CLI」逐项压测。结论先行:**E+C 内核仍然成立且确实消灭半提交窗口,但 round-04 漏了三个会致命的现实约束——多进程(非多线程)、content-address 的 sha 语义、版本升级对账**。本轮只读、未改代码。

---

## 0. 本轮新增的代码级事实(全部带 file:line)

### 0.1 真实启动拓扑是「多进程」,不是「主进程单例」

Windows Portable 启动(`scripts/deploy/windows-portable/launcher/launcher.mjs:67-77`):

```
start():
  assertProductPayload → ensurePortableConfig → loadDataEnv → ensurePortAvailable
  await prepareSystemAssets()      // :73  ← 关键
  await migrate()                  // :74
  await ensureAdminUser()          // :75
  await runServer(...)             // :76  ← server 进程在这之后才起
```

`prepareSystemAssets()`(`launcher.mjs:464-467`)**spawn 一个独立子进程**跑 `build/prepare-system-assets.ts --sync-user-assets`,launcher `await` 它退出后才 `runServer`。容器/通用 runner 走 `scripts/deploy/product-start.mjs:13,27`,同样是「先 spawn preflight 进程,再 spawn server 进程」。

于是 `.compiled/` 的写入方分布在**至少 3 个进程入口**:

| 入口 | 进程 | 触发时机 | 写哪个 root |
| --- | --- | --- | --- |
| `prepare-system-assets.ts`(launcher/product-start spawn) | **独立 CLI 进程** | server 启动前 | system 编译 + **sync 写 user** |
| `sync-user-assets.post.ts:7`(前端「同步」按钮) | **server 进程内** | 运行时任意 | system 编译 + **sync 写 user** |
| HTTP runtime compile / compile-all worker | server 进程 + **worker_thread** | 运行时 | user(或 system) |
| `bun dev`(`package.json:20`) | 独立 CLI 进程 | `nuxt dev` 起来前 | system + sync user |

`sync-user-assets.post.ts:7` 调的就是 `prepareSystemAssets({syncUserAssets:true})` —— **和启动 CLI 完全同一段代码**,但一个跑在独立进程、一个跑在 server 进程内。

### 0.2 全仓库没有任何跨进程锁

grep `lockfile|flock|\.lock|withLock|proper-lockfile|mutex`:`async-mutex`、`proper-lockfile` 只作为 `@prisma/adapter-libsql` 的**传递依赖**出现在 `bun.lock`,profile/compile/sync 代码**零引用**。`.compiled/` 没有任何 advisory lock / pid lock / 原子 CAS 保护。

### 0.3 编译产物不进 git,全靠启动重建

`.gitignore:43` 忽略 system `assets/.../profiles/.compiled/`;`:38` 忽略整个 `/workspace/`(user root)。即:

- **dev `git pull`**:产物不在版本控制 → `bun dev` 重跑 preflight(`package.json:20`,`skipFresh` 增量)重建变化项。
- **product 包**:`product-runtime.mjs` stage 时把 `assets/workspace`(含源码 + `.compiled/`)与 `.output` 一起复制(`:34-35`),`copyRuntimeSources()`(`:40`)复制 `server/` 源码,`prepareProductSystemAssets()`(`:50`)在 CI 烘焙 `.compiled/`,`assertProductProfileArtifactsPortable()`(`:61-64`)断言 `manifest.json` 存在且可移植。**所以产品包带预编译 system 产物 + 重编所需源码**;启动 preflight `skipFresh` 命中 fresh 就秒过,否则现编。

### 0.4 content-address 设计命门:sha 哈希的是「输出」还是「输入」?

当前编译器里同时存在两套 hash,round-04 没区分清楚:

- `artifactSha256` = **编译输出 `.mjs` 字节**的 hash(`profile-artifact-compiler.ts:341` `hashFile(temporaryOutputPath)` → `:359`)。
- `dependencyHash` = **输入**的 hash:`"profile-artifact"\0 + PROFILE_ARTIFACT_COMPILER_VERSION + 源码路径 + 每个依赖(path/sha/bytes)`(`:469-485`),**已包含 compilerVersion**。
- artifact 文件名 = `stableArtifactStem`(`:308,339,670-679`),**不含任何 hash,新版本原地覆盖旧文件**。

### 0.5 compilerVersion gate 是「整本 manifest 作废」

`readProfileArtifactManifest:128-130`:`record.compilerVersion !== PROFILE_ARTIFACT_COMPILER_VERSION`(当前 `=5`,`:11`)→ 直接 `emptyArtifactManifest`(`:657-664`,`profiles: []`)。任何读到旧版本号的代码,**整个 root 的所有 profile 瞬间变 not_compiled**。

### 0.6 sync 是「逐 profile 重写 user manifest + 覆盖式替换 + prune 删未列项」

`syncCompiledProfileArtifact(fileName)`(`novel-workspace.ts:861-931`)每个 system profile 调一次:

1. 读 user manifest(`:869`)→ rehome system item 到 user 标签(`:871`,`rehomeProfileArtifactItem` 改依赖路径)→ 把 source hash 绑成 user 源码 hash(`:883-887`)。
2. `stageVerifiedArtifact`(`:1006-1036`):copy system `.mjs` 到 `.syncing` 临时文件 → **校验 sha == manifest 期望**(比编译器 copyFile 谨慎)→ 暂存。
3. 写 user manifest 到 `.syncing` 临时文件(`:920-923`)。
4. `replaceFilesWithRollback`(`:1042-1062`):**逐个 commit**(`:1055-1058` for 循环依次 `commit()`),失败回滚。
5. `pruneCompiledDirectory(userCompiledRoot, nextManifest.profiles…)`(`:925`)**删除不在 nextManifest 里的产物**。

注意点:`replaceFilesWithRollback` 有 rollback,但 commit 是**逐文件顺序**,跨文件**不是原子**;且仍是**覆盖式替换 stable 文件名**(Windows 上若该 `.mjs` 正被 import,占用/撕裂风险仍在)。它是 per-file 调用 → user manifest 被**重写 N 次**(同 compile-all 的 N 次非原子提交,只是搬到了 user root + 启动 preflight 进程里)。

---

## 1. 对 round-04 的硬冲突(按严重度排序)

### 🔴 F1 — 「主进程唯一 Publisher + 内存权威 Registry」假设被多进程打破

round-04 §3/§9 的 C 方案核心是「worker 只写 artifacts/、主进程唯一原子写 manifest + 翻内存 Registry → 根除跨线程双重作废」。但 §0.1 证明真相是**多进程**:

- 启动期:**preflight 是独立进程**,它编 system + sync 写 user manifest,server 进程那时还没起。server 起来后读盘进 Registry —— 这条**没问题**(串行,launcher `await`)。
- 运行期:前端点「同步」→ `sync-user-assets.post.ts` 在 **server 进程内**跑 `prepareSystemAssets`,它和 server 自己的 runtime compile worker、live watcher 并发 —— round-02 §4 已点出的同进程多写入方,**这条 round-04 说「都经 Publisher」可以解决**。
- dev / 运维误操作:server 在跑,有人另开终端 `bun system-assets:prepare` 或 `bun scripts/build/profile.ts compile --all` —— **两个进程并发写同一个 `.compiled/`,无任何锁**(§0.2)。E 的原子 manifest rename 只保证**读者不撕裂**,**不保证两个写者不互相覆盖**(lost update / 交错发布)。

**round-04 的缺口**:它把问题建模成「跨线程」,但真实是「跨进程」。内存权威 Registry 只能管 server 自己那个进程,管不了 CLI 进程。

**修正方向(必须在 Phase 1 前补)**:
1. **承认两种 Publisher 模式**:进程内(server)发布要「写盘 + 翻 Registry」;进程外(CLI/preflight)发布只「写盘」,server 下次读盘或被 manifest watcher 拉起谨慎 re-resolve(round-04 §5 的 external fallback,要落实)。共用 `prepareSystemAssets` 必须显式注入「是否进程内 Publisher」。
2. **给 `.compiled/` 加跨进程 advisory 锁**(per-root,`<root>/.compiled/.publish.lock`,`proper-lockfile` 需 `bun add` 为**直接依赖**、勿赖 Prisma 传递依赖):任何写者(CLI / server / worker)发布前抢锁,杜绝并发写者交错。内容寻址让「读」无需锁,只有「替换指针」这一步要锁,争用极小。
3. **明确「谁能在 server 运行时写 `.compiled/`」**:最干净是「运行时只有 server 进程经其单例 Publisher 写;preflight 只在 server 未起时由 CLI 写」。sync API 不再自己写盘,而是调用 server 进程内 Publisher。

### 🔴 F2 — content-address 的 `<sha>` 必须是「输出字节哈希」,否则 write-once 不可变会变成 stale 投毒

round-04 §2 写 `artifacts/<sha>.mjs`「同一 sha 只写一次、永不覆盖」,但**从没说 `<sha>` 到底是什么**。§0.4 显示有两个候选:

- ✅ **正确:`<sha>` = `artifactSha256`(编译输出字节 hash)**。同样输出 → 同名同内容(共享无害);输出不同 → 不同名,绝不撞车。编译器升级即使不 bump compilerVersion、只要输出字节变了,sha 就变,旧文件自然作废 → write-once 安全。
- ☠️ **错误:`<sha>` = 输入 hash(`dependencyHash`/`sourceSha`)**。一旦编译器逻辑变了但输入没变(改 banner、esbuild 小版本升级导致产物不同),输入 hash 不变 → write-once 命中旧文件 → **永远 import 到旧产物,且无人察觉**。这是比现状「原地覆盖」更隐蔽的正确性 bug。

**round-04 缺口**:未锁定 sha 语义。**修正**:写死「`<sha>` = 编译输出字节 sha256」,worker 编完→算输出 sha→写 `<sha>.mjs`→回传 sha(round-04 §3 流程本就这样,只是没点明 sha 来源)。compilerVersion gate(§0.5)继续作为**粗粒度兜底**:bump 版本 → 整本 manifest 作废 → 重新 derive profile→sha 映射。两层配合才完备。加一条测试:**同输入、不同 compilerVersion → 必须产出不同 artifact 且不复用旧文件**。

附带收益:content-address 让 system→user 的 sync 巨幅简化(见 §3.2)。

### 🔴 F3 — 版本升级(compilerVersion bump)会**删除**用户自定义 profile 产物,而启动 preflight 不会重编 user root

这是最贴近用户痛点的发现(**代码推导,未运行时验证**,可补测试坐实):

升级到 compilerVersion 6 后首次启动:

1. preflight 进程读 **user** manifest(v5)→ §0.5 gate → 返回 `emptyArtifactManifest`(profiles 空)。
2. `syncCompiledProfileArtifact` 以「空 user manifest」为基底,`nextManifest.profiles = [仅系统同步项]`(`:879-889`),写成 v6 user manifest → **用户自定义 profile 的 manifest entry 全部丢失**。
3. `pruneCompiledDirectory`(`:925`)只保留 nextManifest 列出的产物 → **用户自定义 profile 的 `.mjs` 被物理删除**。
4. preflight **只 `compileProfileArtifacts` system root**(`system-assets-preflight.ts:23`),**从不编 user root**;`save`/`create` 也不编(round-02 §2);harness 启动只起 watcher 不编。

→ **结论:每次 compilerVersion bump,用户自定义 profile 升级后变 not_compiled 且产物被删,必须手动 compile-all 才恢复。** 这与用户报告的「lowcode 表单忽隐忽现」高度吻合——升级是其中一类稳定触发。

round-04 §7.1 写「preflight/自动编译重生成新格式」是**过度乐观**:preflight 不碰 user root,自动编译只在「源码编辑」触发,**都覆盖不到「manifest 被版本重置」这个场景**。

**修正方向(必须补进设计)**:**启动对账 sweep(reconcile-on-boot)**——Registry 加载 manifest 后,对每个 root 比对「源码文件集合 vs manifest 命中集合」,对缺失/版本失配的源码 profile **enqueue 后台编译**(走 Coordinator,非阻塞)。这样:
- compilerVersion bump → 整本作废 → sweep 把 system + user 全部 enqueue 重编 → 自愈,无需用户手动。
- 严格无 stale 期间这些 profile 显示 `compiling`(round-04 §4 状态机已有),不再「静默消失」。
- preflight 也应顺带触发 user root 的对账(进程外只写盘版本),或把 user root 重编交给 server 启动后的 sweep(更安全,避免 preflight 进程编 user)。

---

## 2. 多使用场景矩阵

✅ 已被 E+C 覆盖 / ⚠️ 需补设计 / ❌ 新发现的洞

| 场景 | 当前行为 | E+C(round-04 原样) | 结论 |
| --- | --- | --- | --- |
| 全新安装首启 | preflight 全量编 system;user 空 | 一次原子发布;Registry 建 Map | ✅ |
| 普通重启(无变化) | preflight `skipFresh` 全 fresh → 秒过 | 读 manifest → import sha → O(1) | ✅ 须保证 boot 不误判 stale 触发重编 |
| 升级:源码变、同 compilerVersion | preflight 增量重编变化的 system;sync 推送 managed,手改保留;user 自定义源码没变 → 仍 fresh | 原子发布变化项 | ✅ 基本无忧 |
| **升级:compilerVersion bump** | **user 自定义产物被删 + 不重编 → 表单消失,需手动 compile-all** | round-04 同样不自动重编 user root | ❌ **F3,必须加 boot 对账 sweep** |
| 降级(回退旧版) | 旧码读新 manifest → gate 作废 → 旧码按 stable 文件名覆盖重编(旧扁平布局无残留) | 新布局下 `<sha>.mjs`(新版写的)无人引用 → 残留,**靠 GC**;旧码 GC 只认自己 manifest → 可能漏删 | ⚠️ GC 必须「删一切不被 current manifest 引用的 sha」,不假设自己是唯一写者 |
| 崩溃 / 断电(发布中途) | copyFile 循环中途 → 撕裂 manifest+产物 → 下次 freshness 判 stale 重编(自愈但吵) | `<sha>.mjs` 加性写 + manifest 单次 rename → 要么旧要么新,**永不撕裂** | ✅ E 的结构性优势 |
| 磁盘满 / 写失败 | copyFile 中途失败 → 残留 | tmp 写失败 → 发布中止,旧 manifest 不动,旧版继续跑 | ✅ E 优雅降级 |
| sync API 与 runtime compile 并发(同进程) | 多写入方各写各的 manifest(round-02 §4) | 都经进程内 Publisher 串行 | ⚠️ 须确保 sync API **不再自己写盘**,而是调用同一 Publisher 实例 |
| **CLI 与 server 并发(跨进程)** | 无锁,可互相覆盖 | 原子 rename 防撕裂,**不防 lost update** | ❌ **F1,须跨进程锁 / 单写者纪律** |
| dev 编辑 system profile 源码 | watcher invalidate;不自动编 | per-root Coordinator 自动编(system+user 双 root watch) | ✅ 设计已含,落地须确认双 root |
| 产品启动依赖 rehash 命中 | freshness 重 hash 全部依赖(`:251-256`),依赖路径 = cwd 相对(`server/...`),product 靠 `copyRuntimeSources` 提供 → 命中则 fresh | 同样的 freshness 模型 | ⚠️ 依赖 rehash 在启动热路径,profile 多/依赖多时成本可观;新设计可考虑 boot 时「源码 sha + compilerVersion 命中即信任,延后/抽样 rehash 依赖」 |

---

## 3. 启动 CLI 的优化 / 重构建议(回应「cli 可按需优化或重构」)

现状 CLI 表面(`scripts/build/profile.ts`:`status/check/compile/preview`;`prepare-system-assets.ts`:preflight+sync 入口)是合理的,真正该重构的是**它们底下共用的「逐文件非原子提交」内核**,正好与 E+C 同向:

### 3.1 统一「批量 staging → 一次原子发布」,消灭两处 N 次非原子提交

- 编译侧:runtime worker `runProfileCompileAll` 逐文件 commit(round-02 §3),CLI `--all` 反而是「一次全量 commit」(`profile.ts:183-187`,`fileName: undefined`)——**两种语义不一致**。统一成 Publisher:每个 profile 编到内容寻址 staging,整批一次 manifest rename。CLI 与 runtime 共用同一 Publisher(进程外只写盘 / 进程内翻 Registry,F1)。
- 同步侧:`syncCompiledProfileArtifact` per-file 重写 user manifest(§0.6)→ 改为「先把所有要同步的 system sha 落入 user `artifacts/`,再一次性合并发布 user manifest」。

### 3.2 content-address 让 sync 大幅简化甚至删掉 rollback 机制

当前 sync 的 `stageVerifiedArtifact` + `replaceFilesWithRollback` + per-file 覆盖(§0.6)是为「覆盖 stable 文件名还要可回滚」造的复杂机器。content-address 后:

- system 与 user 的同一产物**字节相同 → 同一个 `<sha>.mjs`**。sync 只需 `copy-if-absent`(目标已存在即跳过,天然幂等),**不存在覆盖,不需要 rollback**。
- user manifest entry 指向同一 `<sha>`,只是 `sourceSha256` 绑用户源码 hash(rehome 的语义保留)。
- 发布仍是「user manifest tmp→rename」一次。
→ `stageVerifiedArtifact`/`replaceFilesWithRollback`/`replaceFileWithRollback` 这套(`novel-workspace.ts:1006-1062`+)在 profile 路径上**可整体退役**(variable definition 路径同理可跟进)。这是实打实的减负。

### 3.3 启动 preflight 的阻塞与延迟尖峰

`launcher.mjs:73` `await prepareSystemAssets()` **阻塞 server 启动**。正常重启 `skipFresh` 秒过,但 compilerVersion bump 时 system root 全量串行重编 → **升级首启延迟尖峰**。建议:
- 编译并行化(worker 池),preflight 内部并发编多个 profile。
- **user 自定义对账重编移出 preflight 阻塞段**,作为 server 启动后的后台 sweep(F3 修正),启动只阻塞「system 可运行」最小集合。
- preflight 失败处理要明确:目前 `await` 抛错会怎样?(`run` 在 `product-start.mjs:120-127` 非 0 退出码会 reject → launcher 启动失败)。strict-no-stale 下,system 编译失败应「该 profile 不可运行 + 状态可见」,而非**整个产品起不来**——需要 preflight 把「单 profile 失败」与「致命错误」分开。

### 3.4 CLI / server 共用代码的 Publisher 模式注入

`prepareSystemAssets`、`compileProfileArtifacts` 被 5 类调用方共用(round-01 §4)。重构后它们必须接受「Publisher 句柄 / 模式」参数:进程内传 server 的单例 Publisher(翻 Registry),进程外(CLI)传 disk-only Publisher。否则 F1 的两种模式会在同一函数里隐式打架。

---

## 4. round-04 文档需要修订的具体条目

1. **§2 磁盘布局**:明确 `<sha>` = **编译输出字节 sha256**(F2);补一句「artifact 跨 root 同 sha 即同文件,sync 用 copy-if-absent」。
2. **§3 发布时序**:把单一「主进程 Publisher」升级为「进程内 Publisher(翻 Registry)/ 进程外 Publisher(只写盘)」双模 + per-root 跨进程发布锁(F1);补「boot 对账 sweep」节点(F3)。
3. **§4 状态机**:补 `compiling` 覆盖「boot 对账触发的重编」来源。
4. **§7.1 迁移**:纠正——compilerVersion bump 后 **user root 不会被 preflight 自动重生**,必须靠 boot 对账 sweep;preflight 只管 system + sync(F3)。
5. **§7.3 assets 同步**:落实为「copy-if-absent 到 user artifacts/ + 一次性发布 user manifest」,退役 rollback 机制(§3.2)。
6. **§9 风险**:新增 F1(跨进程无锁 → lost update,缓解=advisory lock)、F2(sha 语义错误 → stale 投毒,缓解=输出哈希+测试)、F3(升级删 user 产物,缓解=boot sweep);GC 补「删一切非 current 引用的 sha,不假设单写者」(降级残留)。
7. **§11 开放问题**:Q1/Q2 已锁定(移入任务 README 的 Decisions),§11 仅余依赖 rehash(见 §5.3)+ round-04 原 3 问。

---

## 5. 开放问题与决策

**✅ 已锁定(用户确认)**:

1. **跨进程写入纪律(F1 / 原 Q1)= 单写者 + advisory lock**。运行态 `.compiled/` 只由 server 进程经其单例 Publisher 写;preflight 仅在 server 未起时由 CLI 进程写;不允许 server 运行时另起进程并发写运行态产物。per-root advisory lock(`<root>/.compiled/.publish.lock`,`proper-lockfile` 实现时 `bun add` 为直接依赖、勿赖传递依赖)兜底防交错。
2. **升级首启重编策略(F3 / 原 Q2)= 非阻塞 boot 对账 sweep**。compilerVersion bump 等「整本 manifest 作废」场景,server 正常启动,后台 enqueue 重编失效的 user 自定义 profile;重编完成前短暂不可运行(严格无 stale),以前端 `compiling` 状态诚实呈现。**不做阻塞式预编**;单个 profile 编译失败只标 `compile_failed`,绝不阻塞 App 启动或其它 profile(失败隔离是选此方案的决定性理由)。

**✅ 已锁定(补充,用户确认推荐默认)**:

3. **freshness 降级**:boot/热路径只验「源码 sha + compilerVersion」,全依赖 rehash 放 CLI `profile check`;依赖变化运行期靠 watcher 触发重编(freshness 三时机见 round-04 §5.1)。
4. **release 历史后置 + 去抖 500ms 单窗口 + Phase 0 先行**(详见任务 README 的 Decisions / round-04 §11)。

---

## 6. 结论

- **E+C 内核经得起审查**:内容寻址 + 原子 manifest 指针确实把「半提交窗口」「崩溃/磁盘满撕裂」从结构上消灭(§2 矩阵多数 ✅),这是现状 copyFile 循环给不了的。
- **但 round-04 漏了三个现实约束,必须在 Phase 1 之前补进设计**:
  - **F1 多进程(非多线程)+ 零锁** → 双模 Publisher + per-root advisory lock。
  - **F2 content-address 的 sha 必须是输出哈希** → 写死语义 + 加测试,否则不可变性反成 bug。
  - **F3 compilerVersion bump 删 user 自定义产物且不自动重编** → boot 对账 sweep 自愈(这极可能是用户报告「表单忽隐忽现」的升级类根因之一)。
- **CLI 不需要推倒重写**,需要的是把它和 runtime 共用的「逐文件非原子提交 / 覆盖式 sync rollback」内核换成 Publisher 的「批量 staging→原子发布 + copy-if-absent」,顺带退役一整套 rollback 机器(§3),并把 user 重编移出 preflight 阻塞段。
- **修订后分期**:Phase 0(读路径硬切 + 前端状态,不变,仍最快见效)→ Phase 1 增加「双模 Publisher + 跨进程锁 + sha 语义锁定」→ Phase 2 增加「boot 对账 sweep + 自动编译」→ Phase 3 GC 补「非单写者残留回收」+ 可选 releases/。
