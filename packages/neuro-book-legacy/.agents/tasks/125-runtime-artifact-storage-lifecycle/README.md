# 125 - 可重建运行产物的存储生命周期

> 状态：Implementing。Round 01 完成诊断与设计；Round 02 实施 Phase 1/2；Round 03 完成 artifact 减重；Round 04 收口 Project Workspace 测试隔离与真实 Workspace Root 残留。
>
> 编号说明：本任务最初建为 `120`，与 [Task 120 Agent Skill Package Contract](../120-agent-skill-package-contract/README.md) 撞号（Task 123 的 R4）。因 `124` 已被写作产品线第三批占用，本任务改号为 `125`。

## 2026-07-28：Image Variant Cache 新 owner

- 新增独立 Image Variant Cache，固定在 `Cache Root/image-variants/`；未配置独立 Cache Root 时才默认落在 `State Root/cache/image-variants/`。它从各领域 canonical 原图重建，不与 Published Profile Artifact、Runtime Import Cache 或 Project Runtime Artifact 共用 Store。
- 硬预算为 512 MiB、10000 项、每 source 32 项；首次使用清 temp/建 inventory，成功写入后仅在超预算时按生成时间淘汰，命中不更新访问时间。
- 缓存初始化、写入、损坏项删除或回收失败会关闭本进程后续持久写入，但当前转换仍可返回内存 bytes。它不进入 Application State migration、备份、File Index、History 或 Project 下载。
- 该 owner 遵循 ADR 0002 的“明确 owner/真相源/硬预算”，领域特有授权与变体参数由 [ADR 0006](../../adr/0006-image-variant-and-original-ownership.md) 冻结。

## Relative documents refs

- [诊断与推荐架构](walkthroughs/round-01-diagnosis-and-recommended-architecture.md)
- [ADR 0002：可重建运行产物必须有界](../../adr/0002-bounded-rebuildable-runtime-artifacts.md)
- [Task 79 Profile Build System](../79-profile-build-system/README.md)
- [Task 75 World Engine artifact cache](../75-world-engine-api-calendar-embedding-cleanup/README.md)
- [Task 105 Product / State Root 合同](../105-unified-installation-manager/README.md)
- [Profile Compiled Artifacts](../../../reference/agent/profile-compiled-artifacts.md)
- [Round 04：Project Workspace 测试隔离与残留收口](walkthroughs/round-04-workspace-test-isolation.md)

## User Request / Topic

用户发现 `.agent` 和系统临时目录被测试快速占满：测试每次新增 `nbook-workspace-assets-*` 目录，Profile `.compiled` 也持续增长。用户要求先清理可直接重建的缓存，再深入分析增长原因，建立系统性的长期方案；不能用定时清空、散落清理脚本或测试专用 hack 掩盖问题。

本任务负责三类问题：

1. Published Profile Artifact 的未引用文件没有硬容量边界。
2. Runtime Import Cache 只有写入能力，没有 retention policy。
3. Test Workspace Fixture 复制了不应复制的系统产物，且异常与进程中断后的所有权不完整。

## 用人话解释

测试本身不是凭空产生了上百 GB 的缓存。真正发生的是：

1. 内置 Profile 每次全量编译会产生约 381 MiB 新 artifact；旧 artifact 先作为孤儿保留。
2. 测试 helper 为很多测试复制完整的系统 `.nbook`，连已经膨胀到数 GB 的 `.compiled` 一起复制。
3. 一个 4.75 GiB 的模板被几十个测试重复复制，磁盘占用就会在一次测试中被放大到上百 GB。
4. 如果复制中途失败、`afterEach` 前面的清理抛错，或者测试进程被强杀，最终 `rm()` 没机会执行，临时目录就永久留下。

所以只在测试结束时多写一个 `rm()` 不够。必须同时解决“源模板为什么无界变大”“测试为什么复制不可达产物”“失败后谁负责找回孤儿”三个问题。

## Goal

让所有可重建运行产物都具有明确 owner、真相源、可达集合、硬容量预算和回收时机；让测试默认不复制完整系统产物，并能在初始化失败、hook 失败和上一次测试进程死亡后收回自己创建的目录。

完成标准：

- 当前发布的 Profile artifact 永远不会被 GC 误删，严格无 stale 合同不变。
- Published Profile Artifacts、Runtime Import Cache、Test Workspace Fixture 分别由明确的深层 Module 管理。
- 不存在只提供 `cacheRoot/cacheKey`、却无法声明 retention policy 的持久缓存入口。
- 关键测试重复运行后的磁盘增量收敛在预算内，而不是随运行次数线性增长。
- 中断测试进程后，下一次运行能保守识别并回收过期 fixture。
- Source checkout、Product Bun、Windows Portable 三种运行形态均能导入当前 Profile / Variable / World Engine artifact。

