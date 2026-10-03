# Round 03 — 架构方案枚举与横向对比

> 基于 round-01/02 的事实，沿 4 条正交轴枚举子选项，组合成 5 个整体方案，给出对比矩阵。最终推荐在 round-04 展开。
>
> **术语提示（事后并入 round-05）**：本文是历史方案枚举，**最终架构与术语以 round-04 终稿为准**。文中「主进程」一律指 **server 进程**；round-05 已把「主进程唯一 Publisher」修正为**双模 Publisher**（server 进程内翻 Registry / CLI·preflight disk-only），且**内存权威 Registry 仅限 server 进程**。

## 0. 设计目标回顾（成功判据）

1. **消灭半提交窗口**：任何编译过程中，runtime 读到的 profile 视图要么是完整旧版、要么是完整新版，绝不出现「文件新 / 账本旧」。
2. **故障隔离 + 原子发布并存**：一个坏 profile 不阻塞其它，但发布是整批原子。
3. **热路径只读内存**：`snapshot()`/`get()` O(1) 内存读，永不在请求里编译/重 stat。
4. **明确状态模型**：含运行态 `compiling` / `compile_failed`，前端不再把失败渲染成「消失」。
5. **严格无 stale**：源码变更后该 profile 立即不可运行，直到新 build 成功（配合保存即自动编译）。
6. **读路径解耦**：models/web/cost/embedding/模型列表 不再绑死 profile catalog。
7. **不破坏 5 类编译调用方 + assets 同步 + product shim**（round-02 §8）。

---

## 1. 四条正交轴的子选项

### 轴 1 — 发布原子性（如何让 runtime 视图原子翻转）

- **1a 原地覆盖 + manifest 最后写**：保留扁平目录，artifact 原地 copyFile 覆盖，manifest 用 temp+rename 最后写。缺点：覆盖正在被 import 的 `.mjs` 在 Windows 上可能撕裂/占用；只把窗口缩小，没消灭。
- **1b 内容寻址 artifact + 原子指针**（关键原语）：artifact 落 `artifacts/<sha>.mjs`，同一 sha 只写一次（`<sha>.tmp` → rename 到不存在的目标，原子），新版本 = 新 sha = 新文件，**永不覆盖**。一个指针文件（manifest 或 current.json）映射 profile→sha；发布 = 确保所有 sha 文件就绪 → 原子替换指针。读者经指针→sha→文件，**永远读到完整文件**。
- **1c 整目录 swap**：构建到 `.compiled.next/`，再 rename 目录互换。同盘原子，但 Windows 上对持有打开句柄（被 import 的 .mjs）的目录 rename 易 EBUSY；1b 用「不存在目标 rename」绕开此坑。

> 结论：**1b 是最稳的原语**，且天然规避 Windows 目录/覆盖 rename 问题。

### 轴 2 — 变更检测/失效（catalog 如何不抖动地得知视图变了）

- **2a 全目录监听 + 任意事件 invalidate**（现状）：抖。
- **2b 只监听指针文件 + 源码文件，忽略 `artifacts/**`**：指针原子 rename = 恰好一个干净事件 = 一次重载；源码变 = enqueue 编译（严格模式下立即标该 profile stale）。
- **2c `.compiled` 完全不监听**：由进程内 Publisher 直接更新内存指针；watcher 只监听**外部源码编辑**作为 fallback（debounce + 谨慎 re-resolve）。
- **2d 内存 epoch 计数**：只由 Publisher bump，cache 按 epoch 键。（与上面任一组合）

### 轴 3 — 编译编排

- **3a 现状**：端点触发、worker 内逐文件循环、无 debounce、无 build-state。
- **3b Coordinator + Worker(staging) + Publisher + BuildState**：
  - Coordinator：按 root 串行排队、合并快速连续变化、**发布前重校验输入 generation**（源码已再变则丢弃本次 build 标 stale 并 re-enqueue）、保存/外部编辑/helper 变更自动 enqueue。
  - Worker：每个 profile 独立编译到**内容寻址 staging**（故障隔离，坏的标 compile_failed）。
  - Publisher：写齐 artifact + release/指针，**最后一步原子替换指针**。
  - BuildState：内存记录 running/pending/lastResult，供 UI 显示「编译中/失败/已加载」。
- **3c 主线程同步编译（无 worker）**：见方案 D。

