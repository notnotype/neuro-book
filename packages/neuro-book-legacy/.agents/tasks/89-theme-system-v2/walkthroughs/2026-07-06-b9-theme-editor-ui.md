# B9 主题编辑器 UI

## 本轮目标

按 PLAN.md B9 落地自定义主题编辑器 UI：主题编辑 Dialog、核心 13 色调色盘、高级 36 变量区、实时预览卡，并把设置页 frontend 主题区改造成主题列表 + 新建/编辑/复制/删除/导出/导入入口。

## 实际变更

- 新增 `app/components/novel-ide/settings/theme/ThemeEditorDialog.vue`
  - 管理 draft 主题、名称、appearance、颜色合法性、保存与取消。
  - 打开期间把 draft 变量实时应用到 `.novel-ide-theme` 宿主；取消时恢复当前 store 主题。
  - 保存走 `useThemeManager.saveThemeConfig()`，失败沿用主题管理器通知与回滚。
- 新增 `ThemeCorePaletteSection.vue`
  - 核心 13 色使用 `FormColorField`。
  - 核心色变化后立即调用 `deriveDefaults()` 重新生成派生变量。
- 新增 `ThemeAdvancedVarsSection.vue`
  - 36 变量按 8 组折叠展示，显示变量名、当前值与复制按钮。
- 新增 `ThemePreviewCard.vue`
  - 用传入的完整 ThemeVars 渲染面板、按钮、输入框、四状态徽标和编辑器色块预览。
- 新增 `app/utils/theme/theme-editor.ts`
  - 统一处理自定义主题 ID、draft 变量补齐、核心变量读取、派生重算、`ThemeVars -> CustomThemeDto.vars` 转换。
  - 浏览器端用临时元素解析 `color-mix(...)` / `color(srgb ...)`，避免把内置预设的 CSS 表达式直接喂给取色器。
- 新增 `app/utils/theme/theme-editor.test.ts`
  - 覆盖自定义主题 ID 生成、draft 变量补齐、服务端 CSS 表达式 fallback。
- 改造 `app/components/novel-ide/NovelIdeSettingsDialog.vue`
  - 主题区增加内置/自定义主题列表与新建、编辑、复制、删除、导出、导入操作。
  - 新建/复制以当前选中主题为起点；删除当前自定义主题时回退 `sepia`。
  - 导入导出复用 B8 的 `theme-io.ts`。
- 更新 `app/i18n/locales/zh-CN.ts` 与 `app/i18n/locales/en-US.ts`
  - 补齐设置页主题按钮/反馈、编辑器文案、8 个变量组与 36 个变量标签。
- 调整 `app/composables/useThemeManager.ts`
  - `saveThemeConfig()` / `setTheme()` 返回 `boolean`，让 Dialog 在保存失败时保持打开。

## 与计划的出入

- B9 计划中的四组件拆分已完成；额外增加了 `theme-editor.ts` helper 与单测，用来集中处理 ID、颜色表达式解析和 draft 补齐，避免组件内重复逻辑。
- i18n 没有机械凑到“约 60 key”的数量，但中英两份已覆盖本轮 UI、8 变量组和 36 变量标签。
- 按约束未做浏览器验证；如需做新建、调色、保存、导入导出、重启保持等人工流程，需要先征求用户同意。

## 验证结果

- `bun run typecheck`：失败。
  - 本轮最终状态下无主题相关路径错误。
  - 仍被既有基线阻塞：Agent plan-mode / `agentMode` 类型漂移、Profile DSL `PlanMode*` 导出缺失、writer profile `customTopSystemPrompt.trim()` fixture、`server/low-code-form/index.ts(798,13)`。
- `bun run test`：失败。
  - 最终统计：18 failed / 153 passed / 1 skipped test files；48 failed / 1250 passed / 87 skipped tests；2 unhandled errors。
  - 失败集中在 Agent/Profile/Workspace/Auth/Web/Plot/World Engine 等既有区域，包括 plan-mode 工具缺失、profile compile worker、workspace-files hook timeout、web_fetch timeout、plot/world-engine timeout。
- `bunx vitest run app/utils/theme/derive.test.ts app/utils/theme/theme-io.test.ts app/utils/theme/resolve-theme.test.ts app/utils/theme/theme-editor.test.ts`：通过。
  - 4 files passed，9 tests passed。
- `bun run generate:openapi`：通过。
  - 40 routes updated，0 failed。

## 遗留与风险

- 自定义主题编辑器尚未做浏览器交互验证；视觉预览、Dialog 内实时应用、导入导出文件选择和删除确认仍需用户同意后走浏览器验证。
- 全量 typecheck/test 仍受既有非主题基线阻塞，本轮未修改这些区域。