## Non-goals

- 不建立跨所有领域的“大一统 Artifact Store”。三类资源的真相源和安全删除条件不同，强行共用一个生命周期会让 Interface 比 Implementation 更复杂。
- 不改变 Task 79 的内容寻址 artifact、原子 manifest、Publisher 唯一发布 seam 和严格无 stale 合同。
- 不靠应用启动时无条件清空全部缓存。
- 不把测试临时目录改到 `.agent/workspace` 后就视为解决；换位置不会消除无界复制和所有权丢失。
- 不优先引入共享 chunk 或把所有依赖 external。两者都可能掩盖 Profile SDK 的宿主依赖渗入，而且 Product State Root 无法自然解析根 `node_modules`。
- 不为历史缓存格式增加 legacy 兼容层；项目处于快速开发阶段，可直接切换新合同。

## Current State

### 磁盘基线（2026-07-26）

- 清理前 `.agent` 约 39.10 GB；删除 6 处可直接重建缓存后约 11.353 GB，释放约 27.76 GB。
- `%TEMP%/nbook-workspace-assets-*` 共 295 个，逻辑大小约 119.994 GB；检查时没有 Vitest 进程，均为残留候选。
- 系统 Profile `.compiled` 约 4.752 GB。
- current manifest 只引用 14 个 `.mjs` 和 14 个类型文件，约 0.372 GB。
- 未被 current manifest 引用的 456 个文件约 4.369 GB。

这些数字是本机当时的诊断快照，不是长期预算或产品指标。实施前必须重新采样，删除仍需单独确认目标与活跃 owner。

### 已复现的增长机制

- 同一个 `cacheKey` 重复调用 `importRuntimeArtifact()` 会复用一个文件；不同 key 会线性新增文件。当前 Module 没有 TTL、文件数、字节数或可达性回收。
- 455 字节的最小 Profile 可生成 6,971,024 字节 artifact，约放大 15,321 倍。
- 同一路径重复编译的输出 SHA 稳定；相同源码换临时根后 SHA 改变，已观察到的差异来自 esbuild 输出中的源码路径注释。
- 当前内置 Profile artifact 约 27.2 MiB；任意两个内置 artifact 约 99.898% 内容相同。一次 14 Profile 全量编译约新增 381 MiB。
- Profile artifact 的 esbuild metafile 可包含约 3,942 个 inputs，包含 Prisma WASM、jsdom、Google SDK、Provider SDK 与 Harness 等宿主实现。
- `defineAgentProfile` 和 `profile-dsl` 的最小导入分别约带入 6.58 MiB / 2,478 inputs 与 6.52 MiB / 2,470 inputs；`profile-tools` 约 11 KiB，不是主要来源。

### 直接代码原因

- `ProfileReleasePublisher` 已正确保护 current manifest，但 GC 只按“未引用且超过 7 天”删除，没有字节或文件数上限。
- `ProfileArtifactStore` 把已经带 artifact SHA 的 published artifact 再复制到 `profile` runtime import cache，形成重复物理副本。
- `importRuntimeArtifact()` 的 Interface 允许调用方声明 `cacheRoot/cacheKey`，但不要求 retention policy，因此新增持久 cache 时类型系统无法阻止无界增长。
- `createIsolatedWorkspaceAssets()` 每次 `cp()` 完整系统 `.nbook`；系统 `.compiled` 中的孤儿、staging 和 runtime cache 都被当成测试模板。
- helper 在初始化完成前抛错时还没有返回 `dispose()`，调用方无法清理已创建 root。
- 多处测试 cleanup 顺序执行；前一项失败会使最终 `rm(root)` 短路。
- 进程被强杀时，当前运行没有机会执行 `finally`，下一运行也没有 lease/marker 可判断哪些目录可回收。

## 推荐架构

### 1. Published Profile Artifacts

继续使用 Task 79 的 `.compiled/artifacts/<sha>.mjs` 和原子 `manifest.json`。在现有 Profile 发布 Module 内深化生命周期，不再让调用方各自清理：

- current manifest 是可达集合的唯一真相源；当前引用永不删除。
- publish lock 内完成 manifest 发布与 GC 决策，避免发布和回收竞态。
- 未引用 artifact 使用短 grace 保护并受硬字节预算约束；容量超过预算时，从最旧孤儿开始回收，硬预算优先于 grace。
- GC 同时报告 current bytes、orphan bytes、deleted bytes、protected bytes 和最大 artifact，便于诊断。
- Profile runtime 直接 native import 已含 SHA 的 published artifact 路径，移除重复的 `profile` import cache。

