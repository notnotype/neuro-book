# Task 129: 项目选择界面与 Agent 入口收敛

> 状态：Implemented（2026-07-27 立项并实施，W1/W2/W3、Project close-then-open 与 Session recovery 入口均已落地；项目选择页旧版视觉与状态曾完成浏览器验收，当前封面/切换/recovery 链仍待用户验收）

## 2026-07-31：Project 加载阶段进度

- 主 IDE 原先只有“正在打开 Project”的旋转图标，现在按真实冷切换节点显示 6 步阶段进度：释放旧工作面、准备 Project、建立 presence、同步 Catalog、加载文件树、恢复上次内容并完成深链。步骤只表达已进入的确定阶段，不按耗时伪造百分比。
- `ProjectSessionState` 的 pending 分支增加 `opening-project`、`connecting-presence` 与 `waiting-reconnect`。重连可能退避并重复尝试，因此继续显示不定进度，并区分等待、重新打开和恢复连接；HTTP open、presence SSE、`presence_ready` 与 `readyRevision` 合同均未改变。
- 页面进度记录绑定 route revision；旧 intent 的异步回流与 `finally` 不能推进或清空新 intent。加载面板使用主题 `info` 状态色，确定进度公开 ARIA 步骤值，不定进度不伪造 `aria-valuenow`，并为 reduced-motion 停止位移动画。用户文案已改为“正在打开作品”并同步英文。
- 聚焦验证：`useProjectSession.test.ts`、`project-route-transition.contract.test.ts`、`theme-tokens.test.ts` 共 3 文件、18 项通过。根 `bun run typecheck` 仍被未改动的 Catalog readonly 类型、Profile command、Session migration 与 llmlint fixture 错误阻断，本轮文件零命中。按仓库规则未自动执行浏览器验收。
- 后续审查确认原投影仍有两个微任务级倒退窗口：Controller 从 `connecting-presence` 提交 `ready` 后、route worker 写入第 4 步前会出现 `3 → 1 → 4`；Store 把 `restoringWorkspaceFile` 复位后、worker 固定第 6 步前会出现 `6 → 5 → 6`。两者根因都是用多个瞬时状态重新计算当前步骤，而没有保存同一 route revision 已达到的最高阶段。
- 六阶段现由纯 reducer 按 revision 和固定顺序维护；`connecting-presence` 与首次文件恢复通过同步观察提交，`ready` 或恢复标记复位不再让步骤倒退。新 revision 覆盖旧 revision，迟到的 advance、精确 clear 与 worker clear-through 都不能触碰更新进度；页面只负责异步流程和文案翻译，Store 与 Project Session 合同未增加展示回调。
- live region 已移除永久 `aria-busy`，并把 `aria-atomic` 放到 `role="status"` 节点；确定/不定 progressbar 的数值合同保持不变。动态顺序、latest-wins 和重连模式改由纯模型行为测试覆盖，源码合同只保留页面接线、失败回 Picker、静态 ARIA 与 reduced-motion。
- 审查收口验证：Project progress、route、Controller、Novel IDE Store、Workflow/World Engine Preview、Project open/presence API 与主题合同共 12 文件、67 项通过；`index.vue` script/template/style 编译通过。根类型检查本轮路径零命中，仍被未修改的 Profile SDK/工具绑定迁移、Profile command、Session migration 与 llmlint fixture 等错误阻断；未自动执行浏览器验收。

## 2026-07-28：Project cold transition 与 Session recovery

- Header、Picker、浏览器前进后退和冷启动深链只提交 route intent，由 `index.vue` 的单一 transition 串行处理。保存取消或失败发生在 release 前，旧 Project 与 URL 保持；release 开始后停止 Workspace SSE 和 consumer、清空旧 Project surface，再打开目标。
- `ProjectSessionController` 只拥有本标签页 open/presence。普通切换不会调用 `/api/projects/close`；打开、presence、文件树或标签恢复失败统一释放并回到裸 `/` Picker，不恢复旧 Project。opening/reconnecting 显示不可编辑空态。
- `projectSurfaceActive` 同时要求 controller ready、ready root 等于 `currentProjectRoot` 和页面 bootstrap 完成。Workspace SSE 绑定 ready revision；断线立即停止，新 revision 后重订阅，旧代事件丢弃。Workflow/World Engine Preview 使用相同 cold transition。
- Picker 新增默认折叠的“需要确认的会话”。首次展开才分页请求 `scope=all&recovery=required`，可把 Session 重绑到现有 Project 或明确改为 Workspace Root Session；成功后就地移除，错误走统一通知。没有增加搜索、排序或新的 Project 字段。
- recovery 重绑只修复 durable Session metadata。它校验 Project Lifecycle snapshot，而不要求目标已经 open，也不会建立 presence 或 occupancy；Windows 大小写别名会规范到 Lifecycle 发布的真实目录拼写。执行 Session 时仍由 invocation admission 打开并捕获 exact ready generation，不放宽 strict-open 数据面。
- 原实现错误地在重绑时调用 `requireActiveReadyProject()`，导致 Picker 中选择真实但尚未打开的 Project 也返回 `PROJECT_NOT_OPEN`。现有 Harness 回归覆盖“未打开但存在可重绑且 occupancy 为零”和“不存在时 metadata 不变”，route seam 覆盖成功委托、`404 / PROJECT_NOT_FOUND` 与运行中 `409 / current_project_rebind_forbidden`。
- 用户浏览器实测发现页面一直显示“正在打开 Project”：Network 中 presence 长连接 pending 是正常 SSE 形态，但当时响应始终为 0 字节。根因是 route 在 H3 `eventStream.send()` 前等待 `push(presence_ready)`，与 `TransformStream` reader 背压互锁。修复后 route 先启动 send，再推首帧；首帧失败会 close 并 release。localhost 实测已立即收到 200 SSE 与匹配 `presence_ready`，旧死锁连接需要刷新页面重建。
- 两个 Preview 的首次数据加载失败现在都会释放 ready presence 并清空选择；普通刷新失败继续保留当前 Preview Project。最终组合验证为 Session/HTTP/Project/页面合同 12 files / 90 tests，catalog/repair 4 files / 40 tests，presence route/Controller/parser 3 files / 19 tests。根 typecheck 的本轮 Preview 错误已归零，仍被其它在途 Profile worker 3 项和 llmlint fixture 26 项阻断。其余 transition/recovery 浏览器验收仍按仓库规则留给用户。
- 主页面现在显式消费 Controller terminal `failed`：停止 Workspace SSE、释放本标签页 presence、清空 Current Project surface 并规范到裸 `/`，不重复弹出 Controller 已报告的领域错误。普通 reconnect 继续显示不可编辑空态，新 ready revision 后才恢复数据面。
- Workflow/World Engine Preview 按 `projectRoot + readyRevision` 加载并同时校验 selection revision。离开 ready 立即清空旧数据；首次 open 与 reconnect 共用同 generation Promise，迟到请求和旧 `finally` 都不能发布结果或关闭新 generation loading。
- recovery 列表 append 按 `sessionId` 去重；成功移除一项时同步把下一页 offset 减一，连续重绑不会因实时列表前移而跳项。本轮 Controller/页面/两个 Preview/Picker 组合回归为 5 files / 17 tests 通过；仍未自动执行浏览器验收。

