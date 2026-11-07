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

- `HostAppearanceHint` 增加两个可选字段：`scene`（同源路径，不带协议与主机，例如 `/assets/study-day-<哈希>.webp`、`/api/nbook.files/raw/user/theme-assets/<sha>.webp`）、`indicator`（`dots` | `pulse` | `page`）。`readDocumentHint` 从 `--skin-loading-scene`、`--skin-loading-indicator` 读：地址不是同源（`data:`、`blob:`、别的主机）就不记，名字不在白名单就不记。
- **两个新字段各自独立判定，不并入“颜色整条不认”的规则**：颜色要么全对要么不用（只用一部分会让底色跟系统、文字跟记录），而背景和进度样式缺一个只是退回缺省。
- 内联脚本读到合格的 `scene`（只收 `^/[A-Za-z0-9._~%/-]+$`：没有引号、括号、空白，不可能拼出 CSS 注入）就在根上设 `--host-loading-scene: url("<路径>")` 与 `data-host-scene`；读到合格的 `indicator` 就设 `data-host-indicator`。
- 读的一方不能 import：键名、字段与格式两边各写一份，`appearance-hint.dom.test.ts` 核对一致（现有做法，扩展它）。

### 样式（`web/host-loading.css`）

- 背景：`.nb-host-loading[data-host-scene]::before` 铺一层场景图（`center / cover`），不透明度由 `--host-loading-scene-opacity` 控制（缺省 0.4），底色仍是 `--host-loading-background`，书名与提示的颜色不变；实测书名与提示对叠出来的底色不低于 4.5，不够就调低不透明度。`prefers-contrast: more`、`forced-colors: active` 下不画图（与主题其它位置一致）。
- 进度样式：把形状与动画从定位里拆开。现在的 `.nb-host-loading__bar` 同时管“固定在正中”与“细条动画”；拆成定位（`.nb-host-loading__bar`）与形状（新的 `.nb-host-indicator`），形状按祖先上的 `data-host-indicator` 换：`bar`（缺省，现状）、`dots`（三点依次亮）、`pulse`（一个点缓慢呼吸）、`page`（一张书页翻动）。都是纯 CSS；`prefers-reduced-motion: reduce` 下全部静止（现状已有，各样式补一份）；进度指示仍在正中，书名在上、提示在下，后到的文字不推动它。
- 宿主页的“启动中”（`FailurePage`）用同一套类名，自动跟着变。

### 主题编辑器（`workbench/web/components/theme-editor/`）

- “场景与取景”分区底部加一小节“加载页”：一个开关“用场景图当加载页背景”（这一套明暗没有场景图时停用并说明）、一个进度样式的分段选择（细条、圆点、呼吸、书页），每个选项旁用 `.nb-host-indicator` 画一个小的动画预览（同一份样式，不另写）。模型加 `setLoadingScene(boolean)`、`setLoadingIndicator(name)`，走现有的 `#update`（亮暗各自一份，沿用顶部的明暗切换）；选回缺省的 `bar` 时从声明里去掉这个字段，`loading` 空了整个去掉。
- 文字进 `nbook.workbench` 目录两份语言包与 `locales.test.ts` 表；组件文档 `ThemeEditorScene.md` 同步；Lab 夹具已有 `scene` 场景，补一个带 `loading` 的。

### 书房（`theme-study/plugin.ts`）

亮暗都写 `loading: {scene: true, indicator: "page"}`。`plugin-sdk/examples/README.md` 的主题参考一行补“加载页”；示例 `theme-dusk` 写 `indicator: "dots"`（最小的演示）。

## Spec 与文档改动（主工作区 master）

- `theme/skins.md`：声明形状加 `loading`；新输出“加载页”（取上一次的记录、两个字段各自独立、只认静态 `scene`、对比度、高对比度与强制颜色不画图、第一次打开用缺省）与验收；边界里去掉与之矛盾的句子（若有）。
- `runtime/browser-host.md`：启动序列第 1 步补“记录里还有可选的场景图地址与进度样式”；验收 12 补书房的加载页。
- `theme/editor.md`：“场景与取景”一节加“加载页”小节与验收。

## 切片

1. 声明与变量：schema、`SKIN_VARS`、`themeVars`；`themes.test.ts`（形状、`loading.scene` 与 `scene` 的组合、变量写出与不写）。验证 `bun test src/plugins/workbench/themes.test.ts`。
2. 提示与加载页：`appearance-hint.ts`、两份 `index.html`、`host-loading.css`（拆定位与形状、四种样式、场景层）；`appearance-hint.dom.test.ts`（读写、白名单、同源判定、两字段独立、内联脚本与模块一致）。验证 `bun run test` 里的 dom 测试。
3. 编辑器与书房：模型、小节、语言包、Lab 夹具、书房与示例的声明；`theme-editor.test.ts`、`theme-editor.e2e.ts`。
4. 加载页的端到端：e2e 用例（见验收映射）；Spec 三份；Task 记录。

## 验收映射

- `theme.skins` 新输出与验收：`themes.test.ts`（声明与变量）；`themes.e2e.ts` 新用例：装好书房、进一次工作台让提示写下，然后让引导请求挂起，在加载页上断言 `data-host-indicator="page"`、`--host-loading-scene` 是同源路径、场景层有图；暗色同理；高对比度模拟下没有图；用 `measure` 的做法量书名与提示对叠出来的底色不低于 4.5。
- `runtime.browser-host` 验收 12：同一个用例，加上“第一次打开（没有记录）仍是现在的细条”。
- `theme.editor` 新验收：`theme-editor.e2e.ts`（开关与选择写进声明、亮暗各自一份、没有场景图时开关停用、选回细条去掉字段）。
- 提示的安全与独立判定：`appearance-hint.dom.test.ts`。

## 验证

`bun run build`、`bun run build:e2e` 后只跑 `themes.e2e` 与 `theme-editor.e2e` 的相关用例、`appearance-hint.dom.test.ts`、`themes.test.ts`。给开发者看：亮色 `nbdev shot` 加载页四种样式与书房的加载页（亮暗）。

## 不做与风险

- 不做主题自带的动画素材（SVG 动画）、不让加载页用场景提供者画的图、不做加载页的书名字体按主题换。
- 风险：场景图在第一帧之后才到，会有“纯色→图”的一次渐显（图已被浏览器缓存时几乎看不出）；场景图地址依赖同源路径，插件素材改名后旧记录里的地址会 404，加载页退回纯色（图加载失败不影响文字与进度条）；对比度取决于具体场景图，按主题实测，不保证任意主题通过。