### 轴 4 — 读路径解耦

- **4a 现状**：editor-snapshot 大包 + 无条件 `profiles.snapshot()`。
- **4b 硬切**：editor-snapshot 移除 profile settings 构造；新增 `/api/agent/profiles/settings` 轻接口（只在真要 settings 时读 catalog）；models/web/cost/embedding 不读 catalog；AgentChatSurface 模型列表 → `bootstrap()`；新增 `/api/agent/profiles/build-status`（compiling/failed）；`snapshot()` 变 O(1) 内存读。

---

## 2. 五个整体方案

### 方案 A — Stop-the-bleed（保留扁平格式，最小改动）

**组合**：1a + 2b + 3a(改良：compile-all 改一次全量 commit + prune 延后 GC) + 4b。

- compile-all 不再逐文件，改调一次全量 `compileProfileArtifacts()`（复用现有 CLI 全量路径），但先把所有文件编到 staging、再一次性 commit；manifest 用 temp+rename 最后写作为提交点；prune 改为发布后延后 GC，不在事务内删。
- watcher 忽略 `.compiled/**`，只靠显式 invalidate + 源码监听。
- 前端加状态块、editor-snapshot 轻拆。

**消灭窗口程度**：部分。manifest 成为提交点能挡住「账本旧」窗口；但 artifact 仍原地覆盖，正被 import 的 `.mjs` 覆盖在 Windows 上仍有撕裂/占用风险（轴 1a 固有）。
**成本**：最低（不破格式、不动 product 打包、不动 assets 同步结构）。
**给不到**：不可变历史、release 账本、强故障隔离的原子批（全量 commit 仍是「全成功才发布」或需额外 staging 编排）。
**定位**：可作为**过渡止血**，但不是终态。

### 方案 E — 内容寻址 + 原子 manifest 指针（B-lite，推荐核心）

**组合**：1b + 2b + 3b + 4b。

- 布局：`.compiled/artifacts/<sha>.mjs`（+ `<sha>.types.d.ts` 旁路）、`.compiled/manifest.json`（唯一指针：profile→{sha, status, sourceHash, deps...}）。
- 发布：Worker 把每个 profile 编到 `artifacts/<sha>.tmp`→rename；Publisher 写齐后**原子替换 manifest.json**（temp+rename）。失败 profile 在 manifest 里记 `compile_failed`，成功的照常 load。
- catalog 读 manifest → 按 sha import；watcher 只看 manifest + 源码。
- 未引用 sha 由 GC 延后清理。

**消灭窗口程度**：完全。内容寻址 = 读者永不见半写文件；原子 manifest rename = 永不见「账本旧」。
**成本**：中。破 `.compiled` 格式（用户已接受）；改 5 类编译调用方读写入口；assets 同步改为「rehome 后经 Publisher 发布」；product 打包改为预生成 artifacts+manifest。
**给不到（相对 B）**：多版本历史 / 一键回滚 / 显式 releaseId 账本（manifest 即「当前」，无历史）。
**定位**：**80% 的 B 收益、40% 的 B 成本**，是推荐的核心。

### 方案 B — 完整 release 账本（用户最初锁定的形态）

**组合**：1b + (2b 或 2c) + 3b + 4b + `releases/<id>.json` 不可变 release manifest + `current.json` 独立指针。

- 发布：写 artifacts → 写 `releases/<id>.json`（含整批 profile 状态、依赖图）→ **原子替换 `current.json`**。
- catalog 只读 current release；回滚 = current 重指旧 release；GC 按 release 清理。

**消灭窗口程度**：完全（同 E）。
**额外收益（相对 E）**：release 历史、回滚、审计、按 release 的依赖图精确定位受影响 profile、发布与 artifact 解耦（多 profile 共享 artifact 更自然）。
**成本**：最高。多一层 releases/ + current.json 概念与 GC；assets 同步、product 打包、测试面更大。
**定位**：终态目标，但**历史/回滚账本可作为 E 之上的增量**，按需再加。

### 方案 C — 进程内权威指针（叠加在 E 或 B 之上的增强）

**组合**：在 E/B 基础上 + 2c。server 进程内存持有「已解析 current release」；Publisher（在 server 进程，吃 worker 回传的 {profileKey→sha, manifest}）**事务性更新内存指针 + 写盘 current/manifest 作持久化**；watcher 仅监听**外部源码编辑**作 fallback（debounce 谨慎 re-resolve）。