## Relative documents refs

- [Task 118 README](../118-project-catalog-snapshot-path-integration/README.md) — 第三批身份改名与回归修复背景；本任务 W1 是该回归在 Agent session 面的漏网收尾
- [Task 118 PLAN-batch3-recovery](../118-project-catalog-snapshot-path-integration/PLAN-batch3-recovery.md) — A–E 问题分类与 slice 2 边界
- `reference/workspace/TERMS.md` — Workspace Root / Project Workspace 术语

## User Request / Topic

用户在第三批回归修复验收后提出（2026-07-27）：

1. **项目选择界面要做**：`http://localhost:3000/` 应为「无 project 打开状态」，呈现类似 JetBrains 系 IDE 的项目选择界面，而不是自动打开某个项目。
2. **session 多次请求进行谨慎地优化**：点击 Agent 面板的「Session 列表」按钮会触发两次不同参数的 sessions 请求（外加一条 config bootstrap）。
3. 前置 bug（同轮诊断确认、用户默许修复方案）：**Agent session 列表返回空**——第三批改名在 Agent session 面漏网。
4. 后续视觉反馈：项目选择首页过于单调，按用户选择的“编辑工作台”方向优化，但不增加封面、搜索、排序或新的 Project 数据合同。
5. 第二轮视觉反馈（2026-07-28）：横向项目卡仍不像书架，改为封面主导的竖版书架，并查清 `/api/projects` 真相源与封面承载方式。

## Current State（诊断结论，2026-07-27 只读调研）

### W1 前置 bug：session 列表空

- 磁盘 session header 存旧形态：`"workspaceKey": "workspace/ming-ding-zhi-shi"`；服务端 `session-repo.ts:370` 按 `summary.workspaceKey !== input.workspaceKey` **精确匹配**。
- 第三批改名后 `currentNovelId` 变单段，`AgentChatSurface.vue:396` 的 `workspaceKey` computed 直接消费它 → 请求发 `workspaceKey=ming-ding-zhi-shi-2` → 与磁盘 `workspace/ming-ding-zhi-shi-2` 不匹配 → 全滤掉。同一调用里 `projectPath` 补了 `workspace/` 前缀（`:869`），`workspaceKey` 漏了。
- **数据完好、无污染**：全量扫描 499 个 session，形态分布 = `workspace/<root>` 265 + `global` 233 + `user-assets` 1，**零个单段形态**（改名后没有新 session 被写成错误形态），不需要数据迁移。
- 疑似既有 bug（顺带查清）：`ProfileTemplateVisualEditor.vue:498` 构造 `novel-${currentNovelId}` 查询——该形态在磁盘上零命中，该面板的 session 列表可能一直为空；`:1119` 的 createSession 也用单段。

### W2 现状：首页自动打开项目

- `index.vue` `initializeWorkspaceFromRoute()`：裸 `/`（default 分支）→ `switchToNovelWorkspace()` 自动打开默认项目，`normalizeNovelRouteQuery()` 再把 URL 重写成 `?project=<root>`。「无项目状态」从未存在。
- URL 指向不存在项目时 fallback 到 `list[0]` 并通知（`notifyProjectRouteFallback`，批次 4 修好正则后该链路已恢复）。
- 已有素材：`NovelBookshelfDialog.vue`（314 行）= 完整书架 Dialog（卡片网格 + 就地新建表单 + 删除 + 当前项高亮 + 未保存拦截），列表逻辑全部依赖 store（`novels` / `switchNovel` / `createNovel` / `deleteNovel` / `ensureDefaultNovel`）。
- C 类竞态背景：前端在 open 完成前发 `config/bootstrap` 等数据面请求 → 后台 409 错误栈（还会连带触发 youch source-map wasm 崩溃噪音）。选择界面把「进入项目」变成显式动作后，入口路径的这类竞态自然收窄，但 bootstrap 全面竞态修复不属本任务。

### W3 现状：Session 列表按钮的请求链

- 点按钮 → `openSessionDialog()` → `await ensureSessionReady()`：首次时 `refreshSessions()` 拉一次（默认 query，无 offset 那条 URL）→ 对话框打开 → 对话框组件按自身筛选条件再拉一次（`includeArchived=false&offset=0` 那条）。
- `ensureSessionReadyInternal` 对已加载列表有 early-return（`:842`），重复拉只发生在首次打开；`session-list-request-guard` 已提供 latest-wins 去重。
- 第三条 URL 是 `config/bootstrap`，与该按钮无关（页面级触发），W3 不动 config 面。

## ADR / Decisions

