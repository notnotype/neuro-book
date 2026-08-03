# Project Workspace Index Watcher

## User Request

- 排查 `reference/silly-tavern` 外部导入后前端文件树不更新的问题。
- 明确 Project Workspace tree snapshot 的内存缓存是否由 watcher 保持最新。
- 设计更合理的架构：Project Workspace index 自己 watch 文件变化并维护最新缓存；SSE 和其他组件直接依赖这个缓存，而不是由 SSE 负责刷新缓存。
- 本次实现硬切，不做 legacy 兼容；user-assets 也纳入同一套 index watcher 机制。

## Goal

让 workspace tree index 成为 Project Workspace 和 user-assets 文件树 snapshot 的主动维护者：它负责按 root 管理内存 index、watcher、dirty/rebuild 状态和 revision；`tree` API、SSE 文件事件流、前端同步都只消费这个 index。成功标准是外部 CLI 直接写入 Project Workspace 文件后，即使写入没有经过 workspace mutation API，只要应用进程内该 root 的 index 已启动，就能通过 watcher 自动刷新缓存并让前端收到更新；user-assets 文件变化也走同一套 watcher/index/subscriber 机制。

验证面：

- 后端单测证明 index watcher 收到外部 `reference/silly-tavern/...` 文件写入后会重建 snapshot。
- 后端单测证明没有 SSE 订阅时，index 仍能 watch 并更新缓存。
- SSE route 单测证明它订阅 index 更新，不再直接负责 `refreshProjectWorkspaceIndex()`。
- 现有 workspace mutation API、tree API、upload/write/rename/delete 路径不回归。

## Current State

- `server/workspace-files/project-workspace-index.ts` 当前只维护按 root 的内存缓存：
  - `readProjectWorkspaceTreeSnapshot()` 命中 `entry.index` 时直接返回缓存。
  - `refreshProjectWorkspaceIndex()` 会全量 rebuild 并更新缓存。
  - `invalidateProjectWorkspaceIndexAfterMutation()` 只清空缓存，等待下一次读取重建。
- `project-workspace-index.ts` 自身没有 watcher。
- `server/workspace-files/workspace-file-events.ts` 当前按 workspace root 创建 chokidar watcher，但 watcher 生命周期挂在 `subscribeWorkspaceFileEvents()` 上。
- `server/api/workspace-files/events.get.ts` 当前在收到 `workspace_files_changed` 后调用 `refreshProjectWorkspaceIndex()`，然后把 revision / validatedAt 附到 SSE payload 上。
- 因此当前实际链路是：前端 SSE 在线时，SSE route 顺手刷新 index；没有 SSE 订阅或 watcher 漏事件时，外部 CLI 直接写磁盘不会让 index 知道。

## Walkthrough

- 2026-05-30：确认 `reference/silly-tavern` 不属于扫描过滤路径；普通 `scanWorkspaceTree()` 能扫描 Project Workspace 下的 `reference/`。
- 2026-05-30：确认当前 Project Workspace tree snapshot 缓存不是由 index 自己 watch，而是依赖 SSE route 收到文件事件后刷新。
- 2026-05-30：讨论并确定更合理的架构方向：watcher 生命周期应属于 Project Workspace index manager，SSE 只消费 index 更新。
- 2026-05-30：实现硬切：`project-workspace-index.ts` 现在按 root 管理 watcher、dirty 状态、debounce 全量 rebuild、revision 和 subscribers；Project Workspace 与 user-assets 复用同一套 index watcher。
- 2026-05-30：`events.get.ts` 改为订阅 `subscribeWorkspaceTreeIndex()`，不再接管 chokidar watcher，也不再收到 SSE 文件事件后调用 `refreshProjectWorkspaceIndex()`；`tree.get.ts` 删除 `refresh` query 语义。
- 2026-05-30：前端 `loadWorkspaceTree()` 和两个 workspace 面板的手动刷新入口删除 `{ refresh: true }`，统一通过 index read 合同拿当前 snapshot。
- 2026-05-30：删除旧 `workspace-file-events.ts` runtime 文件；原测试迁移为 index watcher subscription 测试。
- 2026-05-30：完成实现审计时修复一个 rebuild race：若 watcher debounce flush 时已有 rebuild 在跑，flush 会等待旧 build，发现 entry 仍 dirty 时再执行一次 rebuild，避免把旧 snapshot 的 revision 当成文件事件后的 index 事件推给 SSE。
- 2026-05-30：针对“直接在系统文件系统删除 `reference/silly-tavern` 后前端不实时更新”复查真实链路：后端 index watcher 能收到 `unlinkDir reference/silly-tavern` 并重建缓存，但 SSE route 会等待 watcher `ready` 后才返回响应；大型 Project Workspace 下初始 watch 扫描会拖住 SSE 建连，页面实际还没订阅上事件。修复为订阅先注册并立即返回 SSE 响应，`workspace_watch_ready` 改为 watcher ready 后异步推送。
- 2026-05-30：文件事件触发的前端 `syncWorkspaceFromDisk()` 改为绕过已有同 workspace 的 pending tree 请求，确保“事件之后”一定发起新 tree 读取，避免复用事件之前发出的旧快照。
- 2026-07-18：文件树扫描契约收口为弱一致 snapshot。`readdir` 后消失的 SQLite WAL/SHM 等节点、以及显式 target 在存在性检查后消失的情况，只在错误码为 `ENOENT` 时跳过；`EACCES`、真实路径越界和磁盘错误继续抛出。该修复由扫描 Module 自身吸收实时文件系统竞态，不串行化 Tree 与 History 预热。
- 2026-07-18：显式 validation target 在判断存在性前先应用 Project Runtime Artifact 硬排除，因此已存在或已消失的 artifact 都不会生成文件树节点、`missing-target` 或 Project Workspace Issue；`.gitignore` 否定规则不能恢复它们。

