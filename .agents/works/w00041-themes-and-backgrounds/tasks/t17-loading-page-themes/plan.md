# t17 计划：加载页的主题（场景图背景与进度样式预设）

## Context

从书架打开作品是整页导航，进入的是 `index.html` 的静态加载页：主题底色上一条居中的进度条，书名在上、提示在下（[`runtime.browser-host`](../../../../../docs/specs/runtime/browser-host.md) 启动序列第 1 步，样式 [`host-loading.css`](../../../../../packages/neuro-book/src/web/host-loading.css)）。它在任何脚本之前画出第一帧，所以颜色只能取“上一次应用的主题”：宿主在主题每次写到文档根时把明暗和四种颜色记进本地存储（`appearance-hint.ts`，键 `nbook.host-appearance`），`index.html` 头部的内联脚本在第一帧前读回。

开发者 2026-11-07 提出：这个加载动画可以加主题。范围（本会话选的推荐项）：**主题能决定加载页用不用它的场景图当背景，并从几种内置的进度样式里选一种**；不做主题自带动画素材。书房使用，主题编辑器同步（“声明能写的，编辑器都能编”）。

依据：[`theme/skins.md`](../../../../../docs/specs/theme/skins.md)、[`theme/editor.md`](../../../../../docs/specs/theme/editor.md)、[`runtime/browser-host.md`](../../../../../docs/specs/runtime/browser-host.md)。

## 关键设计

### 声明：`Look.loading`（`workbench/shared/themes.ts`）

每套明暗各写各的，和 `scene` 一样：

```ts
loading?: {
    scene?: boolean;                                   // 用这一套的 scene（静态那张）当加载页背景；没写或 false 不用
    indicator?: "bar" | "dots" | "pulse" | "page";     // 进度样式；没写等于 "bar"（现在的细条）
}
```

- `additionalProperties: false`，只追加字段，老声明照常合法。
- 只认静态 `scene`：场景提供者画的图是对象 URL，整页重新加载后就没了，加载页用不了它；`workingScene` 不用（加载时还没有 Agent 状态）。`scene` 没写时 `loading.scene: true` 没有效果，不报错（声明校验只管形状）。
- 纯数据，没有素材：“我的主题”、导出包、导入、复制插件主题都原样带着它，不需要素材管线。

### 从主题到文档根（`workbench/web/themes.ts` 的 `themeVars`）

- `loading.scene === true` 且静态 `scene` 解析得出时，写 `--skin-loading-scene: url("<场景地址>")`；`indicator` 写了且不是 `bar` 时写 `--skin-loading-indicator: <名>`。变量名进 `SKIN_VARS`。这样文档根的写入沿用现有的主题变量通道，换主题时随着一起变、清掉。

### 记进加载页的提示（`web/host/appearance-hint.ts`、两份 `index.html` 的内联脚本）

- `HostAppearanceHint` 增加两个可选字段：`scene`（同源路径，只有 `pathname`，例如 `/assets/study-day-<哈希>.webp`、`/api/nbook.files/raw/user/theme-assets/<sha>.webp`、`/api/runtime/plugins/<编码后的插件 id>/files/<摘要>/<路径>`）、`indicator`（`dots` | `pulse` | `page`）。
- **地址一律先按浏览器的 URL 规则解析再判同源，不用正则当同源校验**（设计审查第 2、3 条）：`readDocumentHint` 读 `--skin-loading-scene` 里的 `url("…")`，用 `new URL(raw, location.href)` 解析，要求 `origin === location.origin`、没有用户名与密码，存 `pathname`（素材地址都不带查询与片段，带了就不记）。内置主题素材在开发服务与 e2e 外壳里是 `new URL(…, import.meta.url).href` 的绝对地址，生产产物里是 `/assets/…`，第三方插件与用户素材是 `/api/…` 的相对地址：四种形状都走这一个转换。`data:`、`blob:`、别的主机、协议相对地址（`//host/…`）、`/%2f%2fhost` 一类都因为解析后不同源或路径不合而不记。
- 内联脚本读时再做一遍同样的检查（localStorage 的值是可被改写的输入）：`new URL(value, location.href)`，同源、协议与页面一致、无用户名密码，`pathname` 以 `/` 开头、不以 `//` 开头、且匹配 `^/[^"'()\\\s]+$`（引号、括号、反斜杠、空白都不可能出现）；通过才设 `--host-loading-scene: url("<pathname>")` 与 `<html data-host-scene>`。`indicator` 在白名单（`dots`、`pulse`、`page`）里才设 `<html data-host-indicator>`。
- **两个新字段各自独立判定，不并入“颜色整条不认”的规则**：颜色要么全对要么不用（只用一部分会让底色跟系统、文字跟记录），而背景和进度样式缺一个只是退回缺省。
- 读的一方不能 import：键名、字段与格式两边各写一份，`appearance-hint.dom.test.ts` 核对两份 `index.html` 的内联脚本一字不差，并在 happy-dom 里执行它读宿主真实写下的值（现有做法，扩展它）。
- 属性放在 `<html>` 上（加载页的 `<main>` 在脚本之后才解析到），所以 CSS 的选择器都以 `html[data-host-…]` 开头，不写成 `.nb-host-loading[data-host-…]`（后者永远匹配不上，设计审查第 1 条）。