- **D1（W1 修向）**：前端投影回旧形态，服务端 session 存储与过滤不动——`workspaceKey` 的服务端收口属 Task 118 slice 2，不提前、不做双形态兼容读。
- **D2（W2 路由语义）**：URL 即状态。裸 `/` = 项目选择界面（不自动跳上次项目）；`/?project=<root>` = 打开项目。刷新页面带着 query 天然「记住当前项目」，选择页把最近项目排前即可，不引入「自动重开上次项目」偏好项。
- **D3（W2 退出语义）**：「返回项目列表」= disconnect 本窗口 presence + 路由回 `/`，**不调用强制 close**。多窗口在场时另一窗口不受影响，从根上绕开 close 409 的展示问题（close API 的 409 语义保持第二批拍板不变）。
- **D6（书架 Dialog 去留，2026-07-27 实施前追加拍板）**：**项目选择界面替换书架 Dialog**，`NovelBookshelfDialog.vue` 删除，顶栏「书架」按钮改为回到选择界面。理由：顶栏本来就有项目下拉可快速切换（`handleSwitchNovel` 已带 World Engine 草稿确认 + 未保存三选），保留 Dialog 会出现两个语义重合的入口和两条切换代码路径。该决策取代原计划里「抽公共 `NovelBookshelfGrid` 供两者共用」的方案——只剩一个消费方后不需要中间层，卡片/表单 markup 直接落在选择界面里。
- **D4（W2 fallback 目标）**：URL 指向不存在的项目时，从「fallback 到 list[0]」改为「落到选择界面 + 通知」，语义更自然。
- **D5（W3 方向）**：列表加载收敛到对话框组件单一入口，`openSessionDialog` 不再预拉；`ensureSessionReady` 保留给真正需要恢复 active session 的调用点（mounted、发消息前）。若实施时发现对话框渲染依赖 ensure 产物，退回保守方案（打开时仅在列表未加载过时预拉一次并让对话框跳过首刷）。
- **D7（项目选择页视觉，2026-07-27）**：采用克制的编辑工作台，而不是营销首页或模拟实体封面墙。顶部使用现有品牌语言，项目卡只消费标题、摘要和更新时间，以主题变量构成书脊视觉；不为本轮增加封面字段、搜索、筛选或排序。
- **D8（封面书架，2026-07-28）**：D7 的“无封面横向卡片”被用户第二轮反馈取代。`project.yaml` 增加可选 `cover`，只接受 Project Workspace 内 PNG/JPEG/WebP 的可携带相对路径；列表 snapshot 只投影该字符串，不为每本书探测文件。图片通过只接收 `projectRoot` 的专用只读端点返回，真实文件路径始终由服务端 manifest 决定；无效路径、缺失文件或损坏图片只回退到排版封面，不让 Project 从列表消失。

## 实现计划

### W1：session workspaceKey 投影修复（前置，最小改动）

1. `AgentChatSurface.vue:396` `workspaceKey` computed：novel 分支改为 `` ideStore.currentNovelId ? `workspace/${ideStore.currentNovelId}` : "workspace" ``，注释标注「旧 workspaceKey 形态投影，slice 2 随 SessionMetadata 收口删除」。11 个消费点随之恢复：sessions 查询、createSession、localStorage 草稿 / last-session / inline-editor-session key（key 恢复旧形态恰好找回改名前的记忆指针）。
2. 审计其余 workspaceKey 构造点并统一为同一投影：`ProfileTemplateVisualEditor.vue:498`（先 git 考古 `novel-` 前缀原语义再改）与 `:1119`；`AgentModeSessionSidebar` 的 `workspaceKey` prop 传入链核对。
3. 不动：服务端 session 存储/过滤、`agentWorkspaceRoot` computed（已是标注过的 slice 2 项）、workflow `runs.post` 的 `workspaceKey`（上轮已投影为 `workspace/<root>`，与磁盘形态一致）。
4. 验证：受影响组件单测；dev server 冒烟 `GET /api/agent/sessions?workspaceKey=workspace/<root>&...` 返回非空；浏览器验收（ming-ding-zhi-shi-2 应看到原有全部 session）待用户。

### W2：项目选择界面（主体）

1. **组件拆分**：从 `NovelBookshelfDialog.vue` 抽出 `NovelBookshelfGrid.vue`（卡片网格 + 就地新建表单 + 删除 + 空态），Dialog 与选择页共同消费；差异经 props/emit 表达——Dialog 场景保留 `beforeWorkspaceSwitch` 未保存拦截，选择页场景无已打开项目、点击即 `emit("open", projectRoot)`。
2. **选择页**：新建 `ProjectPickerScreen.vue`（全屏布局：产品名 + 项目网格 + 新建 + user-assets 入口），由 `index.vue` 在「无项目状态」渲染；空项目列表显示「新建第一本书」，不再依赖 `ensureDefaultNovel` 自动建库（该函数语义实施时核对，书架 Dialog 行为不变）。
3. **路由与初始化**：`initializeWorkspaceFromRoute` 的 default 分支改为置「无项目状态」（不 `switchToNovelWorkspace()`、不发项目数据面请求）；`normalizeNovelRouteQuery` 仅在已打开项目时重写 URL；不存在项目的 fallback 按 D4 落选择界面。store 需要新增/放行「未选择项目」合法状态，逐点核对 `workspaceBootstrapped` / `workspaceRouteSynced` / openPath 消费与顶栏、左栏对该状态的渲染守卫（依赖当前 project 的入口在选择页一律隐藏）。
4. **退出入口**：顶栏加「返回项目列表」（D3：disconnect + 路由 `/`）；现有书架 Dialog 入口保留不动（后续按使用情况再决定去留）。
5. i18n 中英文案同步。
6. 验证：`index.vue` 路由初始化单测（裸 `/`、`?project=存在`、`?project=不存在`、user-assets 四态）；浏览器走查（选择/新建/删除/返回列表/多窗口 presence）待用户。

### W3：session 列表请求收敛（谨慎，最后做）

1. 按 D5 改 `openSessionDialog`；实施前先读 `AgentSessionDialog` 的 open watch 与数据依赖，确认列表首刷归属对话框后无渲染空窗。
2. 保持不变的合同：`session-list-request-guard` 的 latest-wins、`ensureSessionRequest` 去重、mounted / 发消息前的 `ensureSessionReady` 语义。
3. 验证：现有 guard/pagination 单测全绿；手动 network 走查确认点击按钮 = 恰一次 sessions 请求（首次）/ 零次（列表已加载）。

## 边界 / 不做

- 不动服务端 session 存储、过滤与 `SessionMetadata`（Task 118 slice 2）。
- 不做 `config/bootstrap` 竞态的全面修复与 youch source-map 崩溃（Task 118 C/E 类），W2 仅自然收窄入口路径的触发面。
- 不改 close API 的 409 语义（第二批拍板）。
- W3 不动 config 面请求。

## Implementation Walkthrough

实施日期 2026-07-27，按 W1 → W2 → W3 顺序落地。

### W1：session workspaceKey 投影修复