## Decisions

- 本次硬切，不保留旧 SSE-owned watcher 作为 Project Workspace 或 user-assets 的兼容路径。
- `ProjectWorkspaceIndex` 应升级为 workspace tree index，并成为 Project Workspace 与 user-assets 文件树 snapshot 的单一内存真相源。
- Watcher 生命周期应从 SSE route 挪到 workspace tree index manager。
- 一个 root 一旦被 `tree` API 读取就启动 watcher，并常驻到进程退出、root 删除或测试显式关闭；第一版不做 subscriber-count 绑定、idle timeout 或 LRU。
- 第一版所有文件变化 debounce 后全量 rebuild，不做局部增量。
- SSE 不再负责刷新缓存，只负责订阅 index 更新并推送给前端。
- 不保留 `tree?refresh=1` 这种显式刷新查询语义；手动刷新也应通过 index manager 的 read/rebuild 合同拿到当前真相。
- user-assets 纳入同一套 index watcher 机制，但 user-assets snapshot 仍不运行 Project Workspace 内容节点 Issue Index。
- watcher 不能承诺“永远最新”，只能承诺正常情况下主动刷新；仍需 dirty 标记、手动 refresh、watcher error 后 read-time rebuild 兜底。
- 单次 Project Workspace File Index build 也不承诺强一致；扫描期间消失的节点可从该 snapshot 缺席，但只有 `ENOENT` 可被忽略，其他 I/O 与 containment 错误必须失败。
- 第一版遇到任何文件结构变化都可以 debounce 后全量 rebuild，不做局部增量，优先保证正确性。

## Proposed Architecture

### Index Entry

每个 workspace root 对应一个 index entry。Project Workspace 和 user-assets 共用 entry 生命周期、watcher、dirty/rebuild 和 subscriber 机制；区别只在 snapshot builder 是否运行 Project Workspace Issue Index。建议包含：

```ts
type ProjectWorkspaceIndexEntry = {
    root: string;
    index: ProjectWorkspaceIndex | null;
    buildPromise: Promise<ProjectWorkspaceIndex> | null;
    watcher: FSWatcher | null;
    subscribers: Set<ProjectWorkspaceIndexSubscriber>;
    dirty: boolean;
    rebuildTimer: ReturnType<typeof setTimeout> | null;
    revision: number;
    lastWatchError: string | null;
};
```

### Public API Shape

建议收敛到这些内部 API：

```ts
readWorkspaceTreeSnapshot(options)
rebuildWorkspaceTreeIndex(options)
invalidateProjectWorkspaceIndexAfterMutation(input)
subscribeWorkspaceTreeIndex(options, handler)
closeWorkspaceTreeIndex(root)
```

语义：

- `readWorkspaceTreeSnapshot()`：如果没有 index、index dirty、或 watcher 出过错，则 rebuild 后返回；否则返回缓存。
- `rebuildWorkspaceTreeIndex()`：内部全量 rebuild，不暴露为兼容式 HTTP query。
- `invalidateProjectWorkspaceIndexAfterMutation()`：标记 dirty，并可安排 debounce rebuild；对于同进程 mutation，仍可直接 rebuild 或让下一次 read rebuild。
- `subscribeWorkspaceTreeIndex()`：确保 entry 和 watcher 已启动；订阅 index snapshot 更新；SSE route 使用这个 API。
- `closeWorkspaceTreeIndex()`：测试、Project 删除或 user-assets root 删除时释放 watcher。

### Watcher Behavior

