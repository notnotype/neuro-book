# t15 Walkthrough — Agent Profile 设置页 Lab 迁移

## 交付内容

新增受控视图 `AgentProfileSettingsView`（`app/components/novel-ide/settings/views/agent-profile/`），在 Component Lab 中提供完整可操作的 Profile 设置页：默认设置页 + Profile 导航与详情，常用设置优先（使用模型/推理强度/专属设置常驻，高级模型参数与运行策略折叠，诊断与维护独立段）。

### 新增
- `AgentProfileSettingsView.vue` / `.types.ts` / `.md`：受控页面视图，无 IO/store/路由/持久化，全部修改经 `update:modelValue` 上报；保存/放弃/恢复默认/重置 Home 为事件请求。
- `AgentProfileSettingsViewFixture.vue` + `fixtures/index.ts` 10 个场景登记：global / project / dialog-window / statuses / custom-settings / empty / loading / saving / load-error / save-error。`dialog-window` 复用已公开 nb-ui `DialogWindow` 包裹同一受控视图，关闭后可从 fixture 入口重新打开；保存仅把 baseline 更新为草稿的 JSON 深拷贝并提示「已保存到本次预览」。
- `docs/specs/ui/agent-profile-settings.md`（planned，capability `ui.agent-profile-settings`）及注册表登记。
- Task README（role: tasker）。

### 原地重设计（同名替换）
- `AgentProfileModelFields.vue`：移除旧 `NovelIdeModelSelect` 与 common 表单依赖，改 nb-ui `FormField/FormInput/FormSelect`；模型选项由 enabledModels 富选项映射，空值继承用非空哨兵，模型列表为空显示提示。
- `ProfileRuntimeSettingsFields.vue`：改 nb-ui 控件；空串继承选项改为 `__inherit__` 哨兵（Reka Select 禁止空串 value），kind 字段双向转换。
- `AgentProfileDetailPanel.vue` / `AgentProfileDefaultsPanel.vue`：nb-ui `Button/Badge/Collapsible/FormField/Tooltip` 重建；移除逐段 shadow-sm 卡片堆叠（Surface 材质轴/层级轴合同）；低代码表单继续复用 `LowCodeForm`（九类字段全保留）；props 新增 `disabled`、`runtimeBaseline`、`descriptions`；旧宿主调用点已同步（`runtime-override-count`/`settings-override-count` 由 `runtime-baseline` + 草稿内计数取代）。
- i18n zh-CN/en-US 新增 `settingsView.*` 约 30 条文案。

### 修复（超出本 Task 新代码的既有缺陷）
- `AgentProfileNavListFixture.vue`：初始 ref 直接取场景登记初值 + 数据回流等值跳过重置。修复 Lab 数据面板回流把 `statuses` 场景行内选中清空的时序缺陷（该缺陷导致既有 `smoke:component-lab` 在迁移期间无法通过：fixture 键名已改为 story-writer/line-editor 等，但 smoke 仍断言 p1/p2）。
- `scripts/smoke/agent-profile-nav.ts`：同步断言到当前 fixture 键名（line-editor/story-writer/`  Line  ` 前后空格），恢复该 smoke 的可运行性。

## 验证（当前工作树 revision）

当前 `HEAD` 为 `c75bbb601621a33d959bfe3a338cfef432280eda`；之后的 t15 修复仍在工作树，尚未创建 follow-up 提交。

| 命令/观察 | 结果 |
| --- | --- |
| `bun x vue-tsc --noEmit -p packages/neuro-book/tsconfig.json` | 通过，退出码 0 |
| t15 聚焦集合（含 `AgentProfileModelFields.test.ts`、`AgentProfileSettingsView.test.ts`、`app/component-lab` 与场景注册回归） | 8 个文件 / 36 个测试通过；覆盖 runtime 基线层序（含 global `profileDefaults`）、点击默认设置后真实 `DefaultsPanel → DefaultModelSection → ModelFields` 校验链路、页面模型错误链路、模型高级区自动展开、Dialog 取消/Escape/确定与焦点恢复、10 个设置场景注册（含 DialogWindow 内嵌） |
| `bun run --cwd packages/nb-ui test` | 15 个文件 / 260 个测试通过 |
| `bun run --cwd packages/nb-ui typecheck` | 通过 |
| `bun run --cwd packages/nb-ui build:css` | 通过；`dist/nb-ui.css` 无工作树差异 |
| `bun run --cwd packages/neuro-book smoke:component-lab -- --url http://127.0.0.1:3001 --browser-executable C:/Users/notnotype/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe` | 历史整套 smoke 记录曾失败于既有 `CollapsibleSidePanel` 文案；本轮修正分层后重新执行并通过，见下方三条最新命令 |
| `bun run --cwd packages/neuro-book smoke:component-lab:core -- --url http://127.0.0.1:3001 --browser-executable C:/Users/notnotype/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe` | 核心 Lab 分层 smoke 通过 |
| `bun run --cwd packages/neuro-book smoke:component-lab:agent-profile -- --url http://127.0.0.1:3001 --browser-executable C:/Users/notnotype/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe` | Agent Profile 分层 smoke 通过；Dialog geometry、FormSelect 下拉层级、resize、关闭/重开与导航交互通过 |
| `bun run docs:check` | 5413 个文件，0 failures |
| `bun run governance:check` | 0 failures，0 warnings |
| `git diff --check` | 通过；仅 Git 报告工作树 LF→CRLF 提示 |
| `bun run --cwd packages/nb-ui test:e2e` | 20 个通过、14 个失败；本次失败包含视觉基线漂移与 `#nb-lab-target` 等待超时，未更新基线 |

