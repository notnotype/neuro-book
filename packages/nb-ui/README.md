# nb-ui

Shared Vue/Nuxt UI primitives for NeuroBook-derived projects.

## Local development

```bash
bun install
bun run dev          # playground on :3004
bun run build:css    # regenerate dist/nb-ui.css (commit the result)
bun run test
bun run typecheck
```

`dist/nb-ui.css` is a committed build artifact: consumers install this package over `github:` / `link:`,
where there is no publish step to build it for them. Rerun `build:css` and commit whenever component
classes, icons, tokens, or `src/styles.css` change.

## Use from a sibling app

Register this package with Bun:

```bash
cd ../nb-ui
bun link
```

Then reference the registered package name from the sibling app:

```json
"@notnotype/nb-ui": "link:@notnotype/nb-ui"
```

Install from the app:

```bash
cd ../some-app
bun install
```

Do not use `link:../nb-ui`: Bun 1.3.14 on Windows expects linked dependencies to reference a registered package name, not a relative path.

## Nuxt module

In `nuxt.config.ts`:

```ts
export default defineNuxtConfig({
    modules: ["@notnotype/nb-ui/nuxt"],
});
```

The module auto-registers Vue components and composables.

## Manual imports

Components can also be imported explicitly:

```ts
import {Button, Dialog, IconButton, Notification, Panel, SegmentedControl} from "@notnotype/nb-ui/components";
import {useNotification} from "@notnotype/nb-ui/composables";
```

## Components

### 基础交互与控制 (Controls & Form)
- `Button`：primary / secondary / subtle / danger / ghost 变体，`sm` (26px) / `md` (32px) / `lg` (38px) 尺寸，支持 block、loading 与反色文字。
- `IconButton`：紧凑图标操作按钮，`sm` / `md` / `lg` 尺寸，高精度触觉反馈与零尺寸抖动。
- `Menubar`：桌面应用级主菜单栏（文件/编辑/视图/写作/帮助），支持横向方向键无缝穿梭与子菜单快捷键。
- `Editable`：行内即时编辑组件（大纲章节名/角色名就地重命名，Enter/Blur 提交，Esc 撤销）。
- `Stepper`：步骤向导器（作品新建向导、多格式电子书导出流程与发布流水线指示）。
- `SegmentedControl`：分段选择器，支持智能隐藏相邻分隔线、阻尼滑动高亮与多选模式。
- `ToggleGroup`：单选 / 多选切换按钮组，适配富文本排版操作栏。
- `Switch` / `SwitchField`：现代胶囊开关控件与带标签的表单开关字段。
- `Slider`：连续与离散滑动条（支持单值/范围双滑块、垂直/水平方向、`sm`/`md`/`lg` 尺寸）。
- `RadioGroup`：单选选项组，支持纵向/横向排布与富描述文本。
- `CheckboxGroup`：复选框受控组合容器（支持水平/垂直排布）。
- `FormField` / `FormInput` / `FormNumberInput` / `FormSelect` / `FormTextarea` / `FormCheckbox` / `Combobox` / `Autocomplete` / `TagInput` / `PinInput`：全套无障碍表单控件与就地自动联想输入。
- `DatePicker` / `DateRangePicker` / `Calendar` / `RangeCalendar`：复合日期选择器、区间选择器、网格日历与起止区间日历。
- `DateField` / `DateRangeField` / `TimeField` / `TimeRangeField`：分段日期/时间精准光标输入框（支持 Tab 快速段落跳转与微调）。
- `MonthPicker` / `MonthRangePicker` / `YearPicker` / `YearRangePicker`：宏观月份/年份网格与跨月/跨年代区间聚合选择器。
- `Listbox`：高级无障碍列表选择框（支持多选、Shift 连选与即时搜索过滤）。
- `ColorPicker`：综合取色器与调色板（预设色板网格、实时取色与 Hex 格式微调）。
- `TimePicker`：`HH:mm` 字符串 `v-model`，支持 min / max / step、disabled / invalid、ArrowUp/Down、Enter、Escape 和关闭后焦点归还；主题可通过 `time-picker@1` 契约替换实现。

