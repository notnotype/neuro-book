# Homepage API Performance Optimization

## User Request

- 基于 `.agent/workspace/localhost.har` 与 `.agent/workspace/<主机>.har` 分析首页加载性能问题。
- 不只从前端减少重复请求入手，也要检查 API 设计和后端实现是否有优化空间。
- 特别关注：
  - `/api/auth/me` 在本地与生产环境下的耗时来源。
  - `/api/config/editor-snapshot`、`/api/workspace-files/tree`、`/api/agent/sessions` 的重复访问。
  - `/api/workspace-files/validate` 对前端的真实用途，以及为什么现在是全量 validate。

## Goal

- 将首页启动阶段的 API 请求从“多入口各自拉取、全量扫描、重复鉴权”收敛为明确的启动数据流。
- 删除独立 `workspace-files/validate` API，把校验变成 Project Workspace File Index 构建和文件事件更新时自动维护的 Issue Index。
- 给 auth/config/workspace-files/agent session 这些固定成本路径建立可验证的性能基线，避免继续把慢接口误判成单纯 SQLite 问题。

## Current State

- 本地 dev HAR 中首页共有 489 个请求，主要受 Nuxt dev/Vite 模块请求影响；生产 HAR 中同页面共有 46 个请求，更接近真实用户体验。
- 两个 HAR 都显示 API 重复模式一致：
  - `/api/config/editor-snapshot` 实际请求 6 次。
  - `/api/workspace-files/tree` 请求 2 次。
  - `/api/agent/sessions` 请求 2 次。
  - `/api/auth/me` 请求 2 次，且还有一次 `/api/_auth/session`。
  - `/api/workspace-files/validate?target=.&recursive=true` 在首页自动触发一次。
- 本地 `/api/auth/me` 的 286ms 主要来自浏览器连接阶段，服务端生成时间约 1ms；生产环境的 182ms 主要在 Waiting for server response，需要服务端分段计时确认 auth/session/db/config 的具体占比。
- 当前 `validateWorkspace()` 固定调用 `target=.&recursive=true`，结果写入 `workspaceIssues`，再由各 detail panel 按当前节点路径过滤展示。
- 当前 `workspace-files/validate` 的实现会扫描工作区并执行 schema、state、类型、兄弟冲突、重复 order、引用存在性等检查；它不是轻量接口，不适合默认位于首页首屏关键路径。

## Walkthrough

- 2026-05-26：用 `jq` 对比本地与生产 HAR，确认首页 API 重复请求和生产 API 等待时间分布。
- 2026-05-26：追踪前端调用点，确认 `workspaceIssues` 是 validate 对前端的主要消费形态；前端并不天然需要每次全量 validate，只是当前 store 把问题状态建模成全局数组。
- 2026-05-26：追踪后端实现，确认 `validateWorkspaceContentNodes()` 同时承担局部节点校验与全局一致性校验，API 合同粒度过粗。
- 2026-05-26：实现 `WorkspaceTreeSnapshot` 合同、Project Workspace File Index / Issue Index、轻量 config bootstrap、auth session 复用和前端运行校验入口删除。
- 2026-05-26：修复 `project.yaml` 格式错误会拖垮 `workspace-files/tree` 和保存链路的隐患：Project Path 定位不再读取 Project Manifest，manifest 解析错误作为 `project.yaml` issue 进入 Project Workspace Issue Index。
- 2026-05-26：继续收口坏 `project.yaml` 的修复路径：Project Config 读写、Project 删除和 Project Manifest 元数据更新不再依赖 manifest 当前可解析；Plot / SQL 等真实语义模块仍保持严格依赖。

## Decisions