这不是推翻 Profile Build System，而是给它补齐发布之后的存储责任。

### 2. Runtime Import Cache

World Engine 与 Variable 的物理 hash 副本没有发布 manifest，属于可删执行缓存。建立一个小而深的 Runtime Import Cache Module：

- Interface 接受 source artifact、namespace、content key 和 retention policy，不再暴露任意 `cacheRoot/cacheKey` 组合给业务调用方。
- 写入成功后或进程启动时，在 namespace 内执行有界回收。
- World Engine 按 Project + calendar/schema namespace 保留当前和有限历史 hash，保证热加载与失败回退所需的最小窗口。
- Variable 保留有限最近条目；命中、写入与回收在同一 Module 内完成。
- cache 文件不是发布真相源，删除后只影响下一次导入成本，不影响源码或 current release。

Published Profile Artifacts 与 Runtime Import Cache 只共享统计与预算类型，不共享 owner 或 GC 实现。

### 3. Test Workspace Fixture

把当前 helper 深化为 Test Workspace Fixture Module，其 Interface 只暴露创建、测试所需路径/context 和异常安全销毁：

- 默认共享只读 system assets snapshot，只隔离 Workspace Root 与 user assets。
- 只有会修改 system assets 的测试显式请求 isolated system copy。
- isolated copy 只投影系统源码、manifest 和 manifest 当前引用的 artifact；排除 orphan、`.staging` 和 runtime import cache。
- 初始化全过程用 `try/catch/finally` 回滚，`create()` 抛错也不会遗留已创建 root。
- dispose 先恢复 context/cwd，再逐项清理并收集错误；无论前一步是否失败都尝试最终删除 root。
- 每个 temp root 写 owner marker/lease，记录 schema、创建时间、PID、run ID 和用途。
- 测试启动时只回收同一 marker schema 下、超过保守窗口且 owner 不活跃的目录；无法证明安全时保留并报告。
- 增加 fixture 投影字节预算测试，防止以后有人再次把整个 `.compiled` 纳入模板。

### 4. Profile Artifact 减重

容量治理能阻止爆盘，但 27 MiB/Profile 本身仍不合理。长期修复是建立 artifact-safe Profile SDK/DSL seam：

- artifact 只携带 Profile 声明、prepare 和真正需要的纯运行逻辑。
- Harness、Provider、Prisma、jsdom、Project 数据面等宿主实现留在宿主 Module，不得从 Profile SDK 静态进入 bundle。
- 用户显式导入的第三方包仍允许 bundle，避免 Product 运行时依赖根 `node_modules`。
- compiler 产出 esbuild metafile 摘要，并对单 artifact 大小、input 数量和禁止的宿主依赖族做回归门禁。
- 完成 seam 后提升 compiler version，全量重编并验证三种发布环境。

Phase 0 需要把 `defineAgentProfile -> profile-dsl / low-code-form / runtime settings -> 宿主实现` 的具体 value-import 链追到文件级；当前证据已证明渗入存在，但不应在设计阶段猜定最终拆分文件。

## 为什么不选其他方案

- **每次启动全清**：会丢失热加载所需的物理 hash 路径，也掩盖 owner 缺失；多进程时还可能误删正在使用的文件。
- **只保留 7 天 TTL**：写入速度可以在一天内远超磁盘，时间不是容量边界。
- **只修 `afterEach`**：无法处理 helper 初始化失败和进程强杀，也不解决模板被放大的根因。
- **测试统一复制完整系统目录**：隔离最简单，但成本随系统资产体积和测试数相乘，已经被真实磁盘结果否决。
- **共享 chunk 优先**：能减少重复字节，但引入 release graph、chunk 可达性与原子发布复杂度；在宿主依赖不该进入 artifact 的前提下属于先优化错误的内容。
- **`packages: "external"`**：Source checkout 可解析，Product artifact 位于 State Root 时裸包无法自动解析 `.output/server/node_modules`，会破坏已验证的只读 Product Root 合同。
- **一个通用 Artifact Store**：三类资源的真相源、并发保护和安全删除条件不同，会形成浅 Module 和复杂配置矩阵。

## Decisions / Discussion

### 已冻结的架构原则