- worker 只负责「编译到内容寻址 staging + 回传 sha 映射」，**不直接当 runtime 真相源**；server 进程是唯一发布者。
- 热路径 = 纯内存读，磁盘竞态归零；外部编辑才走 watcher 慢路径。

**消灭窗口程度**：完全 + 消灭跨线程「写盘/观盘」竞态（round-02 §2 的双重作废风暴根除）。
**成本**：E/B 之上多一条 worker→main 结果通道 + server 进程发布逻辑。
**定位**：把「current pointer」从「磁盘状态」升级为「内存权威 + 磁盘持久化」，最贴合「热路径只读内存」目标。**推荐与 E 组合**。

### 方案 D — 无 worker、主线程同步编译（否决，记录理由）

**组合**：3c。去掉 worker_thread，server 主线程内同步 esbuild + import + 发布。

- 优点：拓扑最简，无跨线程竞态，无 worker 版本管理。
- **否决理由**：esbuild bundle + 动态 import 大模块在 server 主线程会**阻塞 Nitro 事件循环**，product runtime 用同一进程服务 UI，编译期会 jank；现有 worker 跑 tsx loader 也是为 loader 隔离。除非把编译真正移出主线程——那就是 worker 本身。
- **解锁条件**：若未来用子进程 + 完全异步编译且实测主线程无 jank，可重议。

---

## 3. 横向对比矩阵

评分：✅ 强 / 🟡 中 / ❌ 弱。

| 维度 | A 止血 | E 内容寻址+原子manifest | B 完整release账本 | C 内存权威(叠加E) | D 主线程同步 |
| --- | --- | --- | --- | --- | --- |
| 消灭半提交窗口 | 🟡 部分(artifact仍覆盖) | ✅ 完全 | ✅ 完全 | ✅ 完全+消竞态 | ✅(但有jank) |
| 跨线程双重作废根除 | ❌ 仍靠盘 | 🟡 一次干净事件 | 🟡 一次干净事件 | ✅ 内存发布 | ✅ 无线程 |
| 热路径只读内存 | 🟡 | ✅ | ✅ | ✅✅ | ✅ |
| 故障隔离+原子批 | ❌ 二选一 | ✅ | ✅ | ✅ | ✅ |
| 状态模型(compiling/failed) | 🟡 需另建 | ✅ | ✅ | ✅ | ✅ |
| 严格无stale | 🟡 | ✅ | ✅ | ✅ | ✅ |
| 多版本历史/回滚 | ❌ | ❌ | ✅ | 继承E/B | ❌ |
| 改动范围/成本 | ✅ 最小 | 🟡 中 | ❌ 最大 | 🟡 中+ | ✅ 小 |
| 破坏现有格式 | ✅ 不破 | ❌ 破(已接受) | ❌ 破(已接受) | ❌ 破 | ✅ 不破 |
| product/assets同步影响 | ✅ 小 | 🟡 中 | ❌ 大 | 🟡 中 | ✅ 小 |
| 主线程响应性风险 | ✅ | ✅ | ✅ | ✅ | ❌ jank |
| 可测试性(原子边界清晰) | 🟡 | ✅ | ✅ | ✅ | 🟡 |

---

## 4. 初步取舍方向（详见 round-04）

- **推荐核心 = E + C 叠加 + 轴2b/2c + 轴3b + 轴4b**：内容寻址不可变 artifact + server 进程内存权威指针（双模 Publisher） + 原子 manifest/current 持久化 + Coordinator/Worker(staging)/Publisher/BuildState + 读路径硬切。
- **release 历史账本（B 的 releases/ + current 分离）作为增量**：先上 E-core（manifest 即当前），当真正需要回滚/审计时再加 `releases/<id>.json` 历史层——避免一上来就背 B 的全部成本。
- **方案 A 仅在「想先快速止血再做大改」时作为过渡**；若直接做 E+C，可跳过 A。
- 用户最初锁定的 ProfileBuildCoordinator/Worker/Publisher/BuildState 四件套**全部保留**，它们属于轴 3b，与 E/B 正交，无论选 E 还是 B 都需要。

> round-04 将把推荐架构展开为：组件边界与职责、磁盘布局、发布时序、catalog 状态机、watcher 策略、API 拆分清单、迁移路径、测试计划、风险与回滚。
