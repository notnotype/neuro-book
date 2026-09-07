# t15 Walkthrough — Agent Profile 设置页 Lab 迁移

## 交付内容

新增受控视图 `AgentProfileSettingsView`（`app/components/novel-ide/settings/agent-profile/`），在 Component Lab 中提供完整可操作的 Profile 设置页：默认设置页 + Profile 导航与详情，常用设置优先（使用模型/推理强度/专属设置常驻，高级模型参数与运行策略折叠，诊断与维护独立段）。

### 新增
- `AgentProfileSettingsView.vue` / `.types.ts` / `.md`：受控页面视图，无 IO/store/路由/持久化，全部修改经 `update:modelValue` 上报；保存/放弃/恢复默认/重置 Home 为事件请求。
- `AgentProfileSettingsViewFixture.vue` + `fixtures/index.ts` 9 个场景登记：global / project / statuses / custom-settings / empty / loading / saving / load-error / save-error。保存仅把 baseline 更新为草稿的 JSON 深拷贝并提示「已保存到本次预览」。
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

## 验证（全部实测，cwd = linked worktree）

| 命令 | 结果 |
| --- | --- |
| `bun x vue-tsc --noEmit -p packages/neuro-book/tsconfig.json` | 0 error |
| `bun run --cwd packages/neuro-book test -- app/component-lab app/components/novel-ide/settings/agent-profile/` | 5 files / 23 tests passed |
| `node --import tsx scripts/smoke/component-lab.ts --url http://127.0.0.1:3001 --browser-executable …/chromium-1234/…/chrome.exe` | passed |
| 专项浏览器验证（一次性 Playwright 脚本，已清理） | 见下 |
| `git diff --check` | 通过（仅 CRLF 警告） |
| `bun run docs:check` / `bun run governance:check` | 0 failures |

### 专项浏览器验证观察点（真实 `/lab`，Node+Playwright headless 1440×900）
1. 组件树选 `AgentProfileSettingsView` 挂载；标题「Profile 设置」；3 个 Profile。
2. 选 story-writer 改推理强度：事件面板记录 `update:model`、`update:modelValue`；保存后出现「已保存到本次预览」。
3. statuses 场景 7 行；compile_failed 行头部常驻显示可读 issue。
4. project 场景 story-writer 显示「重置 Home」入口（canResetHome）。
5. 390×844：`scrollWidth 390 <= viewport 390`，无页面级横向溢出。
6. 键盘：Enter 选中 Profile（aria-current 迁移）；Space 切换 Collapsible 展开。
7. 明暗主题切换后正文/浮层颜色均来自主题 token（macOS 主题切换验证 `data-nb-theme`）。
8. 全程 console/pageerror 为 0；网络监测仅 127.0.0.1:3001 本地资源，无业务 API/Provider/文件请求。

## 偏差与残余风险
1. **窄屏单列按视口断点（lg:）实现**，未按组件容器宽度（Lab 画布）切换；组件文档「已知偏差」已声明。Lab 手机画布（390×844 视口）行为正确。
2. **放弃修改确认未用 AlertDialog 包装**，当前直接恢复基线；文档「已知偏差」已声明。
3. 基线/草稿深拷贝使用 JSON 往返（`structuredClone` 无法克隆 Vue reactive 代理）；页面草稿均为 JSON 可序列化 DTO，语义无损。
4. Product gate 维持 incomplete：本次未生成 Product image/sourceDigest/HTTP/log/Bearer shutdown/static scan evidence，不宣称 Lab-ready 标签或 gate 闭合；交付口径为「Lab 界面与自动交互已验证」。
5. 用户未跟踪文件 `packages/neuro-book/eval-tmp.ts` 保留未动。
6. 端口 3001 复用已登记服务 `neuro-book-dev-3001`（PID 61308），全程未重启。

## 后续
- 开发者在 `/lab` 人工查看新版设计（常用优先布局、折叠分组、明暗主题），给出视觉取舍；确认后 Leader 可创建正式页面接线 Task。
- planned Spec 在实现证据齐全后由 Leader 评审晋升 implemented。
