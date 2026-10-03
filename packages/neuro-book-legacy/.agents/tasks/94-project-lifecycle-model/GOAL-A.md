# GOAL-A：ProjectSession 核心机制（本会话派发 subagents 执行）

> 执行者：主会话 Claude + subagents。上下文可依赖 [README.md](README.md)（设计决策 D1–D11）与本文档；实现中发现契约矛盾，停下记录到 README 的 walkthrough 并报告，不擅自改语义。

## 一句话目标

在 NeuroBook 建成显式项目生命周期核心：一等 ProjectSession（open / 在场 / 宽限 / close 状态机）+ 两个 HTTP 接口（open、presence SSE）+ harness agent 在场接线 + 前端项目视图接线；**不接数据面守卫**（那是 GOAL-B 的事），交付一个与现状行为兼容的中间态。

## 契约（GOAL-B 将以落地代码为真相源，本节签名必须精确实现）

演进 `server/workspace-files/project-resources.ts`（可更名 `project-session.ts`，同步全部 import）：

```ts
/** 谁发起了 open。用于日志归因与删除占用报告。 */
export type ProjectOpener =
    | {kind: "user"}
    | {kind: "agent"; sessionId: number}
    | {kind: "job"; source: string};

/** 数据面守卫错误。HTTP 层映射 409 + data.code = "PROJECT_NOT_OPEN"。 */
export class ProjectNotOpenError extends Error { readonly projectPath: string }

/** 幂等 open：目录不存在或已标记删除 → 404 语义错误；首次 open 跑一次 initProjectDatabase（迁移收敛，见 D11）并异步预热 tree watcher（不阻塞返回）。 */
export function openProject(projectPath: string, opener: ProjectOpener): Promise<void>;
/** 数据面守卫：未 open 抛 ProjectNotOpenError。GOAL-B 负责把它接进咽喉。 */
export function assertProjectOpen(projectPath: string): void;
export function isProjectOpen(projectPath: string): boolean;
/** 删除占用报告 / 调试。 */
export function listOpenProjects(): Array<{projectPath: string; state: "open" | "grace"; userConnections: number; agentActive: boolean; openedAt: string; lastActivityAt: string}>;
/** presence SSE 连接时调用；未 open 抛 ProjectNotOpenError。返回释放函数（连接断开时调）。 */
export function acquireUserPresence(projectPath: string): () => void;
/** harness 注册"该项目是否有运行中 invocation"探针。 */
export function registerAgentPresenceProbe(probe: (projectPath: string) => boolean): void;
/** 原 touch 降级：仅更新 lastActivityAt（可观测性），不再承载生命周期语义。保留现有调用点兼容。 */
export function markProjectActivity(projectPath: string): void;
/** 内部 close：宽限到期 / 删除流程 / 关停。先逐属主关门，全部成功才除名；失败者进泄漏表由兜底清扫重试。 */
export function closeProject(projectPath: string, reason: "grace-expired" | "delete" | "shutdown"): Promise<void>;
export function closeAllProjects(): Promise<void>;
/** closeAll 从可选改为必填（审查项 4）。 */
export function registerProjectResourceOwner(owner: {name: string; close(p: string): Promise<void>; closeAll(): Promise<void>; busy?(p: string): boolean}): void;
```

**状态机**：`open`（presence>0 或 agent 在场）→ presence 全归零且 agent 探针 false → `grace`（5 分钟常量）→ 恢复任一 presence 则回 `open`，到期则 `closeProject("grace-expired")` → 移除。**泄漏表**：close 中失败的属主保留记录，兜底清扫（60s 周期，保留自 Task 92）只做泄漏重试，不再按 TTL 驱逐。

**GC 分级（审查项 3）**：`force` GC 仅 `reason === "delete"`（与关停）；宽限到期与泄漏重试用无参节流 GC。

## 交付物与任务分解

1. **A1 状态机 + 注册表 v2**：上述契约实现；吸收审查项 1（先关门后除名+泄漏重试）、3（GC 分级）、4（closeAll 必填——同步修四个现有属主注册）、5（删除 world-engine 冗余属主注册）、6（plot `closeAllProjects` 委托 `closeProject`）、8（补 ensureSweepTimer/isProjectResourceBusy 类函数注释）。单测覆盖：幂等 open、presence 计数归零→grace→恢复/到期、agent 探针拦截 grace、close 失败进泄漏表并被重试、assertProjectOpen 抛错类型。
2. **A2 HTTP 接口**：`POST /api/projects/open`（body {projectPath}，幂等，404 语义）；`GET /api/projects/presence?projectPath=`（SSE：连接即 acquireUserPresence，断开即释放，30s 心跳注释行；未 open → 409 PROJECT_NOT_OPEN）；`projects/item.delete` 与 `novels/[novelId].delete` 增加占用检查——**presence>0 或 agent 在场 → 409 返回占用方摘要（listOpenProjects 数据）**；仅 grace 态允许强制 close 后删除。
3. **A3 harness 接线**：invocation 准入处 `openProject(projectPath, {kind:"agent", sessionId})`（无 projectPath 的会话跳过）；harness 初始化时 `registerAgentPresenceProbe`（内存查询运行中 invocation 的 projectPath 集合）。
4. **A4 前端接线**：项目视图入口 composable——`await open` → 挂 presence EventSource → 组件卸载/路由离开时断开；EventSource 自动重连天然处理网络闪断；409/404 用 `useNotification()` 提示。**先核实 IDE 页面是否 SSR 取数**（是则 open 需前置到服务端或该页关 ssr，把结论记进 README）。
5. **A5 文档**：README walkthrough 记录实现过程与出入；PROJECT-STATUS 行更新。

## 验收标准

- 新增单测全绿；`bun run typecheck` 全绿；受影响既有测试（project-resources.test、project-workspace-delete.test）迁移到新契约后全绿。
- **中间态声明**：本 GOAL 完成时数据面守卫尚未接线（facades 仍可在未 open 时工作）——这是有意的过渡态，由 GOAL-B 收口；但 openProject 跑 initProjectDatabase 的行为已生效。
- 浏览器手动走查（用户执行）：进入项目视图 → presence 建立；开两标签页关一个不触发 grace；全关后 5 分钟资源释放；agent 后台跑时关标签页项目保持 open。

## 边界（非目标）

- 不把 assertProjectOpen 接进任何数据面咽喉（GOAL-B）。
- 不动 nb-history（Task 95）。
- 不做管理面"强制关闭项目"端点（D10：close 是内部动作）。
- 不碰并行任务文件：`server/agent/harness/*` 只允许 A3 的两处最小接线，`server/agent/profiles/*`、`server/agent/tools/apply-patch*`、`docs/tasks/93-plot-planning-layer/*` 严禁修改。
