# 写一套 nb-ui 主题

主题决定界面的**形状、节奏、装饰和角色映射**——控件多高、圆角多大、面上有没有渐变、
分隔靠线还是靠底色。它不决定颜色：颜色是**配色**（colorway）的事，两者正交，
任意主题 × 任意配色都应该成立。

三个词先分清：

| 词 | 是什么 |
| --- | --- |
| **配色** colorway | 一组颜色变量取值。33 个变量，见 `src/colorway/colorway-contract.ts` |
| **主题** theme | 一个包：变量声明 + 取值 + 若干配色 + 资源 + 可选的组件覆盖。本文讲的就是它 |
| **插件** plugin | 主题 + 任意 JS，单独安装与授权。**尚未开放** |

能力分三档，与 VS Code（theme / extension 分离）、WordPress（theme / plugin 分离）同构：

1. **声明式主题**——只有 CSS 变量取值和静态资源。无门槛，运行期装载。
2. **组件实现包**——额外替换某些组件的实现。需要声明 `hostVersion` 与契约版本，构建期产物。
3. **插件**——任意 JS。**本版本不开放**，因为在同一个 Vue app context 里安全执行第三方
   组件没有成熟的沙箱方案，安全边界只能靠市场侧的审核与签名来立。

下面讲第一档和第二档。

本文讲的是**格式**：能改什么、怎么装、装不上时看哪里。至于产品默认主题为什么长成那样、
哪些做法已经被实测证伪，见 [设计语言](./design-language.md)——那篇的「踩过的坑」一节
适用于任何一套主题，不只默认那套。

## 一个最小主题

```
themes/my-theme/
  manifest.ts     纯数据。可 JSON 序列化，不含函数或组件对象
  vars.css        变量取值，选择器 :root[data-nb-theme="my-theme"]
  index.ts        运行期入口
```

`manifest.ts`：

```ts
import type {NbThemeManifest} from "@notnotype/nb-ui/theme";

export const manifest: NbThemeManifest = {
    id: "my-theme",
    name: "My Theme",
    tagline: "一句话定位",
    description: "一段话讲清它长什么样。市场列表页只能读 manifest，没有它就只剩一个名字。",
    version: "1.0.0",
    hostVersion: "^0.2.0",
};
```

`vars.css`：

```css
:root[data-nb-theme="my-theme"] {
    --control-h-md: 30px;
    --radius-control: 2px;
    --border-w: 1px;
    --elevation-raised: none;
}
```

`index.ts`：

```ts
import type {NbThemeModule} from "@notnotype/nb-ui/theme";
import {manifest} from "./manifest";

import "./vars.css";

export default {manifest} satisfies NbThemeModule;
```

装载：

```ts
import {installTheme} from "@notnotype/nb-ui/theme";
import myTheme from "./themes/my-theme";

installTheme(myTheme);
```

**装载 ≠ 激活**。`installTheme` 只做登记，哪一套当前生效由主题 store 决定——
「装了 N 套、激活 1 套」是常态。

`themes/editorial/` 就是这个形态的实物：一个 12 行的 manifest 加一份 vars.css，没有别的。
它是 nb-ui 的一方主题，但走的是**和第三方完全相同的装载路径**，没有任何捷径——
默认主题（`nbook`）也一样。

## manifest 为什么必须是纯数据

`manifest.ts` 里不能出现函数或组件对象，实现一律放在 `index.ts`。

理由是市场：索引服务要能在**不执行第三方代码**的前提下知道这套主题是什么、动了哪些组件、
兼容哪个宿主版本。一旦 manifest 里出现函数，索引就必须先跑别人的代码。VS Code 也是这么分的
（`package.json` 的 contributions 与 extension entry 分离）。

装载器会校验两者一致：manifest 声明覆盖了某个组件却没给实现，或给了实现却没声明，
**都直接拒绝装载**。漏声明等于向市场隐藏能力。

## 能改哪些变量

两类。

**主题层变量**——库已经声明好、给了默认值，你只需给新取值。名单见 `src/theme/tokens.ts`
的 `nbThemeTokens`，默认值在 `src/tokens.css` 的裸 `:root`。常用的几组：

