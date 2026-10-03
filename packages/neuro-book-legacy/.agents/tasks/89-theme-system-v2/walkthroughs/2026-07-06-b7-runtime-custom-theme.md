# B7 前端主题运行时开放化

## 目标

- 将前端活动主题从内置 `IdeTheme` 联合开放为 string theme id。
- 增加唯一解析入口，支持内置主题与 `ui.customThemes` 合并解析。
- 将页面启动、设置下拉、Agent client variable、Monaco/diff 主题接到同一套解析结果。

## 变更文件

- `app/utils/theme/theme-tokens.ts`
- `app/utils/theme/resolve-theme.ts`
- `app/utils/theme/resolve-theme.test.ts`
- `app/stores/novel-ide.ts`
- `app/composables/useIdeTheme.ts`
- `app/composables/useThemeManager.ts`
- `app/pages/index.vue`
- `app/pages/login.vue`
- `app/pages/admin/users.vue`
- `app/components/novel-ide/NovelIdeSettingsDialog.vue`
- `app/components/novel-ide/agent/client-variables.ts`
- `app/components/novel-ide/agent/AgentChatSurface.vue`
- `app/components/markdown-studio/MarkdownSourceEditor.vue`
- `app/components/markdown-studio/monaco-theme.ts`
- `app/components/common/diff/monaco-diff-theme.ts`
- `app/components/profile-template-editor/ProfileTemplateVisualEditor.vue`

## 实施记录

- `IdeTheme` 放宽为 string，同时新增 `BuiltInIdeTheme` 约束内置 `themeTokens/themeMeta`，避免自定义 id 被误用于索引内置表。
- 新增 `resolveTheme(themeId, customThemes)`：
  - 内置主题读取 `themeTokens + themeMeta`；
  - 自定义主题按 id 查找，缺键按 `appearance` 选择 `dark` 或 `sepia` 兜底；
  - 未知 id 回退 `sepia`。
- store 新增 `activeThemeId`、`customThemes`、`activeThemeAppearance`、`themeVarsSnapshot`，并持久化首屏快照；保留 `theme = activeThemeId` 作为现有调用点的同 ref 出口。
- `useIdeTheme` 支持启动时优先应用 `themeVarsSnapshot`，随后由 bootstrap 后的 `customThemes/themeId` 触发 reconcile。
- 新增 `useThemeManager`，切换主题时立即应用并静默保存 Global Config；保存失败会通知并回滚。
- 首页 bootstrap 读取 `ui.theme/customThemes` 后写入 store；登录页、管理员页、profile 模板编辑器也接入主题快照，减少独立页面 FOUC。
- 设置对话框主题下拉改为内置预设 + 自定义主题列表，选择时走 `themeManager.setTheme`。
- Agent `client.ide.theme` 校验放宽为内置 id 加当前自定义 id；Agent patch 调用 theme manager 切主题。
- Monaco source/diff 主题改按 `resolveTheme(...).appearance` 选择 light/dark preset，`sepia` 特例继续走 Solarized Light。

## 验证

- `bunx vitest run app/utils/theme/resolve-theme.test.ts server/config/normalizer.test.ts server/config/config-service.test.ts -t "resolveTheme|theme|Global UI"`：通过，3 files passed，5 tests passed，33 skipped。
- `bun run typecheck`：未通过。主题相关过滤输出为空；失败仍集中在既有基线：Agent plan mode 类型契约、`AGENT_PLAN_MODE_STATE_KEY` 缺失、`agentMode`/`planModeActive` 不一致、writer profile `customTopSystemPrompt.trim()`、`server/low-code-form/index.ts(798,13)`。
- `bun run test`：未通过。结果为 149 files passed、19 failed、1 skipped；1218 tests passed、72 failed、87 skipped。失败集中在既有 Agent/profile compile/workspace/auth/web/plot timeout 或 plan-mode 基线；新增 `resolve-theme.test.ts` 在全量中通过。
- `bun run generate:openapi`：通过，40 routes updated，0 failed。

## 与计划的出入

- PLAN 写明 store 字段改为 `activeThemeId`；实际同时保留 `theme` 作为同一 ref 的兼容出口，减少 preview 与长尾组件一次性改动。主页面、设置、Agent、Monaco 已改走开放 id。
- B7 计划提到自定义主题 CRUD 编排；本批只落下 `useThemeManager.saveThemeConfig` 基础保存入口，完整新建/编辑/导入导出 UI 仍按 B8/B9 执行。
- 未做浏览器验证，遵守“浏览器验证先征求用户同意”的约束。

## 下一步

- B8：安装 `colord` 与 `vue3-colorpicker`，实现派生规则、JSON 导入导出和通用取色字段。
- B9：落地主题编辑器 Dialog 与自定义主题 CRUD UI。
