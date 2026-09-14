# Novel IDE 主题变量规范 v2.1

本文档规定 Novel IDE 颜色变量的设计、使用和扩展规则。所有业务组件应消费 `theme-tokens.ts` 中登记的 CSS 变量，避免直接写 Tailwind 调色板类或明暗模式分支。目标是让 8 套内置主题与后续自定义主题都能覆盖完整界面。

## 事实源

- `app/utils/theme/theme-tokens.ts` 是内置主题变量的唯一事实源。
- `shared/theme/theme-vars.ts` 是内置主题 ID、`ThemeAppearance`、36 个无前缀变量名和 `CustomThemeDto` 的 shared 契约源。
- `app/styles/theme-vars.css` 承载三段：SSR / IDE fallback（必须与 `themeTokens.sepia` 保持一致）、nb-ui 角色变量桥接、`--we-*` 别名层。fallback 段的 36 个键值仍由 `themeTokens.sepia` 锁定。
- `.novel-ide-theme` 是主题宿主类，运行时会把当前主题变量写入该宿主。
- `themeMeta` 记录内置主题的 `appearance` 与显示名称；Monaco 与自定义主题派生按 `appearance` 选择明暗策略。
- `resolve-theme.ts` 负责把 `ui.theme: string` 解析为内置或自定义主题；未知 ID 回退 `sepia`。
- `derive.ts`、`theme-editor.ts`、`theme-io.ts` 只服务自定义主题编辑器，不改变 8 套内置预设的字面值。

## 运行时与存储

- Global Config 中 `ui.theme` 是当前主题 ID，类型为 `string`，可以是内置 ID 或 `custom-*` 自定义主题 ID。
- Global Config 中 `ui.customThemes` 保存用户自定义主题数组；自定义主题 ID 必须匹配 `^custom-[a-z0-9-]+$`，最多 50 个。
- Bootstrap 阶段从 `/api/config/bootstrap` 读取 `ui.theme` 与 `ui.customThemes`，写入 `novelIdeStore.applyThemeConfig()`，再由 `useIdeTheme()` 把变量应用到 `.novel-ide-theme`，用于减少首屏 FOUC。
- 切换主题通过 `useThemeManager.setTheme()` 即时应用并静默保存 Global Config；保存失败时通知用户并回滚到上一个主题状态。
- 自定义主题缺失变量时，`resolveTheme()` 按 `appearance` 使用 `dark` 或 `sepia` 内置预设补齐，再覆盖用户变量。

## 变量总表

| 分组 | 变量 | 用途 |
|---|---|---|
| 背景 | `--bg-main` | 页面与 IDE 最底层背景。 |
| 背景 | `--bg-panel` | 卡片、Dialog、主内容面板背景。 |
| 背景 | `--bg-sidebar` | 侧边栏、目录树、分栏导航背景。 |
| 背景 | `--bg-subtle` | 面板内的弱分区、说明块、浅层嵌套底色。 |
| 背景 | `--bg-input` | 输入框、代码外壳、次级容器底色。 |
| 背景 | `--bg-hover` | 列表项、透明按钮、卡片的 hover / active 底色。 |
| 文本 | `--text-main` | 正文、标题、重要内容。 |
| 文本 | `--text-secondary` | 摘要、副标题、普通辅助信息。 |
| 文本 | `--text-muted` | placeholder、弱提示、默认图标、序号。 |
| 文本 | `--text-inverse` | accent / status 实底上的反色文字。 |
| 边框 | `--border-color` | 标准边框、分隔线、输入框边框。 |
| 边框 | `--border-strong` | hover、focus、可拖拽边界等加强边框。 |
| 边框 | `--border-accent` | 选中态、当前项、主线强调边框。 |
| 强调 | `--accent-main` | 主操作、选中状态、主线强调。 |
| 强调 | `--accent-bg` | 强调色软底，用于选中块或轻量提示。 |
| 强调 | `--accent-text` | 链接、重点数字、强调文本。 |
| 状态 | `--status-info` | 运行中、引用、pending 信息主色。 |
| 状态 | `--status-info-bg` | info 软底。 |
| 状态 | `--status-info-border` | info 软边框。 |
| 状态 | `--status-success` | 完成、已同步、已解决主色。 |
| 状态 | `--status-success-bg` | success 软底。 |
| 状态 | `--status-success-border` | success 软边框。 |
| 状态 | `--status-warning` | 草稿、待审、未保存、诊断、占位主色。 |
| 状态 | `--status-warning-bg` | warning 软底。 |
| 状态 | `--status-warning-border` | warning 软边框。 |
| 状态 | `--status-danger` | 错误、删除、冲突主色。 |
| 状态 | `--status-danger-bg` | danger 软底。 |
| 状态 | `--status-danger-border` | danger 软边框。 |
| 编辑器 | `--editor-bg` | Markdown / TipTap / 预览主编辑区域背景。 |
| 编辑器 | `--source-bg` | 源码、代码块、Monaco 容器背景。 |
| 编辑器 | `--source-text` | 源码正文与代码文本。 |
| 编辑器 | `--source-muted` | 源码行号、弱化 token、编辑器辅助信息。 |
| 效果 | `--shadow-color` | 阴影基色，只通过 `color-mix(... transparent)` 使用。 |
| 效果 | `--selection-bg` | 文本选区背景。 |
| 组件层 | `--toolbar-bg` | 顶部工具栏、悬浮工具条、需要轻透明的工具面。 |
| 组件层 | `--chat-ai-bg` | Agent AI 气泡与 AI 输出块背景。 |

