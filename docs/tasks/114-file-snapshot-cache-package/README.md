# Task 114：文件快照缓存独立包与 Project File Index 生命周期

状态：Phase A–F与Task 118 Phase 2–3已完成。package 已删除0生产consumer的projection/store，完成显式activation、raw event-before-rebuild、默认5秒idle TTL与资源诊断；NeuroBook现通过唯一`ProjectFileIndexAdapter`接入生产，Project/plain Workspace共用一个`SnapshotCache`，旧index lifecycle与ResourceOwner已删除。package为3 files / 40 tests且独立typecheck通过；Task 118 Phase 3 warm-up关闭批次为8 files / 41 passed，根typecheck通过（2026-07-24）。

> 2026-07-24 统一合同：执行顺序仍是 Task 118 Phase 1先完成Project Lifecycle发布门禁，随后在Task 118 Phase 3把已深化的cache Interface与ProjectSession/全部built-in Module同代接入；轻量`/api/projects`与“打开目录”产品切片再落地。File Index不临时包装旧ResourceOwner。内置`ProjectModule` registry同批替代全部旧owner；Task 114只拥有File Index迁移，不替其他owner建兼容层。完整tree build等重工作使用共享、可取消后台warm-up，不建设面板级部分ready UI。Project/plain Workspace cache key区分target kind、canonical identity/root与scan policy；旧`project-workspace-index.ts`生命周期必须删除，禁止双cache。关闭失败必须保留本generation精确handle并可重试；plain Workspace由显式引用计数activation lease持有，不得形成第二个snapshot状态机。无实际消费者的projection/store已从package源码、export、测试与benchmark删除。

## Relative documents refs

- [Task 118 联合执行计划](../118-project-catalog-snapshot-path-integration/README.md)：统一 ProjectListSnapshot、一级 Project root、ProjectModule、Task 114 Phase F 与 Task 115 identity/session hard cut 的依赖顺序和决策门禁。
- [Task 21 Project Workspace Index Watcher](../21-project-workspace-index-watcher/README.md)：现有内存 tree index、watcher、dirty/rebuild、revision 与 SSE subscription 的来源。
- [Task 83 Project List Performance](../83-project-list-performance/README.md)：`/api/projects` 现有短缓存、Server-Timing、全 Project Workspace 统计和历史性能基线。
- [Task 92 Project Resource Lifecycle](../92-project-resource-lifecycle/README.md)：Project 资源关闭与空闲释放的前作。
- [Task 94 Project Lifecycle Model](../94-project-lifecycle-model/README.md)：当前 ProjectSession open/presence/close 生命周期和资源属主契约。
- [Task 95 nb-history Integration](../95-nb-history-integration/README.md)：现有 Project Runtime Artifact 规则来源；Task 118进一步把recovery、可重建artifact、transaction temp与普通内容拆成按消费者区分的Workspace Path Policy。
- [Workspace Terms](../../../reference/workspace/TERMS.md)：Project Workspace、Project Workspace `.nbook` 与 Project Runtime Artifact 标准术语。

## User Request / Topic

- 排查 `GET /api/projects` 慢、反复刷新后疑似内存泄漏和 OOM 风险。
- 用户确认继续构造完整 `WorkspaceFileNode[]`，不把列表统计改成另一套轻量文件 walker。
- Task 118最终让Project列表只返回`ProjectListSnapshot`轻量manifest metadata；完整节点快照不参与Project列表，只服务已打开Project与显式plain Workspace的File Index消费者。按联合计划，cache Interface与ProjectModule/File Index先完成，产品列表切片后接入并只做零File Index回归断言。
- Project File Index Adapter 只接收 Project Lifecycle Module 已解析的 Project 身份；不得自行发现嵌套 Project、Workspace Root 外目录或祖先 manifest。
- 先把通用文件缓存能力从 NeuroBook 解耦为单独 package；在无 Nuxt、H3、ProjectSession、SSE 和业务数据库上下文干扰的条件下完成测试与性能测试，再决定是否接入 NeuroBook。

## Goal

先交付独立的 `packages/file-snapshot-cache`：它以调用方提供的完整节点 builder 为输入，统一管理按 key 的内存快照、并发构建去重、watcher dirty/generation、稳定提交、raw/stable事件、订阅、idle回收与关闭；package 自身不得依赖任何 `nbook/*` Module或 NeuroBook DTO。以独立 correctness suite、竞态测试、资源释放测试和可复现 benchmark 报告证明包的行为与成本，在门禁通过前不得修改 `/api/projects`、现有 Project Workspace tree index 接线或产品行为。若 package 无法在复杂度、内存、句柄和延迟预算内成立，停止在独立包阶段，报告证据和替代方案，不用临时 adapter 或双缓存绕过。

Phase F 的目标不是继续扩张 package，而是用 deletion test 收缩生产 Interface：只保留真实 File Index 消费者需要的生命周期能力；若 projection/store 没有非统计消费者，则删除其生产接线、公开类型和专属测试/benchmark。NeuroBook 最终只能保留一个 File Index lifecycle 真相源。

## Current State

### 诊断结论

- `server/utils/novel-chapter.ts` 在 Project 列表冷路径中对所有可见 Project Workspace 并发调用 `scanWorkspaceTree()`，随后从完整 `WorkspaceFileNode[]` 计算 volume/chapter/word/lorebook 数量。
- 完整扫描默认遍历 Project Workspace 所有未忽略目录，不只遍历 `manuscript/` 与 `lorebook/`；`reference/`、`.agent/`、`.nbook/`、`upload/` 等也进入节点构造。
- 真实 Project Workspace 单次扫描基线：
  - `ming-ding-zhi-shi-2`：1615 nodes，约 2.7–13.4s；
  - `ming-ding-zhi-shi`：1444 nodes，约 5.2–29.3s；
  - `gong-li-yu-lu-xue-yuan`：947 nodes，约 2.4–4.8s。
- 历史 `projects.list.slow` 日志多数为 5–17s，出现过约 31–40s；本轮真实 HTTP 请求 90s 未返回，随后连 `/api/hello` 都无法在 3–10s 内响应。
- Project 列表当前使用 5s 短缓存和 in-flight Promise 去重。它能避免同一 runtime 内的完全重复扫描，但缓存寿命短于冷构建耗时；客户端断开也不会取消后台构建。
- 带 `project` query 的 Novel IDE 初始化会先 `loadNovels()`，随后进入 `initializeWorkspace()` → `ensureDefaultNovel()` 再加载一次列表。后端通常共享同一个 in-flight Promise，但每次页面刷新仍会增加两个等待者。
- Node + 强制 GC 的四轮冷列表统计 RSS 为约 `236 → 241 → 248 → 249MB`，V8 heap 约 29–30MB，未证明稳定 runtime 存在无界 JS heap 泄漏。
- 当前 Nuxt dev 父进程曾观察到约 1.9GB Private Bytes、224 threads、2821 handles。`@libsql/client` 最小复现显示进程级 native runtime 会常驻约 32 个等待线程；当前异常更像 Nuxt dev 热重载世代、native runtime 和挂起请求叠加，不能直接归类为页面刷新必现的普通 JS 泄漏。

### 真实 Project Workspace benchmark 结论

