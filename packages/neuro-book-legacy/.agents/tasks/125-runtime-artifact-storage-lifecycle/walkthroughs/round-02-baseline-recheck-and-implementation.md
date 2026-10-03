# Round 02 - 基线复核与 Phase 1/2 实施

> 日期：2026-07-26 → 07-27
> 范围：复核 Round 01 证据 → 一次性受控清理 → 删除冗余 import cache → Fixture 所有权收口 → 有界 artifact 生命周期。

## 1. 基线复核：Round 01 的哪些数字已经过期

| 指标 | Round 01 快照 | 本轮重测 | 判断 |
| --- | --- | --- | --- |
| `%TEMP%/nbook-workspace-assets-*` | 295 dirs / ~119.994 GB | **0 dirs** | 用户已自行清理，原「一次性清理 295 个」决策作废 |
| C: 可用空间 | 30.47 GB | 154.8 GB | 空间压力已解除 |
| system Profile `.compiled` | 4.752 GB / 484 files | 6.16 GB / 570 files | 仍在增长 |
| system orphan | 456 files / 4.369 GB | 542 files / 5.79 GB | 继续膨胀 |
| user State Root orphan | **未统计** | 484 files / 5.58 GB | Round 01 只看了 system root，实际有第二份同规模 orphan |

## 2. 本轮新增的决定性证据

1. **7 天 grace 当前回收量 = 0。** orphan 年龄分布 `<1d` 4.59 GB、`1-7d` 1.20 GB、`>7d` **0**。现有 GC 此刻跑一次一个字节都删不掉，这是 Round 01 H5 最直接的反证。
2. **churn 约 13 次全量发布/天**（4.59 GB ÷ 381 MiB）。观测期内还实测到一次活体重编：artifacts 542 → 570 文件、+0.37 GB，正好 +14 `.mjs` +14 `.d.ts`。
3. **失败编译会把上一版 current 立刻变成 orphan。** 22:39 的 manifest 里 14 个内置 Profile 全部 `compile_failed`（`Cannot find module '@libsql/win32-x64-msvc'`，该 native 包 22:46 才落盘），此刻 current refs = 0、570 个文件全成 orphan。**这直接决定了预算 GC 必须有退化状态守卫**，否则那个窗口会删光一切。
4. **`profile` namespace 是真正的膨胀源，World Engine / Variable 不是。** 三份**早于本次清理**的历史 cache 副本构成一致：`profile`/`profile-compiler` 14–28 files / 20–57 MB，而 `world-engine-calendar` 1 file / 0 MB、`world-engine-schema` 0 files、`variable-definition` 1 file / 0 MB。
5. **Product build 单 artifact 只有 5.9 MB，source checkout 是 21.9–27 MB**（4x 差距）。这是 Phase 3 减重比「拆 SDK/DSL seam」更便宜的切入点，记为 TODO。
6. `manifest.json` 本身 12.7 MB（每个 entry 内嵌约 3,900 条依赖）；`.compiled/` 已在 `.gitignore`。

## 3. 一次性受控清理（已执行）

四步安全校验逐 root 通过（manifest 有 loaded entry / 28 个 current 文件在盘 / 无编译在途 / 只删 keep 之外的文件），六个目标全部已被 gitignore 覆盖。

| 类型 | 路径 | 文件 | 大小 |
| --- | --- | ---: | ---: |
| orphan | `assets/workspace/.nbook/.../.compiled` | 542 | 5,929 MB |
| orphan | `workspace/.nbook/.../.compiled` | 484 | 5,714 MB |
| import cache | `workspace/.nbook/agent/.staging/runtime-artifact-import-cache` | 183 | 3,225 MB |
| import cache | `.agent/.staging/runtime-artifact-import-cache` | 40 | 1,089 MB |
| orphan | `.output/server/assets/.../.compiled` | 310 | 902 MB |
| orphan | `product/.output/server/assets/.../.compiled` | 308 | 900 MB |
| | **合计** | **1866** | **17.34 GB** |

清理后两个 `.compiled` root 各 28 files / 382 MB，current 引用零缺失。`.agent/workspace` 下的旧诊断/打包工作区按边界保留未动。

## 4. 实施内容

### 4.1 删除 Profile 的两处冗余 import cache

