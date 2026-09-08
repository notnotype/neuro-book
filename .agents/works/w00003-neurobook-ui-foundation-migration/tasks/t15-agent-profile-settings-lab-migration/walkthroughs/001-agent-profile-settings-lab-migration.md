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

## 验证（最终 revision，cwd = linked worktree）

| 命令/观察 | 结果 |
| --- | --- |
| `bun x vue-tsc --noEmit -p packages/neuro-book/tsconfig.json` | 通过，退出码 0 |
| `bun run --cwd packages/neuro-book test -- app/components/novel-ide/settings/agent-profile/AgentProfileNavList.test.ts app/components/novel-ide/settings/agent-profile/profile-runtime-settings.test.ts app/component-lab` | 5 个文件 / 23 个测试通过 |
| `bun run --cwd packages/neuro-book smoke:component-lab -- --url http://127.0.0.1:3001 --browser-executable C:/Users/notnotype/AppData/Local/ms-playwright/chromium-1234/chrome-win64/chrome.exe` | 通过；共享 `neuro-book-dev-3001` 保持运行，未重启 |
| `bun run docs:check` | 5409 个文件检查，0 failures |
| `bun run governance:check` | 0 failures，0 warnings |
| `git diff --check` | 通过；仅 Git 的 LF→CRLF 工作树提示 |

### 专项浏览器验证（已知本地 `/lab`，headless，1440×900）

1. 组件树选择 `AgentProfileSettingsView` 后，global 场景挂载 3 个按 key 排序的 Profile；默认页常驻模型与推理强度，高级模型参数和运行策略初始折叠。
2. 高级模型参数与运行策略入口均为可点击 disclosure 按钮；展开后分别显示 `TopK` 与自动摘要字段，`aria-expanded` 同步，nb-ui `Collapsible` 的展开动画状态可观察。
3. 编辑温度后页面出现「有未保存的修改」，保存按钮启用；saving 场景显示保存提示且保存/放弃按钮禁用；save-error 场景保留 dirty 草稿并允许再次保存。
4. 放弃修改确认支持取消与确定：取消保持草稿，确定关闭弹窗并恢复基线；Project 场景的 Home 重置确认支持取消，未产生删除或网络副作用。
5. 受控页面运行策略错误由页面校验汇总，运行策略区在错误时自动展开；运行策略和模型字段均由事件回传，视图不直接访问 API/store/持久化。
6. Component Lab smoke 全程未观察到业务 API、Provider 或文件请求；页面级资源仅包含本地 Lab 资源与已存在 favicon 请求。

## 偏差与残余风险

1. Product gate 维持 `incomplete`：本 Task 未生成 Product image/sourceDigest/HTTP/log/Bearer shutdown/static scan 证据，不宣称 Work/Product gate 闭合；交付口径为「Lab 界面与自动交互已验证」。
2. 正式设置页仍未接线；旧宿主和主应用页面不属于本 Task 的交付范围。
3. 浏览器观察使用独立 headless Chromium 与本地共享 Source Dev 服务，不替代开发者对视觉取舍的人工验收。
4. 用户未跟踪文件 `packages/neuro-book/eval-tmp.ts` 保留未动。

## 后续

- 开发者在 `/lab` 人工查看新版设计（常用优先布局、折叠分组、明暗主题），确认后 Leader 再创建正式页面接线 Task。
- `docs/specs/ui/agent-profile-settings.md` 仍保持 `planned`；是否晋升为 `implemented` 由 Leader 按 Work 合同统一评审。
