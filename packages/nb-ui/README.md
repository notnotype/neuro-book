# nb-ui

NeuroBook 共用的 Vue 界面基础组件。

## 安装

```bash
bun add @notnotype/nb-ui
```

只支持 Bun。包里是 TypeScript 与 `.vue` 源码，没有编译产物，由宿主的 Vite 与 Tailwind v4 编译（[ADR 0028](../../docs/adr/0028-tailwind-only-host-compiles-nb-ui.md)、[ADR 0029](../../docs/adr/0029-workspace-packages-publish-source-to-npm.md)）。对等依赖是 `vue` 与 `typescript`（Vue 的单文件组件编译器要靠它解析导入的属性类型），Bun 会自动安装。宿主还要装 `vite`、`@vitejs/plugin-vue`、`tailwindcss` 与 `@tailwindcss/vite`。图标插件与 Lucide 图标集随 nb-ui 提供。许可证：AGPL-3.0-only。

## 本地开发

```bash
bun install
bun run dev          # playground
bun run test
bun run typecheck
```

改组件类名、图标、token 或 `src/styles.css` 不需要构建，见“宿主里的样式”。

## 在仓库外的应用里用

先把本包登记到 Bun：

```bash
cd ../nb-ui
bun link
```

再在应用里按登记的包名引用，并安装：

```json
"@notnotype/nb-ui": "link:@notnotype/nb-ui"
```

不要写 `link:../nb-ui`：Windows 上的 Bun 1.3.14 要求链接依赖写登记的包名，不认相对路径。

## Nuxt 模块

```ts
// nuxt.config.ts
export default defineNuxtConfig({
    modules: ["@notnotype/nb-ui/nuxt"],
});
```

模块自动注册 `@notnotype/nb-ui/components` 导出的组件与 `@notnotype/nb-ui/composables` 导出的组合函数，内部零件不注册。`nuxt` 与 `@nuxt/kit` 是可选的对等依赖，只有这个入口用到。

## 手动导入

```ts
import {Button, Dialog, IconButton, Notification, SegmentedControl} from "@notnotype/nb-ui/components";
import {useNotification} from "@notnotype/nb-ui/composables";
```

## 组件

每个组件的行为、属性与注意事项见同名 `.md`。清单以 [`src/components/index.ts`](src/components/index.ts) 为准；几个相近的零件怎么选，见 [开发规范](docs/ui-development-spec.md) 的“同类零件的分工”。

### 控件

- [`Button`](src/components/controls/Button.md)：主要、次要、弱化、危险、幽灵几种按钮，可带加载态。
- [`IconButton`](src/components/controls/IconButton.md)：只有图标的紧凑按钮。
- [`SegmentedControl`](src/components/controls/SegmentedControl.md)：换模式：同一处内容换个看法（列表、网格），几个里选一个。
- [`ToggleGroup`](src/components/controls/ToggleGroup.md)：一组可叠加的开关（粗体、斜体），可以同时按下几个；不做单选。
- [`Switch`](src/components/controls/Switch.md)：开关。
- [`Tabs`](src/components/controls/Tabs.md)：换去处：下面的内容跟着换；只换看法时用 `SegmentedControl`。
- [`Toolbar`](src/components/controls/Toolbar.md)：一行工具按钮，按可用宽度让位。

### 表单

- [`Field`](src/components/form/Field.md)：字段外壳：标题、说明、错误与读屏关联。
- [`Input`](src/components/form/Input.md)：单行输入。
- [`Textarea`](src/components/form/Textarea.md)：多行输入。
- [`NumberInput`](src/components/form/NumberInput.md)：数值输入与步进。
- [`Select`](src/components/popup/Select.md)：从一列值里选一个，收在下拉框里。
- [`SearchSelect`](src/components/form/SearchSelect.md)：可搜索的下拉：输入的文字只是搜索词，选中才改值。
- [`Checkbox`](src/components/form/Checkbox.md)：复选框。
- [`CheckboxGroup`](src/components/form/CheckboxGroup.md)：一组复选框。
- [`RadioGroup`](src/components/form/RadioGroup.md)：表单里选一个值，选项可带说明，纵向或横向。
- [`Slider`](src/components/form/Slider.md)：单值或范围滑动条。
- [`ColorSwatches`](src/components/form/ColorSwatches.md)：单选色板，可带“自动”与“自定义”。

### 弹出列表与浮层