- 删除独立 `workspace-files/validate` route；前端不再主动运行校验，问题状态由 `tree` snapshot 与 workspace-files SSE 自动同步。
- `project.yaml` 是用户可编辑文件；格式错误不应阻塞文件树、读取、写入等修复路径。文件系统 API 只负责按 Project Path 定位 Project Workspace，Project Manifest 合法性由 Project Workspace Issue Index 和需要展示元数据的接口处理。
- Project Config 与 Project 删除属于 Project Workspace 管理/修复链路，只需要 Project Path 指向现有目录；Project Manifest 元数据更新允许在坏 YAML 上覆盖写回合法 manifest。Plot/Story、Agent SQL 等依赖 Project 语义或 Project SQLite 的模块仍要求 manifest 合法。
- 删除的是 HTTP route，不删除校验核心能力：`validateWorkspaceContentNodes()` 仍被 `workspace node validate` CLI 依赖，尤其是 `--fix-missing` 写回能力；实现时应把校验规则抽成索引和 CLI 都能复用的内部模块。
- 首屏完成定义为：Project Workspace 文件树可见，已恢复的当前文件可读/可编辑；Agent drawer、完整 validate issues、完整设置快照不属于首屏完成条件。
- 客户端路由鉴权 `/api/auth/me` 是唯一串行门禁；页面账户菜单不应再次用 `/api/auth/me` 阻塞 Project Workspace 初始化。
- 将校验语义拆成三类：
  - 局部节点校验：用于打开详情面板或保存当前节点后快速反馈。
  - 工作区一致性校验：用于检查兄弟冲突、重复 order、结构问题。
  - 引用校验：用于检查 refs/state refs 是否断链，需要跨文件索引。
- 首页应优先从 `tree` 快照读取 Project Workspace Issue Index，而不是单独触发完整体检。
- Project Workspace Issue Index 是前端问题展示的读取事实；但它是从 Project Workspace 文件派生出来的 materialized index，丢失或失效后必须能从文件系统重建。
- Project Workspace 已有 chokidar watcher 与 SSE 文件事件流，可作为 Issue Index 增量刷新和失效标记的基础。
- 引入 Project Workspace File Index：`tree` 已经读取 Markdown frontmatter、state、refs、mtime、size，后续应把这些元信息沉淀为内存索引，而不是让 `tree` 与 `validate` 各自重复扫描。
- validate 不再作为前端主动调用的独立首屏接口；File Index 构建和 watcher 更新时同步维护 Issue Index。
- 绝大多数节点级 validate 可以直接复用 File Index 已有字段，例如 `frontmatter`、`frontmatterError`、`state.frontmatter`、`entryType`、`refs`，不需要二次读取文件。
- `tree` API 负责返回文件树视图、每个节点的轻量 issue summary，以及顶层完整 Issue Index。
- `tree` snapshot 的完整 Issue Index 语义只面向完整 Project Workspace 树；如果请求带 `target` / `type` / `depth`，必须明确返回的是过滤后的 issue projection，或者拒绝这些过滤参数，避免“部分 tree + 全量 issues”的歧义。
- workspace-files SSE 在推送文件变化时也推送受影响路径的 issue summary 更新，让前端不用再主动调用全量 validate。
- 为了保持前端简单，`tree` 响应可以直接包含完整 Issue Index；但完整 issues 应作为响应顶层数组返回，不要重复嵌入每个 node。
- 运行校验按钮可以删除：校验由 File Index 首次构建和 watcher 更新自动完成，刷新文件树等价于重新读取当前索引状态。
- File Index 不保存完整 Markdown 正文，只保存 frontmatter、state frontmatter、refs、words、mtime、size 等结构化派生字段；正文读取仍走文件读取接口。
- `tree` 响应暂时保留 content node 的 frontmatter，避免破坏现有详情面板；后续若 payload 过大再做字段裁剪。
- 内容节点级 issue 指向内容节点目录，文件解析级 issue 指向具体文件；issue `code` 保持稳定，`message` 可以继续使用中文。
- issue summary 采用 `selfCount` + `subtreeCount`；目录节点可展示子树问题，当前节点详情可展示自身问题。
- `change index.md` 时清理并重算当前内容节点问题；refs 变化先触发 debounce 后的引用校验 pass。
- delete / rename 第一版触发 Issue Index 全量重建，避免引用断链、兄弟冲突、order 和目录 summary 漏算。
- `tree` snapshot 与 SSE 更新都携带 `revision`，前端用它处理乱序事件和过期状态。
- 自动校验中的单节点解析失败应转成 issue，不应导致整个 `tree` 请求失败。
- 实现采用破坏式同步迁移：旧 `scanWorkspaceTree()` 纯数组合同、后端调用点和前端调用点一起迁移到 File Index / Tree Snapshot 合同，早暴露类型和测试问题。
- 删除旧 `/api/workspace-files/validate` route，不保留兼容空壳。
- 不再设计面向前端的 validate 模式；`node`、`workspace`、`references`、`all` 只作为索引内部重算策略，必要时再抽成内部函数。
- `workspaceKind=user-assets` 继续可以读取文件树，但不运行 Project Workspace 内容节点 Issue Index；返回 snapshot 外壳时 `issues` 为空，或只包含 user-assets 自己未来定义的资源问题。
- `editor-snapshot` 优先拆轻量 bootstrap；请求 coalescing 作为低风险兜底，避免同一启动窗口内重复打完整快照。
- auth 慢接口不能直接归因 SQLite；必须先加服务端 timing，把 config、session decode、user query、middleware 固定成本拆开测。

