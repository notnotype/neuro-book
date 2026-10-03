# SPEC：`currentProjectRoot` 语义规格

> 冻结件（2026-07-27 用户拍板）。Phase 4B + Phase 7 身份硬切的唯一语义来源。实现中遇到本文未覆盖的情形，停下来补规格，不要就地发明。
>
> 本轮拍板的三项：运行时只携 handle（§3）、重绑走 session 子资源 POST（§6）、`/api/novels` 连同章节/树数据面一起处理（§9——实测发现那块是死代码，见该节）。

## 1. 唯一真相

一个 Agent session 的 Project 归属，由 `SessionMetadata.currentProjectRoot?: string` **单独**表达。

| 值 | 含义 |
| --- | --- |
| 字段缺失 | **Workspace Root session**：没有 Current Project |
| 单段目录名（如 `my-novel`） | 该 session 的 Current Project **名字** |

三条硬规则：

1. **它是名字，不是存在性证明。** 写入时只校验是单段合法 root（`ProjectRootDtoSchema`），不校验目录是否存在——否则 Project 被删除后历史 session 就读不出来了（G2）。存在性在每次 invocation 开始时解析。
2. **它是单段。** 不是 `workspace/my-novel`，不是绝对路径。构造 `workspace/${root}` 是被明令禁止的（Task 118 已冻结）。
3. **缺失只有一种含义。** 旧的 user-assets session 与 external session 在迁移时**都折叠为缺失**（G3）。不存在「第二种无 Project 状态」。

decoder 已对此硬断言：Workspace Root session 若带 `currentProjectRoot` 直接抛错（`legacy-decoder.ts:1348`）。

## 2. 三种可执行性状态

| 状态 | 判据 | 可读 | 可执行 | 出口 |
| --- | --- | --- | --- | --- |
| **unbound** | 无 `currentProjectRoot` | ✅ | ✅ | — |
| **bound** | 有 `currentProjectRoot` 且能解析为 ready Project | ✅ | ✅ | — |
| **dangling** | 有 `currentProjectRoot` 但解析不到 | ✅ | ❌ `current_project_missing` | 重新绑定 / 清除 |
| **review** | 存在 `migrationReview` | ✅ | ❌ `migration_review_required` | 重新绑定 / 清除 |

- 两个阻断码都是**新增**的（当前代码零命中），沿用既有 `PROJECT_NOT_OPEN` / `PROJECT_IN_USE` 的 `data.code` 风格。
- **review 与 dangling 正交**，可同时成立；两者都阻断时报 `migration_review_required`（它更根本：路径本身存疑）。
- `migrationReview` 形如 `{status: "required", reasons: ("external_project" | "ambiguous_path")[]}`，由迁移写入，**永不由 runtime 写入**。清除或重绑成功后删除该字段。
- 阻断发生在 **invocation admission**，不是读取路径。列表、历史、树、附件索引全部照常可读。

## 3. 运行时不携带字符串身份

`RunFrame` 与 `ToolExecutionContext` 现有的 `workspaceKey` / `workspaceRootRef` / `workspaceFsRoot` / `projectPath` 四元组，收敛为：

```ts
workspaceRoot: AbsoluteFsPath;                  // 永远是 RuntimePaths.workspaceRoot
currentProject: ReadyProjectSessionRef | null;  // admission 捕获的 exact generation；unbound 为 null
```

- **不再携带 `currentProjectRoot` 字符串。** 需要名字时从 `currentProject.workspace.ref.projectRoot` 取。这在结构上杜绝了「运行中途拿字符串重新解析」——正是 Phase 5 花了六个切片消灭的问题。
- dangling session 产生不了 handle，但它在 admission 就被拒了，所以 RunFrame 存在时 `currentProject` 必然可解析。这个不变量要用测试守住。
- `WorkspaceRootRef` 类型（`"workspace" | "workspace/.nbook" | AbsoluteFsPath`）**删除**：user-assets 与 external 消失后它只剩一个可能值。
- `ProjectWorkspaceKey` 保留，但仍然只是进程内 key（ProjectSession / 资源 owner / cache / presence / 锁）。它与被删除的 session `workspaceKey` **同名但无关**，不要混淆。

## 4. cwd 与文件地址

- **绑定 Current Project 时，Agent cwd 是该 Project Workspace；未绑定时是 Runtime Workspace Root。** cwd 只决定普通相对路径的起点。
- 普通 Project 文件优先使用 `lorebook/...`、`manuscript/...` 等 Project-relative 地址；absolute filesystem path 继续直接表示物理目标。
- `workspace/<slug>/<relative-path>` 保留为显式跨 Project File Address。它通过 Project open gate，并保留 History、Context Access 与变更记账身份，不是持久化 Project identity 或旧 Adapter。
- `FileScope` 四态持久化联合已经删除；运行时只消费绝对 Workspace Root 与 optional exact ready Project handle。
- `workspace/.nbook/...` 是 Workspace Root 下的全局控制区地址，不属于任何 Project。