### 工作区布局与导航 (Layout & Navigation)
- `Panel`：标准面板容器，支持 `subtle` / `solid` / `glass` 质感与 `none` / `sm` / `md` / `lg` 内边距。
- `Splitter`：多栏可调节分割面板（SplitterGroup / SplitterPanel / SplitterResizeHandle），支持水平/垂直方向与拖拽吸附。
- `ScrollArea`：平滑滚动容器，内置自适应悬浮滚动条。
- `Accordion`：手风琴折叠面板（支持单选/多选展开，平滑高度动效与旋转角标）。
- `Collapsible`：受控折叠展开容器。
- `AspectRatio`：固定宽高比容器（默认 16:9）。
- `Separator`：水平 / 垂直语义分隔线。
- `NavigationMenu`：多栏视口形变导航菜单（支持鼠标移动共享视口平滑位移与宽高渐变过渡）。
- `Tree`：通用无限层级虚拟化大纲树（支持几万节点高性能渲染与快捷键盘遍历）。
- `Breadcrumb`：面包屑导航栏。
- `FileTree`：受控文件与大纲目录树。
- `Tabs` / `Pagination`：选项卡栏与分页控制器。

### 弹层与反馈 (Feedback & Overlays)
- `Dialog` / `DialogWindow`：模态对话框与非模态可拖拽浮动窗口。
- `AlertDialog`：二次确认/破坏性操作警示弹窗（支持 `danger` / `warning` / `accent` 语调）。
- `Drawer`：侧边抽屉面板（支持 `top` / `bottom` / `left` / `right` 四向弹出与遮罩模糊）。
- `Popover`：通用气泡卡片，消费磨砂浮层材质基座。
- `HoverCard`：划词/悬浮卡片（适用于设定集词条、人物资料与超链接预览）。
- `Tooltip` / `ContextMenu`：延迟/即时提示框与右键上下文菜单。
- `Notification` / `NotificationViewport`：全局 Toast 通知。

### 数据展示 (Display)
- `Badge`：超椭圆现代状态徽章（支持 `dot` 发光点、`iconClass` 与温润深琥珀 Warning 调色）。
- `Avatar`：头像组件（支持图片加载失败平滑降级 Fallback 与 `squircle` / `circle` 形态）。
- `Progress`：进度条（支持 `accent` / `success` / `warning` / `danger` 语调与平滑位移动效）。
- `Rating`：星级评分组件（支持半星与悬浮微缩放弹性动效）。
- `Kbd`：实体键盘键帽快捷键展示组件（`sm` / `md` / `lg`）。
- `Table` / `Spinner` / `Skeleton` / `EmptyState`：数据表格与异步骨架/空状态指示。

Icons used inside nb-ui components need no registration by the host app. nb-ui ships compiled CSS
(`dist/nb-ui.css`, produced by `bun run build:css`) that already contains the icon rules and the mask
shim, so the host works whether it uses Tailwind, UnoCSS, or no utility framework at all.

The one exception is icons **you** pass in: `iconClass` on `Badge` / `Dropdown` / `Tabs` /
`SegmentedControl` / `ContextMenu` / `EmptyState` / `FileTree` takes an arbitrary class from your code,
and generating that class is still your build's job.

> **Breaking change in 0.2.0-alpha.** The `@notnotype/nb-ui/uno` export and its `NB_UI_ICON_SAFELIST`
> are gone. They were a UnoCSS-only contract; nb-ui now compiles its own CSS instead. Delete the
> safelist import from your `uno.config.ts` — no replacement is needed.

Shared style registries (register instead of copying values):

- `NB_Z_INDEX` (`@notnotype/nb-ui/theme`) — overlay z-indexes; bind via `:style`.
- `.nb-ui-popover-surface` (`styles.css`) — floating panel border/background/shadow/backdrop base (Dropdown, Combobox, ContextMenu, Tooltip, Dialog).
- `.nb-ui-tooltip-surface` (`styles.css`) — compact paper Tooltip modifier: control-radius surface, short attached arrow, and theme-aware text/padding.
- `.nb-ui-menu-surface` — menu/dropdown radius modifier; consumes `--radius-menu` and keeps nested items concentric.
- `.nb-ui-surface-rim` — opt-in Liquid Glass edge sheen for complete Dialog/DialogWindow surfaces; nbook small popovers leave it off.
- `.nb-ui-menu-item-danger` (`styles.css`) — destructive menu items (Dropdown, ContextMenu).