- 排版：`--font-display` `--text-2xs`…`--text-xl` `--leading-tight` `--tracking-ui`
- 密度：`--control-h-sm/md/lg` `--control-px` `--panel-p` `--stack-gap`
- 形状：`--radius-control` `--radius-control-lg` `--radius-panel` `--border-w`
- 装饰：`--surface-raise` `--inset-shadow` `--elevation-raised/popover/dialog` `--focus-ring`
- 动效：`--motion-fast` `--motion-base` `--motion-enter` `--ease-standard`
- **角色映射**：`--control-surface` `--button-surface` `--panel-surface` `--sidebar-surface`
  `--toolbar-surface` `--overlay-surface` `--overlay-blur` `--strip-surface` `--divider` 及对应的 `-outline`

角色映射这一层最容易被忽略：控件的面用哪个配色变量、描边用不用色、分隔靠线还是靠底色，
这些是**主题决策不是颜色决策**。一整套「界面退场」的低 chrome 风格可以只靠它表达，
一行组件代码都不用改：

```css
:root[data-nb-theme="quiet"] {
    --button-surface: transparent;   /* 按钮平时不显形，hover 才有底 */
    --button-outline: transparent;
    --control-surface: transparent;
    --panel-outline: transparent;    /* 面板不描边，靠留白分层 */
    --divider: transparent;
    --elevation-raised: none;
}
```

### 浮层 Surface（`--overlay-surface`）透明度规范

浮层（`Dropdown` / `Popover` / `CommandPalette`）必须承担清晰的内容承载与文字阅读职责，严禁追求极致透明度而损害可读性：
- **亮色模式**：基准为 `color-mix(in srgb, var(--bg-panel) 65%, transparent)`（65% 温润半透明白底，与 FormSelect 黄金标准一致）；
- **暗色模式**：基准为 `color-mix(in srgb, var(--bg-panel) 75%, transparent)`（75% 烟熏深底，保证文字高对比度）；
- **严禁降低到 14% 等过低不透明度**：过薄透明会导致底层正文、按钮严重透光穿透，彻底破坏实体面板感；
- **机械守门**：全库由 `token-consumption.test.ts` 静态扫描守门，禁止任何组件在模板中内联硬编码 `backgroundColor: color-mix(...)` 或 `backdropFilter`。


**新增变量**——主题层没有的东西，在 manifest 的 `declares` 里声明。每一项**必须自带 fallback**：

```ts
declares: [
    {
        name: "--glass-blur",
        fallback: "none",
        description: "导航面的磨砂配方。没有玻璃主题时就该是 none。",
    },
],
```

fallback 必须能从配色契约派生（字面值或 `color-mix`），保证在**任意配色**下都成立。
装载器把所有已装主题的 fallback 写进一层 `:root`，你的取值写在 `:root[data-nb-theme="x"]`，
后者特异性更高（0,2,0 对 0,1,0），与两者的引入顺序无关。

为什么强制 fallback：不这样的话主题就能**要求**每套配色为它填一个新变量，用户新建配色时
要面对一堆「给我没在用的主题的变量」，配色契约会被主题无限撑大。

判据：只有一套主题用 → 派生型，写 fallback；两套以上主题都要用 → 说明配色契约漏了一个角色，
该去补契约而不是各写各的。`--window-backdrop` 现在被 `macos`、`aurora` 和 `nbook` 各声明了一次，
就是这个信号留在代码里的样子。

## 不许写死颜色

`vars.css` 里**不许出现字面颜色**，只许引用配色变量，或用 `color-mix` 从配色变量派生：

```css
/* 对 */
--panel-outline: color-mix(in srgb, var(--text-main) 10%, transparent);

/* 错：换一套配色就会露出一块与配色无关的死色 */
--panel-outline: #d6c7a9;
```

唯一的例外是纯白与纯黑的低透明度叠层（`rgb(255 255 255 / 0.2)`）——镜面高光和内阴影
表达的是**光**不是颜色，没有对应的配色变量可用。仓库里的 `theme-packages.test.ts`
按这条规则卡着：不许有 hex，`rgb()` 只许是白或黑。

## 按明暗分档

要给暗色配色一套不同的取值时，挂 `[data-nb-appearance]`：

