# Round 05 — 入口迁 IDE 顶栏 + scope 过滤(最近 / session / 无 session)

2026-07-06。用户要求:查看器入口从 AgentChatSurface 聊天顶栏迁到 IDE 顶栏(`NovelIdeHeader.vue` Plot 按钮旁),不再附在聊天面板;查看器内可过滤——某个 session / 无 session(`_system`)/ **最近请求(跨所有 bucket 聚合)**。

## 已交付

### 后端:「最近请求」聚合

- `PiTraceReader.listRecent(limit)`:遍历 bucket 目录(过白名单)→ 各 index 条目打上来源 `bucket`(目录名,不改 index 落盘 schema)→ 按 `ts` 倒序合并取前 limit。
- 新 route `GET /api/agent/traces/recent?limit=`(默认 50,钳 1..200)。静态段稳定优先于 `[bucket]` 参数路由(radix3 staticRoutesMap 先查,已核 `node_modules/radix3/dist/index.mjs:26-30`;双保险:`isValidTraceBucket("recent")` 为 false)。
- DTO:`AgentTraceRecentEntryDto = AgentTraceIndexEntryDto & {bucket}` + list 包装;`useAgentTraceApi.listRecent`。

### 前端:scope 模型

- Dialog 从「bucket 下拉」升级为「scope 下拉」:`__recent__`(哨兵值,在 bucket 白名单字符集外)+ `_system` + 各 session(标题 join 不变)。**缺省打开最近请求**。
- **撞键修复**(核心细节):trace id 是各 bucket 独立 seq,recent 聚合视图跨 bucket 会撞——新增 `traceEntryKey(entry)`(`bucket/id` 复合键),List 行 key、选中态、Dialog `selectedKey` 全部换用;List 的 select 事件从回传 id 改为回传**整条 entry**(Dialog 需要 entry.bucket 取详情)。
- recent 模式:条目带来源徽标 `sourceLabel`(Dialog 用 `bucketLabel` 预格式化传入,List 保持纯展示不引入 session/i18n 概念);清空按钮 disabled(没有单一 bucket)。
- `groupTraceEntries` 泛型化(recent 附加字段类型不丢),invocation 分组在聚合视图同样生效。
- **删除 `props.sessionId`**:唯一传它的调用方(聊天顶栏)已移除,header 语境无 session 上下文。

### 入口迁移

- `NovelIdeHeader.vue`:Plot 按钮后新增 Trace pill 按钮(emit `"open-trace-viewer"`,`i-lucide-activity`,title `ide.header.traceViewerTitle`);**不加 user-assets 门控**(trace 是 harness 级全局观测)。
- `index.vue`:标准工具弹窗模式(顶级 `traceViewerOpen` ref + 页尾挂 dialog);**trace→session 跳转**走 `openTraceSession`:先 `agentSurfaceRef.selectSession(id)` 再开面板——`loadSession` 同步落 `activeSessionId`,使随后 `:active` watcher 的 `ensureSessionReady` 提前返回,天然避开「watcher 恢复旧 session 覆盖目标」竞态(AgentChatSurface 常驻 mounted,无需 nextTick);IDE 模式补 `rightPanelOpen = true`,Agent 模式面板已可见。
- `AgentChatSurface.vue`:移除 import / `traceViewerOpen` / 顶栏按钮 / dialog 实例四处;删死 key `agent.chatSurface.traceViewerTitle`(zh/en)。

## 验证

- `bunx vitest run server/agent/observability app/components/novel-ide/agent/trace-viewer` → **27 通过**(新增 reader.listRecent 聚合/倒序/limit/空态 + traceEntryKey 撞键用例)。
- typecheck:本轮触碰的全部文件 **0 error**;全量红灯均属并行进行的 PlanMode 重构(`planModeActive`/`PlanMode*` 系列,另一会话在途),与本轮无关。
- 浏览器冒烟未执行(清单见 README「P1 验证」附加项:顶栏按钮/默认 recent 徽标/跨 bucket 选中不串/双向跳转)。

## 绕道 / 出入

- 无偏离,按批准计划执行。查看器组件期间被并行改为主题 token(`--status-*`),实现以现状为准未回退。

## 下一步

- 浏览器手动验收(或授权 Agent 验证)。