**前端 `workspaceKind: "novel" | "user-assets"` 是 Studio 挂载点概念，与 session 的 `currentProjectRoot` 无关。** Studio 处于 user-assets 模式时新建的 Agent session，就是一个普通的 unbound session。

## 5. Session 列表过滤

`workspaceKey` + `projectPath` 双字段精确匹配（`session-repo.ts:370-375`）替换为：

```ts
scope?: "all" | "workspace-root" | "project";  // 缺省 all
projectRoot?: string;                          // scope="project" 时必填
```

不用「`currentProjectRoot` 缺省即全部、空串即无归属」的紧凑写法：目录名可以恰好叫 `all`，紧凑写法会撞值。

## 6. 重新绑定与清除

dangling / review 状态的唯一出口。这是**新增接口**（当前不存在）：

```
POST /api/agent/sessions/{sessionId}/current-project
  body: {projectRoot: string} | {projectRoot: null}
```

- `{projectRoot: "x"}` 重绑到 x（必须能解析为合法 Project），同时清除 `migrationReview`。
- `{projectRoot: null}` 清除归属，session 变为 unbound，同时清除 `migrationReview`。
- 以 append entry 形式落盘，与所有其它状态变化一致；**不原地改写 header**。

## 7. 继承规则

| 场景 | 规则 |
| --- | --- |
| `createAgent` 显式传入 | 用传入值 |
| 子 session / linked agent | 继承父 session；父 unbound 则子 unbound |
| summarizer 等系统 session | 继承源 session |
| `forkSession` | 原样复制 |
| workflow 参与者 | 继承 run 的 Project；run 无 Project 则 unbound |
| follow-up queue | **不携带**任何 Project 字段，靠「同一 session」隐式继承（现状即如此，不改） |

现有缺陷顺带修掉：`workflow-session-port.ts:63` 的 mock demo 分支不设置归属，与真实 profile 路径行为不一致。

## 8. 迁移映射（Phase 6 已实现，此处仅登记）

| 旧形态 | 新 header |
| --- | --- |
| managed（Project 存在） | `currentProjectRoot: <root>` |
| stale_managed（Project 已删） | `currentProjectRoot: <root>` → 运行时 dangling |
| user_assets | 无 `currentProjectRoot` |
| external | 无 `currentProjectRoot` + `migrationReview` |
| workspace_root | 无 `currentProjectRoot`；路径歧义时加 `migrationReview` |

真实基线 499 份：bound 241、dangling 24、unbound 234、review 3。

## 9. `/api/novels` 镜像删除

**实测更正（2026-07-27）**：`server/api/novels/` 只有 5 个 route（`index.get` / `index.post` / `[novelId].get` / `.patch` / `.delete`），与 `/api/projects` 逐条对应。

计划里担心的「章节/树数据面」**不存在**：

- 没有 `chapters/` / `volumes/` / `tree` 任何子路由；
- `NovelTreeDto` 在 server 生产代码 0 命中；
- `app/stores/novel-ide.ts` 里的 `loadNovelTree` / `fetchChapterDetail` / `updateChapter` / `updateVolume` / `reorderVolumes` / `reorderChapters` 组件侧 **0 调用方**，且它们请求的是不存在的路由；
- `NovelChapterPanel.vue` 未被任何页面挂载，其 emit 的 reorder 事件无监听方。

结论：这块是**死代码**。本批次的实际动作是「删 5 个 route + 清掉 store 与组件里的死章节树逻辑」，没有迁移工作。清理范围需在动手时重新确认一次（死代码可能牵连 `ChapterDetailDto` 等 DTO 与 `NovelChapterPanel` 相关组件族）。

## 10. 被删除的名字（Phase 8 零命中审计清单）

`SessionMetadata.workspaceRoot` / `SessionMetadata.workspaceKey` / `SessionMetadata.projectPath` / `WorkspaceRootRef` / `FileScope` 四态联合 / `ProjectPath` brand / 旧 Project File Address type/adapter / `projectPath` DTO 字段 / `novelId` / `currentNovelId` / `/api/novels`。

允许保留的位置只有：历史 Task 文档、migration fixture / decoder / report。

`workspace/<slug>/<relative-path>` 输入语法不是被删除的旧 Adapter；它由 `authorized-file-operation` 直接实现，是跨 Project 文件操作的正式领域地址。