## Architecture Review Findings

- HTTP validate route 与 CLI validate 核心必须分开处理。
  - 现有 active Agent workspace CLI `workspace node validate` 调用 `validateWorkspaceContentNodes()`。
  - 计划中的“删除 validate”只表示删除 `/api/workspace-files/validate` 和前端“运行校验”入口，不应删除 CLI 合同、`--recursive`、`--fix-missing` 或校验测试。
  - 推荐把规则层命名为 `workspace-content-validation`，让 Project Workspace File Index 调用纯规则函数，CLI 继续通过同一规则函数输出 issues / fixedPaths。
- `tree` 的过滤参数需要重新定 contract。
  - 当前 `GET /api/workspace-files/tree` 支持 `target`、`type`、`depth`；新计划又希望顶层返回完整 Issue Index。
  - 如果返回“过滤后的 nodes + 全量 issues”，前端和 API 消费者会误判不可见节点的问题。
  - 推荐第一版首页使用完整 snapshot；过滤参数要么暂时拒绝，要么返回过滤后的 issue projection，并在 DTO 上标注 `scope`。
- `workspaceKind=user-assets` 不能直接套 Project Workspace Issue Index。
  - user-assets 是 Workspace Root `.nbook` 的资源覆盖区，不是 Project Workspace。
  - 推荐共用 `WorkspaceTreeSnapshot` 外壳，但 `issues` 第一版为空；不要把 lorebook/manuscript 内容节点规则跑到 user-assets。
- coalescing 需要同时做前端和后端。
  - Pinia in-flight Promise 只能合并同一浏览器页内的重复请求。
  - Project Workspace File Index manager 也要按 root 合并 in-flight build，避免两个 HTTP 请求同时触发两次全量扫描。
- watcher 更新要有重建兜底。
  - chokidar 事件可以增量更新普通文件修改，但 rename/move 常表现为 unlink + add，且引用、兄弟冲突、重复 order 都可能跨目录受影响。
  - 第一版应对 delete / rename / move / addDir / unlinkDir 直接全量重建 Issue Index，后续再优化局部范围。
- `revision` 应该属于 File Index，而不是 SSE 自己的 sequence。
  - 现有 SSE `sequence` 只是 watcher 推送序号。
  - 新 snapshot / SSE 更新需要携带同一个 index revision；前端只用 index revision 判断 issues/tree 是否过期。
- `issueSummary` 计算需要覆盖祖先路径。
  - 单个 issue 指向 `lorebook/note/foo/` 或 `lorebook/note/foo/state.md` 时，文件树上的父目录也需要更新 `subtreeCount`。
  - 实现时要基于 normalized path 建 ancestor chain，不能只更新 issue.path 本身。
- `auth/me` 优化优先级不应超过串行链路治理。
  - 生产 Waiting 慢需要 server timing，但首页最明显的浪费是第二次 `syncAuthSession()` 串行阻塞 workspace 初始化。
  - 推荐先复用 middleware session 或并行化账户菜单数据，再决定是否做用户 TTL cache。
- `editor-snapshot` 的问题更像 API 粒度过粗。
  - 首页只需要 default model label、enabled models、default profile key 这类 bootstrap 字段。
  - 设置弹窗才需要完整 editor snapshot；Agent drawer 解析默认 profile 不应反复拉完整设置快照。

## First Screen Loading Analysis

### Critical path

当前首页首屏不是所有 API 平等并行。真正影响首屏时间的链路应按“是否阻塞后续请求/渲染”排序：