- [`DropdownMenu`](src/components/popup/DropdownMenu.md)：点按钮弹出一列动作，可带勾选项与级联子菜单；选值用 `Select`。
- [`Menubar`](src/components/popup/Menubar.md)：窗口菜单栏。
- [`ContextMenu`](src/components/popup/ContextMenu.md)：右键菜单。
- [`QuickPick`](src/components/popup/QuickPick.md)：输入筛选、挑一项（命令面板、快速打开）；候选与前缀解析归宿主。
- [`AnchoredPopover`](src/components/popup/AnchoredPopover.md)：贴在元素或选区旁边的浮层，不抢焦点，开关由宿主决定。
- [`SuggestionMenu`](src/components/popup/SuggestionMenu.md)：输入时弹出的候选（`@`、`/`）：不抢焦点，键盘由宿主处理。
- [`Popover`](src/components/feedback/Popover.md)：气泡。
- [`Tooltip`](src/components/feedback/Tooltip.md)：悬停提示。
- [`InfoTip`](src/components/feedback/InfoTip.md)：字段标签旁的问号说明。
- [`Dialog`](src/components/feedback/Dialog.md)：模态对话框。
- [`FloatingWindow`](src/components/feedback/FloatingWindow.md)：非模态浮动窗口，可拖动、可缩放。
- [`AlertDialog`](src/components/feedback/AlertDialog.md)：二次确认。
- [`Drawer`](src/components/feedback/Drawer.md)：四向滑出的抽屉。

### 反馈

- [`Notification`](src/components/feedback/Notification.md)：一条通知。
- [`NotificationStack`](src/components/feedback/NotificationStack.md)：在屏幕一角排队显示通知；队列从 `@notnotype/nb-ui/notifications` 导入，不碰 DOM。
- [`Banner`](src/components/feedback/Banner.md)：区域或页面顶部的常驻横幅，不进队列、不自动消失。
- [`Progress`](src/components/display/Progress.md)：进度条。
- [`Spinner`](src/components/display/Spinner.md)：转动的加载指示。
- [`Skeleton`](src/components/display/Skeleton.md)：结构已知时的装饰性占位。
- [`EmptyState`](src/components/display/EmptyState.md)：空状态。

### 布局与导航

- [`Splitter`](src/components/layout/Splitter.md)：冻结，只给 nb-story、dev-panel 用。布局树、分割面板与拖放反馈都在 [`@notnotype/nb-layout`](../nb-layout/README.md)。
- [`ScrollArea`](src/components/layout/ScrollArea.md)：自己建滚动容器、带自绘滑块。
- [`OverlayScrollbar`](src/components/layout/OverlayScrollbar.md)：接到已有滚动元素上的叠加滑块。
- [`Collapsible`](src/components/layout/Collapsible.md)：受控折叠。
- [`CollapsibleCard`](src/components/layout/CollapsibleCard.md)：可折叠的卡片。
- [`CollapsibleRow`](src/components/layout/CollapsibleRow.md)：可折叠的一行。
- [`Separator`](src/components/layout/Separator.md)：分隔线。
- [`DropIndicatorLabel`](src/components/layout/DropIndicatorLabel.md)：拖放的提示药丸。
- [`Breadcrumb`](src/components/navigation/Breadcrumb.md)：面包屑。
- [`Tree`](src/components/navigation/Tree.md)：通用层级树，单选或多选。

### 展示

- [`Badge`](src/components/display/Badge.md)：状态徽章。
- [`Kbd`](src/components/display/Kbd.md)：键帽。
- [`Table`](src/components/display/Table.md)：数据表格。
- [`CodeBlock`](src/components/display/CodeBlock.md)：代码块。
- [`DiffView`](src/components/display/DiffView.md)：比较改前改后，按行、按字标出改动。

## 界面文字

界面文字的值与翻译端口，行为合同见 [`ui/i18n`](../../docs/specs/ui/i18n.md)：

- `@notnotype/nb-ui/text`：`Text`、`TextRef`、`LocaleMap` 与判别、`resolveLocaleMap`、参数整理。纯 TS，不引 Vue，服务端也能用。
- `@notnotype/nb-ui/text-port`：`TEXT_PORT_KEY`、`useText()`、`defaultTextPort()`、`provideDefaultText(locale)` 与 `registerDefaultCatalog(ns, catalogs, source?)`。宿主在每个 Vue 根上注入自己的端口；没有注入时得到 nb-ui 的缺省端口（`zh-CN`，最小实现），目录是所有已导入的共享包登记的：nb-ui、nb-agent-ui、nb-form、nb-markdown 的 Vue 层在导入时各自登记，所以几个共享包嵌在一起、上面没有宿主时都翻得出来。共享包的根组件调用 `provideDefaultText(locale)`：上面有注入的端口就用它，没有时按 `locale` 建一个缺省端口给子树（合法的语言标签取规范写法，不合法的按 `zh-CN`）。登记表挂在 `globalThis` 上（`Symbol.for("nb-ui.default-catalogs")`），出现两份 nb-ui 模块时也共用一张。
- `@notnotype/nb-ui/locales`：nb-ui 自带的目录（命名空间 `nb-ui`），宿主在引导时登记。写成 `.ts` 模块，消费方不需要开 `resolveJsonModule`。