- Published Profile Artifacts 与 Runtime Import Cache 分开拥有生命周期。
- 每个可重建持久 artifact 必须声明 owner、真相源、可达集合、硬预算和回收时机。
- current release 不可驱逐；只有不再可达的 published artifact 才能按预算回收。
- Test Workspace Fixture 不得复制不可达 artifact。
- 类型层阻止新增没有 retention policy 的持久 runtime cache。

这些原则记录在 ADR 0002，目前 ADR 状态是 Proposed，等待用户确认后进入实现。

### 需要用户拍板的实施参数

| 参数 | 推荐默认值 | 理由 |
| --- | --- | --- |
| 每个 Profile root 的 orphan artifact 预算 | 512 MiB | 能保留约一次完整旧 release，远低于当前 4.37 GB；current 引用不计入可驱逐预算 |
| Runtime Import Cache | 每 namespace 64 entries 且 256 MiB | 同时设条目和字节上限，避免大量小文件或少量大文件绕过单一指标 |
| 单个用户 Profile artifact 上限 | 64 MiB，超限编译失败并输出依赖摘要 | 约为当前内置最大值的两倍，允许真实第三方依赖但阻止异常宿主图进入 |
| stale Test Workspace Fixture 回收窗口 | 24 小时 | 足以覆盖长测试；只有 marker 匹配且 PID/lease 不活跃才回收 |

建议先按这些默认值实现，并把它们定义为集中常量和测试合同，而不是用户设置项。当前没有实际产品需求让普通用户调节缓存预算；过早做 UI/config 会增加不必要复杂度。

### 一次性清理决策

实施前建议单独执行一次受控清理：重新确认没有活跃 Vitest/owner 后，删除 295 个残留 Temp fixture；在 publish lock/manifest 可达性复核后删除 456 个 Profile orphan artifact。此操作可释放大量空间，但属于运维动作，不是长期修复，也不由本 Task 文档自动授权执行。

## Implementation Plan

### Phase 0：基线与安全清理

- 重新采样 current/orphan/cache/fixture 的文件数与逻辑/实际字节。
- 建立小型重复运行测量脚本，记录每轮前后磁盘增量。
- 追踪 Profile SDK 宿主依赖渗入的具体 value-import 链和 metafile top contributors。
- 经用户确认后执行一次性残留清理；记录精确删除范围与释放空间。

退出条件：能够用同一组命令重复得到空间基线，且不把 sparse/logical size 混成实际占用。

### Phase 1：Test Workspace Fixture 所有权

- 实现异常安全的 fixture Module 与 marker/lease。
- 默认切换为共享只读 system assets；迁移少数修改 system assets 的测试到 isolated projection。
- 投影 copy 只包含 manifest current refs。
- 修复 cleanup 短路，增加初始化失败、cleanup 多错误、stale lease 回收测试。
- 为 fixture 模板设置字节预算回归。

退出条件：重复运行 `workspace-files.test.ts` 不再按测试数复制 `.compiled`；强制中断后下一运行能回收确认死亡的 fixture。

### Phase 2：有界 artifact 生命周期

- 在 Profile 发布 Module 内加入 orphan 字节预算 GC。
- 移除 Profile 的重复 runtime import cache，直接导入 published SHA 路径。
- 用 retention policy 重塑 Runtime Import Cache Interface。
- 迁移 World Engine 与 Variable 调用方。
- 增加 current 不可驱逐、容量优先、并发 publish/import、损坏缓存重建测试。

退出条件：连续制造不同 hash 后，各 namespace 的文件数和字节数都收敛在预算内。

### Phase 3：Profile artifact 减重

- 建立 artifact-safe Profile SDK/DSL seam。
- 把宿主 Harness/Provider/Prisma/jsdom/Project 数据面从 artifact value-import 图移出。
- 加入 metafile 摘要和依赖族/大小回归门禁。
- 提升 compiler version，全量重编 current system/user Profile。

退出条件：最小 Profile 不再携带宿主实现图；内置 Profile 总 current bytes 显著下降，且行为回归通过。

### Phase 4：跨环境验收与文档收口

- 重复执行关键测试并记录至少 5 轮磁盘增长曲线。
- 中断测试进程，验证下一运行的保守回收。
- 验证 Source checkout、无根 `node_modules` Product Bun、Windows Portable 的 Profile/Variable/World Engine import。
- 更新 `reference/agent/profile-compiled-artifacts.md`、`PROJECT-STATUS.md` 和本 Task walkthrough。

退出条件：空间曲线收敛、三环境导入成功、稳定 reference 与实现一致。

## Verification / Test

实施阶段重点测试正确的 Interface，不为简单 getter 或常量建立碎片测试：

