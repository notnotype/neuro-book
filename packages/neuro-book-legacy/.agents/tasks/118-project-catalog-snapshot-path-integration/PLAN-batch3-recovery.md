# PLAN：Phase 4B 第三批回归修复与后续排期

> 建立于 2026-07-27。触发来源：`/code-review medium` 的 15 项 finding + 用户手动测试的 8 项现象。
>
> **结论先行：第三批（控制面与数据面身份硬切）引入了破坏性运行时回归，之前基于「typecheck 0 错误 + 单元测试全绿」给它盖章是错误的。** `$fetch<T>` 的类型参数是手写断言，不与服务端路由做契约校验，因此前后端参数名不一致完全不会被类型系统或现有单测发现。

## 根因

第三批对前端做了无差别的 `projectPath` → `projectRoot` 全局改名（51 文件 / 307 处 + Vue 模板 11 文件 / 19 处），但服务端只更新了当时手上的控制面与少数数据面入口。**其余路由仍在读 `projectPath`。**

这个错误的结构性教训：身份改名必须**按「一条 HTTP 契约」为单位**推进（前端调用点 + 服务端解析 + DTO schema + 测试断言同时改），而不是按「前端」「后端」分层推进。分层推进时类型系统给不出任何保护。

---

## A. 参数契约断裂（必须修，当前功能全断）

服务端仍读 `query.projectPath` / body `projectPath`，前端已发 `projectRoot`：

| 面 | 文件 | 表现 |
| --- | --- | --- |
| **workspace-files**（12 个） | `tree.get` / `read.get` / `write.put` / `stat.get` / `events.get` / `rename.patch` / `delete.delete` / `create-file.post` / `create-directory.post` / `convert-file-to-directory.post` / `download.get` / `upload-file.post` / `upload-project.post` | 文件树、编辑器读写、文件变更 SSE 全断 |
| **workspace-history**（5 个） | `inbox.get` / `diff.get` / `accept.post` / `accept-all.post` / `revert.post` | 400 `projectPath 不能为空`（用户实测第 1 条） |
| **plot / world-engine** | `projects/plot/[...segments].ts:233`、`projects/world-engine/[...segments].ts:113` | 仍调 `requireProjectPathQuery` → 400。第三批只换了下游的 `requireReadyProjectPath`，**没换参数解析** |
| **workflow** | `agent/workflow/runs.post.ts:22`（body zod）、`agent/workflow/catalog.get.ts:18`（query） | runs 400；**catalog 静默降级到 global scope，不报错**——最危险的一类 |

**tree 的额外后果（解释用户实测第 6、7 条）**：`tree.get.ts:128` 读不到 `projectPath` → `resolveWorkspaceFileTarget`（`novel-workspace.ts:339-346`）落到最后分支返回 `{kind: "workspace-root"}` → 走 `readPlainWorkspaceTreeSnapshot` 全盘扫描**整个 Workspace Root**（含 50+ 个测试项目），**完全绕过 Project File Index 缓存**。这就是「返回全部 workspaceRoot 文件」与「首次 22.5s、后续仍 17s 且不走缓存」的原因。**修好参数名后两者一并消失，不需要单独做性能优化。**

**不在此列**：`server/api/projects/rag/*`（12 个）与 `server/api/config/*`（6 个）的 `projectPath` 命中是 `defineRouteMeta` 的 OpenAPI 声明，真实解析分别走已修好的 `requireProjectRagTarget` 与 `resolveConfigTarget`。它们属 B 类（声明与实现不一致），不造成 400。

### 修法

统一改为单段 `projectRoot`，解析收口到 `requireProjectRefQuery`（`server/api/projects/project-control-plane.ts`）。workspace-files 家族还需同步 `resolveWorkspaceFileTarget` 的入参形态。改完必须**逐条 HTTP 契约验证**，不能只看 typecheck。

---

## B. 改名破坏了函数体逻辑（静默失效，最难发现）

参数改了名但函数体仍按旧形态判断，**不报错、直接给错结果**：