## UI development contract

公共组件、主题、token、样式与 playground 的当前工程规范见 [`docs/ui-development-spec.md`](docs/ui-development-spec.md)。

组件调试工作台运行在 `/lab`：它与全量 `/components` 画廊、设计语言 `/workbench` 分工不同，支持组件场景、主题 × 配色、390/768px 预览、CSS 变量覆盖、计算样式、ARIA 检查、事件日志和变量快照导入导出。新增或修改公共组件时，先读规范并在 `playground/app/component-lab/registry.ts` 登记。

## Colourway

> **Renamed in 0.2.0-alpha.** What used to be called "theme" — a set of colour variables — is now a
> **colourway**, and it moved from `@notnotype/nb-ui/theme` to `@notnotype/nb-ui/colorway`. "Theme"
> now means a package that can change shape, rhythm, decoration and (later) component implementations
> on top of any colourway. Rename map: `applyNbTheme` → `applyColorway`, `createThemeStore` →
> `createColorwayStore`, `nbThemePresets` → `nbColorways`, `NbThemeVars` → `NbColorwayVars`,
> `NB_UI_THEME_HOST_CLASS` → `NB_UI_COLORWAY_HOST_CLASS` (the CSS class it holds also changed from
> `.nb-ui-theme` to `.nb-ui-colorway`). Store members follow: `setTheme` → `setColorway`,
> `initTheme` → `initColorway`, `themeIds` → `colorwayIds`, `themeMeta` → `colorwayMeta`,
> `themes` → `colorways`.

The host app must provide the base colour variables listed in `src/colorway/colorway-contract.ts`.

```ts
import {applyColorway, defaultDarkColorway} from "@notnotype/nb-ui/colorway";

applyColorway(document.body, defaultDarkColorway);
```