- 新增 `app/utils/agent-workspace-key.ts` 的 `legacyAgentWorkspaceKey(workspaceKind, projectRoot)`，作为前端唯一投影点（`user-assets` 保持独立命名空间；空 projectRoot 退化成 `workspace`），注释标注随 slice 2 删除。
- 四个构造点收口：`AgentChatSurface.vue` 的 `workspaceKey` computed、`app/pages/index.vue` 的 `agentWorkspaceKey` computed、`ProfileTemplateVisualEditor.vue` 的 `loadThreads()` 与 `createSession()`。前两处修的是本轮空列表 bug，后两处顺带修掉了先于本轮存在的 `novel-<root>` 形态（该形态磁盘零命中，「预览变量线程」下拉一直为空）。
- 全仓复查确认再无手拼 workspaceKey 的地方（`app/stores/novel-ide.ts` 的 `workspaceSessionKey` 是 localStorage 会话记忆键，与 Agent session 无关，未动）。

### W2：项目选择界面

- 新增 `app/components/novel-ide/ProjectPickerScreen.vue`：全屏欢迎布局（标题 + 项目卡片网格 + 就地新建表单 + 删除 + user-assets 入口）。挂载只调 `loadNovels()`，**不经过 `ensureDefaultNovel`**，因此零项目时是真空态而不是自动建库。组件不感知 URL，只 `emit("open", projectRoot)` / `emit("open-user-assets")`，并提供纯 UI 的 `header-actions` slot。
- `index.vue` 通过该 slot 注入与 IDE 顶栏共用的 `NovelIdeAccountMenu`，因此裸 `/` 和零 Project 状态也能打开个人中心、管理员后台或退出本地登录；项目选择组件本身不依赖认证 API。
- 删除 `app/components/novel-ide/NovelBookshelfDialog.vue`（D6）。index.vue 两处 `@open-bookshelf`（顶栏、Markdown Studio 欢迎页）改为 `void openProjectPicker()`。
- store 新增 `closeProjectWorkspace()`：复用 `initializeWorkspace` 零项目分支的那组清理（`clearActiveChapter` / `clearActiveFile` / `clearWorkspaceState` / `novelTree = null`）并先 `persistWorkspaceSession()`，只动内存不发请求。
- index.vue 接线：
  - `projectPickerActive` 为派生 computed（`workspaceBootstrapped && !isUserAssetsWorkspace && !currentNovelId`），裸 `/`、URL 指向不存在项目、删掉最后一本书三条路径自动收敛到同一状态。
  - `initializeWorkspaceFromRoute` default 分支改为 `closeProjectWorkspace()`；project 分支在项目不存在时 `closeProjectWorkspace()` + 通知 + `router.replace("/")`（D4），不再 fallback 到 `list[0]`。
  - `workspaceRouteSynced()` 裸 `/` 判据从 `workspaceKind === "novel"` 改为 `!currentNovelId`，使「项目页浏览器后退到 `/`」判为未同步，走完整 `syncWorkspaceRoute`（World Engine 草稿确认 + 未保存三选）。
  - `openProjectPicker()`：草稿确认 → 未保存三选（取消时 URL 完全不动）→ `closeProjectWorkspace()` → `router.push("/")`。presence 由 `projectSessionTarget` 变 null 自动断开，不调用强制 close。
  - `openProjectFromPicker()`：只 `router.push(buildProjectRoute(root))`，真正的切换交给 route watch 统一执行；用 push 保证浏览器后退能回到选择界面。
  - 模板：`<ProjectPickerScreen v-if="projectPickerActive">` 插在根容器首位，`<NovelIdeHeader>`、主体 flex 容器、`WorldEngineWorkbenchDialog` 各加 `v-if="!projectPickerActive"`；其余 Dialog 靠自身 `v-model` 关着，未逐个加守卫。
- i18n 新增 `ide.picker.*`（标题/副标题/加载/加载失败/空态/user-assets 入口）中英各 6 条；卡片与新建表单继续复用 `ide.bookshelf.*`，未改键名。

### W2 视觉收口（2026-07-27）

- 页面改为固定品牌栏 + 1120px 编辑工作台主体，账户菜单继续通过 `header-actions` slot 注入；用户资产与新建书籍移到首屏主操作区，不再把用户资产入口放在长列表末尾。
- 项目区按宽屏三列 / 中屏两列 / 移动端单列排布，卡片降至 132px 并使用主题变量构成书脊图标区。打开项目与删除改为两个兄弟按钮，消除可点击 `div` 和嵌套交互风险，键盘 Enter 可激活主按钮。
- 新建表单移出网格成为独立工具面板；加载态使用等尺寸骨架；列表读取失败改为持久错误详情 + 重试；零项目使用独立空态。日期按当前语言格式化，缺失或非法值不再显示 `NaN`。
- 未拆新组件、未改 `index.vue`、路由、store 或 Project API；新增文案仍位于 `ide.picker`，用户可见文案不再出现 `workspace` 内部术语。

### W2 封面书架（2026-07-28）

- 页面从 132px 横向信息卡改为 2:3 竖版封面网格，宽屏五列、中等四列、移动端两列；真实封面填满书封，无封面或加载失败时显示由标题、羽毛和装帧线构成的排版封面。书名、简介和资料更新时间位于封面下方，卡片不再承担主要视觉。
- 保留品牌栏、账户菜单 slot、用户资产、新建表单、loading/error/retry/empty、删除确认和打开/删除兄弟按钮语义；未拆出只服务这一页的新组件，未新增搜索、排序或 Project store。
- `project.yaml` 成为封面引用真相源，`ProjectMetadataDto` 增加可选 `cover`。路径不能是 URL、绝对路径、父目录、反斜杠路径、`.nbook`/`.git` 控制目录或非 PNG/JPEG/WebP 文件；非法值按未设置处理。
- 新增 `GET /api/projects/cover?projectRoot=...`：先查同一 Lifecycle snapshot，再读取 manifest 已授权路径；服务端复核 Project/封面 realpath、普通文件、20MB 上限、扩展名和图片魔数，返回 `nosniff`、ETag 与条件缓存。客户端没有传任意文件路径的入口。
- 顺带修复 Project metadata 的两个既有 identity 合同断裂：create 由标题派生 `projectRoot`，请求体不再错误要求客户端提供；update 的 `projectRoot` 只来自 query，metadata body 不再携带一份会被忽略的重复 identity。