本轮补充了 task-local 只读 harness `benchmarks/real-projects.ts`。它直接复用生产 `scanWorkspaceTree()` 与独立 cache 内核，不打开文件系统watcher、不写 Project Workspace、不修改 `/api/projects` 或现有 tree index。bounded cold/warm阶段显式持有activation，模拟已打开Project Module的所有权；Project列表统计已从目标产品路径删除，benchmark只保留File Index生命周期与资源成本证据。

| 场景 | 实际结果 | 判断 |
| --- | --- | --- |
| 18 个 Project Workspace 逐个完整扫描 | 18/18 成功；最新wall `31.54s` | 当前完整扫描不适合停留在 Project 列表请求路径；wall受OS cache/系统负载影响明显 |
| `ming-ding-zhi-shi-2` | 1615 nodes；最新`10.79s` | 最大节点项目，主要热点为 `lorebook/` 和 `reference/` |
| `ming-ding-zhi-shi` | 1444 nodes；最新`9.46s` | 第二大节点项目，热点同样集中在 `lorebook/` 和 `reference/` |
| `gong-li-yu-lu-xue-yuan` | 947 nodes；最新`8.22s` | `reference/` 是主要热点 |
| 三大项目占比 | 4006/4269 nodes，即 93.8%；扫描时间约 94% | 延迟高度集中，不是 Project 数量平均增长造成 |
| 统计派生 | 最新最差 p95 `0.27ms` | volume/chapter/word/lorebook reduce 不是慢点 |
| 节点数与扫描耗时 | 首轮相关系数约 `0.9995` | “文件/目录节点过多”假设得到强支持 |
| 18 项 activated warm cache read | 最新p99 `0.01ms`，build delta `0` | owner持有期间读取已提交snapshot的成本可忽略 |
| 18 项 activated bounded cold build | concurrency=2，最新wall `7.36s`；历史同机样本曾为`63.20s` | 报告只能证明去重/并发结构，不能替代Phase 3真实Nuxt进程门禁；列表不得成为activation owner |
| 最大项目 100 个并发 cold readers | 只触发 1 次完整 build；最新wall `2.67s` | 同 key in-flight 去重可阻止刷新等待者制造重复扫描 |

顶层目录 profile 将热点进一步定位为：

- `ming-ding-zhi-shi-2`：`lorebook/` 934 nodes/约 3.38s，`reference/` 537 nodes/约 2.17s。
- `ming-ding-zhi-shi`：`lorebook/` 880 nodes/约 3.08s，`reference/` 513 nodes/约 2.13s。
- `gong-li-yu-lu-xue-yuan`：`reference/` 845 nodes/约 3.52s。

scanner 会递归 `stat`/`readdir` 每个节点，并读取、解析所有未归类为已知二进制扩展的文本文件，包括 Markdown frontmatter 与 refs。SQLite、PNG 等已知二进制文件只做 metadata 访问，因此 `ming-ding-zhi-shi-2/.nbook/subject-rag.sqlite` 虽有约 120MiB，但不是数秒扫描的主要来源。目录 profile 是分 target 串行测量，受系统负载与安全软件影响，分项 wall 只用于热点排序，不与一次完整扫描 wall 直接相加。

内存与资源复测结果：

- 最大项目 10 次 `invalidate/rebuild`，每轮强制 GC 后，heap 为 `50.24 → 50.29MiB`，斜率约 7.00KiB/cycle，R² `0.2977`。
- Active resources 为 `3 → 3`，没有发现随 rebuild 增长的句柄或活动资源。
- 同轮 RSS 为 `264.88 → 274.11MiB`，斜率约 1.10MiB/cycle，R² `0.9373`；3-cycle profile为`234.61 → 237.88MiB`、R² `0.9478`。高拟合样本仍是native buffer/V8 allocator风险信号，需在生产Adapter进程验收继续观察。
- 当前证据不支持稳定线性的 retained JS heap 泄漏；RSS 应暂记为 native buffer/V8 allocator 高水位风险信号，不能据此宣布没有 OOM 风险，也不能认定页面刷新必然造成普通 JS 泄漏。

据此，联合计划先建立Lifecycle/manifest/locks，再由Phase F深化cache Interface并与ProjectModule同代接入；Task 118 Phase 4随后让`/api/projects`与File Index完全解耦。File Index最低ready只建立cache entry、History raw-event seam与watcher生命周期；完整`scanWorkspaceTree()`是Module持有的共享warm-up Promise，由generation/`AbortSignal`真正取消，不阻塞`openProject()`。文件树、校验、History等需要完整snapshot的数据面等待同一Promise。跨项目build concurrency只约束I/O峰值，不承诺固定缩短wall；接入必须删除旧5s stats cache和被package替代的宿主cache生命周期，禁止双cache长期并存。

原始产物：

- `benchmarks/results/real-projects-node.{json,md}`：最新主报告按运行时实际发现的35个合法Project生成（其中包含测试运行遗留目录，因此项目数只是本轮环境快照），source SHA-256 `893de3de576ba0ae48973c0fcd0f92736d514cd60f8ff72a6dba92b6c8d38b4d`。
- `benchmarks/results/real-projects-top3-node.{json,md}`：三大项目 10-cycle 内存复测。
- `benchmarks/results/real-projects-top3-profile-node.{json,md}`：三大项目顶层目录 profile。

### 现有模块边界

- `server/workspace-files/workspace-files.ts` 负责 NeuroBook 的完整 `WorkspaceFileNode` 构造、frontmatter、refs、状态和内容语义。
- `server/workspace-files/project-workspace-index.ts` 当前同时承担 cache entry、watcher、dirty/generation、debounce rebuild、issues、SSE payload、ProjectSession 资源注册和 NeuroBook path/DTO 适配；这些生命周期状态属于 Phase F 的删除目标。文件名若保留，最终也只能是薄 Adapter/DTO 组合，不能继续拥有 entry Map、watcher、timer、dirty/generation、build Promise、subscriber 或 close 状态。
- `registerProjectResourceOwner()` 不是可长期保留的第二层 seam。File Index 迁入 `ProjectModule` 后，旧 registry 对它的 init/warm-up/close 责任必须删除，避免两套 readiness 与 close 真相源。
- Project 列表不再消费 File Index，也不需要跨进程统计 projection；deletion review已确认无真实非统计消费者，projection/store现已删除。路径策略不能继续用一个共享布尔“排除”同时控制Index、History与Archive：recovery由Index/History忽略但完整归档保留；可重建runtime artifact三者都忽略；transaction temp按精确matcher忽略并允许清理。

## Decisions / Discussion

### D1：先独立 package，后接入 NeuroBook

实施顺序固定为：

1. 明确 package contract 与独立 fixture。
2. 实现 package，不修改 NeuroBook 现有 tree index 和 `/api/projects` 行为。
3. 完成 correctness、竞态、资源释放测试。
4. 完成 cold/warm/concurrent/event-burst/memory/handle benchmark，提交机器信息与原始报告。
5. 审查 package API 和性能结果，用户确认是否进入 NeuroBook adapter 设计。
6. 只有通过门禁后，才允许迁移现有 index 或接入已打开 Project 的 File Index 生命周期。