1. **`app/components/novel-ide/agent/agent-composer-reference.ts:12`** — `completeProjectFileAddress` 仍判 `startsWith("workspace/")`，收到裸 root 时静默返回未加前缀的相对路径。Composer @-引用与图片快照解析到错误根。
2. **`app/pages/world-engine.preview.vue:116`** — `previewProjectTestPrefixes` 仍是 `"workspace/world-engine-test-"` 等，而过滤对象已是裸 root → `startsWith` 恒为 false → 测试项目全部回到下拉框，还会把真实项目挤出 80 条上限。
3. **`app/pages/index.vue:200`** — `parseProjectRouteTarget` 的正则仍是 `/^workspace\/[^/]+$/`，而 `buildProjectRoute` 已产出裸 root → 深链接永远解析不出 → `workspaceRouteSynced()` 判定失步 → 反复重跑 `initializeWorkspaceFromRoute` 抖动；旧链接 `?project=workspace/foo` 则永远匹配不上 `novel.projectRoot`，触发「不存在或已删除」提示并静默回退 `list[0]`。
4. **`app/components/novel-ide/NovelIdeSettingsDialog.vue:279`** — 三路 fallback 塌缩成同一字段后留下死分支（`novel.title || novel.projectRoot || novel.projectRoot`）。

**同时必须修的测试**：第三批把三处测试改成了**错误方向**——给已改名的参数继续传 `workspace/book` 形态（`useComposerImageTransaction.test.ts:172`、`world-engine-preview.test.ts:42`），使上述回归在测试中不可见。这类"顺着实现改断言"是本轮最需要警惕的反模式。

---

## C. 竞态与生命周期（真 bug）

1. **config bootstrap 不等 open**（用户实测第 3、8 条）
   `AgentChatSurface.loadSelectableModels()` / `loadResolvedLeaderProfileKey()` 只判 `currentNovelId` 非空就发 `/api/config/bootstrap`，**不等 `useProjectSession` 完成 open** → 409 `PROJECT_NOT_OPEN`。
   竞态本身是既有的（旧代码同样如此），但被第三批放大：sessionStorage 里的旧格式 `workspace/<slug>` 失配 → `initializeWorkspace` 回退到 `list[0]`，而列表来源已从 `listNovels()` 换成 Lifecycle `listProjects()`、排序不同 → 落到 `world-tools-test-*` 这类测试项目上。
   修法属 Phase 4B 既定项「调用方 await activate 成功后再提交选择」。

2. **`disconnect()` 的 close 竞态**（用户实测第 4 条）
   `useProjectSession.disconnect()` 只等本地 `connectionLoop` 结算就 POST close，但服务端 presence 是在 h3 event stream 的 `onClosed` 里异步释放的 → `occupancy.userConnections > 0` → 409 `PROJECT_IN_USE` → 被 `isProjectInUseError` 当作正常结果吞掉。
   **后果：显式 close 路径实际上是死的**，Project 只能靠 grace 超时退出。第二批交付的 close 接口因此没有真正生效。
   修法需要服务端在 close 前确认 presence 已释放，或前端等待 presence 释放确认（需设计，不是简单改参数）。

---

## D. 待拍板的产品行为（Phase 4B 既定项，与 A/B/C 分开）

1. **错误 URL 打开项目无提示**（用户实测第 2 条）——对应「route 指定非列表 root 时直接尝试 open，失败保留原选择并清除失败链接的 `openPath`，不得打开旧 Project 或静默切换首项」。
2. **无 Project 空态**（用户实测第 5 条）——用户提出的 IDEA 式项目选择界面，正是「无 Current Project 时显示『新建 Project』『打开目录』，不挂载数据面；空列表不自动创建默认 Project」。**按已冻结计划是需要支持的。**

---

## E. 非本轮引入

- `server/agent/observability/trace-segments.ts:137` 含字面 NUL 字节（`\x00` 写成了真实 0x00），git 将整个文件识别为二进制 → diff / blame / 三方合并全部失效。属 Task 126 改动，建议换成可见分隔符。
- `server/api/projects/index.post.ts:41` — 第三批的 `allocateProjectRoot` 丢掉了原有的 `projectWorkspaceDirectoryExists()` 磁盘探测，只查 Lifecycle 列表。孤儿目录（崩溃的创建、手工拷贝、半删）不在列表中，会把「可重试的后缀递增」变成硬 409。Facade 已有 `listProjectCandidates()` 正为此存在但无人使用。
- `server/agent/harness/neuro-agent-harness.ts:7060` — `getSessionContextInspection` 在 try/catch 外解析 config target，Project 未打开时抛未处理的 500，与「面板是诊断工具，配置有问题时更应该打得开」的设计相悖。
- `server/agent/harness/prepare-run.ts:81` — `mode` 由 `sources.size > 0` 推导，导致「本来就没有 custom_message 的新 session」被误报为 `legacy`。判据应是「有 custom_message 但都不带 promptSource」。
- `server/agent/observability/context-diagnostics.ts:209` — `cacheCompactionRebuild` 只看紧邻前一条 timeline entry，中间隔任何非 turn 条目就漏报。应扫描 `findPreviousTurn` 已算出的完整区间。
- 用户日志末尾的 `unreachable`（source-map wasm）是 youch 渲染错误页时的次生崩溃，非业务问题。