### W2 封面管理与懒加载变体（2026-07-28）

- 书架封面切换到 `preset=project-cover` 的 384×576 WebP 变体，继续 lazy loading、异步解码和固定 2:3 排版；`/api/projects` 不承担图片 I/O。
- 每本书新增独立封面设置按钮；Dialog 支持本地预览、原始 PNG/JPEG/WebP 上传替换、清除确认、持久错误与重试。成功后直接应用服务端返回的 Project metadata，并只重建对应图片。
- Dialog 现在消费 Project HTTP `committed`：`true` 或 `unknown` 都先重新读取 Project snapshot，刷新失败时同一 Project 的封面操作持续禁用且可显式重试。浏览器声明 MIME 为空时交给服务端按 bytes 裁决，`image/jpg` 规范化为 JPEG。
- 完全没有 HTTP response 的 ofetch 错误也按 unknown 处理，不自动重放上传或清除。恢复记录按 `projectRoot` 隔离；打开其它 Project 不覆盖旧门禁，任一次完整 Project snapshot 成功后会刷新所有待恢复封面并解除现有门禁。
- 封面预览复用共享原图 Dialog，只有点击后才请求无参数原图并提供下载；客户端永远不能提交或猜测封面目标路径。
- 已保存封面的下载文件名由服务端按 manifest basename 返回，保留 PNG/JPEG/WebP 的真实扩展名；本地待上传 Blob 仍使用用户原始文件名。
- 后端 mutation、共享变体和 Product native 合同归 [Task 132](../132-shared-image-variants-project-covers/README.md)；本任务继续持有书架交互与待浏览器验收清单。

### W2 封面恢复结算状态机（2026-07-29）

- 完整 Project snapshot 的恢复结算从页面副作用中提取为纯函数：输入按 Project 保存的恢复记录、snapshot、发起刷新时捕获的 Project root 和当前 Dialog root；一次输出清空后的门禁、需要 cache-bust 的 Project roots，以及当前 Dialog 的 `none | unknown | committed | missing` 事实。
- 页面只应用结算结果：批量刷新封面版本并清除旧加载失败，`unknown` 更新真实 metadata 后保留提示，`committed` 更新事实后关闭 Dialog，`missing` 关闭 Dialog 并提示 Project 已删除。
- 两本书可独立保留恢复门禁；任一次完整 snapshot 成功会解除当时全部记录。A 的迟到刷新在 Dialog 已切换到 B 时不会改写 B，未知提交仍不会自动重放 mutation。

### W3：session 列表请求收敛

- `AgentChatSurface.openSessionDialog` 去掉 `await ensureSessionReady()`，改为同步置 `sessionDialogOpen = true`；列表首刷唯一归 `AgentSessionDialog` 的 open watch。`ensureSessionReady` 在 mounted / 发消息前的调用点未动，`session-list-request-guard` 与 `ensureSessionRequest` 合同不变。未触发计划里的保守回退分支。

### 与计划的出入

1. **书架 Dialog 从「保留」变成「删除」**：实施前追加拍板（D6），原计划的「抽 `NovelBookshelfGrid` 共用」随之取消——只剩一个消费方，markup 直接落在选择界面。
2. **进入项目改为 push 而非 replace**：计划写的是选择界面自己 `router.push`，实际由 index.vue 的 `openProjectFromPicker` 统一处理，理由是 `buildProjectRoute` 属页面私有；顺带把「后退回选择界面」做成确定行为。
3. **`discardOpenPathForProjectFallback` 整体删除**：D4 落地后唯一写 true 的点消失（openPath 随 `router.replace("/")` 一起丢弃），连同 `consumeWorkspaceOpenPathFromRoute` 里的对应分支一并清掉。`notifyProjectRouteFallback` 简化并改名 `notifyMissingProjectRoute`（去掉 fallbackTitle 逻辑，去重游标改在成功打开项目时重置）。
4. **`world-engine-ide-entry.test.ts` 断言改写**：删除 3 条书架源码断言与 `:before-workspace-switch` 断言（World Engine 草稿保护改由 `syncWorkspaceRoute` / `handleSwitchNovel` 两条已有断言承担），fallback 相关 6 条断言改写为新语义。

## Verification / Test

- `bun run vitest run app/utils/world-engine-ide-entry.test.ts`：1/1 通过。
- `bun run vitest run app/components/novel-ide/agent app/stores`：26 文件 151 用例，**1 项失败且先于本轮**——`agent-composer-reference.test.ts` 仍按旧合同传 `"workspace/my-book"`，而批次 4 已把 `completeProjectFileAddress` 改成只接受单段 projectRoot（`!normalizedRoot.includes("/")` 守卫）。属 Task 118 批次 4 的测试遗漏，本轮未改（等用户确认后把用例入参换成 `my-book` 即可）。
- `bun run vitest run app/utils/novel-writing-mode-entries.test.ts app/components/novel-ide/rag/NovelRagPanel.contract.test.ts`：10/10 通过（另两个断言 index.vue 源码的套件）。
- `bun run typecheck`：26 个错误，全部在 `server/agent/skills/llmlint.test.ts`（`NormalizedLlmlintConfig.ignoreTerms` 漂移，先于本轮），本轮新增 0。
- dev server 冒烟（W1 直接证据）：`GET /api/agent/sessions?workspaceKey=workspace%2Fming-ding-zhi-shi-2&status=active&relation=all&limit=50` → `total: 155`；同一接口传单段 `ming-ding-zhi-shi-2` → `total: 0`。
- **2026-07-28 更正**：当时只证明 `/api/agent/jobs` 不是 Project-scoped，不能据此推导选择页不会请求它。`index.vue` 与常驻 `AgentJobsDialog` 实际无条件持有 Jobs feed；在 fork worker 争用 `runtime.lease` 时，选择页会把恢复快照错误直接暴露出来。这是 Project Picker 的真实集成缺陷，已由下方生命周期补漏修复。
- **浏览器验收待用户**（我不自动做）。
- 账户入口与 Profile 三态源码合同测试通过；浏览器仍需覆盖裸 `/` 打开个人中心、设备码关联、备份与取消关联。

### 2026-07-27 项目选择页视觉收口验证