1. HTML 文档请求
   - 生产 HAR 中文档请求约 172ms。
   - `auth: true` 时服务端 middleware 会先确认当前用户，未通过会重定向到 `/login`。
   - 这一步是后续 JS 下载、页面挂载、客户端请求的前置条件。
2. 客户端路由鉴权 `/api/auth/me`
   - `app/middleware/auth.global.ts` 会在客户端路由进入时请求 `/api/auth/me`。
   - 该请求通过前，页面初始化逻辑不会正常进入。
   - 因此这不是普通并发 API，而是一个串行门禁。
3. 页面 `onMounted()` 中的 `syncAuthSession()`
   - `app/pages/index.vue` 当前先 `await syncAuthSession()`，再 `await initializeWorkspaceFromRoute()`、`await syncDefaultModelLabel()`、`await validateWorkspace()`。
   - 这会导致第二次 `/api/auth/me` 串行阻塞 workspace tree、config、validate 等后续请求。
   - 这个请求对右上角账户菜单有用，但不应该再次阻塞 workspace 首屏数据。
4. Workspace 首屏数据
   - `workspace-files/tree` 是左侧文件树和已打开 tab 恢复的关键数据，影响可交互时间。
   - `config/editor-snapshot` 影响模型展示、Agent 默认 profile、可选模型；它重要，但当前重复请求过多。
   - `agent/sessions` 只影响 Agent drawer，默认不应阻塞主编辑区首屏。
5. 非首屏关键数据
   - `workspace-files/validate` 只用于生成 Project Workspace Issue Index 并在详情面板展示问题，不应阻塞首屏。
   - `agent/sessions/:id` 只用于恢复 Agent 会话内容，不应影响文件树和编辑器可用。

### Impact ranking

- Highest impact:
  - 去掉第二次串行 `/api/auth/me`，或让页面复用路由 middleware 的 session 结果。
  - 让 workspace tree 与轻量 config bootstrap 尽早并行，不被账户菜单同步阻塞。
- High impact:
  - `editor-snapshot` 6 次收敛为 1 次轻量 bootstrap。
  - `workspace-files/tree` 2 次收敛为 1 次，并加 in-flight coalescing。
- Medium impact:
  - `agent/sessions` 只在 Agent drawer 打开时加载，或初始化时不阻塞主界面。
  - 首页不自动全量 validate，改为从 `tree` 快照读取 Project Workspace Issue Index。
- Measurement required:
  - `/api/auth/me` 生产 Waiting 约 180ms，需要 server timing 拆分后再决定是否做用户短 TTL cache。

## Proposed API Plan

### 1. Tree Snapshot 承载 Issue Index

- 新增或调整 API 合同：
  - `GET /api/workspace-files/tree`
    - 返回 Project Workspace File Index 的文件树投影。
    - 同时返回完整 Project Workspace Issue Index。
    - 每个 node 可带轻量 `issueSummary`，用于文件树红点/计数。
  - 删除 `GET /api/workspace-files/validate`。
    - 校验由 File Index 构建、watcher 更新和 Issue Index 重建过程内部触发。
    - 不再保留用户可见的“运行校验”入口。

### 2. Index 驱动校验语义

- `node`
  - 只检查目标内容节点本身：frontmatter、state、schema、节点类型、基础引用格式。
  - 在 watcher 收到单文件变更或保存当前节点后更新。
- `workspace`
  - 检查兄弟命名冲突、文件/目录冲突、重复 order、内容节点结构问题。
  - 在目录结构变化、重命名、删除、移动后更新。
- `references`
  - 检查 refs/state refs 的目标是否存在。
  - 后端应基于扫描索引或缓存索引判断，不要对每个 ref 反复 `existsSync`。
- `all`
   - 完整体检。
  - 用于 File Index 首次构建、刷新文件树、watcher 发现无法局部归因的变化。
- 这些不是公开 API 模式，只是内部重算范围。
- 首轮可以在 File Index 构建时直接跑 `all`，watch 更新时先跑受影响路径相关校验；遇到删除/重命名等难以局部判断的事件时直接重建，优先保证问题状态正确。

### 3. Workspace 扫描复用

