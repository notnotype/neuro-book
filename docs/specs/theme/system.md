---
schema: nbook.spec/v1
kind: architecture
status: implemented
capability: theme.system
owners:
  - ui
---

# 主题系统参考

## 概述

Novel IDE 主题系统 v2.1 使用“shared 契约 + app 变量事实源 + runtime 应用”的结构。业务组件只消费 CSS 变量，不在组件内部维护第二套颜色源。当前目标是让 8 套内置预设和用户自定义主题覆盖完整 IDE。

## 事实源

- `shared/theme/theme-vars.ts`
  - `builtInThemeIds`：8 套内置主题 ID。
  - `themeAppearanceValues`：`light | dark`。
  - `themeVarNames`：36 个无前缀主题变量名。
  - `CustomThemeDto`：自定义主题 shared 类型。
- `app/utils/theme/theme-tokens.ts`
  - `themeTokens`：8 套内置主题的完整字面值。
  - `themeMeta`：内置主题显示名与 appearance。
  - `IDE_THEME_HOST_CLASS = "novel-ide-theme"`。
- `app/styles/theme-vars.css`
  - SSR / IDE fallback，只应与 `themeTokens.sepia` 保持一致。
- `app/utils/theme/resolve-theme.ts`
  - 解析内置或自定义主题；未知 ID 回退 `sepia`。

## 运行时流程

1. `/api/config/bootstrap` 返回 Global Config 中的 `ui.theme` 与 `ui.customThemes`。
2. `app/pages/index.vue` 调用 `novelIdeStore.applyThemeConfig(theme, customThemes)`。
3. `novelIdeStore` 通过 `resolveTheme()` 生成 `themeVarsSnapshot`，并记录当前 `appearance`。
4. `useIdeTheme(activeThemeId, customThemes, themeVarsSnapshot)` 挂载 `.novel-ide-theme` 宿主并写入 CSS variables。
5. 主题切换走 `useThemeManager.setTheme()`：先即时应用，再静默保存 Global Config；失败时通知并回滚。

登录页、Admin 用户页和 Profile Template Visual Editor 也复用同一套 store snapshot 与 `useIdeTheme()`，避免独立主题源。

## 存储契约

Global Config `ui` 字段：

```ts
type UiConfig = {
    theme: string;
    customThemes: CustomThemeDto[];
    costCurrency: string;
};
```

自定义主题：

```ts
type CustomThemeDto = {
    id: string; // 必须匹配 ^custom-[a-z0-9-]+$
    name: string;
    appearance: "light" | "dark";
    vars: Partial<Record<ThemeVarName, string>>;
};
```

服务端 normalizer 会过滤非法 ID、空名称、非法 appearance、未知变量名和空变量值；最多保留 50 个自定义主题。`ui.theme` 可以是内置 ID，也可以是当前 `customThemes` 中存在的自定义 ID，否则回退 `sepia`。

## 变量体系

v2.1 固定为 36 个变量，分为背景、文本、边框、强调、状态、编辑器、效果和组件层变量。完整表以 `app/utils/theme/README.md` 为准。

核心 13 色用于快速调色：

- `bg-main`
- `bg-panel`
- `bg-sidebar`
- `bg-input`
- `text-main`
- `text-secondary`
- `text-muted`
- `border-color`
- `accent-main`
- `status-info`
- `status-success`
- `status-warning`
- `status-danger`

`deriveDefaults(coreVars, appearance)` 只为自定义主题编辑器生成派生默认值。内置 8 套预设保存完整字面值，不从派生规则反算，确保视觉零漂移。

## 自定义主题

设置页主题区提供：

- 内置/自定义主题选择。
- 新建：复制当前选中主题作为起点。
- 编辑：仅允许编辑自定义主题。
- 复制：把任意当前主题保存为新的自定义主题。
- 删除：删除当前自定义主题；若它正在使用则回退 `sepia`。
- 导出：下载 `{schemaVersion: 1, name, appearance, vars}` JSON。
- 导入：校验 JSON 后生成新的 `custom-*` ID，不覆盖已有主题。`vars` 只接受取色器可编辑的具体颜色值，例如 hex、rgb(a)、hsl(a)；不接受 `var(...)`、`color-mix(...)` 或非法 hex。