- `bun run test -- app/components/novel-ide/profile/novel-ide-profile.contract.test.ts app/utils/theme/theme-tokens.test.ts`：2 文件、8 用例全部通过；账户菜单 slot、认证边界和主题变量合同未回归。
- `bun run typecheck`：失败项均在本轮未改的 Agent workspace 合同迁移与 llmlint fixture；`ProjectPickerScreen.vue` 和两份 i18n 文件零命中。
- Playwright 真实列表与请求 mock 验证通过：加载骨架、503 错误详情、重试恢复为空态、零项目、长标题、无断点长单词、长摘要、缺失 / 非法更新时间、新建与 Esc 取消、删除确认取消、账户菜单、用户资产新标签页、项目卡原生 button 与 Enter 激活。
- 视觉矩阵通过：1440×900 三列、1024×768 两列、390×844 单列及移动端新建表单；Sepia 与 Dark 均无横向溢出或元素遮挡。Dark 验证通过临时应用内置 token 完成，不修改用户配置。
- **更正后的归因**：forked dev worker 与第二服务确实是 `runtime.lease` 争用来源，但选择页无条件挂载 Jobs feed 让不需要后台任务的页面参与了该链路，不能全部记为环境噪音。Project API 与 Picker 模板本身未命中错误栈这一点仍成立。

### 2026-07-28 封面书架验证

- `bun run test -- server/api/projects/cover.get.test.ts server/workspace-files/project-cover.test.ts shared/project-cover.test.ts shared/dto/project.dto.test.ts server/api/projects/index.get.test.ts app/stores/novel-ide.test.ts app/components/novel-ide/profile/novel-ide-profile.contract.test.ts app/utils/theme/theme-tokens.test.ts`：8 文件、30 项全部通过。
- `bun run test -- server/workspace-files/project-lifecycle.test.ts server/workspace-files/project-session.test.ts server/workspace-files/project-session-service.test.ts server/workspace-files/project-workspace-delete.test.ts server/workspace-files/workspace-archive.test.ts`：5 文件、127 项通过、1 项跳过。
- `bun run typecheck`：仍只被既有 `server/agent/skills/llmlint.test.ts` 的 26 项 fixture 类型漂移阻断，本轮 Project/封面/Picker 文件零命中。
- 按仓库规则未自动运行浏览器验证。尝试启动本地开发服务时，被真实 State Root 的 Application State catalog 1 → 2 迁移门禁正常阻止；本轮未擅自执行 `bun run migrate:application-state -- --apply`，因此没有可访问的本地 URL。5/4/2 列书架、真实封面、失效封面回退、Sepia/Dark 和 390/1024/1440 视口仍待用户授权并先完成状态迁移。

### 2026-07-28 封面事务恢复审查收口

- 新增前端 Project mutation error 解析，覆盖 `$fetch` 两种响应结构以及 `false`、`true`、`unknown`；普通或畸形错误不伪装成事务事实。
- 共享 raster MIME 合同替代聊天、附件面板和 Composer 的重复集合；非图片 Attachment 只下载原件，Composer 入口再次 fail closed。
- 空 `File.type` 的真实 multipart、无 response transport unknown、多 Project 独立恢复与完整 snapshot cache-bust 已补齐；未知提交不会自动重放 mutation。
- 此前位于 `app/components/novel-ide/` 根目录的图片体验合同未被 Vitest include 收集；include 已收口为整个 Novel IDE 测试树。本轮聚焦 5 files / 26 tests 真实通过，Project 列表轻量门禁 1 file / 9 tests 通过。

### 2026-07-28 Jobs feed 生命周期补漏

- `index.vue` 不再无条件消费 Jobs feed。徽标数据由只在 `projectSurfaceActive` 时挂载的 `NovelIdeHeader` 直接消费；`AgentJobsDialog` 只在工作面激活且窗口打开时挂载，工作面失活会把打开状态重置为 false。
- 裸 `/` Project 选择页现在没有任何 Jobs consumer，不会请求 `/api/agent/jobs` 或 `/api/agent/jobs/events`。Project/User Assets 工作面首次进入仍读取一次快照并维持一条共享 SSE；离开工作面只断前端连接，不取消后台 Job。
- 初始快照失败仍按退避恢复；成功后推进五分钟不产生周期 GET。`bun run dev` 同时固定为 `nuxt dev --no-fork`，避免同一 State Root 的 Nuxt worker 交接竞争唯一 `runtime.lease`；已运行的旧 dev 进程必须完整重启才生效。
- 聚焦验证为 5 文件、32 项通过；根 typecheck 只剩既有 llmlint fixture 26 项错误。按规则未自动执行本轮浏览器验收。

### 2026-07-29 封面恢复状态机回归

- 纯结算测试覆盖两本书独立恢复、一次 snapshot 清除全部、`unknown`、`committed`、Project missing、无匹配恢复，以及 A 响应迟到时 B 不受影响。
- 前端源码合同锁定页面消费纯结算结果，不再依赖内联循环或单例恢复 root。浏览器验收仍按原 TODO 保留。

## TODO / Follow-ups

- [x] W1 实施 + 冒烟
- [x] W2 实施 + 单测
- [x] W3 实施
- [x] `ProfileTemplateVisualEditor` `novel-` 前缀 git 考古结论回填（HEAD 同样是 `novel-<root>`，磁盘零命中，属既有 bug，本轮统一投影后首次修好）
- [x] 项目选择页视觉与局部状态浏览器走查：真实列表、loading / error / retry / empty、极端文本、新建 / 删除取消、账户菜单入口、用户资产新标签页、响应式与明暗主题。
- [x] Project 选择页移除 Jobs feed consumer，Source dev 固定 `--no-fork`。
- [ ] 封面书架浏览器走查：真实/缺失/损坏封面、5/4/2 列密度、长标题、触屏删除按钮与 Sepia/Dark 对比度。
- [ ] 封面管理浏览器走查：空 MIME 上传、上传响应丢失、两本书分别保留恢复门禁、上传/替换/清除、原图预览与正确扩展名下载、普通失败重试、committed true/unknown 刷新门禁和 mutation 后单图刷新。
- [ ] 浏览器走查其余跨页面链：冷启动深链、Picker/Header切换、快速 A→B→C、未保存三选、打开失败回 Picker、后退前进、presence 断线重连与 SSE 新 revision、两个 Preview 快速切换、多标签/后台 Agent 不受普通切换影响；Session recovery 需分别验证重绑 Project 与改为 Workspace Root。
- [ ] `agent-composer-reference.test.ts` 用例入参改单段（Task 118 批次 4 遗留，待用户确认）