不采用“一边抽 package、一边替换线上 index”的迁移方式。第一阶段允许复制/重新表达必要的通用逻辑，但禁止 NeuroBook 生产代码 import 尚未验收的 package。

### D2：package 是泛型快照缓存内核，不拥有 NeuroBook 领域

建议目录与包名：

```text
packages/file-snapshot-cache/
  package.json
  tsconfig.json
  vitest.config.ts
  src/
  tests/
  benchmarks/
  fixtures/
```

建议包名：`@notnotype/file-snapshot-cache`。首版保持 monorepo private package，不把“是否公开发布”混入本任务。

package 通过泛型和显式 adapter 工作：

```typescript
interface SnapshotBuilder<TKey, TNode, TIssue> {
    build(input: {
        key: TKey;
        signal: AbortSignal;
    }): Promise<{
        nodes: TNode[];
        issues: TIssue[];
    }>;
}

interface SnapshotProjection<TNode, TIssue, TProjection> {
    schemaVersion: number;
    derive(input: {
        nodes: readonly TNode[];
        issues: readonly TIssue[];
        calculatedAt: string;
    }): TProjection;
}
```

最终命名可在实现前按现有 package 风格调整，但边界不变。

package 拥有：

- 按 typed key 管理 cache entry；
- cold build / warm read；
- in-flight Promise 去重；
- dirty、generation、event-during-build 后的稳定提交；
- watcher 事件归并与 debounce；
- stale-while-revalidate；
- subscriber 与 sequence；
- `AbortSignal`、`close(key)`、`closeAll()`；
- 从完整节点快照派生泛型 projection；
- versioned codec、损坏/缺失/schema mismatch 处理；
- JSON projection 原子写入；
- 结构化 diagnostics 与 benchmark hooks。

NeuroBook adapter 继续拥有：

- `WorkspaceFileNode` 具体类型和完整节点构造；
- frontmatter、icon、refs、state、content node 与 issue 语义；
- Project Path / Project Workspace 路径解析；
- ProjectSession open/presence/close；
- H3、Nitro、SSE DTO 和 HTTP route；
- Project Runtime Artifact 路径选择与宿主排除策略；
- Project 列表 DTO；
- volume/chapter/word/lorebook 的具体统计类型和解释。

package 禁止：

- import `nbook/*`；
- import Nuxt/H3/Pinia；
-认识 `workspace/<slug>`、ProjectSession、Workspace Root 或 user-assets；
- 打开 SQLite；
- 把 `unknown` / `any` 当作跨边界逃生口；
- 内置 NeuroBook 的 `.nbook`、`.agent`、frontmatter 或内容节点规则。

NeuroBook Adapter 拥有区分使用场景的 discriminated key。最终类型名可在实现时按 Task 115 的结构化身份调整，但语义必须等价于：

```typescript
type WorkspaceFileIndexKey =
    | {
        kind: "project";
        projectKey: ProjectWorkspaceKey;
        scanPolicy: "project-v1";
    }
    | {
        kind: "plain-workspace";
        root: AbsoluteFilesystemPath;
        scanPolicy: "plain-v1";
    };
```

- key 必须包含 target kind、canonical identity/root 和 scan policy revision，禁止只用绝对 root 复用 entry。
- Project分支消费的`ProjectWorkspaceKey`必须跨Lifecycle实例与HMR稳定；实例私有symbol不允许进入Phase F Adapter。key仍只存在于进程内，不持久化，也不参与跨进程锁ownership。
- 相同物理 root 若 target kind、ignore 规则或 scan options 不同，必须形成不同 entry，不能串用 snapshot。
- Project 与 plain Workspace 可以共用一个 `SnapshotCache` 实例，但各自生命周期宿主不同：Project 由 ProjectSession/ProjectModule 管理，plain Workspace 由其显式消费者与 idle eviction 管理。

### D3：仍然构造完整 `WorkspaceFileNode[]`

本任务不引入第二套“只为统计而扫描”的简化节点模型。NeuroBook 将来接入时，builder 仍调用完整节点扫描；统计只能由这次完整快照的 commit 结果派生，不能再次扫描磁盘。

Project 与 plain Workspace 两类 policy 都继续构造完整 `WorkspaceFileNode[]`，但不要求共享完全相同的 ignore/options；scan policy 是 builder 语义和 cache identity 的一部分。

独立 package 测试使用与生产形态相同的 typed fixture node，但不能 import NeuroBook server Module。package benchmark证明缓存编排、idle回收和watcher生命周期成本；真实`WorkspaceFileNode` builder另以task-local只读harness测量，不进入通用package，也不接生产adapter。该benchmark只能证明真实扫描成本和cache可消除重复构建，不能伪造“扫描器已经优化”或“`/api/projects`已经接入”的结论。

### D4（历史）：曾实现的泛型 projection 能力，现已删除

本节只保留早期设计与deletion review的来由，不是当前Interface。Phase C曾实现projection/store；2026-07-24确认0生产consumer后，源码、export、公开类型、专属测试与benchmark均已删除，不为假想插件保留。

首版完整节点树保留在内存；磁盘只保存体积小、可重建、带版本的 projection。这样避免：

- 序列化完整正文、frontmatter、refs 和绝对路径；
- 磁盘缓存泄露项目内容；
- node schema 变动导致巨大迁移面；
- Project 列表为读取统计重新打开 SQLite。

早期方案曾建议 NeuroBook 使用以下 `ProjectWorkspaceStatistics` projection；由于 Project 列表统计已删除，它现在只作为 package 历史设计记录和 deletion review 候选，不是 Phase F 的产品目标：

```typescript
interface ProjectWorkspaceStatistics {
    schemaVersion: 1;
    calculatedAt: string;
    nodeCount: number;
    volumeCount: number;
    chapterCount: number;
    totalWords: number;
    lorebookCount: number;
}
```

`threadCount`、`sceneCount` 属于 Plot 数据库；`sessionCount` 属于 Workspace Root session repository。三者不进入 File Index projection；早期合并统计方案已经撤销。

### D5（历史）：曾实现的projection持久化合同，现已删除

以下条目只记录被删除实现曾满足的安全边界，不能作为当前可调用能力。若未来出现真实磁盘read-model需求，应重新立项，而不是恢复旧export。

- 构建期间发生新事件时，本轮结果可以暂存，但不得覆盖已知更新世代的持久化 projection。
- 只有 generation 稳定的 snapshot commit 才能 derive + persist。
- 写入采用同目录临时文件 + rename 原子替换；临时文件名和最终artifact都必须进入宿主精确路径策略。禁止使用`*.tmp`或“名称包含.tmp”等宽泛规则，以免隐藏用户文件。
- projection 写入失败不回滚已成功的内存 snapshot；返回/记录 degraded diagnostics，并保留上一版磁盘快照。
- 损坏、缺失或 schema 不匹配的 projection 不向宿主消费者扩散解析异常；只有真实 consumer 存在时，才按其合同标记 missing/stale 并调度重建。

### D6：避免无界资源与刷新堆积

