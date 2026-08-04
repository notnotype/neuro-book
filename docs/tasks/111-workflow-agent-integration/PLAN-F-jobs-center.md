# PLAN-F：后台任务中心（Header 入口 + Jobs 管理浮窗）

状态：已实施（2026-07-22），浏览器走查待用户；实施记录与计划出入见 [README 执行小节](README.md#2026-07-22-模块-f-实施主会话任务中心)。承接 [PLAN-E](PLAN-E-background-jobs.md) 二期事项「Header 任务中心入口 + 任务中心 UI」；用户指令：`NovelIdeHeader.vue:136` 附近加后台任务按钮，点击弹出管理后台任务的 window dialog 面板。

> 历史说明（2026-07-27）：本文第 37 节起的共享轮询、变频、`setPanelOpen()` 与取消后刷新描述是当时实现，现已由 [PLAN-G](PLAN-G-job-sse.md) 的单页面单 Jobs SSE 状态机替代；任务中心 UI 设计继续有效。

## 背景与目标

PLAN-E 一期建成 AgentJobManager（workflow 默认非阻塞、bash/invoke_agent background、HTTP 三路由），Workflow 气泡侧（PLAN-C）已具备单 job 观察与取消，waiting 应答已集中到发起 Session Composer 的 Workflow 待处理区。但**没有全局入口**：用户看不到「现在有哪些后台任务在跑」，终态任务在内存里无限堆积也无法清理。

目标：
1. Header 常驻「Jobs」按钮 + 运行数徽标（不开面板也能瞥见有任务在跑）；
2. 非模态 `DialogWindow` 任务中心：分组列表、状态过滤、实时预览、取消、展开详情（ref / 错误 / result）、复制、清除已结束；
3. 后端补一个最小管理面：`clearFinished()`（内存回收）。

## 现有面盘点（复用清单）

| 已有件 | 位置 | 在本任务中的角色 |
| --- | --- | --- |
| Job HTTP 三路由 | `server/api/agent/jobs/`（list / get / cancel） | 数据面，仅新增 clear-finished 一路 |
| `AgentJobSnapshot` / `AgentJobDetail` | `server/agent/jobs/agent-job-manager.ts` | 前端 type-only import（`workflow.preview.vue:9` 先例，不建 DTO） |
| `useAgentJob` | `app/composables/useAgentJob.ts` | 单 job 观察器（气泡用）；照抄其手法：终态集、revision guard、404→unavailable、shallowRef（F6） |
| `DialogWindow` | `app/components/common/DialogWindow.vue` | 面板壳：非模态、可拖动、毛玻璃；用例 `ThemeEditorDialog.vue:280` |
| `JsonViewer` | `app/components/common/JsonViewer.vue` | 展开区展示 completed 的 `result` |
| `formatTimestamp` | `app/components/novel-ide/agent/agent-message.ts:266` | 相对时间 |
| 轮询样板 | `WorkflowRunPanel.vue:119`（递归 setTimeout 变频） | feed 轮询节奏 |
| 错误口径 | `resolveApiErrorMessage` + `useNotification()` | 面板局部 error / 动作即时反馈 |

约束提醒：
- **F6**：`AgentJobSnapshot.ref` 含递归 JsonValue——列表必须 `shallowRef` 整体替换，不进 useState/payload 序列化。
- `interrupted` 只进 jsonl 登记表不进内存 list，面板实际看不到该态（类型仍要覆盖）；历史任务进列表跟 run-as-session 持久化 TODO 走，本轮不动 Manager 核心结构。

## 后端补充：清除已结束

- `AgentJobManager.clearFinished(): number`：删除内存 Map 中终态（completed/failed/cancelled/interrupted）条目，返回数量。仅内存回收；jsonl 登记表是 append-only 审计面，不动。
- 新路由 `server/api/agent/jobs/clear-finished.post.ts` → `{removed: number}`（薄包装，风格同 `cancel.post.ts`）。
- `agent-job-manager.test.ts` 补 1 例：completed 被清、running 保留。

## 核心设计：共享轮询 feed

Header 徽标与面板共用一份数据，避免两处各自轮询。新增 `app/composables/useAgentJobsFeed.ts`：

```ts
type AgentJobsFeed = {
    jobs: Readonly<ShallowRef<AgentJobSnapshot[]>>;   // F6：整体替换
    activeCount: ComputedRef<number>;                  // running + waiting
    loaded: Readonly<Ref<boolean>>;                    // 首拉完成（区分空态与未加载）
    error: Readonly<Ref<string>>;                      // 最近一次轮询失败，成功自动清空
    refresh(): void;                                   // 立即拉一轮
    setPanelOpen(open: boolean): void;                 // 面板开合调速
    clearFinished(): Promise<number>;                  // POST clear-finished + 刷新
};
export function useAgentJobsFeed(): AgentJobsFeed     // 模块级单例
```

- **模块级单例**而非 useState：轮询纯客户端（入口 guard `import.meta.client`），且递归类型不进 payload 序列化（F6 防线）。
- 变频（递归 setTimeout + revision guard）：

| 面板 | 有 running/waiting | 全终态 |
| --- | --- | --- |
| 开 | 1500ms | 5000ms |
| 关 | 5000ms（徽标及时归零） | 12000ms（常驻慢轮询喂徽标） |

- start 幂等；`index.vue` onMounted 启动、onScopeDispose 停；取消动作留在行组件（直接 `$fetch` cancel，同气泡语义），feed 只管列表与清除。

## UI 设计

### Header（`NovelIdeHeader.vue`）

- props 增 `agentJobsActiveCount?: number`；emits 增 `open-agent-jobs`（Header 保持哑组件）。
- Trace 按钮后插入，**全模式可见**（jobs 是全局面，同 Trace 不加 `v-if="!isUserAssetsMode"`）：图标 `i-lucide-list-checks`、文字硬编码 `Jobs`（与 World/Plot/Trace 一致）、`:title="t('ide.header.agentJobsTitle')"`。
- 徽标：`activeCount > 0` 时右上角 accent 圆点数字（`bg-[var(--accent-main)]` + `text-[var(--text-inverse)]`，>99 显示 `99+`）。

### 接线（`app/pages/index.vue`）

- `useAgentJobsFeed()` 实例化 + `agentJobsOpen` ref + `watch(agentJobsOpen, o => feed.setPanelOpen(o))`；
- 两处 `<NovelIdeHeader>`（agent 布局 / IDE 布局）都接 count prop 与 open 事件；
- `WorkspaceHistoryInboxDialog` 旁挂 `<AgentJobsDialog v-model="agentJobsOpen" />`（面板内自取 feed 单例，无需 projectPath/theme——DialogWindow 自动 teleport 到主题宿主）。

### 面板（新目录 `app/components/novel-ide/jobs/`，循 `history/` 惯例）

**AgentJobsDialog.vue**（壳 + 工具条 + 过滤 + 分组列表，~220 行）

```
┌─ ⠿ 后台任务 ────────────────────────────────── ✕ ┐
│ [全部 12] [进行中 2] [已结束 10]   🧹清除已结束 ⟳ │ ← 工具条 shrink-0 border-b
├──────────────────────────────────────────────────┤
│ —— 进行中（置顶，createdAt 倒序）——              │ ← 列表 flex-1 overflow-y-auto
│ ▸ ⚙ 拆解《雪国》第三章            [● 运行中]      │
│    job_a1b2 · Agent #12 · 3 分钟前 · 2m10s [取消] │
│    「step 4/9: 抽取人物卡…」(preview 随轮询刷新)  │
│ ▸ 🤖 调研角色动机                 [◐ 等待回应]    │
│    ↳ 等待回应：请到发起会话的 Composer Workflow 待处理区应答│
│ —— 已结束（endedAt 倒序）——                      │
│ ▾ ▍bun run build                  [✔ 已完成]     │
│    ├ ref: command=bun run build          [复制]   │
│    ├ preview 全文                                 │
│    └ result: <JsonViewer>（展开时按需拉详情）     │
│ （空态）暂无后台任务——run_workflow、后台 bash、   │
│  后台子代理启动后会出现在这里                     │
└──────────────────────────────────────────────────┘
```

- DialogWindow：`:width="680"` `height="min(640px, calc(100vh - 88px))"` `body-class="flex min-h-0 flex-1 flex-col overflow-hidden !p-0"`。
- 过滤 chips（客户端过滤）：全部 / 进行中(running+waiting) / 已结束(其余)，带计数，选中态 accent。
- 分组：进行中置顶按 createdAt 倒序；已结束按 `endedAt ?? createdAt` 倒序；「全部」视图两组间加分隔标题。
- 「清除已结束」：`feed.clearFinished()` → `notification.success`（清了 n 个）；无已结束项禁用；失败 `notification.error(resolveApiErrorMessage(...))`。
- 列表加载失败 → 面板局部 error 条（feed.error），恢复自动清除，轮询不停。
- 行 `v-for :key="job.jobId"`（key 复用保住 Row 展开态/取消态；shallowRef 整替不丢实例状态）。

**AgentJobRow.vue**（行 + 状态 chip + 展开详情 + 取消 + 复制，~230 行）

- props `job: AgentJobSnapshot`；emit `cancelled`（父触发 `feed.refresh()`）。
- 行1：kind 图标（workflow=`i-lucide-workflow` / bash=`i-lucide-terminal` / invoke_agent=`i-lucide-bot`）+ title truncate + 状态 chip。
- 行2 meta：jobId · owner（`Agent #{n}`；null→「用户直发」）· `formatTimestamp(createdAt)` · 时长（endedAt−createdAt；运行中 now−createdAt，轮询整替自然刷新；`formatDuration` 组件内 inline："12s"/"2m05s"/"1h03m"）。
- 行3：`preview` line-clamp-2；`error` 有值时 danger 色单独一行。
- waiting 特别行：`↳ 等待回应：请到发起会话的 Composer Workflow 待处理区应答`（Jobs 面板只指引，不复制应答状态）。
- 取消（running/waiting）：`POST /api/agent/jobs/:id/cancel` → 本地 `cancelRequested` 置位（按钮「取消中…」禁用；不做二次确认，与气泡一致）→ `emit("cancelled")`；失败 `notification.error`。
- 展开（点行头切换）：
  - ref 结构化摘要：workflow→`runId=…`、bash→`command=…`、invoke_agent→`sessionId=…`（解析失败降级 JSON 文本）+ 每项复制按钮（`navigator.clipboard.writeText` + notification 反馈）；
  - preview 全文（运行中随轮询刷新）、error 全文（可复制）；
  - **completed 且展开时**才 `$fetch /api/agent/jobs/:jobId` 拉 `result`（一次性），有则 `<JsonViewer :value="result" :max-height="240" />`；404 →「已不可查询（可能因服务重启）」（同 `useAgentJob` 404 口径）。

### 状态色映射（主题变量口诀，禁 Tailwind 调色板）

| status | 色 | 备注 |
| --- | --- | --- |
| running | info | chip 带 `i-lucide-loader-2 animate-spin` |
| waiting | warning | 待人工应答 |
| completed | success | |
| failed | danger | |
| cancelled | muted（无状态色） | 中性终态 |
| interrupted | warning | 类型覆盖用；一期实际不出现在列表 |

一律 `--status-*` / `--status-*-bg` / `--status-*-border`。

### i18n（zh-CN + en-US 同步）

- `ide.header.agentJobsTitle`；
- 新 section `ide.agentJobs.*`：title / empty / emptyHint / loadFailed / refresh / clearFinished / clearFinishedDone({count}) / filterAll / filterActive / filterDone / groupActive / groupFinished / statusRunning / statusWaiting / statusCompleted / statusFailed / statusCancelled / statusInterrupted / cancel / cancelling / cancelFailed / ownerNone / waitingHint({session}) / copied / copyFailed / resultUnavailable / resultTitle / refRunId / refCommand / refSessionId。

## 不做的事（二期 / 跟既有 TODO 走）

- SSE 推送（PLAN-E 已记 TODO，轮询先行）。
- `interrupted` 历史任务进列表（等 run-as-session 持久化，不为此 nullable 化 JobRecord）。
- 从面板跳转发起会话 / 气泡锚定（`originToolCallId` 已在快照，留后续）。
- 面板内应答 waiting ask（由 Composer Workflow 待处理区承载，Jobs 对话框仍只指引）。
- 删除单个 job；DialogWindow 尺寸拖拽（通用组件无 resize，不为本任务改它）。

## 验收清单

1. `bunx vitest run server/agent/jobs`（既有 + clearFinished 新用例）。
2. `bun run typecheck`（主源码 0 错；PLAN-E 搁置的 6 个测试文件既有错误不属本任务）。
3. 前端组件不新增测试（简单展示逻辑）。
4. 浏览器走查（用户执行）：novel 与 user-assets 两模式下 Header 按钮与徽标 → 跑 workflow/后台 bash 观察 running→completed 流转与徽标增减 → 取消、展开 result、复制、清除已结束。