- 新建 `server/workspace-files/project-workspace-index.ts`，为 `workspace-files/tree`、watch 更新与校验规则建立共享的 Project Workspace File Index。
- 同一个 Project Workspace 在短时间内只做一次完整扫描；后续由 watcher 事件驱动失效或增量更新。
- File Index 中预先构建：
  - `nodesByPath`
  - `contentNodes`
  - `existingPathSet`
  - `siblingsByDirectory`
  - `refsBySource`
  - `issueSummaryByPath`
  - `revision`
- File Index 不保存完整 Markdown 正文：
  - 保存 `frontmatter`、`frontmatterError`、`state.frontmatter`、`state.frontmatterError`、`refs`、`words`、`mtimeMs`、`size`。
  - 正文仍通过 `readWorkspaceTextFile()` 这类文件读取接口按需读取。
- 校验规则优先消费 File Index 字段：
  - frontmatter schema 使用 `node.frontmatter` / `node.frontmatterError`。
  - state schema 使用 `node.state.frontmatter` / `node.state.frontmatterError`。
  - 节点类型校验使用 `node.entryType`、`node.path`、`node.contentNode`。
  - 引用校验使用 `node.refs` 与 `existingPathSet`。
- 引用校验优先查 `existingPathSet`，减少同步文件系统调用。
- `tree` API 从 File Index 投影出文件树。
- `tree` 响应顶层返回 Issue Index，避免前端再发独立 issues 请求。
- watcher 更新 File Index 后同步刷新相关 Issue Index。
- 刷新文件树或 watcher 触发时自动读取/更新 File Index 与 Issue Index，不再依赖旧 validate API。
- 旧 `scanWorkspaceTree()` 相关调用点同步迁移，不保留长期兼容层。

### 4. 首页 Bootstrap 合同

- 收敛首页启动数据：
  - auth session 只保留一个前端来源。
  - 新增轻量 bootstrap，让 model label、enabled models、default profile key 不再各自请求完整 `editor-snapshot`。
  - agent session 列表由 `ensureSessionReady` 返回或共享，避免初始化后再拉一次。
  - workspace tree 加 in-flight coalescing，避免 store 初始化与面板 mount 竞态重复。
- 轻量 bootstrap：新增 `GET /api/config/bootstrap` 或在现有 `editor-snapshot` 上加 `fields`，只返回首页必需字段，减少 payload 与后端计算。
- 请求 coalescing：同一个 query 在 in-flight 时复用同一个 Promise，避免多个组件同时发出重复请求；它不改变 API 合同，只是低风险止血。

### 5. Auth 与后端固定成本测量

- 给生产 API 增加 `server-timing`：
  - `auth.enabled`
  - `auth.session`
  - `auth.user`
  - `config.read`
  - `workspace.scan`
  - `workspace.validate`
- 对 `isAuthEnabled()` 使用进程级配置缓存，文件变更或保存配置后失效。
- 对当前用户查询是否做短 TTL cache 需要单独评估：
  - 优点：减少首页多 API 并发时的重复 DB 查询。
  - 风险：禁用用户或 sessionVersion 变化不会在 TTL 内立刻生效。
  - 建议先测量，再决定是否引入。

## Phased Implementation Plan

### Phase 0: Measurement Baseline

- Difficulty: Low
- Expected benefit: High confidence, prevents wrong optimization target.
- Scope:
  - 给 `/api/auth/me`、`workspace-files/tree`、`config/editor-snapshot` 加 server timing。
  - 在删除 validate route 前临时记录一次现有 `/api/workspace-files/validate` 耗时，作为迁移收益基线。
  - 记录本地与生产同页面 HAR 的 API 请求次数、critical path、server timing。
- Verify:
  - HAR 中能区分 browser connect/wait 与服务端 auth/config/db/workspace scan 耗时。
  - 能回答生产 `/api/auth/me` 180ms 是否主要来自 session、SQLite 查询、配置读取或中间件。

### Phase 1: Remove First-Screen Serial Blockers

- Difficulty: Low to Medium
- Expected benefit: Highest for perceived first screen speed.
- Scope:
  - 复用客户端路由鉴权结果，避免 `index.vue` 的 `syncAuthSession()` 再次串行阻塞 workspace 初始化。
  - 右上角账户菜单读取 session 不阻塞 `initializeWorkspaceFromRoute()`。
  - `agent/sessions` 初始化从主编辑区首屏路径中移出，只在 Agent drawer 打开或空闲时加载。