- 同 key 同 generation 最多一个 build；并发读只共享结果。
- subscriber 数量、pending event 数量和 diagnostics history 必须有界。
- `close(key)` 必须取消debounce/idle timer、停止watcher、终止或隔离尚未提交的build，并释放subscriber。
- `closeAll()` 后测试必须能证明无活动debounce/idle timer、watcher和不可达entry。
- 独立 package 提供取消能力，但是否把 HTTP disconnect 映射到 build cancellation 由未来 NeuroBook adapter 决定；不能因为单个消费者断开而取消仍被其他消费者等待的共享 build。
- ProjectModule 为 warm-up 创建 module-generation `AbortSignal`；close/delete/shutdown/HMR replacement 必须取消 warm-up并隔离迟到结果。
- 单个 HTTP/SSE 消费者断开只取消自己的等待，不取消仍被 Module 或其他消费者共享的 warm-up。
- route 不得新建无属主的 fire-and-forget build；全部数据面复用 Module 的同一 warm-up Promise。最低 ready 与完整 build 分离，建立 watcher/cache 生命周期不得隐式触发完整扫描。

### D7：性能与复杂度门禁

package 解耦会增加 adapter 与泛型 contract；收益是隔离测试、复用、可测资源生命周期和阻止 HTTP/领域逻辑重新进入缓存内核。用户已经确认进入 Phase F；当前接入门禁固定为：

- package API 规模和依赖数；
- 与现有 index 相比的新增/删除代码量；
- cold/warm/event/memory/handle benchmark；
- Windows 与 Node/Bun 差异；
- 是否实际替代现有实现，而不是只叠加一层 Adapter。

ProjectModule 必须替代 ResourceOwner，旧 index 状态机必须删除，projection/store 必须通过 deletion test。若 Phase F 只能叠加 Adapter 而不能删除旧实现，应停止并报告复杂度证据，不形成双 cache。

## Verification / Test

### 独立 correctness suite

- cold read 只 build 一次，warm read 不 build。
- 同 key 并发 1/10/100 个消费者只产生一个 in-flight build。
- 不同 key 可独立推进，且可配置全局 build concurrency，避免全盘并发 I/O 峰值。
- event burst 经 debounce 合并；pending events 有数量上限和溢出诊断。
- build 期间收到事件时旧结果不得误清 dirty；稳定前最多按契约补跑一轮。
- watcher error 后保留 stale snapshot，下一次 read/revalidate 可恢复。
- root 删除、close、closeAll、重复 close 均幂等。
- subscriber 抛错不污染 cache commit 和其他 subscriber。
- projection derive 只消费本次已提交的完整 nodes/issues。
- projection missing/corrupt/schema mismatch 返回 typed cache status 并触发重建，不把解析异常扩散给只读消费者。
- projection 写失败保留内存 snapshot和旧磁盘文件。
- 临时文件 + rename 路径经过故障注入后，不会留下半份可读取 JSON。
- 自有 artifact 事件通过 adapter ignore 后不会触发 rebuild 循环。
- `AbortSignal` 覆盖 close-before-build、close-during-build、late resolution 与多消费者共享 build。

### 类型与隔离门禁

- package 自己的 `tsconfig` 和 `vitest.config`；不通过根 Nuxt prepare 才能测试。
- `bun run --cwd packages/file-snapshot-cache typecheck` 通过。
- `bun run --cwd packages/file-snapshot-cache test` 通过。
- 静态搜索确认 package 源码 0 个 `nbook/*`、Nuxt、H3、ProjectSession、NeuroBook DTO import。
- package production dependencies 保持最小；新增依赖前先确认根 `package.json` 是否已有，新增时使用 bun 最新版。

### Benchmark suite

benchmark 必须独立于 Vitest 默认 correctness suite，固定 seed，并输出 JSON 和可读 Markdown 报告。报告记录 OS、CPU、内存、Node/Bun 版本、文件系统、运行参数、commit/工作树标识和样本数。

至少覆盖：

1. synthetic 1k / 10k / 50k typed nodes 的 cold commit、projection derive 和内存占用；
2. 同规模 warm read p50/p95/p99；
3. 100 个并发 cold readers 的 build 次数和总延迟；
4. 1k watcher events burst 的 rebuild 次数、事件合并成本和 pending 上限；
5. 连续 100 次 invalidate/rebuild，在可用 GC 条件下测 retained heap/RSS slope；
6. 100 个 key open/close 后 timer、watcher、handle 和 entry 回落；
7. projection 原子读写 cold/warm 延迟与损坏恢复；
8. Windows 与当前主要 Node runtime；如 Bun 行为不同，单列而不混算。

第一轮先建立 baseline，不预先伪造绝对毫秒目标。baseline 完成后，把以下结构性门禁固化成回归断言：

- 同 key 并发 build count 必须为 1；
- warm read 不得触发 builder 或磁盘读；
- 1k event burst 的 rebuild 次数必须有确定上限；
- 100 次 rebuild 后 retained heap/RSS 不得呈稳定线性增长；
- closeAll 后 entry/timer/watcher 必须归零，平台可观测 handle 回到允许误差范围；
- projection 大小只与 projection schema 有关，不随完整节点正文体积线性增长。

绝对延迟预算和允许的 RSS/handle 误差由 baseline 报告后交给用户最终拍板，避免在未知 CI/Windows 文件系统上写脆弱阈值。

### NeuroBook 接入前门禁

以下条件全部满足后才允许提出接入补丁：

- package correctness、typecheck、资源释放测试全部通过；
- benchmark 可重复运行且报告齐全；
- 无无界内存、timer、watcher、subscriber、pending event 证据；
- package API review 证明没有泄漏 NeuroBook 领域；
- 已报告性能与复杂度权衡，用户明确确认接入；
- 接入方案明确删除/替代哪些现有 index 代码，不允许长期双 cache。

### Phase F Interface 与 deletion tests

- Project/plain Workspace 以及不同 scan policy 的 key 相互隔离；同 key 去重，不同 key 不串 snapshot。
- watcher activation 是显式、幂等操作；单纯读取或构造 cache entry 不得隐式打开 watcher。
- File Index 最低 ready 建立 History event seam、cache 与 watcher 生命周期时，完整文件 build count 仍为 0；warm-up 只产生一个共享 build。
- close/delete/shutdown/HMR replacement 会取消 warm-up；迟到 builder 不得重新 commit、发布 SSE、注册 subscriber 或安装 watcher。
- History event seam 在 watcher activation 前完成注册；事件 batch 在 rebuild 前通知，callback 失败与其他 consumer 隔离。
- ProjectModule close 对 File Index 只执行一次；生产代码中 File Index 对 `registerProjectResourceOwner()` 零命中。
- 旧 `project-workspace-index.ts` 生命周期被删除或瘦身为无状态薄 Adapter；宿主不再持有第二套 Map/timer/watcher/generation/build Promise/subscriber。
- `.nbook/recovery/**` 不进入File Index或History，但完整Project归档必须逐字节保留；Lifecycle transaction temp不进入Index/History/Archive；用户自建`notes.tmp`等普通文件仍正常进入tree。
- `/api/projects`连续读取的File Index build delta为0。该项是Task 118 Phase 4的回归门禁，不由Phase F重新实现列表。

## Implementation Walkthrough

