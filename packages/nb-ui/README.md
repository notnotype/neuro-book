# nb-ui

Shared Vue/Nuxt UI primitives for NeuroBook-derived projects.

## Install

```bash
bun add @notnotype/nb-ui
```

Bun only. The package ships TypeScript and `.vue` sources, no compiled output; the host's Vite and
Tailwind v4 compile them ([ADR 0028](../../docs/adr/0028-tailwind-only-host-compiles-nb-ui.md),
[ADR 0029](../../docs/adr/0029-workspace-packages-publish-source-to-npm.md)). Peer dependencies are `vue`
and `typescript` (Vue's SFC compiler needs it to resolve imported prop types); Bun installs peers
automatically. The host also installs `vite`, `@vitejs/plugin-vue`, `tailwindcss` and `@tailwindcss/vite`.
The Tailwind icon plugin and the Lucide icon set come with nb-ui. Licence: AGPL-3.0-only.

## Local development

```bash
bun install
bun run dev          # playground on :3004
bun run test
bun run typecheck
```

nb-ui ships no compiled CSS: the host compiles nb-ui's source with its own Tailwind (see
[Styles in the host app](#styles-in-the-host-app)), so changing component classes, icons, tokens, or
`src/styles.css` needs no build step.

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

The module auto-registers the components exported from `@notnotype/nb-ui/components` and the composables exported from `@notnotype/nb-ui/composables`; internal parts are not registered. `nuxt` and `@nuxt/kit` are optional peer dependencies, needed only by this entry.

## Manual imports

Components can also be imported explicitly:

```ts
import {Button, Dialog, IconButton, Notification, SegmentedControl} from "@notnotype/nb-ui/components";
import {useNotification} from "@notnotype/nb-ui/composables";
```

## Components

### 基础交互与控制 (Controls & Form)
- `Button`：primary / secondary / subtle / danger / ghost 变体，`sm` (26px) / `md` (32px) / `lg` (38px) 尺寸，支持 block、loading 与反色文字。
- `IconButton`：紧凑图标操作按钮，`sm` / `md` / `lg` 尺寸，高精度触觉反馈与零尺寸抖动。
- `Menubar`：桌面应用级主菜单栏（文件/编辑/视图/写作/帮助），支持横向方向键无缝穿梭与子菜单快捷键。
- `DropdownMenu`：点一个按钮弹出一列动作（“更多”菜单、移动到…），可带勾选项与级联子菜单；从几项里选一个值用 `Select`。
- `SegmentedControl`：换模式——同一处内容换个看法（列表 / 网格、文本 / 树形），几个里选一个，带滑动的选中块。
- `ToggleGroup`：一组可叠加的开关（粗体、斜体），可以同时按下几个，也可以都不按下；不做单选。
- `Switch`：现代胶囊开关控件。
- `Slider`：连续与离散滑动条（支持单值/范围双滑块、垂直/水平方向、`sm`/`md`/`lg` 尺寸）。
- `RadioGroup`：表单里从几项中选一个值，每项可带说明文字，纵向或横向排布。
- `CheckboxGroup`：复选框受控组合容器（支持水平/垂直排布）。
- `Field` / `Input` / `NumberInput` / `Select` / `Textarea` / `Checkbox`：无障碍表单控件。
- `ColorSwatches`：单选色板，可带“自动”（值为 null）与“自定义”（旁边打开取色面板）。

### 工作区布局与导航 (Layout & Navigation)
- `Splitter`：多栏可调节分割面板（受控 `sizesPx` / 独立自分配两种用法），支持水平/垂直方向、收起策略与拖拽吸附；常驻 1px `--divider` 接缝与悬停/拖动高亮分层，零宽接缝不画线。几何一律 CSS px，拖动/命中/键盘由 nb-ui 自己的 `useSashGesture` 输入层与 `sash-drag` 求解器承担。
- `createGrid`（`grid` / `grid-splitter`）：领域无关的可序列化拆分树——两轴几何、增删/移动/拆分叶、批量手势原子提交（`resizeBranches`）与快照 v2；`buildGridBranchPanels` / `gridBranchSizesPx` 只是把布局投影成面板配置，数值算法只有 `grid-geometry` / `sash-drag` 一份。
- `NestedGrid`：把布局树递归渲染成 `Splitter`（分支一层一个、叶走插槽），独占一份手势会话：拖动中发布预览布局，松手把一次 `GridGestureCommit` 交给宿主的 `onGestureCommit` 同步接纳。
- `DropFeedbackOverlay` / `DropIndicatorLabel`：从 `@notnotype/nb-ui/components` 导入的拖放反馈层。`DropIndicatorLabel` 是纯视觉的提示药丸，接收 `label` / 可选 `iconClass`；画区域、条目与插入线的 `DropIndicator` 是覆盖层的内部件，不导出。`DropFeedbackOverlay` 是共享覆盖层：吃宿主给的 `preview`（边缘带 / 中央整片叶 / 条目 / 插入线 + 轴），自己负责 body Teleport、fixed 定位、6px（区域）与 2px（线）比例内缩、提示药丸的测量与视口夹紧、`aria-live` 播报和观察器生命周期；业务种类与数量由调用方以 `data-*` 透传到覆盖层根（`<Teleport>` 下手动 `useAttrs`）。纯几何入口 `@notnotype/nb-ui/layout` 另有 `resolveGridInsertion`（边缘插入带 / 中央保持布局 + 插入线）与 `resolveListInsertion`（列表插入位：同一插入位只有一条线）。Lab 的 `DropFeedbackOverlay` 场景按真实矩形演示区域与插入线。
- `ScrollArea`：平滑滚动容器，内置自适应悬浮滚动条。
- `Collapsible`：受控折叠展开容器。
- `Separator`：水平 / 垂直语义分隔线。
- `Tree`：通用层级树（章节、分类这类不带文件语义的内容），单选或多选、键盘遍历。
- `Breadcrumb`：面包屑导航栏。
- `Tabs`：换去处——下面的内容跟着换（设置的分页、面板里的几页）；只换看法、内容还是同一份时用 `SegmentedControl`。

### 弹层与反馈 (Feedback & Overlays)
- `Dialog`：对话框，一个组件两种用法：缺省模态（遮罩、焦点锁定、背景不可交互、点遮罩与 Escape 关闭，同时打开的按打开顺序叠放）；`modal=false` 是浮动窗口（无遮罩、标题栏可拖动、`resizable` 时六个缩放手柄与键盘调整）。外框只有一份。
- `AlertDialog`：二次确认/破坏性操作警示弹窗（支持 `danger` / `warning` / `accent` 语调）。
- `Drawer`：侧边抽屉面板（支持 `top` / `bottom` / `left` / `right` 四向弹出与遮罩模糊）。
- `Popover`：通用气泡卡片，消费磨砂浮层材质基座。
- `Tooltip` / `ContextMenu`：延迟/即时提示框与右键上下文菜单。
- `InfoTip`：字段标签旁的问号说明图标，悬停或聚焦时用 Tooltip 显示说明。
- `SuggestionMenu`：输入时弹出的候选菜单（Composer 的 `@`、`/`、`$`，编辑器的斜杠菜单）：不抢焦点，键盘由宿主处理；贴光标或贴输入框，逐帧跟随、按可用空间翻转与收矮；`suggestionOptionId` 给宿主的 `aria-activedescendant`。
- `QuickPick`：输入筛选、从候选里挑一项的浮层（命令面板、快速打开、跳到行都用它，S4 层级）；纯受控候选项/查询/活动项，`>` 命令与 `:` 行号等前缀解析归宿主。模态键盘与焦点合同、`closed` 真实关闭交接事件、`NB_Z_INDEX.commandPalette`（9200）层级。
- `Notification` / `NotificationStack`：一条通知，与屏幕一角排队显示通知的容器；队列可用 `createNotificationQueue()` 自建一份传给它，通知可带进度。队列本身不碰 DOM，从子路径 `@notnotype/nb-ui/notifications` 单独导入时不会把别的 composable 带进无 DOM 的编译组。
- `Banner`：区域或页面顶部的常驻横幅（已断开正在重连、有新版本要刷新），不进队列、不自动消失。

### 数据展示 (Display)
- `Badge`：超椭圆现代状态徽章（支持 `dot` 发光点、`iconClass` 与温润深琥珀 Warning 调色）。
- `Progress`：进度条（支持 `accent` / `success` / `warning` / `danger` 语调与平滑位移动效）。
- `Kbd`：实体键盘键帽快捷键展示组件（`sm` / `md` / `lg`）。
- `Table` / `Spinner` / `Skeleton` / `EmptyState`：数据表格与异步骨架/空状态指示。

## Interface text

界面文字的值与翻译端口，行为合同见 [`ui/i18n`](../../docs/specs/ui/i18n.md)：

- `@notnotype/nb-ui/text`：`Text`、`TextRef`、`LocaleMap` 与判别、`resolveLocaleMap`、参数整理。纯 TS，不引 Vue，服务端也能用。
- `@notnotype/nb-ui/text-port`：`TEXT_PORT_KEY`、`useText()`、`defaultTextPort()`、`provideDefaultText(locale)` 与 `registerDefaultCatalog(ns, catalogs, source?)`。宿主在每个 Vue 根上注入自己的端口；没有注入时得到 nb-ui 的缺省端口（`zh-CN`，最小实现），目录是所有已导入的共享包登记的：nb-ui、nb-agent-ui、nb-form、nb-markdown 的 Vue 层在导入时各自登记，所以几个共享包嵌在一起、上面没有宿主时都翻得出来。共享包的根组件调用 `provideDefaultText(locale)`：上面有注入的端口就用它，没有时按 `locale` 建一个缺省端口给子树（合法的语言标签取规范写法，不合法的按 `zh-CN`）。登记表挂在 `globalThis` 上（`Symbol.for("nb-ui.default-catalogs")`），出现两份 nb-ui 模块时也共用一张。
- `@notnotype/nb-ui/locales`：nb-ui 自带的目录（命名空间 `nb-ui`），宿主在引导时登记。写成 `.ts` 模块，消费方不需要开 `resolveJsonModule`。

组件的缺省文案（未传属性时的读屏名称、空态与按钮文字，例如 `Dialog` 的 `closeLabel`、`NumberInput` 的 `incrementLabel`、`Table` 的 `emptyText`）走翻译端口，取自这份目录：宿主注入了端口就跟着端口的语言，换语言不重新挂载；没有宿主时是中文。调用方显式传属性时以属性为准，宿主要给某处不同的文案，传属性即可。这些组件在同名 `.md` 里标 `state:inject`。组件内部用 `useUiText()`（`@notnotype/nb-ui/text-port`）取，键类型从中文目录推出，写错键编译不过。

## Styles in the host app

nb-ui is styled with Tailwind v4 and ships no precompiled CSS. The host's CSS imports Tailwind first,
then nb-ui's entry:

```css
@import "tailwindcss";
@import "@notnotype/nb-ui/tailwind.css";
@source "../";                           /* the host's own sources, when Vite's root is not the package root */
```

The entry scans nb-ui's components for utility classes, so the host's build emits them and the host
does not have to scan `node_modules`. The design is explained in the header comment of
[`src/tailwind.css`](src/tailwind.css); the points a host needs:

- **Layers.** Tailwind's standard order `theme, base, components, utilities`. nb-ui's design tokens
  (`src/tokens.css`) sit in `base`, its semantic classes (`.nb-ui-*`, `src/styles.css`) in `components`.
  Utility classes a caller passes to a component are in `utilities`, so they override the semantic
  classes without any specificity tricks. Colourway and theme variables (`themes/*/vars.css`) are
  unlayered and win over the `base` tokens by selector specificity.
- **No preflight.** A library should not reset the host's elements. Use the preflight that
  `@import "tailwindcss"` brings, or your own reset, and put it in `@layer base`. If you want only
  Tailwind's theme and utilities, all three parts below are needed; drop the layer statement and
  utilities end up ordered before nb-ui's `base` and `components`, drop `layer(…)` and they are
  unlayered. Either way a caller's utility silently loses to nb-ui's semantic classes:

  ```css
  @layer theme, base, components, utilities;   /* before every @import: layer order is set by first appearance */
  @import "tailwindcss/theme.css" layer(theme);
  @import "tailwindcss/utilities.css" layer(utilities);
  @import "@notnotype/nb-ui/tailwind.css";
  ```
- **Global rules go in `base`.** An unlayered rule with specificity below one class (`html`, `body`,
  `*`, a reset's `all: unset`) beats every layered utility class. Put such rules in `@layer base`.
- **Type scale.** nb-ui declares `--text-2xs` to `--text-xl`, `--leading-tight|ui|reading` and the
  `--font-*` families with `@theme static`, so `text-sm` is nb-ui's 13px and `text-md`, `leading-ui`
  exist as utilities. Tailwind's other scales are untouched.
- **Native scrollbars.** Put `nb-ui-scrollbar-thin` on the root element (`<html>`) to give the whole
  app thin native scrollbars coloured by `--text-main` mixed at `--scrollbar-thumb-mix`; the rule has zero specificity, so
  `nb-ui-scrollbar-none` or any utility overrides it where needed.

Icons used inside nb-ui components need no registration by the host app: the entry generates the icon
rules (`@iconify/tailwind4`, `i-lucide-*`) and the mask shim itself. The one exception is icons **you**
pass in: `iconClass` on `Badge` / `Banner` / `DropdownMenu` / `Tabs` / `SegmentedControl` /
`ContextMenu` / `EmptyState` / `Tree` takes an arbitrary class from your code, and generating that
class is still your build's job.

Shared style registries (register instead of copying values):

- `NB_Z_INDEX` (`@notnotype/nb-ui/theme`) — overlay z-indexes; bind via `:style`.
- `.nb-ui-popover-surface` (`styles.css`) — floating panel border/background/shadow/backdrop base (DropdownMenu, Select, ContextMenu, Tooltip, Dialog).
- `.nb-ui-tooltip-surface` (`styles.css`) — compact paper Tooltip modifier: control-radius surface, short attached arrow, and theme-aware text/padding.
- `.nb-ui-menu-surface` — popup-list modifier (DropdownMenu, Select, Menubar, ContextMenu, QuickPick, SuggestionMenu): consumes `--radius-menu` and writes the `--menu-pad` padding, so nested items stay concentric.
- `.nb-ui-menu-item` (+ `__icon`, `__label`, `__hint`, `--multiline`), `.nb-ui-menu-label`, `.nb-ui-menu-separator` — one popup-list row: `--menu-item-h` / `--menu-item-font`, concentric radius, highlight only on `[data-highlighted]`, one leading column shared by the check and the icon.
- `.nb-ui-surface-rim` — opt-in Liquid Glass edge sheen for complete Dialog surfaces (modal and window); nbook small popovers leave it off.
- `.nb-ui-menu-item-danger` (`styles.css`) — destructive menu items: danger text and icon colour; the highlight stays neutral.

## UI development contract

公共组件、主题、token、样式与 playground 的当前工程规范见 [`docs/ui-development-spec.md`](docs/ui-development-spec.md)。

组件场景登记在新应用的 Component Lab（`packages/neuro-book` 的开发模式 `/lab`，合同见 [`ui/component-lab`](../../docs/specs/ui/component-lab.md)）：组件场景、主题 × 配色、手机与平板画布、检查器、事件日志与 `lab:shot` 截图。它与 playground 的全量 `/components` 画廊、设计语言 `/workbench` 分工不同。新增或修改公共组件时，先读规范并在 `packages/neuro-book/src/plugins/lab/web/fixtures/nb-ui/` 登记场景。

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

Two things to know: nb-ui sets `--text-sm` to 13px and `--text-lg` to 16px (a deliberate
control-surface type scale), which is what the `text-sm` / `text-lg` utilities mean in your app; and `--elevation-popover` / `--elevation-dialog` are derived from the colourway's
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

- [UI Development Specification](docs/ui-development-spec.md) — Comprehensive engineering contracts, token consumption, core component specifications (Button, IconButton, SegmentedControl, Checkbox, Select, DropdownMenu, ScrollArea), and Component Lab scene registration guidelines.
- [Design Language](docs/design-language.md) — The rationale behind materials, layers, paper vs chrome, Chinese typography, and motion physics.
- [Theme Authoring Guide](docs/authoring-themes.md) — Theme manifest structure, contracts, and override mechanisms.
- [Upgrading from 0.3 to 0.4](docs/migration-0.4.md) — 公开 API 收成一套写法后的逐项对照（尺寸、语调、弹出位置、文案属性、列表字段、浮层的打开与关闭、`FloatingWindow`）。