## 核心色与派生色

自定义主题编辑器以 13 个核心色作为快速调色盘：

- 背景 4 个：`--bg-main`、`--bg-panel`、`--bg-sidebar`、`--bg-input`
- 文本 3 个：`--text-main`、`--text-secondary`、`--text-muted`
- 边框 1 个：`--border-color`
- 强调 1 个：`--accent-main`
- 状态主色 4 个：`--status-info`、`--status-success`、`--status-warning`、`--status-danger`

其余变量是派生默认值，但不是硬规则。内置 8 套主题保存完整字面值，保证视觉零漂移；自定义主题可以先从核心色派生，再逐个覆盖高级变量。派生规则只能作为编辑器的默认建议，不能在消费端临时计算颜色。

## 自定义主题编辑器

- 设置页主题区提供内置/自定义主题选择、新建、编辑、复制、删除、导出、导入入口。
- 新建与复制会以当前选中主题为起点；若内置预设含 `color-mix(...)`，浏览器端通过临时元素 `getComputedStyle` 解析为取色器可编辑的具体颜色。
- `ThemeEditorDialog.vue` 打开期间会把 draft 变量实时应用到 `.novel-ide-theme` 宿主；取消恢复当前已保存主题，保存走 `useThemeManager.saveThemeConfig()`。
- `ThemeCorePaletteSection.vue` 管理核心 13 色，颜色变更会立即重算派生变量。
- `ThemeAdvancedVarsSection.vue` 展示 36 变量完整列表，允许逐项覆盖派生值。
- `ThemePreviewCard.vue` 只消费传入 ThemeVars，不读写全局主题状态。
- 主题 JSON 导出格式固定为 `{schemaVersion: 1, name, appearance, vars}`；`vars` 使用无 `--` 前缀变量名。
- 导入 JSON 会做 schema、变量名白名单和颜色值校验，`vars` 只接受取色器可编辑的具体颜色值，例如 hex、rgb(a)、hsl(a)；不接受 `var(...)`、`color-mix(...)` 或非法 hex。导入后生成新的 `custom-*` ID，不覆盖已有主题。

## 状态语义

状态色按业务角色选择，不按原始颜色名称机械迁移：

- `warning`：草稿、待审、未保存、诊断、占位、需要注意但不是错误的状态。
- `success`：完成、已同步、已解决、检查通过。
- `danger`：错误、删除、冲突、不可恢复失败。
- `info`：运行中、引用、pending 信息、普通说明性状态。
- `accent`：选中、当前项、主线强调、主操作。

Amber 有两种角色：警示类徽标走 `warning`，Sidebar 选中、ring、主线强调走 `accent`。遇到不确定场景，先看交互语义，不要按色名猜。

## World Engine 别名层

World Engine 工作台仍保留 `--we-*` 局部别名层，真实 Dialog 与 preview 都必须挂 `.world-engine-workbench-theme`。唯一映射源是 `app/styles/theme-vars.css`，组件内 scoped style 和 preview 页面不得重复定义 `--we-*`，也不得写 `--bg-main: var(--we-bg-canvas)` 这类反向覆盖。

允许修改的只有 `--we-*` 指向的 v2.1 主题变量；不要删除别名层，也不要把 preview 专属浅绿硬编码带回去。

## nb-ui 角色变量桥接

nb-ui 的角色变量（`--overlay-surface`、`--panel-surface`、`--control-surface`、`--divider`、`--focus-ring` …）在库里声明在 `:root` 上、值是对产品配色的 `var()` 引用（库的 `src/tokens.css`）。`var()` 在**声明元素**上就代换完，所以那批角色变量在 `<html>` 上按 sepia 兜底代换一次就不再跟随主题——非 sepia 主题下对话框/浮层会停在 sepia 浅底。