- 2026-07-21：完成 `/api/projects` 慢与 OOM 风险诊断。确认主慢点是 Project 列表请求内全量构造所有 Project Workspace 的完整 `WorkspaceFileNode[]`；刷新会增加共享 in-flight Promise 的等待者，但稳定 Node 强制 GC 测试未证明无界 JS heap 泄漏。
- 2026-07-21：用户确认继续构造完整 `WorkspaceFileNode[]`，采用派生统计持久化，并要求先把文件缓存模块解耦成独立 package，完成独立测试和性能测试后再考虑接入 NeuroBook。
- 2026-07-21：创建 Task 114，冻结“两阶段硬门”与 package/宿主边界。本轮只写任务设计，不创建 package、不修改生产代码、不运行浏览器验证。
- 2026-07-22：完成 `packages/file-snapshot-cache` 独立包。公开 contract 只包含 typed builder/key/node/issue/event/projection/store/watcher，不 import NeuroBook、Nuxt、H3、ProjectSession 或 `WorkspaceFileNode`；package 无 production dependency。
- 2026-07-22：完成 cache 状态机：同 key in-flight 去重、跨 key 全局 semaphore、generation 稳定提交、stale-while-revalidate、事件 debounce/有界 pending、subscriber 隔离、watcher error 诊断、`AbortSignal`、幂等 `close/closeAll` 与 late result guard。测试过程中修复了同步 subscriber throw 穿透、同步 watcher open throw、closeAll 未等待已开始 close、projection late read 和显式 revalidate no-op 等竞态。
- 2026-07-22：完成 versioned JSON projection store。只持久化派生 projection；写入使用同目录临时文件 + rename。`isCurrent()` 的线性化点在 rename 前：此前已知 generation 失效则清理临时文件且不替换旧 projection；rename 后才到达的事件属于下一 generation，当前 projection 作为 stale read model 保留并由后续 rebuild 替换。
- 2026-07-22：独立 typecheck 与 4 个测试文件共 24 例通过，覆盖 1/10/100 同 key readers、跨 key 并发、build 中失效、1k event burst、watcher/close/late result、subscriber、projection missing/corrupt/schema mismatch、写入/rename 故障和静态领域隔离。
- 2026-07-22：生成 Windows NTFS / Node 24.13.0 与 Bun 1.3.14 baseline。最终 Node：100 cold readers 只 build 1 次，总计约 0.20ms；1k watcher events 只 build 1 次并按上限丢弃 900 条，总计约 6.02ms；50k synthetic nodes 的 20 次 cache commit/projection 编排 p50/p95/p99 约 0.45/0.57/1.07ms，warm p99 小于 0.001ms；projection 原子写 p50/p95/p99 约 1.02/1.21/1.64ms，磁盘读约 0.66/0.80/0.89ms。该 cold 数字不包含调用方节点构造，不能替代真实完整文件扫描 benchmark。
- 2026-07-22：资源 baseline 中，100 key `closeAll` 后 entry/timer/watcher/subscriber 均归零、100 个 watcher handle 均执行 close，Node active resources 为 `2 → 2`。25 次 allocator warm-up 后再做 100 次 10k fresh-node rebuild，强制 GC heap 为约 `12.46 → 12.48MiB`、slope 77B/cycle、R² 0.5580，没有稳定线性 retained-heap 证据；RSS 为约 `167.88 → 210.78MiB`、slope 169KiB/cycle、R² 0.2725，未达到高拟合风险门禁，但仍保留为 V8 allocator/进程级观察项，不能据此宣称真实 Nuxt OOM 风险已经消失。Bun 本机 `heapUsed` 采样恒定，报告明确标记 `unavailable`。
- 2026-07-22：Phase E 建议为“可以进入 NeuroBook adapter 设计，但不应直接宣称 `/api/projects` 已优化”。package 编排开销和自有资源回收通过门禁；真正产品收益仍取决于复用完整节点快照、跨请求读取持久化统计，以及接入时删除旧 5s stats cache/重复 index 生命周期。Phase F 继续冻结，等待用户明确确认。
- 2026-07-22：按任务显式门禁完成第二轮逐条审计。新增 projection commit barrier：原子写入期间的 watcher 事件先有界入队并记为 deferred generation，`isCurrent()` 在 rename 前同时检查当前 generation 与 deferred generation；已知失效不会替换旧 projection，barrier 结束后补跑新 generation，也不会发布旧内存 snapshot。`close` 会 abort 并等待已经进入提交阶段的有限 projection write 收尾，防止旧 entry late rename 覆盖同 key 新 entry；忽略 `AbortSignal` 的 builder late result 仍不阻塞关闭。
- 2026-07-22：第二轮审计补齐 stale-while-revalidate、不稳定重试上限、root 删除形态、close-before-debounce、关闭期间拒绝新操作/安全重开、100 snapshot/projection readers 去重与共享取消、semaphore waiter 取消、subscriber 上限、projection 写入窗口、derive/decode 异常、missing/corrupt/schema mismatch 恢复、写失败后重建，以及生产依赖/领域 import/scripts 独立性门禁。最终为 4 files / 43 tests，全部通过。
- 2026-07-23：Task 118 Phase 1主体实现已覆盖exact digest/HMR、prospective `prepareOpen()`、Lifecycle close/in-flight、root fingerprint/ABA、compromised commit gates、Promise-fulfilled handoff、terminal lock release/tokenized sidecar、manifest conflict、transactional mutations与watcher/TTL；最终退出审查因POSIX root publish不是atomic no-replace、stale lock与publish-window case race证据缺失而重新打开。
- 2026-07-23：Phase 2首批cache Interface按逐条RED→GREEN完成。`read()`不再隐式启动watcher；`activate()`同步返回ready/error和精确incarnation close；raw event使用独立账本在rebuild前投递，builder失败后不丢失也不重复，stable subscriber仍只在成功commit触发。旧watcher测试与synthetic benchmark改为显式activation；该checkpoint为4 files / 48 tests、独立typecheck通过。
- 2026-07-23：deletion review确认projection/`JsonProjectionStore`/`readProjection()`在server/app/scripts/assets生产范围为0 consumer；后续顺序调整为先删除projection/store，再实现idle TTL，最后贯穿`scanWorkspaceTree()` AbortSignal并重生成Node/Bun与真实Project benchmark。
- 2026-07-24：完成Phase 2剩余独立Interface。删除`json-projection-store.ts`、`node.ts`、`readProjection()`、package `./node` export及全部projection类型/测试/benchmark；isolation deletion test固定生产Interface不回流。`SnapshotCache`新增默认5秒idle TTL与`idleTimerCount`，one-shot、subscriber、activation、debounce/build、close/reopen均以精确entry incarnation覆盖。
- 2026-07-24：`WorkspaceScanOptions.signal`已贯穿`scanWorkspaceTree()`、递归visitor、frontmatter/state/icons/ignore/default-target读取；宽catch优先重新抛出abort reason，取消后不再访问后续sibling。6条abort与4条scan-race测试通过。
- 2026-07-24：新增`WorkspaceFileIndexKey`公开Adapter identity：Project=`ProjectWorkspaceKey + project-v1`，plain Workspace=`AbsoluteFsPath + plain-v1`；同一物理root的两种target通过真实`SnapshotCache`公开Interface证明不会串entry。该类型尚未接入旧`project-workspace-index.ts`，因此没有叠加第二套cache。
- 2026-07-24早期checkpoint：补齐activation幂等/minimum-ready build=0、raw callback失败隔离和dropped-event双账本证据；当时package为3 files / 37 tests，Node/Bun synthetic source SHA-256同为`1464a9080ebc6c0e4a7123c8fb10d6022bcfd4ebd3091ba0c09f3543714c39f1`。
- 2026-07-24早期checkpoint：三套真实Project报告source SHA-256同为`8fff2a780f65f9550f15e6fa4e6e6e55eec8aed5eeead111945e1dc766a43c5a`。首次复跑发现one-shot entry在长cold阶段按5秒TTL回收，使“warm”阶段build delta=11；harness改为显式activation后warm delta恢复0；当时18项bounded cold wall为63.20s。
- 2026-07-24关闭恢复深化：两个公开Interface tracer证明watcher关闭失败保留精确handle/entry且activation/单key/`closeAll()`均可重试，package更新为3 files / 39 tests。Node/Bun synthetic source SHA-256同为`669bd09ddf83243787ad8a624a3bd6fa0dfc6f5b6c1e0298b144ded76c4b2f9d`；三套真实Project source SHA-256同为`977429f8214ade6205fefed567289375f6c5a850945daf46b7442655e0c9ced6`，主报告warm build delta=0、bounded cold wall为7.36s。与早期63.20s差异说明真实扫描wall高度受运行环境影响，Phase 3仍必须做Nuxt进程内存/GC门禁。
- 2026-07-24 Phase 3退出门禁补充：`SnapshotCache`按entry记录`buildFailureCount/lastBuildError/lastBuildFailedAt`，错误文本限制为2000字符且不保留Error对象图；失败保持dirty，原共享build settle后下一批并发read只启动一次重试。package更新为3 files / 40 tests，真实`ProjectFileIndexAdapter`回归证明warm-up失败可诊断且50个并发消费者共享一次重试。Node/Bun synthetic source SHA-256更新为`553d4c53c0e84bb0ccbfa8140427ee2cf90014a4c82a16bc18afe5fd31e06b6e`，三套真实Project报告source SHA-256更新为`893de3de576ba0ae48973c0fcd0f92736d514cd60f8ff72a6dba92b6c8d38b4d`。
- 2026-07-22：benchmark 改为每个节点规模 20 个 cold samples，固定 seed；1k events 经 fake watcher adapter 的真实 `onEvent` 路径注入；100 key 资源测试同时断言 100 次 watcher close；warm gate 直接断言不调用 builder、不写 projection、不读磁盘。报告记录 NTFS、Node/Bun、机器信息、参数、repository revision 与覆盖未提交 package 内容的 SHA-256；结构门禁失败会让命令非零退出。Bun `heapUsed` 恒定时明确标记 `unavailable`，不再伪装成通过。
- 2026-07-22：当时的复杂度审计为package约897行源码（其中状态机约556行、types约139行、JSON store约123行）、909行测试和703行benchmark；现有`project-workspace-index.ts`约603行。该checkpoint早于projection/store删除，只用于说明package不是小工具；只有Phase F能删除/替代宿主cache/watcher/generation生命周期时才值得接入，若只是新增adapter并保留旧index，则复杂度收益不成立。
- 2026-07-22：新增 task-local 真实 Project Workspace 只读 benchmark `benchmarks/real-projects.ts`。它复用生产 `scanWorkspaceTree()`、`/api/projects` 统计判定和独立 cache，但使用内存 projection store，不打开 watcher、不写 Project Workspace、不修改生产接线；输出 JSON/Markdown 到 `benchmarks/results/`。全 18 项两轮逐个完整扫描 wall 为 7.16–11.90s；最终源码指纹 `a052623a…95493ce` 的主报告中，`ming-ding-zhi-shi-2` 2.66s/1615 nodes、`ming-ding-zhi-shi` 2.15s/1444 nodes、`gong-li-yu-lu-xue-yuan` 1.68s/947 nodes。首轮较慢样本分别为 4.40s/3.81s/2.71s；排序和三者占全部节点 93.8%、扫描耗时约 94% 的结论稳定。首轮节点数与扫描耗时相关系数约 0.9995；统计派生最差 p95 仅 0.09ms，根因在完整节点构造而不是统计 reduce。
- 2026-07-22：顶层目录分解进一步定位文件热点：`ming-ding-zhi-shi-2` 的 `lorebook/` 934 nodes/约 2.77s、`reference/` 537 nodes/约 2.02s；`ming-ding-zhi-shi` 的两目录约 3.16s/1.91s；`gong-li-yu-lu-xue-yuan` 的 `reference/` 845 nodes/约 3.45s。scanner 会递归 stat/readdir 每个节点，并读取解析所有非已知二进制扩展的文本；SQLite/PNG 只 stat，因此单个 120MiB SQLite 不是主要延迟来源。目录分解阶段受系统/安全软件抖动影响，分项目 target wall 不应与一次完整扫描直接相加，只用于热点排序。
- 2026-07-22：跨项目 cache 冷构建并发上限 2 的两轮 wall 为 4.09–5.74s；无界 `Promise.all` 为 3.55–6.37s。二者均仍需每项目构造一次，绝对差异会受 NTFS/OS cache 与并发 I/O 抖动影响，不能据单轮宣称某个并发度固定更快。全 warm 18 项 read p99 为 0.01–0.02ms、build delta=0；最大项目 100 个并发 cold readers 只 build 1 次，证明同 key 去重可消除刷新等待者造成的重复扫描。
- 2026-07-22：最大项目 10 次 invalidate/rebuild + 强制 GC 复测：heap `50.42 → 50.48MiB`，斜率约 7.40KiB/cycle、R² 0.0993；active resources `3 → 3`，没有线性 retained JS heap/句柄泄漏证据。RSS `254.86 → 262.87MiB`，斜率约 0.99MiB/cycle、R² 0.8306，但逐轮样本存在回落；另一轮 3-cycle profile 为 `258.05 → 258.36MiB`、R² 0.1293。当前应归为 native buffer/V8 allocator 高水位风险信号，不足以证明无界泄漏；真实 Nuxt/libSQL/HTTP 断开与 dev 热重载仍需 Phase F 进程级验收。