- Verify:
  - HAR 中 `/api/auth/me` 从 2 次降到 1 次，且 workspace tree/config 不再等待第二次 auth。
  - 主编辑区文件树出现时间提前。

### Phase 2: Coalesce Duplicate Bootstrap Requests

- Difficulty: Low to Medium
- Expected benefit: High, reduces request count and repeated auth middleware cost.
- Scope:
  - `workspace-files/tree` 增加前端 in-flight coalescing，避免 store 初始化与面板 mount 并发重复。
  - `editor-snapshot` 首页消费收敛为单次轻量 bootstrap。
  - `ensureSessionReady()` 返回已刷新 session list，避免之后立即 `refreshSessions()`。
- Verify:
  - HAR 中 `editor-snapshot` 从 6 次降到 1 次。
  - `workspace-files/tree` 从 2 次降到 1 次。
  - `agent/sessions` 从 2 次降到 0-1 次，取决于 Agent drawer 是否首屏打开。

### Phase 3: Define Tree Snapshot Contract

- Difficulty: Medium
- Expected benefit: High, gives front-end and back-end a single startup data contract.
- Scope:
  - 调整 `GET /api/workspace-files/tree` 响应，从纯 `WorkspaceFileNode[]` 改为 `WorkspaceTreeSnapshot`。
  - `WorkspaceTreeSnapshot` 包含 `nodes`、`issues`、`revision`、`validatedAt`。
  - `WorkspaceFileNode` 增加可选 `issueSummary`，包括 `selfCount`、`subtreeCount`、`count`、`highestLevel`。
  - 明确完整 Project Workspace snapshot 与过滤查询的关系；第一版首页只使用完整 snapshot。
  - `workspaceKind=user-assets` 返回同样 snapshot 外壳，但不运行 Project Workspace Issue Index。
  - 若未来 issues 体积过大，再补可选 `includeIssues=summary | full` 或独立 issues API。
- Verify:
  - 前后端 DTO 类型一次性暴露所有旧数组合同调用点。
  - 完整 Project Workspace 请求返回 nodes、issues、revision、validatedAt。
  - user-assets 请求返回 nodes、空 issues、revision、validatedAt。
  - 过滤参数的行为有明确测试或显式拒绝。

### Phase 4: Move Validate Into File Index

- Difficulty: High
- Expected benefit: Medium to High, removes non-critical workspace scan from critical path and reduces duplicate IO.
- Scope:
  - 建立 Project Workspace File Index，复用 `tree`、watch 更新与 Issue Index 的扫描结果。
  - File Index 首次构建时生成 Issue Index。
  - 用 `existingPathSet` 替代引用校验中的大量同步 `existsSync`。
  - Project Workspace 文件事件流驱动 Issue Index 失效或增量刷新。
  - 首页不再自动调用 `target=.&recursive=true` 的全量 validate。
  - 前端从 `tree` 响应中一次拿到 nodes、完整 issues 和 node issue summary。
  - 删除用户可见的“运行校验”入口。
  - 删除 `GET /api/workspace-files/validate` route，但保留 CLI 使用的校验核心。
  - 接入已有 Project Workspace 文件事件流，文件变化后更新 File Index 与相关 Issue Index。
- Verify:
  - 首屏 HAR 中不再出现 `/api/workspace-files/validate?...recursive=true`。
  - 详情面板仍能从 `tree` 响应中的 Issue Index 展示当前节点相关问题。
  - watcher 更新后文件树与问题列表正常刷新。
  - 单个 Markdown frontmatter 损坏时，`tree` 仍返回，损坏节点上出现对应 issue。
  - `workspace node validate --recursive` 与 `--fix-missing` 仍可用。
  - 仓库内不再存在前端或后端调用旧 HTTP validate route 的路径。
  - 大 Project Workspace 下 `tree` snapshot 与 Issue Index 总耗时下降。
  - 引用多的 workspace 中 validate 不再随引用数线性触发大量磁盘 exists。

### Phase 5: Auth and Config Fixed-Cost Optimization