因此 `theme-vars.css` 里有一段 `:root, .novel-ide-theme` 的宿主级重声明，按同一套映射把角色变量在宿主上重新解析一遍。改库那一层映射时，这段要跟着改；新增角色变量时先确认它在不在这一段里。

这一层只是别名，不新增变量键：它不进变量总表、不参与自定义主题校验，主题编辑器草稿（实时写入宿主）与自定义主题都能正常跟随。宿主之外（通知视口这类）仍取 `:root` 的 sepia 兜底。

已知边界：nb-ui 的浮层默认经 Teleport 落到 `document.body`（库内 `SelectPortal` / `DropdownMenuPortal` 等未指定目标，`TimePickerDefault` 直接写死 `body`），这些节点不在 `.novel-ide-theme` 内，取不到宿主上的重声明。Dialog / DialogWindow / ContextMenu 有 `teleport-target` 开关可以落进宿主；FormSelect / Combobox / Dropdown / Tooltip / DatePicker 这类没有对应开关，要在宿主内跟随主题得先改门户口径。

## 分类与内容色板例外

Plot / Workspace / Reference chip 的分类色板是“类别识别色”，不是主题状态色。本轮不迁移这些定义文件：

- `plot-thread-panel.types.ts`
- `plot-tree.types.ts`
- `plot-preview.types.ts`
- `workspace-entry-meta.ts`
- `app/styles/reference-chips.css`

Reference chip 的唯一外观源是 `app/styles/reference-chips.css`。Vue / TipTap 组件只负责输出 `is-chapter`、`is-character`、`is-location` 等语义 class，不要 inline 类型色，也不要为每一种引用类型新增主题变量。

这些内容色板同样不进入 36 主题变量：

- Profile template 节点类型 accent。
- Markdown 文字 / 背景颜色选择器。
- JsonViewer / Monaco 语法高亮和第三方编辑器内部色板。
- `markdown-themes.css` 中的备用 Markdown 内容主题。

分类色板可以继续使用固定色类，但在正文、卡片或列表中叠底时，优先让类别色和 `--bg-panel` / `--bg-main` 做混合或使用低透明度，避免覆盖主题的整体明暗关系。不要把分类色板扩散到通用组件。

NotificationViewport 当前挂在 `.novel-ide-theme` 宿主外层，是跨入口的玻璃 toast；它的玻璃拟态与固定反色文本暂作为宿主外例外处理。若未来将通知视口移入主题宿主，再按状态变量统一。

## 阴影与选区

- 阴影必须通过 `--shadow-color` 表达，例如 `box-shadow: 0 12px 32px color-mix(in srgb, var(--shadow-color) 14%, transparent)`。
- 不要写 `rgba(15,23,42,...)`、`#000`、`black` 等固定阴影色。
- 文本选区统一消费 `--selection-bg`，入口在 `.novel-ide-theme ::selection`。

## 组件层变量登记

组件层变量只允许用于跨多处消费、且无法由通用语义变量准确表达的稳定组件角色。新增前先确认：

- 是否能用背景、文本、边框、强调、状态或编辑器变量表达。
- 是否至少存在多个消费点，或属于长期稳定的基础组件。
- 是否已在本文档的“变量总表”登记用途。
- 是否为 8 套内置主题都补齐完整字面值，并同步 `theme-vars.css` fallback。

临时业务差异不要新增组件层变量，优先在组件内用已有变量组合表达。

## 禁止事项

- 禁止在业务组件里写 Tailwind 调色板类：`bg-gray-100`、`text-amber-700`、`border-rose-500/30` 等。
- 禁止写 `dark:` 变体。明暗差异必须由当前主题变量承载。
- 禁止用 `bg-black/5`、`bg-white/10` 叠在普通内容底色上制造深浅变化；遮罩和玻璃拟态是少数例外。
- 禁止直接写固定 hex / rgba 作为业务颜色；测试断言、分类色板定义、外部资产预览除外。
- 禁止运行时拼接 UnoCSS 变量类名。必须写完整字面类名，例如 `bg-[var(--status-warning-bg)]`。
- 禁止删除或绕过 `--we-*` World Engine 别名层；当前只允许修改别名指向。

## 推荐写法

```vue
<template>
    <button class="border border-[var(--border-color)] bg-[var(--bg-input)] text-[var(--text-main)] hover:border-[var(--border-strong)] hover:bg-[var(--bg-hover)]">
        保存
    </button>
    <span class="border border-[var(--status-warning-border)] bg-[var(--status-warning-bg)] text-[var(--status-warning)]">
        未保存
    </span>
    <button class="bg-[var(--accent-main)] text-[var(--text-inverse)]">
        创建
    </button>
</template>
```

```css
.panel {
    box-shadow: 0 16px 40px color-mix(in srgb, var(--shadow-color) 12%, transparent);
}
```