### 2026-07-31 Catalog 与 create/delete 恢复收口

- Picker 不再直接 `splice` 或赋值项目列表；create/delete/cover 都调用唯一 Store action。任意完整 Catalog snapshot 同时结算请求开始时捕获的 create、delete 与 cover 恢复记录。
- create 使用单一恢复门禁，delete 按 `projectRoot` 隔离；每次恢复都有组件生命周期内不复用的 attempt。旧成功或旧失败响应只能结算相同 attempt，不能清除同一 Project 后发起的新恢复。
- create 的 `committed: true` 刷新后关闭并清空表单，`unknown` 保留输入让用户核对；delete snapshot 缺失目标时清理本地 workspace session，目标仍存在时解除门禁并允许显式重试。刷新失败保留持久错误，所有重试都只读取 snapshot，不自动重放 mutation。
- World Engine Preview 的独立创建入口采用相同 transport-unknown、attempt 和刷新事实规则，但仍保持页面局部状态，不接入主 IDE Store。创建链拆成 POST、Catalog 刷新、Project 激活三段：POST 成功后 Catalog 失败按 `committed: true` 保留已知 root 和恢复门禁；Catalog 成功但激活失败只显示激活错误，不把已提交创建误报为失败，也不重放 POST。
- 深链进入 Project 不再以 Catalog 成员关系预判；ProjectSession open 是存在性真相源。open 成功后文件树立即继续加载，Catalog 在后台 best-effort 刷新，慢请求或失败不会撤销 ready Project；Catalog 缺失时 workspace 地址仍由当前 root 正确投影，顶栏以 root 回退显示。
- Store mutation 成功后始终回读服务端完整 Catalog，因此书架排序只由 Lifecycle snapshot 决定。发布对象、数组和 metadata 元素均为只读冻结值，组件不能再通过嵌套对象修改 Catalog。
- 自动化覆盖同 Project attempt 1/2 ABA、多 Project 独立恢复、create true/unknown、delete missing/present、失效 GET 成功/失败追读、mutation 权威回读、direct-open 与 Preview 三阶段行为。本轮最终一次性回归 13 files / 77 tests 通过；封面、慢 Catalog 深链、Preview 激活失败、响应丢失与多 Project 恢复仍按仓库规则留给用户浏览器验收。

### 2026-07-31 Preview 创建行为边界与 Settings 目标收口

- World Engine Preview 不再在页面函数里手工拼接 POST、Catalog 刷新和恢复分支。页面专用 `world-engine-preview-create` utility 返回 `rejected | settled | refresh_failed`，并显式携带 commit state、已知 root 与 activation 结果。
- POST 普通失败不会读取 Catalog；POST 成功后刷新失败保存 `committed: true` 和服务端已返回的 root；transport unknown 不猜 root。恢复刷新只接收 Catalog/activation 能力，类型层没有 POST，因此每次用户动作最多创建一次。
- Catalog 已刷新但 Project 激活失败时，创建事实仍结算为 committed：表单按已提交语义清理，页面保留 activation 错误，不显示“创建失败”或进入 mutation 重试。
- Settings 同步删除 Project Catalog 与跨 Project selector，只展示当前打开 Project；metadata 缺失时回退 root。该改动减少一次无必要列表请求，也消除了选择未打开 Project 后必然触发 `PROJECT_NOT_OPEN` 的入口。
- 新增 Preview 6 项行为测试和 Settings 2 项源码合同；最终相邻合并回归 13 files / 77 tests。根 typecheck 本轮文件零错误，未修改的 Skill 声明、Session migration 与 llmlint fixture 仍阻断全仓通过。

### 2026-07-31 Agent Composer 首次激活与只读态收口

#### 诊断与实现

- 真实浏览器复现确认：`AgentChatSurface` 初次以 `active=true` 挂载时，旧 active watcher 没有 `immediate`，`onMounted` 又只加载 config，导致完全不请求 Session 列表；关闭再打开面板才触发恢复。`activeSummary=null` 同时被旧投影误判成 Profile 不可用。
- `AgentSurfaceActivationController` 只负责 Surface 激活状态与 recovery single-flight；`AgentSurfaceOperationController` 负责 Project/Inline/Prompt Bar 操作的发布权。数据面 owner 由 `projectRoot + readyRevision + activationRevision` 组成，Session/SSE 再校验 `sessionId` 或 connection generation；草稿和 last-session 记忆仍使用稳定的 `project:<root>`，没有把运行代次写进持久化 identity。
- Project reset 在首个 `await` 前停止主/Inline stream、失效列表与 recovery 请求并清空旧 UI。草稿持久化可以自然完成，但只有仍拥有 reset owner 的调用才能更新 Composer generation，旧 Project 的迟到 clear 不会清掉新 Project。
- config bootstrap 收敛为同一响应快照。默认 Profile 改变会换代并重新选 Session；Profile 未变的 config revision 也会强制开启新 recovery generation。activation 只使用自己 `listSessions()` 返回的 `page.items` 选择 Session，弹窗查询只控制共享列表投影。
- `useAgentSessionStream` 增加显式强制 recovery：旧 Promise 不跨 generation 复用，旧 `finally` 只能清自身请求。recovery、SSE event、异步 event callback、live state 与 client variable patch 都校验 Session/connection owner；其他 Session 的 live state 会被 reducer 拒绝。当前代 recovery 失败进入 `load-error`，迟到成功和迟到错误静默失效。
- Inline list/load/create/invoke/stop/model 操作贯穿同一 Project owner，create 固定使用启动时捕获的 Project root，stale list 不会自动创建 Session。页面在保存文件前捕获 Surface 实例、operation key 与请求 revision，保存后、Surface 返回后及 `catch/finally` 前重新校验；旧请求不能清空新 Prompt Bar、显示旧成功通知或结束新 loading。
- Composer 改用单一判别联合投影 `ready | restoring | empty | archived | profile-unavailable | waiting-blocked | load-error | blocked`。`activeSummary=null` 不再推断 Profile 缺失；零主 Session 保持显式创建，不自动 POST。只读运行的发送位始终执行停止，即使编辑器已有草稿，草稿也不会被误发送或清空。
- 输入壳持续显示状态图标、原因和“新建对话 / 恢复对话 / 重试”，使用既有 info/warning/danger 主题变量且不整体降 opacity。通用纯文本编辑器保留 `contenteditable=false` 门禁，并补 `role=textbox`、`aria-multiline=true`、响应式 `aria-readonly`、稳定 readonly class/data attribute 与禁用光标；Composer 整体没有设置 `aria-disabled`。
- 390px 元素级验收发现模型选择器固定 320px 且禁止收缩，导致工具按钮与发送位重叠。`AgentSessionModelControls` 现允许作为 flex item 收缩，Composer 保留模型上限但让它占剩余宽度，发送按钮固定保留；没有为该局部问题新增断点或移动端布局分支。