## Verification Result

- `bun run --cwd packages/file-snapshot-cache typecheck`：通过。
- `bun run --cwd packages/file-snapshot-cache test`：3 files / 40 tests 通过。
- 根`bun run typecheck`：通过。
- `bun run --cwd packages/file-snapshot-cache benchmark`：通过，报告见 `packages/file-snapshot-cache/benchmarks/results/baseline-node.{json,md}`。
- `bun run --cwd packages/file-snapshot-cache benchmark:bun`：通过，报告见 `packages/file-snapshot-cache/benchmarks/results/baseline-bun.{json,md}`。
- `bunx tsc --noEmit -p docs/tasks/114-file-snapshot-cache-package/benchmarks/tsconfig.json`：通过。
- `node --expose-gc --import tsx docs/tasks/114-file-snapshot-cache-package/benchmarks/real-projects.ts`：18/18 个真实 Project Workspace 扫描成功；报告见 `benchmarks/results/real-projects-node.{json,md}`。
- 三大项目 10-cycle 内存复测与顶层目录 profile：通过；报告见 `benchmarks/results/real-projects-top3-node.{json,md}`、`real-projects-top3-profile-node.{json,md}`。
- `bunx vitest run server/workspace-files/workspace-file-index-key.test.ts`：1 file / 1 test通过；相同物理root的Project/plain Workspace产生独立entry。
- `bunx vitest run server/workspace-files/workspace-tree-scan-abort.test.ts server/workspace-files/workspace-tree-scan-race.test.ts`：2 files / 10 tests通过。
- `bunx vitest run server/workspace-files/workspace-files-containment.test.ts server/workspace-files/runtime-generated-path.test.ts`：2 files / 7 tests通过。
- 静态隔离搜索：package `src/` 与 `package.json` 中无 `nbook/*`、Nuxt、H3、ProjectSession、`WorkspaceFileNode` 依赖。
- 全仓生产接线搜索：package只由`server/workspace-files/project-file-index.ts`的唯一Adapter消费；`app/`、`scripts/`、`assets/`不直接import package，也没有第二个宿主cache生命周期。
- 最终 Node/Bun benchmark package source SHA-256 均为 `553d4c53c0e84bb0ccbfa8140427ee2cf90014a4c82a16bc18afe5fd31e06b6e`，运行卷为 NTFS；真实Project报告source SHA-256均为`893de3de576ba0ae48973c0fcd0f92736d514cd60f8ff72a6dba92b6c8d38b4d`。

