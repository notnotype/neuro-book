# 前端领域规范

适用：`app/**` 以及 VitePress 主题中的 Vue、HTML、CSS 和客户端交互。通用与语言规则由 [`README.md`](README.md) 路由；只有 `app/**` 追加最近的 `app/AGENTS.md`。

## Vue 与交互

- 使用 Composition API 和仓库现有函数式风格；props、emits、slot 与 template ref 保持类型完整。派生状态用 `computed`，`watch` 只承载副作用并负责停止订阅、计时器和请求。
- 通用能力优先复用现有组件、错误映射、通知和面板工具；具体入口由最近的作用域 `AGENTS.md` 登记。
- 交互控件使用语义 HTML、键盘可达名称、正确的 disabled/focus 状态；图标按钮提供可访问名称或 Tooltip。用户文字面向第一次使用 NeuroBook 的普通作者。
- 列表 key 来自稳定实体身份。昂贵派生不在 template 重复调用；布局尺寸使用稳定约束，避免加载、hover 或长文本造成跳动和遮挡。
- `.vue` 单文件组件达到或超过 800 行是硬审查线。新增职责前按稳定边界拆出组件、composable、store 或领域模块。

## CSS 与主题

- 普通界面颜色只消费 `app/utils/theme/README.md` 登记的语义变量；新增变量同步主题文档与全部内置主题。
- 决定某块区域用玻璃、实心还是不给面时，判据在 [`packages/nb-ui/docs/ui-development-spec.md`](../../../packages/nb-ui/docs/ui-development-spec.md) 第 2 节，取舍理由在 [`packages/nb-ui/docs/design-language.md`](../../../packages/nb-ui/docs/design-language.md)。这两份规范此前只从 nb-ui 内部路由得到，主应用侧改样式的人找不到，材料语言因此被逐页重新发明过。
- 样式由组件或语义 class 拥有，保持低特异性；动画尊重 reduced motion，文本、焦点环和状态色保持可辨识。
- 固定格式控件、面板或网格使用 `min/max`、grid track、`aspect-ratio` 等稳定约束；长文本必须换行或动态收敛，不遮挡相邻内容。

## 客户端持久化与存储分层

前端状态与偏好的持久化严格执行分层治理，单一数据源维护唯一持久化路径：

### 分层原则

1. **UI 偏好（窗口尺寸、面板开合、视图模式、编辑器字体等）**：统一归 **Pinia store 持久化**（`pinia-plugin-persistedstate`，存储介质为 `localStorage`），键名统一为 store id 或规范命名空间（如 `novel.ide.local`）。**UI 组件层严禁新增裸 `localStorage` 直接读写**。
2. **会话瞬时态（打开标签页、当前活动 tab、编辑器缓冲、即时撤销栈、工作区恢复点等）**：统一归 **`sessionStorage` 或 session store**（如 `novel.ide.session`），生命周期绑定浏览器当前标签页，关闭标签页即丢弃，不跨会话污染本地存储。
3. **服务端权威配置（主题包、明暗外观、配色方案、费用币种等）**：统一归 **Global Config（HTTP API `PUT /api/config/global`，`ui.*` 命名空间）**，启动时由 bootstrap 载入并同步内存状态。前端组件与 composable 不得将服务端权威配置私自写入本地 `localStorage`。
4. **草稿类富文本与大体量领域数据**：统一归**服务端磁盘 Store**（通过专用 HTTP Adapter），严禁占用 `localStorage` 额度；存量旧草稿仅作一次性迁移源，迁移后删除。
5. **Component Lab / Playground 私有键**：Lab 与组件库 playground 的偏好设置属于开发/调试隔离环境，不进入产品运行时规范；私有键 **MUST** 具备独立前缀（如 `nb-lab:*`、`nb-ui-playground-*`），与产品命名空间严格隔离，不得读写产品持久化数据。

### 版本与兼容

- 持久化数据 **MUST** 包含 schema 版本字段（`schema: <number>`）。
- **容错与回退**：反序列化异常、版本不匹配或结构校验失败时，**MUST** 记录告警并安全回落至预设默认值，同时自动以合法默认结构重写存储，严禁向外抛出未捕获异常阻断应用初始化与界面渲染。

### 存量债务清单与迁移方向

产品前端既有裸 `localStorage` 写入点均已列入存量债务清单，禁止作为新功能参考，后续按指定方向逐步迁移：

| 存量写入点 | 当前位置 | 状态 | 迁移方向 |
|---|---|---|---|
| `nbook.settingsDialog.size` | `NovelIdeSettingsDialog.vue` | 待迁移 | 归入外壳/对话框布局 Pinia store 持久化 |
| `nbook.projectCreateDialog.size.v2` | `ProjectCreateDialog.vue` | 待迁移 | 归入外壳/对话框布局 Pinia store 持久化 |
| `nbook.locale` | `i18n-locale.client.ts` | 待迁移 | 迁移至 Global Config `ui.locale` 或独立偏好 store |
| `nbook.costDisplay.usdToCnyRate` | `useCostDisplay.ts` | 待迁移 | 迁移至专用运行时缓存/session store，或保留但登记为离线汇率缓存例外 |
| `agent:pinned-sessions:<scopeKey>` | `AgentModeSessionSidebar.vue` | 待迁移 | 迁移至 Agent 领域 Pinia store 或工作区持久化配置 |
| `agent:last-session:<scopeKey>` | `AgentChatSurface.vue` | 待迁移 | 迁移至 session store（会话级恢复）或专用 Pinia store |
| `agent:inline-editor-session:<scopeKey>` | `AgentChatSurface.vue` | 待迁移 | 迁移至 session store 或专用 Pinia store |

### 待深入讨论（明确留白）

底座先行，细节另开任务。以下技术细节本次明确不做定论，由后续专项任务细化：
- 跨标签页状态同步机制（是否监听 `storage` 事件同步更新 store，抑或维持单标签页独立生命周期）
- Pinia store 拆分粒度（既有单一庞大 `novelIde` store 拆分为 `workbench-layout`、`agent-session` 等领域子 store 的边界）
- 客户端缓存淘汰策略（TTL 自动失效、存储容量保护与主动清理机制）
- 存量裸键迁移批次与平滑退役周期（读取旧键后静默写入新 store 并删除旧键的双轨过渡期）
- Global Config 与本地响应式状态的双写一致性与网络抖动回滚细则

## 验证

前端改动说明桌面和窄屏影响。逻辑测试、类型检查和浏览器验收分别报告；用户可见交互或布局变化必须运行真实页面并留下可观察证据。

完成标准：目标桌面与窄屏视口均可完成受影响流程，键盘与焦点路径可用，主题和长文本不会产生溢出或布局跳动。