Required public tokens (33 — aligned with the NeuroBook main repo's variable table, minus its six
editor/domain-specific ones, plus nb-ui's own `--shadow-panel` / `--overlay-bg`):

```text
--color-scheme
--bg-main
--bg-panel
--bg-sidebar
--bg-subtle
--bg-input
--bg-hover
--text-main
--text-secondary
--text-muted
--text-inverse
--border-color
--border-strong
--border-accent
--accent-main
--accent-bg
--accent-text
--status-info          --status-info-bg      --status-info-border
--status-success       --status-success-bg   --status-success-border
--status-warning       --status-warning-bg   --status-warning-border
--status-danger        --status-danger-bg    --status-danger-border
--shadow-color
--selection-bg
--shadow-panel
--overlay-bg
```

`defaultDarkColorway` is an alias of the built-in table (single source). One colourway ships with
the library:

```ts
import {applyColorway, nbColorways, nbColorwayIds, nbColorwayMeta, NB_DEFAULT_COLORWAY_ID} from "@notnotype/nb-ui/colorway";

applyColorway(document.body, nbColorways.dark);
```

Colourway id: `dark`. Products can add extra `--*` variables, but nb-ui components only depend on
the listed public tokens.

> **The library ships no light colourway.** If you install nb-ui without a theme, a light-mode OS
> still gets a dark UI. Light colourways come from theme packages — `macos` brings `macos-light`
> and `macos-dark`. A theme's `defaultColorway.light` must therefore point at one of its own
> colourways.

> **Breaking change in 0.2.0-alpha.** The lineup was replaced. `catppuccin` / `dracula` /
> `monokai` / `one-dark-pro` / `tokyo-night` are retired, and so are `sepia` / `light` (two light
> colourways) and `midnight` / `slate` (which briefly shipped in an early 0.2.0-alpha). Stored ids
> are migrated automatically by `createColorwayStore` via `retiredColorwayAliases` (all retired
> ids → `dark`) instead of silently falling back. `defaultLightColorway` was removed with the
> lineup. If you pass a custom `colorways` table, pass your own `aliases` map too.

## Design tokens

Beyond colour, nb-ui ships five groups of colourway-independent tokens (typography, spacing, radius,
elevation, motion). Values live in `src/tokens.css`; the registry is exported for reference:

```ts
import {nbDesignTokens, nbTypographyTokens, nbRadiusTokens} from "@notnotype/nb-ui/theme";
```

Two things to know if you also use Tailwind: nb-ui sets `--text-sm` to 13px and `--text-lg` to 16px
(a deliberate control-surface type scale), which changes what the `text-sm` / `text-lg` utilities mean
in your app; and `--elevation-popover` / `--elevation-dialog` are derived from the colourway's
`--shadow-color`, so never hard-code an rgba shadow.

For the full colourway session (apply + localStorage persistence + startup restore), use
`createColorwayStore` instead of re-implementing it per app:

```ts
// app/composables/useColorway.ts — module-level create = app-wide singleton
import {createColorwayStore} from "@notnotype/nb-ui/colorway";

const store = createColorwayStore({storageKey: "my-app-colorway"});
export function useColorway() {
    return store;
}
```

`createColorwayStore` accepts custom `colorways` / `meta` tables for products that ship their own ids.
It also writes `data-nb-appearance="light" | "dark"` on `<html>` alongside `color-scheme`, so themes
can branch on light/dark in plain CSS — `color-scheme` itself is not selectable.


## Themes

A **theme** is the second axis, orthogonal to colourway: shape, density, decoration and role mapping.
Colourway decides the colours; theme decides how tall a control is, how round it is, whether a surface
carries a gradient, and which colourway variable each surface role resolves to. Any theme × any
colourway is expected to work.

A theme is a package — manifest, variable values, optionally its own colourways, static SVG assets,
and optionally replacement implementations for whitelisted components:

```ts
import {installTheme, createThemeStore} from "@notnotype/nb-ui/theme";
import {provideThemeComponents} from "@notnotype/nb-ui/theme";
import nbook from "@notnotype/nb-ui/themes/nbook";
import macos from "@notnotype/nb-ui/themes/macos";

installTheme(nbook);   // install ≠ activate: install many, activate one
installTheme(macos);

const store = createThemeStore({storageKey: "my-app-theme", defaultId: "nbook"});
provideThemeComponents(store.components);   // in the app root setup
```

Four themes ship with the library: `nbook` (default), `macos`, `editorial`, `aurora`.
They all go through the same loader as a third-party theme — there is no privileged path.

`nbook` is the product theme for long-form writing. It takes Apple's Liquid Glass layering rule —
glass belongs to navigation and controls, never to content — and pushes the content side one step
further: the manuscript is not merely opaque but paper, the one surface on screen that is warm,
serif, and casts a shadow. Chrome floats over it as glass, blurred harder than macOS does, with
edge refraction where the browser supports it. Its load-bearing inversion is that **in dark mode the
manuscript is the brightest surface on screen**, not the darkest — a lamp falls on paper, so paper
outranks the desk. Typography is set for Chinese: no negative tracking, one size step up from the
Apple scale, and looser leading, because Han characters fill the em box where Latin lowercase
does not.

`macos` stays in the library as the reference implementation of the format — it exercises every
extension point at once, so a theme author can read one package instead of four.

**Running with no theme installed is a supported state**, not a degraded one: the bare `:root`
defaults in `src/tokens.css` apply, so the UI works, it just has no design character.

Every loader check rejects with a readable reason rather than degrading silently, and the manifest is
pure data so a marketplace can index a theme without executing it.

## Documentation

- [UI Development Specification](docs/ui-development-spec.md) — Comprehensive engineering contracts, token consumption, core component specifications (Button, IconButton, SegmentedControl, FormCheckbox, FormSelect, Dropdown, Listbox, ScrollArea), and Component Lab (`/lab`) development guidelines.
- [Design Language](docs/design-language.md) — The rationale behind materials, layers, paper vs chrome, Chinese typography, and motion physics.
- [Theme Authoring Guide](docs/authoring-themes.md) — Theme manifest structure, contracts, and override mechanisms.