- Profile 发布 Module：current manifest 引用永不删除；publish 与 GC 并发不产生缺失 artifact；超预算按最旧孤儿回收。
- Runtime Import Cache Module：同 key 复用；多 key 达预算后收敛；正在导入项不被驱逐；源 artifact 仍可重建缓存。
- Test Workspace Fixture Module：初始化任一步失败仍删除 root；多个 cleanup 错误不阻止最终 `rm()`；活跃 lease 不回收；死亡/过期 lease 可回收。
- 真实放大链：`workspace-files.test.ts` 的 system copy 次数、copy bytes 和结束残留目录数。
- Profile bundle：最小 Profile artifact bytes、内置 current total bytes、metafile inputs 和禁止依赖族。
- 发布环境 smoke：无根 `node_modules` 下加载 system/user Profile、Variable 和 World Engine calendar/schema。

## Risks and Trade-offs

- 512 MiB 等预算太低会减少快速回滚窗口，太高会允许本地开发再次积累数 GB；current release 始终受保护，因此风险主要是重编成本而非数据丢失。
- 共享只读 system assets 会暴露偷偷修改系统模板的测试。此类测试必须显式申请 isolated copy，这是一种有意的测试合同收紧。
- Profile SDK 拆分是本任务最深的一段，可能影响大量 Profile 编译测试。Phase 0 必须先用 metafile 定位，不按文件名猜边界。
- native import 的 Bun module cache 不能主动卸载；磁盘缓存有界不等于进程内 ESM 实例可回收。验收需同时观察长期进程内存，但本 Task 不承诺解决 Bun 内部 module cache。

## Implementation Walkthrough

- Round 01 已完成只读诊断、最小实验与推荐架构，见 [walkthrough](walkthroughs/round-01-diagnosis-and-recommended-architecture.md)。
- Round 02 复核基线、执行一次性清理并实施 Phase 1/2，见 [walkthrough](walkthroughs/round-02-baseline-recheck-and-implementation.md)。
- Round 03 实施 Phase 3 artifact 减重（四处切边 + 依赖门禁），见 [walkthrough](walkthroughs/round-03-phase3-artifact-diet.md)。
- Round 04 把 Project 测试写入全部收进 suite 级隔离 Runtime Workspace Root，移除 Preview 测试前缀遮掩，并精确清理已授权残留，见 [walkthrough](walkthroughs/round-04-workspace-test-isolation.md)。

### 实际结果与原计划差异

- 原问题最初聚焦 `.agent` 缓存；深入后确认最大残留实际位于系统 `%TEMP%`，由测试 fixture 放大 `.compiled` 导致，因此任务范围从“缓存清理”扩展为三个 owner 的生命周期设计。
- 原本可能只需修 cleanup；最小实验证明 Profile artifact 与 runtime import cache 自身也无界，因此单修测试会很快复发。
- 没有采用大一统 Artifact Store；领域真相源差异足以证明分离 owner 更简单、更安全。

## TODO / Follow-ups

- [x] 用户确认 ADR 0002 与推荐默认预算（Round 02）。
- [x] 用户确认并执行一次性清理（Round 02，实际回收 17.34 GB / 1866 文件）。
- [x] Phase 0：刷新空间基线（Round 02 §1-2；Profile value-import 链追踪归入 Phase 3）。
- [x] Phase 1：Test Workspace Fixture 所有权收口。
- [x] Phase 2：有界 artifact 生命周期（Profile orphan 硬预算 + 移除冗余 import cache + retention policy 类型门禁）。
- [ ] Phase 2 补测：预算 GC 四条聚焦测试、`profile-artifact-store.test.ts`、fixture 所有权测试。
- [x] Phase 3：Profile artifact 减重（Round 03：单 artifact 27.3→1.2 MiB、一代 release 382→17.24 MiB；「Product 只有 5.9 MB」的差距根因即渗漏边——Product 是对 Nitro tree-shake 后的 `.output/server` 编译，天然没有 jsdom/prisma；切边后 source 反而更小）。
- [x] Phase 3 门禁：编译器 metafile 依赖白名单 + 禁止依赖族 + 4 MiB 字节上限，违规 `compile_failed`，合同见 `reference/agent/profile-compiled-artifacts.md` 的 Dependency Gate 小节。
- [ ] Phase 4：跨环境验收（Source / Product Bun / Windows Portable 三形态 Profile 导入）与 5 轮空间收敛曲线。原 `bun:ffi` 阻塞已在 Round 02/03 解除（`isPlatformBuiltinModule` external + 依赖图切边），`catalog.test.ts` 已回到 44/44。