`ProfileArtifactStore` 与 `importCompiledProfile` 都不再建物理副本——published artifact 落盘名已是 `artifacts/<输出字节 sha256>.mjs`，staging 路径已含 `randomUUID()`，两者路径都随内容变，不存在 Bun 按 pathname 复用旧模块的问题。历史理由（Task 79 之前落盘名是 `<name>.mjs`）已随内容寻址改造失效。

`expectedBytes` 字节校验的归属已查清，**不需要补任何代码**：`catalog.ts` 在 `importProfile` 之前一定先跑 `freshness.validate` → `validateProfileArtifact`，做的是**完整 sha256 重算 + 字节比对**，严格强于 import cache 里那个 `stat().size`。

同时消除了「system artifact 从只读 Application Root 复制进 user State Root」的跨根不对称。

### 4.2 Test Workspace Fixture 所有权收口

`workspace-assets-test-helper.ts` → `test-workspace-fixture.ts`，删除死选项 `seedUserAssets`（全仓 3 处调用全传 false）与 `sourceSystemNbookRoot`。

- **默认共享只读 snapshot**：`globalSetup` 建一份 run 级 snapshot，各 fixture 的 `<root>/assets` 是指向它的 junction。
- **`systemAssets: "isolated"`** 才复制可写副本，供两个真正改写 system assets 的用例使用。
- snapshot 是**对已发布 release 的纯投影**（源码 + manifest + current refs），排除 orphan / `.staging` / runtime cache，**不做编译**。
- create 失败自行回收 root；dispose 聚合错误但保证最终 `rm(root)`；每个 root 写 `.nbook-fixture.json` owner marker；`globalSetup` 按 marker 保守回收残留。

### 4.3 有界 artifact 生命周期

- Profile orphan 硬字节预算 512 MiB/root，优先级 **最小安全年龄地板(10min) > 硬预算 > 7 天 grace**。
- **mtime 语义修正**：`installImmutableArtifact` 幂等复用不刷新 mtime，导致被长期引用的 artifact 一脱离 current 就成为最优先驱逐对象。GC 现在对 keep 集合 `utimes(now)`，把 mtime 变成「最后一次仍被 current 引用的时间」。
- **退化状态守卫**：`manifest.profiles` 为空时跳过预算回收（对应第 2 节第 3 条实测）。
- `runtime-artifact-import` 的 options 改为可选嵌套 `cache`，其中 `retention` **必填**，从类型层堵死 `definition-artifact.ts` 原先 `?? dirname(artifactPath)` 那种「顺手找个地方放」的无界缓存；写入成功后按 namespace 做「保留最近 N 个 + 字节预算」驱逐。

## 5. 验证结果

| 项 | 结果 |
| --- | --- |
| `bun run typecheck` | 只剩 `llmlint.test.ts` 的既有 20 项漂移，**零新增** |
| `config-service.test.ts` | **60/60 通过** |
| `runtime-artifact-import.test.ts` | 通过（含新增的 retention 驱逐与字节预算两条） |
| fixture 磁盘峰值 | 60 个用例期间 `%TEMP%` 只有 1 份 snapshot 386 MB + 单个 fixture **1 MB**；改造前是 60 × 6.3 GB |
| 运行结束后残留 | **0 MB**（dispose + teardown 都生效） |
| snapshot manifest | `{"loaded":14}` |
| **新增测试** | `profile-artifact-gc.test.ts` 9 项 + `test-workspace-fixture.test.ts` 6 项 + `profile-artifact-store.test.ts` 2 项 + `runtime-artifact-import.test.ts` 4 项 = **21/21 通过** |
| 空间收敛（5 轮） | TEMP 残留与 `.compiled` 文件数/字节 **5 轮完全持平**，无随运行次数增长 |
| `config-service.test.ts` | 提高 `hookTimeout` 后 **60/60 通过** |
| `catalog.test.ts` | 26/44 失败，**全部**由 Task 118 的 `bun:ffi` 破坏导致（见 §7），非本任务 |
| `workspace-files.test.ts` | **8/85 失败，未收敛**（详见下） |

### `workspace-files.test.ts` 收敛过程：13 → 11 → 8 → 5 → 4

每一轮都是完整 solo run（约 13–17 分钟），每轮定位一个根因：