### 样式（`web/host-loading.css`）

- **背景**：`html[data-host-scene] .nb-host-loading::before` 铺一层场景图（`var(--host-loading-scene) center / cover`），不透明度 `--host-loading-scene-opacity`（缺省 0.4），底色仍是 `--host-loading-background`，书名与提示颜色不变。测试要断言伪元素真的有 `background-image`（`getComputedStyle(el, "::before")`），不能只断言属性在。`prefers-contrast: more`、`forced-colors: active` 下不画图。
- **类名迁移合同**：`nb-host-loading__bar` 保留，仍是进度指示在加载页里的定位节点（`FailurePage` 与两份 `index.html` 都用，`FailurePage.dom.test.ts` 断言它）；同一个元素再加 `nb-host-indicator` 类，形状与动画归后者。不新增节点。
- **形状与槽位**：现在的 `__bar` 有 `overflow: hidden` 和 160×2 的固定尺寸，会把别的样式裁成细线（设计审查第 5 条）。改为：`__bar` 只管定位（`position: absolute; top: 50%; left: 50%`，不裁剪，用 `translate(-50%, -50%)` 居中）；每种样式在 `.nb-host-indicator` 上定义自己的宽高与 `overflow`：
  - `bar`（缺省）：160×2、`overflow: hidden`，伪元素一段强调色来回扫（现状）；
  - `dots`：34×6，元素自己是中间的点，`::before`、`::after` 是左右两点，三点依次亮（动画延迟错开）；
  - `pulse`：14×14 的圆，缓慢放大缩小加淡入淡出；
  - `page`：28×36，一张书页（`::before` 是页，`::after` 是翻起的页，`transform-origin` 在左边，`rotateY` 翻动），书脊一条竖线。
- **书名与提示的位置**：书名 `bottom` 与提示 `top` 现在写死 `50% ± 14px`；改为 `calc(50% ± var(--host-loading-gap))`，每种样式设自己的间距（`bar` 14px、`dots` 16px、`pulse` 18px、`page` 28px），让它们都离指示器边缘约 12px；同一种样式里位置固定，后到的文字不推动指示器。
- **选择器上下文**（设计审查第 8 条）：加载页里按 `html[data-host-indicator="…"] .nb-host-loading .nb-host-indicator` 匹配；编辑器里的预览是裸的 `.nb-host-indicator`，自己带 `data-host-indicator="…"`，按 `.nb-host-indicator[data-host-indicator="…"]` 匹配；两套选择器分开写，不用 `:is()` 混在一起，免得运行中的应用 `<html>` 上遗留的属性把预览带偏。预览尺寸用自己的缩小版槽位（不绝对定位）。
- **动效**：`prefers-reduced-motion: reduce` 下四种都静止（动画为 `none`，图形仍可见：`bar` 停在现有的偏右位置，`dots` 三点同亮、`pulse` 停在中等大小、`page` 停在半开）；e2e 默认就把动效压成静止（`docs/testing/README.md`），测动画要显式 `no-preference`。
- 宿主页的“启动中”（`FailurePage`）用同一套类名，自动跟着变。

### 主题编辑器（`workbench/web/components/theme-editor/`）

- “场景与取景”分区底部加一小节“加载页”（预览按上面的局部属性上下文画，不读也不改当前文档根的属性）：一个开关“用场景图当加载页背景”（这一套明暗没有场景图时停用并说明）、一个进度样式的分段选择（细条、圆点、呼吸、书页），每个选项旁用 `.nb-host-indicator` 画一个小的动画预览（同一份样式，不另写）。模型加 `setLoadingScene(boolean)`、`setLoadingIndicator(name)`，走现有的 `#update`（亮暗各自一份，沿用顶部的明暗切换）；选回缺省的 `bar` 时从声明里去掉这个字段，`loading` 空了整个去掉。
- 文字进 `nbook.workbench` 目录两份语言包与 `locales.test.ts` 表；组件文档 `ThemeEditorScene.md` 同步；Lab 夹具已有 `scene` 场景，补一个带 `loading` 的。

### 书房（`theme-study/plugin.ts`）

亮暗都写 `loading: {scene: true, indicator: "page"}`。`plugin-sdk/examples/README.md` 的主题参考一行补“加载页”；示例 `theme-dusk` 写 `indicator: "dots"`（最小的演示）。

## Spec 与文档改动（主工作区 master）