- Difficulty: Medium
- Expected benefit: Medium to High, depends on measurement result.
- Scope:
  - 对 `isAuthEnabled()` 加进程级配置缓存。
  - 如果 server timing 证明 user query 是主要瓶颈，再评估当前用户短 TTL cache。
  - 新增轻量 config bootstrap，避免首页和 Agent drawer 多次拉完整 `editor-snapshot`。
- Verify:
  - auth cache 不破坏退出登录、禁用用户、sessionVersion 变更等安全语义。
  - 首页不再因为模型 label、默认 profile key 多次请求完整 `editor-snapshot`。

## Files Changed

- `docs/tasks/archived/homepage-api-performance/README.md`
- `shared/dto/workspace-tree.dto.ts`
- `server/workspace-files/project-workspace-index.ts`
- `server/api/workspace-files/tree.get.ts`
- `app/stores/novel-ide.ts`
- `app/pages/index.vue`

## Verification

- 计划阶段验证：
  - 已从本地与生产 HAR 抽取请求数量、耗时分布、重复接口。
  - 已追踪前端 `workspaceIssues` 消费点。
  - 已追踪 `validateWorkspaceContentNodes()` 后端校验范围。
- 后续实现阶段验证：
  - 使用同一页面重新导出 HAR，对比 API 请求次数。
  - 对生产 API 响应检查 `server-timing`，确认慢点是否从 auth/db/config/workspace scan 中收敛。
  - 对 Project Workspace File Index 构建、Issue Index 生成、watch 更新重算补后端测试。
  - 对首页初始化补前端单元或组件测试，确认不再自动全量 validate。
- 2026-05-26 实现阶段验证：
  - `bun run typecheck` 通过。
  - `bun test server/workspace-files/workspace-file-events.test.ts` 通过。
  - 使用临时脚本验证 `readProjectWorkspaceTreeSnapshot()` 会返回 issues / issueSummary，`readPlainWorkspaceTreeSnapshot()` 返回空 issues。
  - `bun test server/workspace-files/workspace-files.test.ts server/workspace-files/workspace-file-events.test.ts` 通过。
  - 旧 `writeNovelWorkspaceMetadata` / `workspace.yaml` 测试已迁移到当前 `project.yaml` / Project Workspace 创建合同。
  - 新增 Project Workspace File Index 失效后重新读取文件与 issues 的回归测试。
  - 新增坏 `project.yaml` 回归测试：Project Workspace 根目录仍可解析、tree snapshot 返回 `invalid-project-manifest` issue、Project 列表遇到单个坏 manifest 不整批失败。
  - 新增坏 `project.yaml` 收口测试：Project Config 仍可读写，Project Manifest 元数据更新可覆盖修复坏 YAML。

## TODO / Follow-ups

- [x] Phase 0：为 auth/config/workspace scan 加 server timing；HAR baseline 需用户重新导出页面 HAR 后对比。
- [x] Phase 1：移除第二次串行 `/api/auth/me` 对 workspace 初始化的阻塞。
- [x] Phase 2：收敛 `editor-snapshot`、`workspace-files/tree`、`agent/sessions` 的重复请求。
- [x] Phase 3：将 `workspace-files/tree` 响应改为包含 nodes、issues、revision、validatedAt 的 snapshot，并明确过滤查询与 user-assets 行为。
- [x] Phase 4：实现 Project Workspace File Index，首页移除自动全量 validate，改为从 tree / SSE 读取 Issue Index。
- [x] Phase 4：删除 HTTP `workspace-files/validate` route，移除用户可见的运行校验入口，但保留 CLI 校验核心。
- [x] Phase 5：新增轻量 config bootstrap；auth 用户 TTL cache 仍按 server timing 结果后续决定。
- [x] 清理 `workspace-files.test.ts` 中旧 `writeNovelWorkspaceMetadata` / `workspace.yaml` legacy 测试，并迁移到 `project.yaml` 合同。
- [x] 拆分 Project Path 定位与 Project Manifest 校验，避免坏 `project.yaml` 阻塞文件树和保存修复链路。
- [x] 收口 Project Config、Project 删除和 Project Manifest 元数据更新，避免坏 `project.yaml` 阻塞管理/修复链路。
- [ ] 重新导出本地和生产 HAR，确认首屏请求数量与 Server-Timing 改善。