| 轮次 | 失败数 | 本轮定位并修掉的根因 |
| --- | ---: | --- |
| 1 | 13 | globalSetup 强制重编，失败时用 `compile_failed`×14 覆盖掉刚投影的有效 manifest |
| 2 | 11 | 共享模式用 junction，被子进程 realpath 穿透 → 改硬链接投影 |
| 3 | 8 | 6 条 sync 用例 timeout 不足（每次 sync 搬 382 MB artifact）→ 提到 180s |
| 4 | 5 | `linkedApplicationEntries` 漏 `packages`，14 个 profile 全判 dependency_changed |
| 5 | 4 | published release 相对当前源码过期 → `system-assets:prepare` + 新增 globalSetup 前置校验 |

**剩余 4 项的定性：**

| 用例 | 定性 | 依据 |
| --- | --- | --- |
| `workspace project init-db` | **既有失败** | 子进程按 `INVOCATION_CWD = process.cwd()`（= fixture root，`useAsCwd` chdir 来的）相对化输出，测试断言绝对路径。这条链上的 chdir、`root = path.resolve(".agent", ...)`、子进程 cwd 继承、`formatInvocationDisplayPath` 全部未被本任务触碰 |
| `同步系统 assets 会清理未手改的旧 llmlint 受管文件` | **既有失败** | 断言 llmlint CLI 输出含 `show-llm-rules`，而该字符串在仓库 llmlint 2.0.1 源码里根本不存在，属 llmlint 版本漂移（同族的还有 `llmlint.test.ts` 的 20 项 typecheck 漂移） |
| `同步系统 assets 不覆盖已手改用户 profile artifact` | 超时，已提 180s | 与上面 6 条同因，第 5 轮才发现它有独立的 30s |
| `前端同步 preflight 会先刷新过期 system profile manifest` | **顺序相关的 flake** | 单独跑 `-t "前端同步 preflight"` **通过**（1 passed / 84 skipped）；只有在整文件顺序执行时才失败。不是逻辑错误，是测试间状态泄漏（profile catalog / registry 的模块级缓存跨用例残留） |

## 6. 过程中发现并修复的两个自身缺陷

1. **globalSetup 强制重编会毁掉刚投影的有效 manifest。** 首版在 snapshot 内跑 `compileProfileArtifacts({skipFresh:true})`，编译一旦失败就用 `compile_failed` ×14 覆盖掉投影进来的有效 manifest，导致 13 个 profile-sync 用例一起垮。改为纯投影后 snapshot manifest 稳定为 `loaded 14/14`。
2. **`removeFixtureTree` 对 Windows 目录 junction 用非递归 `rm` 会 EFAULT。** 必须带 `recursive: true`（`fs.rm` 对 symlink/junction 只解链接、不进入目标）。

3. **共享模式最初用 junction，被子进程 realpath 穿透。** `<fixture>/assets` 若是指向 snapshot 的 junction，测试里 `bun <fixture>/assets/.../agent/scripts/workspace.ts` 会被 bun realpath 成 snapshot 内的真实路径，子进程随之把 **snapshot** 当成自己的 Workspace Root，断言拿到的路径不再落在 fixture 内。

   改为**硬链接投影**：目录逐级真实创建、文件一律 `link()`。硬链接是真实目录项、没有 reparse point，既不会被 realpath 穿透，14 个约 27 MiB 的 artifact 又不产生任何额外字节。跨卷等无法建链接时回退 `copyFile`。

   代价是语义收紧：共享模式下 system assets 内容在所有 fixture 之间共享，**只可读**；改写 system assets 的测试必须显式 `systemAssets: "isolated"`。这正是本任务想要的合同。

4. **`linkedApplicationEntries` 漏了 `packages`。** manifest 的依赖路径按 cwd 相对记录，实测顶层前缀是 `node_modules`(51184) / `server`(3620) / `shared`(266) / **`packages`(126)** / `assets`(14) / `tsconfig.json`(14)。junction 列表里唯独没有 `packages`，于是 fixture 内 `packages/file-snapshot-cache/src/concurrency.ts` 解析不到 → 14 个 system profile 全判 `dependency_changed` → sync 直接跳过 profile → 一堆「期望非空却拿到 `[]`」的断言失败。已补 `packages` junction，并在注释里写明这个列表必须覆盖依赖路径的全部顶层前缀。