编辑器由四个组件组成：

- `ThemeEditorDialog.vue`：draft 状态机、实时预览、保存/取消。
- `ThemeCorePaletteSection.vue`：核心 13 色。
- `ThemeAdvancedVarsSection.vue`：36 变量高级区。
- `ThemePreviewCard.vue`：小型 UI 预览。

打开 Dialog 时，draft 变量会实时应用到 `.novel-ide-theme` 宿主；取消时恢复当前已保存主题。内置主题中的 `color-mix(...)` 会在浏览器端解析为取色器可编辑颜色，避免把 CSS 表达式直接交给 `vue3-colorpicker`。

## 消费规则

- 业务 UI 必须使用 `bg-[var(--...)]`、`text-[var(--...)]`、`border-[var(--...)]` 或 CSS 中的 `var(--...)`。
- 禁止新增 Tailwind 调色板类和 `dark:` 变体。
- 禁止直接写固定 hex / rgba 作为业务颜色；测试、外部资产预览和分类色板定义除外。
- 阴影使用 `--shadow-color`，文本选区使用 `--selection-bg`。
- Monaco 主题按 resolved theme 的 `appearance` 选择 light/dark 基底；语法 token 色不进入自定义调色盘。

## 状态语义

- `warning`：草稿、待审、未保存、诊断、占位。
- `success`：完成、已同步、已解决、检查通过。
- `danger`：错误、删除、冲突、不可恢复失败。
- `info`：运行中、引用、pending 信息、普通说明。
- `accent`：选中、当前项、主线强调、主操作。

Amber 的历史用法要按角色拆分：警示徽标走 `warning`，选中/主线强调走 `accent`。

## World Engine 别名层

World Engine 的 `--we-*` 仍是别名层，当前只允许修改其指向，不删除别名。唯一映射源是 `app/styles/theme-vars.css` 中的 `.world-engine-workbench-theme`；真实 `WorldEngineWorkbenchDialog.vue` 必须挂这个 class。

禁止在独立调试面或正式工作台重新写浅绿 `--we-*` 硬编码，也禁止用 `--bg-main: var(--we-bg-canvas)` 这类反向覆盖把局部别名写回全局主题变量。

## 例外

Plot / Workspace / Reference chip 分类色板是类别识别色，不迁移为主题状态色。当前明确保留：

- `plot-thread-panel.types.ts`
- `plot-tree.types.ts`
- `plot-preview.types.ts`
- `workspace-entry-meta.ts`
- `app/styles/reference-chips.css`

分类色用于正文或列表叠底时，应低透明或与 `--bg-panel` / `--bg-main` 混合，不得扩散到通用组件。

Reference chip 的外观只由 `app/styles/reference-chips.css` 管理，组件只输出 `is-chapter`、`is-character` 等语义 class。Profile template 节点类型 accent、Markdown 正文颜色选择器、JsonViewer / Monaco 语法高亮和备用 Markdown 内容主题属于内容或第三方编辑器色板，不进入 36 主题变量；只要求其周边普通 UI 使用主题状态色、文本色和阴影变量。

NotificationViewport 目前位于 `.novel-ide-theme` 宿主外，是跨入口玻璃 toast；在通知视口移入主题宿主前，其玻璃拟态和固定反色文本暂作为宿主外例外。

## 验证

- 变量新增、删除、重命名时同步 `shared/theme/theme-vars.ts`、`theme-tokens.ts`、`theme-vars.css`、`app/utils/theme/README.md` 和本参考。
- 内置主题必须保持 8 套完整变量表。
- 自定义主题相关变更优先跑：
  - `bunx vitest run app/utils/theme/derive.test.ts app/utils/theme/theme-io.test.ts app/utils/theme/resolve-theme.test.ts app/utils/theme/theme-editor.test.ts`
  - `bun run typecheck`
  - `bun run test`
  - DTO / config route 变化后再跑 `bun run generate:openapi`