## Completion Audit

| Requirement | Evidence | Result |
| --- | --- | --- |
| 完整 typed builder，仍由调用方构造完整节点 | `SnapshotBuilder` 只接收 typed `nodes/issues`；package 不含文件 walker；README 明确数组所有权 | 已证实 |
| cold/warm、同 key 去重、跨 key 并发上限 | 1/10/100 readers、semaphore、activated warm build delta=0 | 已证实 |
| watcher dirty/generation、debounce、有界事件 | fake watcher 1k events、pending/drop 断言、build-during-invalidate 与 root 删除测试 | 已证实 |
| generation 稳定 snapshot + raw/stable双账本 | build期间invalidate丢弃旧结果；raw在rebuild前投递，callback/builder失败与dropped count隔离 | 已证实 |
| projection/store删除合同 | 0生产consumer inventory；源码、export、类型、测试与benchmark deletion test | 已证实 |
| subscriber、idle TTL 与 diagnostics 有界 | subscriber上限/异常隔离；one-shot/owner idle回收；pending、debounce/idle、watcher、subscriber诊断 | 已证实 |
| close/closeAll、late result、安全重开 | debounce/idle timer、watcher.open、builder、semaphore waiter、多消费者取消与精确incarnation回归 | 已证实 |
| package 隔离与独立命令 | 0 production dependency；0 领域 import；标准 local CLI；`tsx` 明确 devDependency | 已证实 |
| 可复现 Node/Bun benchmark | 固定 seed、cold/warm 分位数、source SHA、NTFS/机器/runtime/参数、JSON+Markdown、fail-fast gates | 已证实 |
| 无无界 package-owned resource 证据 | 100 rebuild趋势门禁；100 key close后entry/debounce/idle/watcher/subscriber/handle回落 | 已证实；真实Nuxt OOM不在此结论内 |
| Phase A–E独立期不接入 NeuroBook | package isolation test与历史checkpoint证明当时生产import为0；Phase F随后只由唯一`ProjectFileIndexAdapter`接入 | 已证实 |
| 真实 `WorkspaceFileNode` builder benchmark | 18/18 Project Workspace、目录 profile、100 readers、10-cycle rebuild 报告 | 已证实；未接生产 adapter |
| HTTP/连续刷新/Nuxt/libSQL 进程验收 | 仍需真实 route、客户端断开与进程级资源曲线 | Phase F 待执行 |

## Actual Result vs Plan

- 与计划一致：Phase A–D 均在独立 package 内完成，没有修改 `/api/projects`、Project Workspace tree index 或任何 NeuroBook 生产接线，也没有运行浏览器验证。
- 与早期计划相比收缩：projection/store曾在Phase C实现，但deletion review确认0生产consumer后已整体删除；当前package只保留File Index真实需要的内存snapshot生命周期。
- 与计划相比强化：watcher `open`与builder都贯穿`AbortSignal`；diagnostics增加debounce/idle/watcher-opening/watcher/subscriber总量，默认5秒idle TTL避免one-shot entry长期滞留。
- 与计划相比补强：Phase 3只读复核发现原close Implementation会在watcher关闭失败时先丢handle并删除entry，无法兑现`closing_failed`。已按公开Interface逐条RED→GREEN改为失败保留精确handle/closed entry并允许同一activation、`close(key)`与`closeAll()`重试；package正式Vitest为3 files / 39 tests，独立typecheck通过。
- 与计划相比调整：测试采用真实 timer + controllable Promise 为主，只在 event debounce 使用 fake timer；这样更直接覆盖 Node/Bun 异步边界。benchmark 同时输出 Node 与 Bun 报告，而不是只做 Node/Windows。
- 与原计划相比提前完成：在不接生产 adapter 的前提下增加了真实 `WorkspaceFileNode` builder 只读 benchmark，用于确认完整扫描成本、目录热点和 cache 去重收益。
- 未完成且有意保留：没有 HTTP Server-Timing、连续页面刷新或 Nuxt/libSQL 进程级资源 benchmark；这些仍属于Phase 3生产Adapter验收，不能由task-local harness代替。18个activation bounded cold wall在同机不同轮次出现`7.36s`至`63.20s`的大幅波动，进一步说明task-local harness只能验证结构，不能省略真实进程门禁。

### 2026-07-22：Project Module 异步加载决定

- 用户确认 Project Database、History、File Index 尽量采用 VS Code 式渐进加载。三者不再由某个 HTTP route 隐式 fire-and-forget 预热，而是进入统一的内置 Project Module registry，各自报告 `pending/ready/error`、重试和 close。
- 该日仍保留“模块级部分 ready 或全部 ready”分支；此分支已被下一节 2026-07-23 统一合同取代。

### 2026-07-23：最低 ready、cache identity 与删除合同收口

- 本轮不建设面板级部分ready UI。required Project Database、History、File Index在core identity后共享AbortController并行启动，`openProject()`等待三个Module各自最低ready；首错abort、allSettled收尾并按固定依赖逆序回滚。
- File Index 最低 ready 是 History event seam、cache entry 与 watcher 生命周期已经建立；完整 tree build 是共享、可取消的后台 warm-up，由数据面按需等待，不阻塞 open。ready session关闭失败时，activation必须保留精确watcher handle并由同generation重试，成功前不得释放Occupancy。
- 内置ProjectModule registry原位替代`registerProjectResourceOwner()`；联合切片还会把History、Plot façade、Agent SQL迁入同一registry。Task 114只修改File Index，但验收必须证明生产不存在第二套registry。
- Phase F先深化显式watcher activation/ready、raw event-before-rebuild与真实`AbortSignal`，再与Task 118 Phase 3接入；Task 118 Phase 4的轻量列表不由Phase F实现，只验证列表读取不会触发File Index。
- Project/plain Workspace key 必须区分 target kind、canonical identity/root 和 scan policy；绝对 root 相同不等于 cache identity 相同。