- `theme/skins.md`：声明形状加 `loading`；新输出“加载页”（取上一次的记录、两个字段各自独立、只认静态 `scene`、对比度、高对比度与强制颜色不画图、第一次打开用缺省）与验收；边界里去掉与之矛盾的句子（若有）。
- `runtime/browser-host.md`：启动序列第 1 步补“记录里还有可选的场景图地址与进度样式”（同源路径、两个字段各自独立、读不出退回缺省）；验收 12 补书房的加载页。
- 兼容边界（`theme/skins.md` 与 `theme/editor.md` 都写）：新版本读得了旧记录；旧版本读新版本写下的带 `loading` 的主题，会因为 `additionalProperties: false` 把那一条判为不合格、不进列表，但记录里的原条目不改写、不丢（现有行为），升级后再回来仍在。不做降级迁移。
- `theme/editor.md`：“场景与取景”一节加“加载页”小节与验收。

## 切片

1. 声明与变量：schema、`SKIN_VARS`、`themeVars`；`themes.test.ts`（形状、`loading.scene` 与 `scene` 的组合、变量写出与不写）。验证 `bun test src/plugins/workbench/themes.test.ts`。
2. 提示与加载页：`appearance-hint.ts`、两份 `index.html`、`host-loading.css`（拆定位与形状、四种样式、场景层）；`appearance-hint.dom.test.ts`（读写、白名单、同源判定、两字段独立、内联脚本与模块一致）。验证 `bun run test` 里的 dom 测试。
3. 编辑器与书房：模型、小节、语言包、Lab 夹具、书房与示例的声明；`theme-editor.test.ts`、`theme-editor.e2e.ts`。
4. 加载页的端到端：e2e 用例（见验收映射）；Spec 三份；Task 记录。

## 验收映射

- `theme.skins` 新输出与验收：`themes.test.ts`（声明与变量）；`themes.e2e.ts` 新用例（真实运行时，两个场景分开，设计审查第 4 条）：
  1. **第一帧**：装好书房、进一次工作台让提示写下，再重新加载并让引导请求挂起：断言 `html[data-host-indicator="page"]`、`--host-loading-scene` 是同源 `pathname`、`.nb-host-loading::before` 的计算 `background-image` 含它；暗色同理；`forced-colors`/高对比度模拟下没有图。
  2. **书名与提示压在图上的对比度**：书名与提示只在引导返回之后才填（`boot.ts` 的 `onChange`），所以让引导正常返回、再拦住后面的阶段（RPC 握手或第一个插件的模块请求，沿用 `browser-host.e2e.ts` 里“加载页：书名出现在进度条上方”的拦截点，写明释放条件并在 `finally` 里放行），用 `measure` 的做法量书名与提示对叠出来的底色不低于 4.5；等图片解码后再量。
  3. **第一次打开（没有记录）**：仍是现在的细条，没有图。
- 四种预设（设计审查第 9 条）：`browser-host.e2e.ts` 里按预设各一个真实加载页场景（先往 localStorage 种一条合格的提示，用 `addInitScript`），断言 `__bar` 的几何（宽高与居中）与关键计算样式；`reducedMotion: "no-preference"` 下动画名不是 `none`，`reduce` 下是 `none` 且图形仍有尺寸；书名与提示不压在指示器上。
- `runtime.browser-host` 验收 12：上面第 1、3 条加原有断言；`FailurePage.dom.test.ts`（类名迁移合同：`nb-host-loading__bar` 仍在、仍是定位节点，四种样式下启动失败页都不乱）。
- 提示的安全与独立判定：`appearance-hint.dom.test.ts`：`//host`、`/%2f%2fhost`、同源绝对地址、跨源、`data:`、`blob:`、带引号或括号的路径、非法 `indicator`、只有一个字段合格；内置素材（绝对地址）、用户素材与第三方插件素材三种真实形状的转换（用真实的 `builtinPluginAssets`、`rawUrlOf`、`pluginFilesPrefix`）。
- `theme.editor` 新验收：`theme-editor.e2e.ts`（开关与选择写进声明、亮暗各一份、没有场景图时开关停用、选回细条去掉字段；逐项选中并断言局部预览的 `data-host-indicator` 与动画状态；390px 不溢出）。

## 验证

`bun run build`、`bun run build:e2e` 后只跑 `themes.e2e` 与 `theme-editor.e2e` 的相关用例、`appearance-hint.dom.test.ts`、`themes.test.ts`。给开发者看：亮色 `nbdev shot` 加载页四种样式与书房的加载页（亮暗）。

## 不做与风险

- 不做主题自带的动画素材（SVG 动画）、不让加载页用场景提供者画的图、不做加载页的书名字体按主题换。
- 兼容：见 Spec 改动里的兼容边界（只保证新读旧）。
- 风险：场景图在第一帧之后才到，会有“纯色→图”的一次渐显（图已被浏览器缓存时几乎看不出）；插件素材改名、升级或重装后旧记录里的地址会 404，加载页退回纯色（图加载失败不影响文字与进度条；这条降级用 e2e 里让图片请求 404 的用例覆盖）；对比度取决于具体场景图，按主题实测，不保证任意主题通过。