```css
:root[data-nb-theme="my-theme"][data-nb-appearance="dark"] {
    --surface-raise: linear-gradient(180deg, rgb(255 255 255 / 0.07), rgb(0 0 0 / 0.1));
}
```

**不要挂 `[data-nb-colorway="dark"]`。** 前者是配色的**明暗属性**，任何暗色配色都会命中；
后者是配色的**身份**，对用户自定义的暗色配色一律失效，而且失效时不报任何错，
只表现为「换了个暗色配色就不对了」。

`macos` 的玻璃配方正是这么踩过一次：整套只按亮色调过，暗色下 `brightness` 和高光 alpha
两项方向都是反的——Apple 的暗色 Liquid Glass 是**压暗**不是提亮，白色高光在暗底上会过曝成灰边。

## 自带配色

主题可以带自己的配色。写法：

```ts
// manifest.ts
providesColorways: ["my-theme-light", "my-theme-dark"],
defaultColorway: {light: "my-theme-light", dark: "my-theme-dark"},
```

```ts
// index.ts
export default {
    manifest,
    colorways: {"my-theme-light": {...}, "my-theme-dark": {...}},
    colorwayMeta: {
        "my-theme-light": {label: "My Light", appearance: "light"},
        "my-theme-dark": {label: "My Dark", appearance: "dark"},
    },
} satisfies NbThemeModule;
```

`defaultColorway` 是**默认值不是约束**——用户仍可任选任何配色。

但它的 `light` 槽有一条硬约束：**库内置配色只有 `dark` 一套**，所以想填 `light` 槽就必须
自带一套亮色配色，否则加载器会以 `colorway-mismatch` 拒绝装载。

配色 id 不能与内置的 `dark` 重名，否则「切到 dark」在装不装这套主题时会是两种颜色，
用户无从知道为什么。加个主题前缀即可。

暗色可以从 `nbColorways.dark` spread 出来只改几项——自带配色是为了修正冲突（`macos` 的玻璃在
通用 dark 的面色下会发灰），不是为了重造一份 33 色，从零手写只会让两份色值各自漂移。
亮色没有可继承的基，只能给全 33 个（`themes/macos/colorways.ts` 就是这么写的）。

## 静态资源（SVG）

滤镜、渐变、遮罩这类只能在文档里定义、只能被 CSS 用 `url("#id")` 引用的东西，走 `svgDefs`：

```ts
export default {
    manifest,
    svgDefs: `<filter id="my-lens">…</filter>`,
} satisfies NbThemeModule;
```

装载器按标签白名单校验后注入到一个隐藏容器里。放行的是滤镜原语、渐变和基础图元；
`<script>`、`<foreignObject>`、任何 `on*` 事件属性、指向外部 URL 的 `href`
**一律拒绝装载并指出是哪一个**。

这不是沙箱，也不冒充沙箱——它只把第一档主题的资源面收窄到「静态图形定义」，
好处是想做玻璃折射这类效果不必升到插件档。

## 替换组件实现（第二档）

主题可以换掉某个组件的实现。当前只有一个组件开放覆盖：

| 组件 key | 契约 id |
| --- | --- |
| `time-picker` | `time-picker@1` |

白名单极小起步是刻意的：市场一旦跑起来，登记过的组件 API 就不能随便改了，这是这个方向
真正的长期成本。等阶段 2 的组件重写完再逐个放开。

```ts
// manifest.ts —— 只写契约 id，不写实现
overrides: {"time-picker": "time-picker@1"},
```

```ts
// index.ts
import TimePickerWheel from "./components/TimePickerWheel.vue";

export default {manifest, components: {"time-picker": TimePickerWheel}} satisfies NbThemeModule;
```

契约钉的是 **props / emits / 键盘 / a11y**，不钉 DOM 结构。直接反例：Radix Themes
的公开 props 一个没改，内部 HTML 重构照样破坏了依赖它的覆盖。所以你可以把下拉列表换成
滚轮、换成表盘、换成什么都行，只要 `v-model` 和键盘行为一致。

契约版本变了（`time-picker@2`）意味着 props / emits / 键盘行为变了，你的主题会被**明确拒绝装载**，
而不是渲染出一个半坏的控件。