组件的缺省文案（未传属性时的读屏名称、空态与按钮文字，例如 `Dialog` 的 `closeLabel`、`NumberInput` 的 `incrementLabel`、`Table` 的 `emptyText`）走翻译端口，取自这份目录：宿主注入了端口就跟着端口的语言，换语言不重新挂载；没有宿主时是中文。调用方显式传属性时以属性为准，宿主要给某处不同的文案，传属性即可。这些组件在同名 `.md` 里标 `state:inject`。组件内部用 `useUiText()`（`@notnotype/nb-ui/text-port`）取，键类型从中文目录推出，写错键编译不过。

## 宿主里的样式

nb-ui 用 Tailwind v4 写样式，不发预编译的 CSS。宿主的样式入口先导入 Tailwind，再导入 nb-ui：

```css
@import "tailwindcss";
@import "@notnotype/nb-ui/tailwind.css";
@source "../";                           /* 宿主自己的源码，Vite 的根不是包根时要写 */
```

入口会扫描 nb-ui 的组件，所以宿主的构建会产出这些类，不用扫 `node_modules`。设计见 [`src/tailwind.css`](src/tailwind.css) 的头注释；宿主要知道的是：

- **分层**：Tailwind 的标准层序 `theme, base, components, utilities`。nb-ui 的设计 token（`src/tokens.css`）在 `base`，语义类（`.nb-ui-*`，`src/styles.css`）在 `components`。调用方传给组件的原子类在 `utilities`，不用提高特异性就能盖过语义类。配色与主题变量（`themes/*/vars.css`）不分层，靠选择器特异性压过 `base` 的 token。
- **不带重置样式**：库不该重置宿主的元素。用 `@import "tailwindcss"` 带来的重置或你自己的，放进 `@layer base`。只要 Tailwind 的主题与原子类时，下面三部分都要有：少了层序声明，原子类会排到 nb-ui 的 `base` 与 `components` 之前；少了 `layer(…)`，原子类不分层。两种情况下调用方的原子类都会静默输给 nb-ui 的语义类。

  ```css
  @layer theme, base, components, utilities;   /* 写在所有 @import 之前：层序按第一次出现定 */
  @import "tailwindcss/theme.css" layer(theme);
  @import "tailwindcss/utilities.css" layer(utilities);
  @import "@notnotype/nb-ui/tailwind.css";
  ```
- **全局规则放进 `base`**：不分层、特异性低于一个类的规则（`html`、`body`、`*`、重置样式的 `all: unset`）压过所有分层的原子类。
- **字号刻度**：nb-ui 用 `@theme static` 声明 `--text-2xs` 到 `--text-xl`、`--leading-tight|ui|reading` 与 `--font-*`，所以 `text-sm` 取的是 nb-ui 的刻度（数值随主题），`text-md`、`leading-ui` 也能用。Tailwind 的其它刻度不动。
- **原生滚动条**：在根元素（`<html>`）上挂 `nb-ui-scrollbar-thin`，整个应用的原生滚动条变细、按 `--text-main` 与 `--scrollbar-thumb-mix` 混色。这条规则特异性为 0，`nb-ui-scrollbar-none` 或任何原子类都盖得过。

nb-ui 组件内部的图标不用宿主登记：入口自己生成图标规则（`@iconify/tailwind4`、`i-lucide-*`）。例外是你传进去的图标：`Badge`、`Banner`、`DropdownMenu`、`Tabs`、`SegmentedControl`、`ContextMenu`、`EmptyState`、`Tree` 的 `iconClass` 接收你代码里的任意类名，生成这个类仍是你的构建的事。

共用的样式登记处（登记，不抄数值）：

- `NB_Z_INDEX`（`@notnotype/nb-ui/theme`）：浮层层级，用 `:style` 绑定。
- 浮层外框类（`.nb-ui-popover-surface` 等，`src/styles.css`）：见 [开发规范](docs/ui-development-spec.md) 的“浮层外框”。
- `.nb-ui-menu-item`（及 `__icon`、`__label`、`__hint`、`--multiline`）、`.nb-ui-menu-label`、`.nb-ui-menu-separator`、`.nb-ui-menu-item-danger`：弹出列表的一行，见开发规范的“弹出列表的共同合同”。

## 开发规范