## Planned Phases

### Phase A：Contract 与独立骨架

- 创建 `packages/file-snapshot-cache` 的 package、独立 tsconfig/vitest config、public API 草案和 fixture types。
- 建立 key/node/issue/projection/watcher/store/diagnostics 类型合同。
- 静态隔离测试阻止未来 import NeuroBook runtime。

### Phase B：Cache 内核与竞态测试

- 实现 entry 状态机、in-flight 去重、generation、debounce、subscriber、取消与关闭。
- 用 fake clock、controllable builder 和 fake watcher 穷举事件时序。
- 不接真实 NeuroBook builder。

### Phase C：Projection Store

- 实现 versioned codec、typed status、stale-while-revalidate 和 Node 原子 JSON store。
- 故障注入覆盖半写、rename 失败、损坏文件、schema mismatch 和 late build。

### Phase D：Benchmark 与资源审计

- 建 synthetic node/fixture tree 和 benchmark runner。
- 输出 JSON + Markdown baseline；复跑验证方差。
- 完成内存、handle、timer、watcher 和 subscriber 审计。

### Phase E：接入决策，不直接接入

- 报告 package 实际 API、复杂度、依赖、测试和 benchmark。
- 给出继续接入、缩小 package 或放弃替换的建议。
- 等待用户决策；本 Phase 不修改 NeuroBook adapter。

### Phase F：NeuroBook File Index adapter（由 Task 118 协调）

> Phase F 已获用户同意。Task 118 Phase 1已采用portable rename best-effort合同并完成最终退出证据，NeuroBook生产接入现可开始。Phase F的Interface深化对应Task 118 Phase 2，NeuroBook接入对应Task 118 Phase 3；Project列表去统计化与UI属于Task 118 Phase 4，不由本Phase重新实现。

- 先深化package/Adapter Interface：显式watcher activation与ready/error、idle TTL、raw event-before-rebuild seam、带target kind与scan policy的discriminated key，以及projection/store deletion review。
- `scanWorkspaceTree()`与递归visitor贯穿`AbortSignal`；close/abort必须停止真实I/O，不能只隔离late commit。
- 将完整 `WorkspaceFileNode[]` builder 注入 package；Project/plain Workspace 共用一个通用 cache 内核，但使用不同 key/policy，不能按绝对 root 串 snapshot。
- 将 File Index 迁入内置 ProjectModule。最低 ready 只建立 History event seam、cache/watcher 生命周期、ready/error/重试/diagnostics 与幂等 close；完整 tree build 作为 module-generation 管理的共享、可取消 warm-up。
- required Project Database、History、File Index在core identity后并行启动；`openProject()`等待三者最低ready。完整tree、D15等重工作不阻塞open，需要它们的数据面等待各Module共享Promise。
- plain Workspace 不挂 ProjectSession 或 Occupancy Lock：one-shot tree read不activation；首个SSE consumer取得引用计数activation lease，最后一个consumer释放，Nitro shutdown/HMR调用`closeAll()`。lease只持计数与activation handle，不保存snapshot/dirty/revision，因此不是第二个cache。
- raw event batch的`droppedEventCount > 0`必须触发History共享完整reconcile或等价补账；不能只把未丢弃events传给现有`reconcileWatcherBatch()`后静默漏账。
- 把旧 Project tree index 的通用生命周期迁入 package 后立即删除宿主的 Map/watcher/dirty/generation/timer/build Promise/subscriber/close 状态；原文件若保留，只允许作为薄 Adapter/DTO 组合。
- ProjectModule原位替代`registerProjectResourceOwner()`对File Index的init/warm-up/close责任；session generation持有精确handle，HTTP open route删除吞错式fire-and-forget预热。
- 以 key isolation、minimum-ready latency、warm-up abort/late-result、HMR replacement、现有 tree/History/SSE 回归、真实 Project Workspace benchmark、连续刷新内存/句柄曲线和旧 registry/双 cache 零命中验收。
- `/api/projects` 只做回归断言：连续读取 file build delta 为 0，且不打开 Project Database、History 或 File Index。
- 独立package可以继续保持“已验证”状态，但NeuroBook生产Adapter属于Task 118 Phase 1–8同一release train；Phase 8总门禁完成前不得单独发布接入结果。

## TODO / Follow-ups

- [x] Phase A：创建独立 package 与 contract。
- [x] Phase B：完成 cache 状态机、竞态和资源释放测试。
- [x] Phase C：完成 projection codec/store 和故障注入测试。
- [x] Phase D：完成 Node/Bun Windows benchmark 和报告。
- [x] Phase E：向用户提交性能/复杂度决策报告；建议可以进入 adapter 设计，但不直接接入。
- [x] 用户已确认进入 Phase F 设计；联合执行顺序见 Task 118。
- [x] Task 118 G1–G5、Phase 0 inventory及Lifecycle/Lock已完成；portable rename best-effort合同、stale lock与最终preflight/race证据已收口，Phase 1最终为110 passed / 1 skipped，Windows Bun reparse 1/1。
- [x] Task 118 Phase 1已采用portable rename并明确接受best-effort外部writer窗口，退出门禁完成。
- [x] Task 118 Phase 2独立Interface：one-shot read、activation ready/error/幂等/minimum-ready、raw event/dropped账本、incarnation close、idle TTL、scanner abort与discriminated key均已落地；关闭失败保留精确handle/entry并可由activation、单key或`closeAll()`重试；build failure进入有界diagnostics且下一批消费者共享重试；最终3 files / 40 tests与独立typecheck通过。
- [x] 删除无生产consumer的projection/store，并完成idle TTL、真实AbortSignal、discriminated target/scan-policy key与benchmark重生成。
- [x] File Index 已从 `registerProjectResourceOwner()` 迁入 ProjectModule，建立最低 ready、共享可取消 warm-up、generation/`AbortSignal`、迟到结果隔离和幂等 close。
- [x] `project-workspace-index.ts`已瘦身为薄Adapter；生产代码对第二套Map/watcher/dirty/generation/timer/build Promise/subscriber状态零命中。
- [x] plain Workspace只保留显式引用计数activation lease；Project数据面一律从ready session取得generation-scoped File Index handle。
- [x] History raw batch在`droppedEventCount > 0`时执行完整reconcile；`workspace_watch_ready`只来源于`activation.ready`，stable commit才发布`workspace_files_changed`。
- [ ] Task 118 Phase 4删除Project列表统计接线后，本任务只验收`/api/projects`不调用File Index；projection/store deletion review已完成，不再恢复该Interface。
- [x] 使用真实 Project Workspace 建立完整 `WorkspaceFileNode` builder、同 key 去重和 rebuild 内存基线。
- [ ] 真实扫描已明确不满足 Project 列表请求预算；完整 build 只作为已打开 Project Module 的共享可取消 warm-up。若还要降低首次索引时间，另行基于 benchmark 优化完整 builder；不能偷偷引入第二套统计 walker。