### 本轮修复

1. 页面将默认页/Profile 的模型校验映射到温度与 TopK `FormField`；错误文本与 `aria-invalid` 同步呈现，错误时自动展开高级区并继续阻止保存。
2. runtime 基线 helper 仅服务 Lab 受控 View：Global defaults 从 harness 开始，Project defaults 叠加已保存 Global patch；Profile 基线允许当前作用域 defaults 草稿影响跟随项，但排除当前 Profile 草稿。正式旧宿主仍独立组装 runtime 层，本 Task 未迁移它。
3. `AlertDialog` 仅在存在 `trigger` slot 时渲染 `AlertDialogTrigger`，恢复遮罩，并在 triggerless controlled 模式阻止上游自动抢焦点；增加有 trigger 打开/取消、无 trigger 确认/`update:open` 与页面取消/Escape/确定焦点回归。
4. 恢复设置页 footer 与 loading → load-error → Profile → defaults 条件链，保留 `h-full`、`data-lab-subject` 和受控 opener 方案。

## 偏差与残余风险

1. Product gate 维持 `incomplete`：本 Task 未生成 Product image/sourceDigest/HTTP/log/Bearer shutdown/static scan 证据，不宣称 Work/Product gate 闭合。
2. 正式设置页仍未接线；t16 DialogWindow 迁移独立，不混入本 Task。
3. 本轮新增的真实 `/lab` DialogWindow 自动观察：选择「AgentProfileSettingsView → DialogWindow 内嵌」后，DOM 观察到 1 个 `[data-dialog-window]`、1 个 `[data-lab-subject]` 和 3 个 `[data-dialog-resize]`；窗口宽度由 1100px 经键盘右侧 resize 调整为 1110px；点击关闭后窗口从 DOM 移除且「打开 Agent Profile 设置窗口」入口保留，点击入口后可再次打开；1440px 页面 `scrollWidth` 与 `clientWidth` 均为 1440px。
4. 尚未完成的人工观察：10 个设置场景的完整人工逐项验收（编辑/保存/放弃/继承/错误态/场景隔离/键盘/明暗主题/无真实副作用）仍未完成；本轮仅自动验证 DialogWindow 场景的打开、内容、resize、关闭/重开及无页面溢出。
5. 新增 smoke 脚本 `scripts/smoke/agent-profile-settings-dialog.ts` 已通过 `bun run --cwd packages/neuro-book scripts:typecheck`；`bun x vue-tsc --noEmit -p packages/neuro-book/tsconfig.json` 通过。
6. 用户未跟踪文件 `packages/neuro-book/eval-tmp.ts` 保留未动。
## 五轴审查结论

- **正确性**：模型错误从 View 经 `modelErrorsFor` 到字段，错误时展开高级区并禁用保存；runtime defaults/Profile 层序由纯 helper 和回归测试锁定；Dialog 三种关闭路径均验证焦点恢复。Product gate 与正式页面接线仍不在本 Task 范围内。
- **可读性**：View 保持低于 800 行；默认页/Profile runtime 层序、模型错误结构和 triggerless Dialog 语义均有命名 helper、测试和同名文档。
- **架构**：保持受控 props/emits 单向数据流；领域 runtime helper 留在 agent-profile 模块；AlertDialog 公共组件只增加 triggerless/focus 合同，不引入宿主特例。
- **安全性**：未新增 API、store、Provider、文件、路由或持久化访问；Lab 数据仍只作用于 fixture 内存，文本由 Vue 渲染转义。
- **性能**：runtime 层序和模型错误映射均为有限页面草稿的 computed/单次遍历；未新增请求、轮询、无界扫描或额外依赖。

## 后续

- 开发者在 `/lab` 人工查看新版设计（常用优先布局、折叠分组、明暗主题），确认后 Leader 再创建正式页面接线 Task。
- `docs/specs/ui/agent-profile-settings.md` 仍保持 `planned`；是否晋升为 `implemented` 由 Leader 按 Work 合同统一评审。