公共组件、主题、token、样式与 playground 的工程规范见 [`docs/ui-development-spec.md`](docs/ui-development-spec.md)。组件场景登记在新应用的 Component Lab（`packages/neuro-book` 开发模式的 `/lab`，合同见 [`ui/component-lab`](../../docs/specs/ui/component-lab.md)），位置是 `packages/neuro-book/src/plugins/lab/web/fixtures/nb-ui/`。playground 只放需要真实浏览器的验收页。

## 配色

配色是一组颜色变量。宿主要提供 `src/colorway/colorway-contract.ts` 列出的基础变量：

```ts
import {applyColorway, defaultDarkColorway} from "@notnotype/nb-ui/colorway";

applyColorway(document.body, defaultDarkColorway);
```

必须提供的公开变量（33 个）：

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

库里只带一套配色，id 是 `dark`；`defaultDarkColorway` 是内置表的别名：

```ts
import {applyColorway, nbColorways, nbColorwayIds, nbColorwayMeta, NB_DEFAULT_COLORWAY_ID} from "@notnotype/nb-ui/colorway";

applyColorway(document.body, nbColorways.dark);
```

产品可以加别的 `--*` 变量，但 nb-ui 组件只依赖上面列出的公开变量。

**库里没有亮色配色。** 不装主题时，亮色系统下界面仍是暗色。亮色配色来自主题包，例如 `macos` 带 `macos-light` 与 `macos-dark`；主题的 `defaultColorway.light` 因此要指向它自己的配色。

配色的整套流程（应用、存进 localStorage、启动时恢复）用 `createColorwayStore`，不用每个应用各写一份：

```ts
// 模块顶层创建，就是全应用单例
import {createColorwayStore} from "@notnotype/nb-ui/colorway";

const store = createColorwayStore({storageKey: "my-app-colorway"});
export function useColorway() {
    return store;
}
```

它接受自定义的 `colorways`、`meta` 表与 `aliases`（把存过的旧 id 映射到新 id，缺省的 `retiredColorwayAliases` 把已退役的 id 都映射到 `dark`）。它还会在 `<html>` 上写 `data-nb-appearance="light" | "dark"` 与 `color-scheme`，主题可以在纯 CSS 里按明暗分支（`color-scheme` 本身选不中）。

## 设计 token

颜色之外，nb-ui 有五组与配色无关的 token（排版、间距、圆角、投影、动效）。取值在 `src/tokens.css`，名单可以导入：

```ts
import {nbDesignTokens, nbTypographyTokens, nbRadiusTokens} from "@notnotype/nb-ui/theme";
```

`--elevation-popover`、`--elevation-dialog` 由配色的 `--shadow-color` 推出，不要写死 rgba 投影。

## 主题

主题是与配色正交的第二条轴：形状、密度、装饰与角色映射。配色决定颜色；主题决定控件多高、多圆、面带不带渐变、每个表面角色取哪个配色变量。任意主题配任意配色都应当能用。

主题是一个包：清单、变量取值，可选自带配色与静态 SVG 资源。不能替换组件的实现，也不能带 JS。

```ts
import {installTheme, createThemeStore} from "@notnotype/nb-ui/theme";
import nbook from "@notnotype/nb-ui/themes/nbook";
import macos from "@notnotype/nb-ui/themes/macos";

installTheme(nbook);   // 安装不等于激活：可以装多套，激活一套
installTheme(macos);

const store = createThemeStore({storageKey: "my-app-theme", defaultId: "nbook"});
```

库里带四套主题：`nbook`（默认）、`macos`、`editorial`、`aurora`，都走和第三方主题相同的装载路径。

- `nbook` 是长篇写作的产品主题：玻璃属于导航与控件，正文是纸，是屏幕上唯一温暖、带衬线、有投影的面；暗色下稿面是最亮的面，不是最暗的。排版按中文定：不收字距，比 Apple 的刻度大一档，行距更松。
- `macos` 是格式的参考实现，用到了所有扩展点，主题作者读这一个包就够了。

**不装主题是受支持的状态**：`src/tokens.css` 的裸 `:root` 缺省值生效，界面能用，只是没有设计特点。

装载器的每项检查不通过都给出能读懂的原因，不静默降级；清单是纯数据，市场不执行它也能建索引。写主题见 [主题作者规范](docs/authoring-themes.md)。

## 文档

- [开发规范](docs/ui-development-spec.md)：工程合同、token 消费、浮层与滚动条、自检清单。
- [设计语言](docs/design-language.md)：材质、层级、中文排版与动效的判据和取舍。
- [主题作者规范](docs/authoring-themes.md)：主题包的结构、合同与装载。
- [从 0.3 升级到 0.4](docs/migration-0.4.md)：公开 API 收成一套写法后的逐项对照。