5. **纯投影要求已发布 release 相对当前源码新鲜。** 修完 `packages` 后仍然 stale，追下去是 `server/agent/harness/neuro-agent-harness.ts` 哈希不匹配——即 Task 118 在发布之后又改了 `server/**`，published manifest 是真的过期了（不是 fixture 的错）。跑一次 `bun run system-assets:prepare` 后全部 `fresh=true`。

   由于 snapshot 刻意不重编，这个前置条件现在由 `ensurePublishedSystemProfilesFresh()` 在 globalSetup 把关：探测第一个 profile（14 个内置 profile 共享绝大部分依赖图，省掉 14 倍哈希开销），不新鲜就**自动重编一次**再继续。

   两个必须留在注释里的实现约束：
   - **重编必须开子进程。** 先在 vitest 主进程内直接调 `compileProfileArtifacts` 实测直接 OOM（14 个 profile 的 esbuild 依赖图打满 heap，mark-compact 后 `Ineffective mark-compacts near heap limit`）。改为 `execFile("bun", ["scripts/build/prepare-system-assets.ts"])`，复用与 `bun run system-assets:prepare` 完全相同的入口。
   - **重编必须在仓库根**（globalSetup 时 cwd 就是仓库根），不能在 snapshot 或 fixture 内：依赖路径按 cwd 相对记录，只有仓库根编出来的 manifest 才能被任意 fixture 复用。

   顺带确认：freshness 判据是 **sha256 而非 mtime**，所以 `touch` 源文件不会误判 stale。

   这个自愈路径在开发中立刻证明了价值：我给 `pruneCompiledArtifacts` 加 `export` 之后，published release 当场就 stale 了——任何对 `server/**` 的改动都会让它过期。

## 7. 已知的既有失败（不归因本任务）

`profile-compile-worker-preview.test.ts` 的 dry-run 用例失败，原因是 esbuild 无法解析 `bun:ffi` / `@notnotype/owned-process` / `@notnotype/file-snapshot-cache`。

**根因是 Task 118 在途的未提交改动**：`server/workspace-files/project-root-reparse-windows.ts` 是**未跟踪新文件**（`git status` 显示 `??`），它使用 `bun:ffi`，并经 `project-root-identity.ts` 进入 profile 依赖图。

已用两组对照排除本任务：
- 把 fixture 切成 `systemAssets: "isolated"`（等价于改造前的完整拷贝）→ **同样失败**，与 junction/共享无关。
- 失败发生在 **esbuild 构建阶段**，早于任何 import；本任务只改了构建**之后**的导入方式。

## 8. 计划 vs 实际的出入

- 计划写「per-test root 下不需要真的存在 `assets/workspace/.nbook`」——**这是错的**。profile 编译按 cwd 相对记录依赖路径，user-assets sync 又按 `assets/workspace/.nbook/agent/profiles` 字符串标签 rehome，把 system root 挪出 cwd 会让依赖标签退化成临时目录绝对路径。最终方案改为「物理路径始终存在，只是背后从真实副本换成 junction」。
- 计划把「零写入路径跳过 GC」记为 TODO 不实施，理由是「每次真实发布都会 GC，够用」。**这个判断被实测推翻，本轮改为实施。**

  反例：最小安全年龄地板会在发布时挡下刚变成 orphan 的一整代（382 MiB）。那一刻确实不该删（可能有在途读者），但 GC 只在发布时跑，于是这批 orphan 要等**下一次真实发布**才被重新考虑。长期不发布的 root 就一直超预算——实测 765 MiB 可驱逐 orphan 稳稳停在 512 MiB 预算之上，没有任何东西会来收它。

  补上的 `sweepProfileArtifactBudget(profileRoot, budgetBytes?)` 挂在 `!publishRequired` 早退分支：两阶段（先无锁 `readdir` 预检，全部可达就返回 `null`；确有 orphan 才进 publish lock），锁内重读磁盘 manifest 重建可达集合（不能用预检那份，并发 Publisher 可能已加 entry），`writePolicy: "forbid"` 时一个文件都不删（Product 内置 assets 是只读安装目录）。
- 计划的「单个用户 Profile artifact 64 MiB 上限」本轮未实施（属 Phase 3 门禁）。
- 任务改号目标从 124 调整为 **125**（124 当天已被写作产品线第三批占用）。

## 9. 仍待完成