### 自证：跑契约测试

```ts
import {runTimePickerContract} from "@notnotype/nb-ui/testing";
import MyTimePicker from "./components/MyTimePicker.vue";

runTimePickerContract("my-wheel", MyTimePicker);
```

这是与库默认实现**完全同一份**用例。全绿才算真的实现了 `time-picker@1`。

### 一条硬规矩

**切换主题不应让用户丢失核心功能**（WordPress 的原话）。这里的落法是：主题只能**替换**实现，
不能取消——解析永远返回一个可渲染的组件，你没覆盖的组件仍然是库默认的。

## 已知边界

- **体积随「装了几套」增长，不随「当前是哪套」。** 所有已装主题的 CSS 都在产物里，
  靠 `[data-nb-theme]` 选中。
- **`hostVersion` 不支持复合范围。** 支持 `*`、精确版本、`^x.y.z`、`~x.y.z`、`>=x.y.z`；
  写 `>=1.0.0 <2.0.0` 会被拒绝并说明不支持，而不是猜一个结果。
- **SSR 未解决。** 运行期切换主题组件会带来 hydration 不一致。当前消费方都是 `ssr: false`。
- **减少动效只覆盖库的三个时长变量。** 你自己新增的动效变量（例如 `macos` 的 `--glass-lift`）
  要自己在 `@media (prefers-reduced-motion: reduce)` 里关掉——库不知道它们叫什么。
- **边缘折射（`backdrop-filter: url(#…)`）只有 Chromium 支持。** Safari / Firefox 都不支持，
  要当渐进增强写。
- **`backdrop-filter` 糊不到操作系统桌面。** 要糊真桌面得由桌面壳开窗体级 vibrancy
  （Electron 的 `vibrancy` / `backgroundMaterial`，Tauri 的 `window-vibrancy`），纯 Web 拿不到。

## 装不上时看哪里

装载器的每一条校验都是「拒绝 + 明确报错」，没有静默降级——市场场景下半装成功在用户眼里
就是产品的 bug，而且没有任何线索指回主题。抛出的 `NbThemeInstallError` 带 `reason`：

| reason | 意思 |
| --- | --- |
| `host-version` | `hostVersion` 与当前 nb-ui 版本不匹配，或用了不支持的范围写法 |
| `declaration-missing-fallback` | `declares` 里有一项没写 fallback |
| `declaration-collides` | 重复声明了配色契约或设计 token 已有的变量 |
| `unknown-component` | 覆盖了不在白名单里的组件 |
| `contract-mismatch` | 契约版本与宿主不符 |
| `override-mismatch` | manifest 与入口对不上（声明了没实现，或实现了没声明） |
| `colorway-mismatch` | 自带配色对不上，或 `defaultColorway` 指向不存在 / 明暗不符的配色 |
| `unsafe-svg-defs` | `svgDefs` 含白名单以外的标签、事件属性或外部引用 |
| `svg-defs-id-collides` | `svgDefs` 里的 id 与另一套已装主题重名。SVG 的 id 是全文档级的，`url(#id)` 会取先装的那一套且不报错，所以每套主题的 id 都要带自己的前缀 |
| `duplicate-id` | 同 id 的主题已经装过 |

## 实物参照

| 包 | 演示了什么 |
| --- | --- |
| `themes/editorial/` | 最小主题：零新增变量、零配色、零资源、零覆盖 |
| `themes/aurora/` | 新增一个变量并带 fallback |
| `themes/macos/` | 格式天花板：10 个新变量、自带亮暗两套配色、SVG 资源、覆盖一个组件、把窗口左上角判给侧栏 |
| `themes/nbook/` | 产品默认主题：从 `macos` 衍生，17 个新变量、自带亮暗两套配色、自带 SVG 资源。示范两件事——① 「主题的论点写在变量里」：「稿面比桌面亮」不是写死一个亮色值，而是 `--page-surface` 取 `--bg-panel`，再由配色表保证 panel 恒亮于 main，所以换任何配色这条都成立；② **衍生主题是同级不是继承**，两套各自自包含，删掉任一套另一套照常装载 |
