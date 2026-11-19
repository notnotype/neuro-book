# @notnotype/nb-layout

布局工具：布局树、尺寸求解、落点与拖动。决策见 [ADR 0044](../../docs/adr/0044-workbench-single-layout-tree.md) 与 [ADR 0054](../../docs/adr/0054-nb-layout-general-library.md)，行为合同见 [`docs/specs/ui/nested-grid.md`](../../docs/specs/ui/nested-grid.md)。工作台的布局文档与标签条在 [`@notnotype/nb-workbench-layout`](../nb-workbench-layout/README.md)。

```ts
import {createGrid, NB_LAYOUT_THEME_VARS} from "@notnotype/nb-layout"; // 纯 TS：树、尺寸、落点、变量清单，不依赖 Vue 与 DOM
import {NestedGrid, Splitter} from "@notnotype/nb-layout/vue";         // 组件与组合式函数，只依赖 vue 与 tabbable
import {LAYOUT_TEXT_KEY} from "@notnotype/nb-layout/text";              // 宿主接文字的注入点
```

## 主题

组件只读本包命名空间下的 CSS 变量 `--nb-layout-*`，每处都带回退：

- 装了 nb-ui 的宿主不用做什么：nb-ui 的 `tokens.css` 在根元素上把主题的名字接过来（`--nb-layout-sash-line-color: var(--sash-line-color)`），主题照旧写旧名（[主题系统](../../docs/specs/theme/system.md)的“布局组件的桥接”）。旧名只在根元素上改才传得过来；子树要改 nb-layout 的外观，直接设 `--nb-layout-*`。
- 不装 nb-ui 时用回退：尺寸、时长、圆角与 nb-ui 的缺省相同，颜色是系统色（`Canvas`、`CanvasText`、`Highlight` 一类）。要自己的配色，在根上设下表的变量。
- 系统减少动态效果时，四个时长（`--nb-layout-motion-*`）归零，宿主设的值也压不过。
- 时长写成 `ms` 或 `s` 的字面值：组件的 JS 也按它计时（过渡收尾、放下的滑回），`calc()` 这类写法 JS 读不出、当 0。

主题级的变量（承诺不随意改名）：

| 变量 | nb-ui 主题里的名字 | 回退 |
|---|---|---|
| `--nb-layout-motion-fast` | `--motion-fast` | `120ms` |
| `--nb-layout-motion-base` | `--motion-base` | `180ms` |
| `--nb-layout-motion-move` | `--motion-move` | `280ms` |
| `--nb-layout-motion-layout` | `--motion-layout` | `470ms` |
| `--nb-layout-ease-layout` | `--ease-layout` | `cubic-bezier(0.23, 1, 0.32, 1)` |
| `--nb-layout-sash-line-color` | `--sash-line-color` | `Highlight` |
| `--nb-layout-sash-line-size` | `--sash-line-size` | `3px` |
| `--nb-layout-sash-line-inset` | `--sash-line-inset` | `0px` |
| `--nb-layout-sash-line-radius` | `--sash-line-radius` | `0px` |
| `--nb-layout-sash-line-glow` | `--sash-line-glow` | `none` |
| `--nb-layout-drop-area-fill` | `--drop-area-fill` | 系统色（`Highlight` 12%） |
| `--nb-layout-drop-area-border` | `--drop-area-border` | 系统色（`Highlight` 70%） |
| `--nb-layout-scrim` | `--layout-scrim` | 系统色（压暗的 `Canvas`） |
| `--nb-layout-sector-fill` | `--layout-sector-fill` | 系统色（`Highlight` 5%） |
| `--nb-layout-sector-line` | `--layout-sector-line` | 系统色（`Highlight` 65%） |
| `--nb-layout-sector-active-fill` | `--layout-sector-active-fill` | 系统色（`Highlight` 12%） |
| `--nb-layout-sector-active-line` | `--layout-sector-active-line` | 系统色（`Highlight` 70%） |
| `--nb-layout-card-radius` | `--layout-card-radius` | `10px` |
| `--nb-layout-card-shadow` | `--layout-card-shadow` | 黑色投影加一圈系统色描边 |
| `--nb-layout-focus-ring` | `--focus-ring` | 系统色（`Highlight` 外圈） |
| `--nb-layout-focus-outline` | `--focus-outline` | `Highlight` |

其余变量（面、文字、线等通用令牌，两个落点浮层的层级，宿主旋钮与组件写在行内的几何）是内部名字，全部名单与回退在根入口导出的 `NB_LAYOUT_THEME_VARS` 里；宿主旋钮的用法见各组件的同名 `.md`。

## 文字

分隔条、可排序列表与浮动窗把手的读屏名称与提示经 `LAYOUT_TEXT_KEY`（`@notnotype/nb-layout/text`）注入的翻译函数取：`(key, params) => string`，键不带命名空间，宿主按命名空间 `nb-layout` 查自己的目录（`@notnotype/nb-layout/locales` 有 `zh-CN` 与 `en-US`）。函数要在每次调用时读宿主的当前语言，组件才会跟着换语言。没有注入时用自带的 `zh-CN` 目录。