---

## 执行顺序

**第一批（恢复可用，不可拆）**：A + B。这两类必须一起做——A 修参数名，B 修被改名破坏的函数体与被改错的测试断言。中途停下应用仍是坏的。

**第二批**：C。两个竞态，其中 close 竞态需要设计。

**第三批**：D。两项产品行为，属 Phase 4B 既定清单。

**穿插**：E 中的 `allocateProjectRoot` 与 `index.post` 属第三批自己的遗留，建议并入第一批；其余 E 项独立排期。

### 验证要求（本轮教训）

**不得再以 typecheck + 单元测试作为身份改名的完成依据。** 每条 HTTP 契约至少要有一项能同时覆盖「前端发出的参数名」与「服务端读取的参数名」的验证——route 级集成测试，或对照 `defineRouteMeta` 声明与实际 `getQuery` 读取的一致性检查。后者可以做成一个通用守卫测试，一次性覆盖全部 route，避免同类问题重演。

---

## 第三批之后仍未开始的 Phase 4B + 7 工作

（与本文件的 A–D 无关，属原计划剩余量）

- **控制面收尾**：新增 `GET /api/projects/candidates`（Facade `listProjectCandidates()` 已存在、零消费）；canonical OpenAPI 切到真实 `/api/projects`。
- **Session 消费面（slice 2，最大一块）**：`SessionMetadata` 切 `currentProjectRoot` + `schemaVersion`；`RunFrame` / `ToolExecutionContext` 收敛为 `currentProject: ReadyProjectSessionRef | null`；attachments / linked agents / workflow / queue inheritance 同步；**`projectRefFromLegacyPath` 当前 32 处调用点即精确工作清单**，切完连函数一起删。同批做**真实 apply 迁移**（停 runtime → dry-run → apply → 全库复扫 → 重启）+ Phase 6 推迟的 **fail-closed gate** + **两把 lease 归一**。
- **store 死代码**：7 个请求已删除 `/api/novels/*` 路由的函数（`loadNovelTree` / `fetchChapterDetail` / `saveCurrentChapterContent` / `updateChapter` / `updateVolume` / `reorderVolumes` / `reorderChapters`）。组件族已删，但它们散在 2400 行 store 中并牵连 `novelTree` / `selectedChapterId`，需单独判定。**Phase 8 零命中审计前必须清掉。**
- **File Address / cwd / File Scope**：cwd 恒为 Workspace Root；File Address 只留两种；删 `FileScope` 四态联合与 `workspace/<slug>/...`；处理两处硬编码构造点（`snapshotSessionAttachment` 后端强制、`completeProjectFileAddress` 前端拼接）。
- **workspace CLI**：加 `project ensure`，删 `--target` / `init-db` / `--no-db` / 祖先发现 / alias；`schema` 迁 `node schema`；**建统一 JSON envelope + typed error**（当前全是裸 `throw new Error` + `exitCode=1`）；四层 wrapper 同步。
- **Prompt 与资产**：**新写** `RuntimeLocationReminder`（Task 109 已删除，不是「恢复」）；精简 `WorkspaceFocusReminder`；16 个资产源文件 108 处 `workspace/`；profile compile → metadata → check 串行。
- **Phase 8**：删 `ProjectPath` brand / 旧 DTO/codec / File Scope union / external Project runtime；零命中审计；删或重写只证明旧行为的测试；全门禁（package + 根 typecheck、Nuxt/Nitro build、Product packaging smoke）；真实 HTTP 资源曲线；Portable smoke；浏览器验收；文档收口。