#### 与计划的出入

1. 没有新增 ADR、共享 DTO、服务端 API、数据库或全局状态机；局部协调器已经覆盖所需所有权边界，继续上升为全局抽象只会增加概念和迁移成本。
2. `ReferencePlainTextEditor` 没有承载 Agent 文案或重状态配色；它只提供通用只读语义，Agent 状态仍由 Composer 解释，避免影响历史消息编辑器与 Prompt Bar。
3. 真实数据没有“只有归档主 Session、没有活跃主 Session”的 Project，也没有可安全复用的非空草稿运行。为避免篡改用户 Session，本轮没有为了浏览器覆盖而归档、恢复、创建或启动运行；归档投影、显式创建和只读运行停止由确定性回归覆盖。
4. 390px 只验 Composer 自身 383px 容器。Novel IDE 既有桌面 drawer 在整页 390px 视口仍位于主工作区右侧，本任务不把全局移动端重排混入激活与所有权修复，因此不声明整页移动端适配通过。
5. 没有形成可采信的浏览器 A→B→A 延迟注入或“保存文件期间切 Project”断言；这些竞态的基础发布权由 activation/operation/stream 的 deferred Promise 回归锁定，页面调用链则经过源码审查与 typecheck。若后续要把全部矩阵升级为端到端门禁，应建设可控的 Project/Session fixture，而不是在真实作者数据上注入破坏性状态。

#### Verification

- 聚焦回归：`agent-chat-surface-state`、Composer draft、Session list guard、`useAgentSession`、`useAgentSessionStream`、Composer image transaction 与 interaction policy 共 7 文件、59 项通过。覆盖初次 `active=true`、重新激活、A→B→A revision、同 scope 换代、卸载、single-flight、强制 recovery、旧成功/错误、阻塞 event callback、跨 Session event/live state 和全部 availability 投影。
- 相邻回归：Session API/pagination、client variables、Project route transition、ProjectSession 与 route progress 共 6 文件、48 项通过。
- `bun run typecheck`：全仓通过。`git diff --check` 在本轮文件没有补丁错误，仅报告仓库既有的 LF/CRLF 工作区提示。
- Playwright（Nuxt `http://localhost:3000`）：已有 Session 的 Project 在面板已打开的冷刷新中立即发出 sessions + recovery + attachments + SSE 请求，恢复到 `contenteditable=true / aria-readonly=false`；面板关闭再打开仍可输入且不重复恢复。
- 零 Session Project 只发 GET sessions，无隐式 POST；显示 warning 原因和“新建对话”，编辑根为 `contenteditable=false / aria-readonly=true / data-readonly=true`，wrapper 也有稳定 readonly 标记。
- 现有 Profile 不可用 Session 显示服务端原始原因“未找到 agent profile: leader.rp”，没有再误报为通用 Profile 缺失；用于选择该 Session 的临时 browser last-session key 已删除。
- 1440×900 的 Sepia 与内置 Default Dark 下，warning 状态的边框、软底、图标、文字和动作均可辨认；暗色检查后已恢复 Sepia，自定义主题未改。390×844 的 Composer 元素截图和 bounding box 证明全部工具/发送按钮位于自身 383px 容器内，`scrollWidth === clientWidth`。
- 新鲜页面检查未发现浏览器 error/warning 或 `unhandledrejection`。中途 dev server 因并行 Source rebuild 重启产生的 503/断流只出现在旧页面记录，重启后的验收重新建立页面并单独检查，没有把该环境噪音计入产品结论。

### 2026-08-01 Agent Composer 恢复态视觉收口

- 复查确认恢复态高度跳动来自模板结构：`restoring` 在完整编辑区与工具栏上方额外插入状态栏，因此必然比 `ready` 多一行；同时 info 软底覆盖整个输入壳，让短暂加载状态看起来像持续告警。
- `restoring` 改为在真实编辑区原位覆盖轻量 spinner 与“正在恢复对话”，底层编辑器保持挂载但不可见、不可交互。占位直接复用编辑器折叠 `44px` / 展开 `220px` 的真实布局，不新增恢复态高度常量，切换为 `ready` 时工具栏和壳体高度不变。
- `empty`、`archived`、`profile-unavailable`、`waiting-blocked`、`load-error` 与 `blocked` 仍保留持续可见的状态栏、语义色和可用操作；本轮没有改变 availability、Session recovery、草稿或只读门禁合同。
- 本轮执行聚焦 availability 回归与全仓 typecheck。按仓库规则未自动运行浏览器验收；恢复动画、明暗主题和实际像素高度仍建议在真实界面人工确认。

### 2026-08-01 Task 63 待处理输入交互的能力拆分

- Task 129 的 availability 继续只解释普通 Composer 的 `canInvoke` 与恢复状态；等待用户输入时不再把 `canInvoke=false` 复用为回答区 `readonly`。底部 pending 面板直接接收独立的 `canResolveUserInput` 与 `canAbort`，因此回答和终止能力不会被灰色 Composer 门禁误伤。
- pending 提交复用 Task 129 的 `AgentSurfaceOperationController`，并额外绑定主 `sessionId` 与有序 pending batch key。Project generation、Session 或批次变化后，旧成功、旧错误和旧 `finally` 都不能发布；这没有改变 activation/recovery/SSE 的既有所有权层次。
- 普通 Composer 在 pending 期间由面板替换但保留正文、模型和图片草稿。历史气泡只读消费完整 pending 列表，唯一提交 owner 仍在 Surface。完整实现与验证见 Task 63 walkthrough；本轮未自动执行浏览器验收。