- watcher 由 index entry 创建，监听 Project Workspace root 或 user-assets root。
- 仍过滤 `.git`。
- 收到 `add/change/unlink/addDir/unlinkDir` 后：
  - 记录 `WorkspaceFileChangeEventDto[]`。
  - 标记 `dirty = true`。
  - debounce 后调用 `rebuildProjectWorkspaceIndex()`。
  - rebuild 成功后 `revision + 1`，更新 `entry.index`，通知 subscribers。
- watcher `error`：
  - 记录 `lastWatchError`。
  - 标记 `dirty = true`。
  - 下一次 `readProjectWorkspaceTreeSnapshot()` 必须 rebuild。

### SSE Behavior

`events.get.ts` 不再直接调用 `refreshProjectWorkspaceIndex()`，也不再使用旧 `subscribeWorkspaceFileEvents()` 作为 Project Workspace 或 user-assets 的长期入口。

新流程：

```text
GET /api/workspace-files/events
-> resolve Project Workspace root
-> subscribeWorkspaceTreeIndex(root, handler)
-> handler 收到 index changed snapshot
-> push workspace_files_changed + revision + validatedAt
```

SSE payload 仍应包含原始 changed paths；index watcher 记录 debounce 窗口内的 `WorkspaceFileChangeEventDto[]`，rebuild 成功后连同 revision / validatedAt 一起发给 subscribers。

长期更干净的做法是让 SSE payload 直接携带 index revision，并允许前端按 revision 决定是否 reload tree。

## Implementation Plan

### Phase 1: Move Watch Ownership Into Index

- 在 `project-workspace-index.ts` 中扩展 entry，加入 watcher、subscribers、dirty 和 rebuildTimer。
- 抽出 `ensureProjectWorkspaceIndexEntry(root)`，统一创建缓存 entry。
- 在 entry 创建或首次 subscribe/read 时启动 watcher。
- 硬切删除 Project Workspace 和 user-assets 对旧 `workspace-file-events.ts` watcher ownership 的依赖；如保留该文件，只能作为迁移过程中被重命名/收敛后的内部 helper，不保留旧 public contract。

验证：

- 新增测试：先 `readProjectWorkspaceTreeSnapshot()` 建缓存，再直接 `fs.writeFile(reference/silly-tavern/foo.md)`，等待 watcher 后再次 read，必须看到新文件。
- 新增测试：无 SSE 订阅时 watcher 仍能更新 index。
- 新增测试：user-assets 普通文件变化也会更新同一套 tree index，但 issues 保持为空。

### Phase 2: Let SSE Consume Index Updates

- 新增 `subscribeWorkspaceTreeIndex(root, handler)`。
- 改 `server/api/workspace-files/events.get.ts`，Project Workspace 和 user-assets 都使用 index subscription。
- 保留 close/unsubscribe 清理逻辑，但最后一个 SSE subscriber 断开时只移除 subscriber，不关闭 root watcher；watcher 跟 index entry 生命周期一致。

验证：

- 更新 `events.get.test.ts`，断开连接后只清理 SSE subscriber，不销毁 index entry。
- 测试文件事件会导致 SSE payload 携带新的 revision / validatedAt。

### Phase 3: Remove Duplicate Watcher Responsibility

- 清理或重命名 `workspace-file-events.ts`，避免代码层继续表达“SSE 拥有 watcher”。
- 清理 `events.get.ts` 中“收到原始 FS 事件后刷新 index”的旧逻辑。
- 清理 `tree.get.ts` 中 `refresh=1` 查询语义；不保留 legacy refresh query。

验证：

- 搜索确认 Project Workspace 和 user-assets 实时链路都不再直接依赖 `workspace-file-events.ts` 刷新 index。
- `server/workspace-files/workspace-file-events.test.ts` 迁移为 index watcher 测试，或删除旧测试。

### Phase 4: Read-Time Safety And Manual Refresh

- `readProjectWorkspaceTreeSnapshot()` 遇到 `dirty` 或 `lastWatchError` 时自动 rebuild。
- Project 删除、Project rename、user-assets root 删除或 root 不存在时关闭并删除 entry。
- 前端手动刷新仍调用 `loadWorkspaceTree()`，但不再传 `refresh=1`；如果 index dirty 或 watcher error，read-time rebuild 会兜底。

验证：

- watcher error 后 read 会 rebuild。
- Project root 删除后 entry 会清理，不留下 watcher。
- 手动 refresh 仍能看到磁盘当前状态，但不依赖 HTTP refresh query。

## Files To Change

- `server/workspace-files/project-workspace-index.ts`
- `server/workspace-files/workspace-file-events.ts`
- `server/api/workspace-files/events.get.ts`
- `server/api/workspace-files/tree.get.ts`
- `server/workspace-files/workspace-files.test.ts`
- `server/workspace-files/workspace-file-events.test.ts`
- `server/api/workspace-files/events.get.test.ts`
- `app/stores/novel-ide.ts`