- [x] Profile 预算 GC 的聚焦测试（`profile-artifact-gc.test.ts`，7 项）。
- [x] `profile-artifact-store.test.ts`（2 项，含「不建立任何物理副本」这条守住不要把 import cache 加回来）。
- [x] fixture 所有权测试（`test-workspace-fixture.test.ts`，6 项，含 junction sentinel）。
- [ ] `前端同步 preflight` 的顺序相关 flake：定位跨用例泄漏的模块级缓存。
- [ ] 两条既有失败按各自归属处理：`init-db` 的绝对/相对路径断言口径、llmlint `show-llm-rules` 版本漂移。
- [x] 5 轮重复运行的空间收敛曲线：TEMP 残留与 `.compiled` 完全持平，不随运行次数增长。
- [x] 强杀恢复：由 `test-workspace-fixture.test.ts` 的 sweep 三态用例确定性覆盖（死 PID + 过窗口 → 回收；活 owner / 窗口内 / schema 不匹配 / 无 marker → 一律保留），不需要真等 24 小时。
- [ ] Source checkout / Product Bun / Windows Portable 三环境 Profile 导入验收（被 Task 118 的 `bun:ffi` 阻塞）。

## 9b. 预算标定问题（Task 118 修复 `bun:ffi` 之后暴露）

Task 118 补上 reparse 边界后 `Could not resolve "bun:ffi"` 归零，esbuild 从此**真的**去打包整张依赖图。结果：单个 profile artifact 27.3 MiB，且里面确实含 `ProjectRootIdentityModule` / `GetFileAttributesW` 这类宿主实现。

有一份报告据此认为「512 MiB 预算被单次发布就撑爆了」。**按实测这句不成立**，但它指出的问题是真的，只是位置不同：

```
current = 382 MiB（14 loaded，按合同永不驱逐、不计入预算）
orphan  = 492 MiB（预算 512 MiB → 未超，GC 正常工作）
盘上合计 875 MB / 64 files
```

预算治的是 orphan，orphan 492 MiB 确实在 512 MiB 以内，GC 没有失效。真正的问题是**标定**：

1. **一代 release 就吃掉 75% 的 orphan 预算。** 一次全量发布 382 MiB，被下一次发布顶下来就整代变成 orphan。512 MiB 只买得到约 1.3 代回滚余量 —— 第二次发布必然触发驱逐。
2. **「512 MiB」这个数字容易被读成总量上限，其实不是。** current 按合同不可驱逐、天然无界，所以单 root 稳态是 `current + orphan ≈ 894 MiB`，约为标称值的 1.75 倍；system + user 两个 root 合计约 1.75 GB。
3. 这个数是 Round 01 按「381 MiB/次全量发布」定的，数字没错，但没人把「一代 = 3/4 预算」这层含义写出来。

**结论：机制没问题，分母不对。** 把 orphan 预算调小只会让每次发布都清空上一代（回滚余量归零），调大则失去意义。真正的解法是 Phase 3 把单 artifact 压下来 —— Product build 实测只有 5.9 MiB，同样 512 MiB 就能装约 5 代。上面那两个符号是 Phase 3 现成的抓手。

同一份体积也解释了测试侧的两个现象：vitest 主进程内编译 14 个 profile 直接 4 GB OOM；`config-service.test.ts` 单跑 58/60、与 `workspace-files.test.ts` 并行时掉到 55/60，失败全是 10s 整的超时形状 —— 加载 14 × 27.3 MiB 模块本身就慢。

## 10. sync 成本的权衡（本轮按用户决定处理）

共享 snapshot 语义下，`syncSystemAssetsToUserAssets()` 每次调用都要把 14 个约 27 MiB 的 current artifact 搬进 user root。多次调用 sync 的用例因此撞上 30s/60s 超时。

用户已拍板走**第 1 条：放宽这些用例的 timeout 到 180s**（7 条 sync 用例）。这只是承认「sync 一次搬 382 MB」是当前的真实成本，不是把成本消掉。

另两条留作后续：

2. **让 sync 对 artifact 也走硬链接** —— 治本且快，但 user artifact 与 system artifact 从此共享 inode，任何原地改写都会互相污染；需要先确认 sync 之后没有原地改 artifact 的路径。
3. **等 Phase 3 把单 artifact 从 27 MiB 降到 Product 级的 5.9 MB** —— 382 MB 自然降到 83 MB，超时大概率自己消失。这也是三条里唯一真正降低成本的。