## Verification

计划阶段已验证：

- 当前 `project-workspace-index.ts` 没有 watcher。
- 当前 `events.get.ts` 会在 SSE 文件事件到达时调用 `refreshProjectWorkspaceIndex()`。
- 当前 `readProjectWorkspaceTreeSnapshot()` 命中 `entry.index` 会直接返回缓存。

实现阶段已运行：

- 2026-07-18：`workspace-tree-scan-race.test.ts` 与 `runtime-generated-path.test.ts` 8/8 通过，覆盖子节点和显式 target 的 `ENOENT` 弱一致跳过、显式/递归 runtime artifact target 硬排除、`.gitignore` 否定规则无权恢复 artifact，以及显式 target `EACCES` 原样失败。
- `bun test server/workspace-files/workspace-files.test.ts -t "Project Workspace tree|plain workspace tree|user-assets tree index"`：通过，覆盖 Project Workspace snapshot、外部写入 `reference/silly-tavern/...` 后 watcher 更新缓存、user-assets watcher 更新缓存且 issues 为空。
- `bun test server/workspace-files/workspace-file-events.test.ts server/api/workspace-files/events.get.test.ts`：通过，覆盖 index subscription 事件推送和 SSE 断开清理。
- `bun test server/workspace-files/workspace-files.test.ts`：通过，58 个底层 workspace-files 测试全部通过，覆盖扫描、读写、模板、Project manifest、user-assets 同步等底层路径。
- `bun test server/workspace-files/workspace-file-events.test.ts server/api/workspace-files/events.get.test.ts`：通过，新增覆盖外部整目录删除 `reference/silly-tavern` 后会推送 `unlinkDir` 并移除缓存子树；新增覆盖 SSE handler 不会等 watcher ready 才发送响应。
- live 探针 `http://localhost:3000/api/workspace-files/events?projectPath=workspace%2Fgong-li-yu-lu-xue-yuan`：SSE 约 67ms 返回；临时 `reference/__codex-watch-probe-*` 目录新增和删除均收到事件；随后 tree API 确认临时目录已从快照消失。
- `rg "subscribeWorkspaceFileEvents|refreshProjectWorkspaceIndex|refresh=1|query\\.refresh|loadWorkspaceTree\\(\\{ refresh|LoadWorkspaceTreeOptions" -n server app shared`：0 命中，运行时代码中没有旧 SSE-owned watcher 或 `refresh=1` 残留。
- `rg "invalidateProjectWorkspaceIndexAfterMutation\\(\\{root, workspaceKind" -n server/api/workspace-files`：确认 create-file/create-directory/write/rename/delete/convert/upload-file/upload-project 等 mutation 入口都会标记同一个 index dirty。
- `bunx tsc --noEmit --pretty false --incremental false`：失败，但失败项均为本任务外既有类型问题：SillyTavern skill 脚本 `inspection` excess property、`server/agent/session/session-repo.ts` 的 `origin` narrowing、`server/agent/skills/silly-tavern-card-cli.test.ts` 的 optional/string undefined。新改文件没有继续出现类型错误。

实现和原计划的出入：

- SSE route 测试为避免 Bun 环境缺少 `vi.resetModules` / `vi.stubGlobal`，把 route 抽成 `createWorkspaceFileEventsHandler()` 并用依赖注入测试关闭清理逻辑；生产默认依赖不变。
- 第一版没有额外实现 HTTP 手动强制 rebuild 入口，保持用户决策：不保留 `tree?refresh=1`。手动刷新仍会调用普通 `tree` API；index dirty 或 watcher error 时由 read-time rebuild 兜底。
- 现有 `server/api/workspace-files/*.test.ts` 中 download/upload/write 相关测试仍因既有 Bun/Vitest mock API 兼容问题无法运行，失败点是 `vi.resetModules` / `vi.doUnmock` 不存在；本次已用底层全量 workspace-files 测试、mutation 入口静态核对和新增 index watcher 测试补强回归证据。

## TODO / Follow-ups

- [x] 实现 index-owned watcher，读过即 watch 并常驻。
- [x] 将 Project Workspace 和 user-assets SSE 改为订阅 index 更新。
- [x] 删除 `refresh=1` HTTP query 语义。
- [x] 清理旧 SSE-owned watcher 入口，不做 legacy 兼容。
- [ ] 后续在 SillyTavern CLI 既有类型错误修复后，补真实 CLI 导入 smoke；当前本任务已用外部直接写入 `reference/silly-tavern/...` 证明 index watcher 会更新缓存和 SSE 事件。
