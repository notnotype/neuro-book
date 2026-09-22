# nb-ui 表面模型：材质轴与层级轴

- **状态**：accepted（两条轴与层级做法已由开发者拍板；「未决」一节列的是实现细节，不影响已定的取舍）
- **日期**：2026-09-02
- **范围**：`packages/nb-ui` 的表面（surface）角色、打包方式与主题合同

本提案的前身叫「表面盒子规范」，把表面按「这块面装什么」分成内容盒 / 器械盒 / 浮层盒三档。**那个设计已作废**，原因写在「当前行为与证据」的最后一节：它把两件不同的事混在了一条轴上。

## 问题

在组件 Lab（`/lab`）把页面背景换成一张色彩复杂的照片之后，界面上大部分面板的文字**要盯着看才认得出**。顺着这个现象查下去，发现的不是一处错，是四处：

1. **登记的 5 档表面里，4 档全部读不了。** 工具栏 30%、侧栏 26%、浮层 14%、窄条 38%，实测都不合格。
2. **唯一读得清的配方根本没登记。** 它是 `FormSelect` 下拉菜单里的一行内联 style，某个人当年调准了但没有变成规范，于是没有第二个组件受益。
3. **同一档面，不同地方长得不一样。** 库里只有「浮层」这一档被打包成了可直接使用的类，其余 4 档只给一个颜色变量，消费方要自己拼面色、模糊、描边、抬起四样。拼漏一样不报错，只是看起来不对。
4. **没有「面上再放一个面」的答案。** 面板里放一个表单、一张卡片、一条操作条该用什么，库里回答不了。5 档是按部件命名的，新出现的部件不在表里就只能硬塞。

第 4 条是最根本的一条，前三条都是它的症状。

## 目标与非目标

**目标**

- 把**材质**（玻璃 / 实心）与**层级**（第几层）分成两条独立的轴，各自有各自的规则。
- 材质只有一层，可读性下限由构造保证，不靠人记住。
- 层级可以嵌套，且嵌套时自动取到正确的一档，不靠消费方手选。
- 每一档打包成一个可直接使用的类，消费方不再手工拼装。

**非目标**

- 不限制主题的模糊配方。实测证明模糊强度不影响可读性，它属于主题的观感身份。
- 不重新设计控件（按钮、输入框）自身的面。本提案只覆盖容器级表面。
- 不把层级与阴影绑定。Material Design 3 曾经绑过又主动解绑，理由见证据部分。

## 当前行为与证据

### 库里现有的 8 个表面变量

登记在 `packages/nb-ui/src/theme/tokens.ts`，是保留 token，主题只能赋值不能重新声明：

| 变量 | 用途 | nbook·昼 取值 |
|---|---|---|
| `--toolbar-surface` | 顶栏、应用条 | 侧栏色 30% |
| `--sidebar-surface` | 导航栏 | 侧栏色 26% |
| `--overlay-surface` | 下拉、菜单、对话框 | 侧栏色 14% |
| `--strip-surface` | 面板里的操作条、表头 | 次级底 38% |
| `--panel-surface` | 正文、数据面板 | 面板色 100% |
| `--control-surface` | 控件面 | — |
| `--button-surface` | 按钮面 | — |
| `--panel-outline` | 面板描边 | — |

只有浮层那一档被打包成类。`packages/nb-ui/src/styles.css` 的 `.nb-ui-popover-surface` 一次给全描边、圆角、面色、投影、磨砂五样，14 个组件在用。其余几档没有对应的类，消费方各自手写。

`packages/nb-ui/src/components/form/FormSelect.vue` 用内联 style 覆盖了它自己那一档（面板色 65% + 弱模糊），也就是说 `--overlay-surface` 登记的 14% 在实际产品里**一处都没生效**。

### 走查：不透明度决定可读性，模糊配方不决定

2026-09-02 在 Lab 里用 `SurfaceTierDemo` 走查。背景为一张色彩复杂的照片，底色统一固定为面板色，只变两个变量：

| | 强模糊 `sat(190%) bright(1.12)` | 弱模糊 `sat(130%) bright(1.0)` |
|---|---|---|
| **面 26%** | 读不了 | 读不了 |
| **面 65%** | 读得清 | 读得清 |

分界线整齐落在不透明度上，与模糊配方无关。

两条推论：规范该定的是**不透明度下限**而不是模糊规则；模糊配方可以完全留给主题。

（判读方式：Lab 页面人工走查，判据是「不盯着看能否认出字」，无自动化断言。）

### 走查第二轮：色块上的结论不能直接当下限

把上面的数落到整条侧栏与顶栏之后，65% 仍然要盯着看。四格实验用的是巴掌大的色块，实际的面是整条栏——**面越大，同样的透光量累积出来的干扰越多**，长文比几个词更受影响。

同一轮还发现完全不透光的面看起来像贴上去的白板，与整页的玻璃语言脱节。

调到 **92%** 后可读，且这块面和背后的桌面还有关系。

这一轮改变了第一轮的一条推论：四格实验证明的是「该调哪个变量」，不是「该调到几」。具体的数只能在真实尺寸的面上走查得到。

### 走查第三轮：Lab 整页收敛到一档

分档只有在两块面**挨着**时才传达得出来。隔着半个屏幕的两块面差十来个百分点，看到的不是「两种材料」，是「没做齐」。

Lab 先是按「装什么」把左栏（导航）与右栏（正文）分成两档，使用者的第一反应是「为什么不一样」；合并之后同样的问题落到顶栏与工具条上。**最后整个页面收敛到一档面**：顶栏、中栏工具条、两条侧栏、画布盒子全部 92%，只剩「有面」与「不给面」的区别。

一个装了导航、工具、正文、数据四种内容的满屏页面，最终只用得上一档面——这是「按装什么分」这条轴失效的直接证据。

### 外部调研：主流体系怎么做

2026-09-02 分三路读官方文档查证。结论比预期整齐：**没有一个体系用一条轴，全部是两条。**

#### 材质轴：只有操作系统级的体系才有，而且都禁止嵌套

只有 Apple 和 Microsoft 有「材质」这个概念——因为只有操作系统能保证背后真有桌面壁纸可以模糊。两家的规则一致：**一个应用只有一层材质，在最底下。**

微软写得最死，两条明文禁令：

> "Don't apply backdrop material more than once in an application."
> （一个应用里不要施加多于一次的 backdrop 材质。）
> — [Mica material](https://learn.microsoft.com/en-us/windows/apps/design/style/mica)

> "Avoid layering multiple acrylic surfaces: multiple layers of background acrylic can create distracting optical illusions."
> （避免叠放多层 acrylic 表面：多层会制造分散注意力的视错觉。）
> — [Acrylic material](https://learn.microsoft.com/en-us/windows/apps/design/style/acrylic)

而且微软给了替代方案——**上层不是第二层材质，是一层低透明度纯色**：

> "The content layer should pick up the material behind it, Mica, using the `LayerFillColorDefaultBrush`, a low-opacity solid color, as its background."

微软的材质按「在哪一层、活多久」选，完全不问装什么内容：Mica 是 "opaque, dynamic material ... for long-lived windows"，Acrylic 是 "only for transient, light-dismiss surfaces such as flyouts and context menus"。

苹果对新的 Liquid Glass 有同样的禁令：

> "avoid overcrowding or layering Liquid Glass elements on top of each other."
> "Don't use Liquid Glass in the content layer."
> — [Adopting Liquid Glass](https://developer.apple.com/documentation/technologyoverviews/adopting-liquid-glass)、[HIG Materials](https://developer.apple.com/design/human-interface-guidelines/materials)

有一处值得注意的反例：**苹果的 macOS 材质是按部件命名的**，14 档全是 `sidebar`、`menu`、`popover`、`toolTip`、`hudWindow` 这样的名字，零个提厚度；而当年按明暗厚度命名的那批（`light` / `dark` / `mediumLight` / `ultraDark`）已全部废弃。所以「按部件命名」有先例，不能说它一定错——但它成立的前提是**部件的层级由平台固定**，一旦要回答「面板里放一个表单」这种自由嵌套，它就没有答案。

#### 层级轴：所有人都有，而且一律是不透明色阶

| 体系 | 层级怎么表达 | 有没有材质 / 模糊 |
|---|---|---|
| **Material Design 3** | `surface-container-lowest / low / (default) / high / highest` 五档 | **没有** |
| **IBM Carbon** | `base / layer-01 / 02 / 03` 四层 | **没有** |
| Microsoft | Mica 上叠低透明度纯色 | 材质只有最底一层 |
| Ant Design v5 | `colorBgLayout / colorBgContainer / colorBgElevated` | 没有 |
| Atlassian | `surface / .sunken / .raised / .overlay` 四档 | 没有 |
| Primer | `bgColor-default / muted / inset` | 没有 |
| shadcn/ui | 按部件命名，无深度轴 | 没有 |
| Radix Colors | 按用途分段，**step 1 与 2 官方说可互换** | 没有 |
| Tailwind v4 | 内置 theme 里**没有任何语义面 token** | 没有 |

本机核对（读 `node_modules` 源码，非文档）：`reka-ui` 里 `surface` 一词零命中；`tailwindcss/theme.css` 里 `surface` 零命中；`@radix-ui` 装进来的包里一个 CSS 文件都没有。**我们脚下这套底座在「面」这件事上什么都不提供**，nb-ui 的 8 个表面变量完全是自己发明的。

#### Carbon 做了「相对父层」，而且两套 token 并存

Carbon 是唯一一个把层级做成可自动推导的体系：

> "There are four layers within a theme: base layer, layer 01, layer 02, and layer 03. Layers stack one on top of the other in a set order."

> "A contextual token is aware of what layer it is placed on and will call the correct values for that layer. There is only one set of contextual tokens and they require only one component variant to be built."
> （contextual token 知道自己被放在哪一层，会调取那一层对应的正确值。）

> "The two types of tokens have similar token names except the contextual tokens do not have the number terminal."

> "Components can be nested inside the layer component up to three level."
> — [Carbon Color usage](https://carbondesignsystem.com/elements/color/usage/)、[Color overview](https://carbondesignsystem.com/elements/color/overview/)

色值规则：浅色主题每加一层在 White 与 Gray 10 之间**交替**（不是单调斜坡，是保证相邻两层可区分的锯齿）；深色主题每加一层**变亮一档**。

微软给了同方向的一条规则，而且明说明暗两态都适用：

> "In both light and dark color modes, darker colors indicate background surfaces of less importance. Important surfaces are highlighted with lighter and brighter colors."
> — [Color in Windows](https://learn.microsoft.com/en-us/windows/apps/design/signature-experiences/color)

**暗色模式下上层也是变亮，不是变暗。**

#### M3 特意往反方向走过一次

M2 的层级是真正绑在 z 轴上的：elevation 的 dp 值越高，叠加的着色越多。M3 把这个绑定拆了：

> "The new color roles are not tied to elevation and offer more flexibility and support for color features, such as user-controlled contrast."
> — [M3 Color system overview](https://m3.material.io/styles/color/system/overview)

理由是「按容纳需要自选，大屏布局更灵活」。M3 的轴因此从**物理深度**退成了**强调度**——仍是单调的一条轴，但不再和「离底几层」挂钩，档位由人手选。

这是 Carbon 与 M3 的真实分歧：**把选择权放在机器还是放在设计者。**两边都是生产级方案。

#### Atlassian 的一条禁令说明了绝对档位的病

> "Don't apply sunken elevations on raised or overlay elevations."
> — [Atlassian Elevation](https://atlassian.design/foundations/elevation)

如果它是相对体系，「在抬起的面里放一个凹陷」应该天然合法。禁掉它，正说明**绝对档位一旦嵌套顺序不对就会色阶倒挂**。Atlassian 是靠写禁令挡的，不是靠机制。

（Atlassian 另有一个 `utility.elevation.surface.current`，官方描述是「反映你的应用当前所在面的正确背景色」，但它只解决「我被塞进未知容器、不知道脚下什么颜色」，**给的是父层的颜色，不是父层 +1 档的运算**，属于逃生舱不是主线规则。）

#### CSS 规范：毛玻璃套毛玻璃在 Web 上不成立

三条硬事实，来自 [MDN backdrop-filter](https://developer.mozilla.org/en-US/docs/Web/CSS/backdrop-filter) 与 [Filter Effects Level 2](https://drafts.csswg.org/filter-effects-2/)：

1. **规范自相矛盾且未解决。**[w3c/fxtf-drafts issue #500](https://github.com/w3c/fxtf-drafts/issues/500) 至今 Open：规范正文与注释对「内层糊到的是什么」给了两个答案，结果 Gecko 与 Chromium / WebKit 渲染得不一样。有社区实测称 Chromium 干脆不让子元素也生效（二手来源）。
2. **规范自己写了性能理由。**
   > "There would likely be an exponential performance degradation in the case of nested backdrop-filter ... Each nesting level will double the number of these required re-paint cycles."
3. **它会创建包含块。**
   > "A computed value of other than none results in the creation of both a stacking context and a Containing Block for absolute and fixed position descendants."

第 3 条是会真出 bug 的：**任何开了毛玻璃的面板，里面 `position: fixed` 的下拉菜单、Toast、对话框都会被关在这个面板里**，不再相对视口定位。

### 结论：前一版提案错在哪

前一版把表面分成内容盒 / 器械盒 / 浮层盒三档，用的是一条轴——「这块面装什么」。

对照上面的调研，这条轴把两件事混在了一起：**内容盒与器械盒是层级轴上的两档，浮层盒是材质轴上的东西。**混成一条之后必然出现两个症状，两个都已经在 Lab 上实际发生：

- 「面上再放一个表单该用哪一档」回答不了，因为三个盒子都是绝对档位，没有「相对当前这块面」的位置。
- 一个真实页面收敛到一档，三个盒子里有两个用不上。

## 方案

### 两条轴

**轴一：材质。整页只有一层，在最底下。**

- 谁直接贴在窗体底纹上，谁就是材质层：顶栏、侧栏、面板、浮层。
- **只有这一层开模糊。**往上不再开——理由不是观感，是 CSS 规范的三条硬事实。
- 主题决定它是玻璃还是实心（aurora、editorial 这类不做玻璃的主题定成实心即可）。
- **只有这一层有不透明度下限**，因为只有它压在不可控的背景上。

**轴二：层级色阶。从材质层往上堆，纯不透明色，可嵌套。**

- 第 0 层是材质层本身。往上每一层是一块不透明色，叠在下面那一层上。
- **方向固定：往上更亮。**明暗两态都是（微软的规则，与 Carbon 深色主题一致）。
- **不开模糊，不定不透明度。**它压的是自己家的面，不是桌面，不存在可读性风险。
- 上限三层（Carbon 的先例）。超出上限的行为需要单独定义，见「未决」。

「不给面」不属于任何一条轴，它是「这块区域让下面透上来」这个答案本身，任何层都能用。

### 层级色阶走 Carbon 式：位置自动推导

消费方写不带编号的 `--nb-layer`，套进去几层就自动取第几档；库提供一个层级容器负责推导。

- 好处：嵌套永远不会漏、不会撞档，一个组件只需要一个变体。
- 代价：有硬上限；组件必须能知道自己的层级，需要一套 provide / inject 之类的机制。

同时保留编号档位 `--nb-layer-01 / 02 / 03` 供需要写死的地方使用——Carbon 就是两套并存，编号那套给设计意图明确的位置，无编号那套给通用组件。

### 具体问题的答案

| 问题 | 答案 |
|---|---|
| 面板里放一个表单 | 多数情况**不给面**，靠间距和分隔线成组；需要框住时用层级 +1 |
| 面板里放一张卡片 | 层级 +1 |
| 面板里放一条操作条 | 层级 +1（现在的 `--strip-surface` 属于这一档） |
| 输入框、代码块这类「凹下去」的 | 单独一档「凹」，**只能用在层级 0 上**（Atlassian 的教训） |
| 下拉、对话框 | 材质层（它压在桌面上，不是压在面板上），加重投影 |
| 展台、画布 | 不给面 |

### 交付形式

复用库里已经验证过的机制——基座类 + 形状修饰类：

```
.nb-ui-material-surface   材质层：面色 + 模糊 + 描边 + 抬起
.nb-ui-layer              层级色阶，自动推导
.nb-ui-layer-01/02/03     层级色阶，写死档位
.nb-ui-layer-sunken       凹
```

浮层是材质层加重投影，现有的 `.nb-ui-popover-surface` 成为它的形状修饰类或别名，14 个消费方随之迁移。

### 主题合同

主题需要提供：

- 材质层的**一个**面色（不透明度不低于下限）与一套模糊配方。
- 层级色阶的三档色值（或一条派生规则）。

下限取 **92%** 作为本次 Lab 的 nbook 日间走查基线；**暗色材质的下限由各主题自行决定**，库不为所有主题保证统一可读性。模糊配方、色相、饱和度、亮度全部由主题自由决定。

### 下限把关：拆成两条轴之后代价小了一个量级

前一版这里卡住了：开发者选择「加载器强制校验」，但加载器只校验 manifest，看不见主题的 CSS。三条路里方案乙（材料改成 manifest 数据、由库合成）是唯一让下限真正成为合同的做法，但当时要改的是整套表面系统，破坏性太大。

**两条轴拆开之后，需要校验的只剩材质层那一个数。**主题在 manifest 里申报一个不透明度和一个基色，库负责合成材质层的面色；层级色阶那一套完全不受影响，主题随便写 CSS。

下限由构造保证，不可能被绕过，而代价从「整套表面系统改写法」缩小到「一个数走 manifest」。

## 备选方案与取舍

### 层级色阶：Carbon 式 vs M3 式（已决定 Carbon 式）

- **M3 式**：提供具名档位，每处自己挑。简单、无运行时机制、灵活；代价是大项目里容易漂移，会出现「面板里套面板同色」这种漏。M3 是从自动改成手选的，理由是灵活性。
- **Carbon 式**：位置自动推导。嵌套不会错；代价是硬上限加一套推导机制。

*2026-09-02 决定采用 Carbon 式，同时保留编号档位。*

### 材质：按部件命名 vs 只有一层（已决定一层）

- **按部件命名**（现状，也是 macOS 的做法）：有先例，且苹果是主动从「按视觉属性命名」走到这一步的。但它成立的前提是部件的层级由平台固定，回答不了自由嵌套。
- **只有一层**：与微软一致，与 CSS 规范一致。

*2026-09-02 决定材质只有一层。*

### 已作废：三个盒子

前一版的内容盒 / 器械盒 / 浮层盒，作废理由见「当前行为与证据」最后一节。

## 影响

**接口**：新增材质层与层级色阶两套类；现有 8 个表面变量重新归类，`--toolbar-surface` / `--sidebar-surface` 合并进材质层，`--strip-surface` / `--panel-surface` 归入层级色阶。属于 nb-ui 的公开表面，消费方（主应用、nb-workshop）需要同步。

**迁移**：

- nbook 主题的浮层 14%、侧栏 26%、工具栏 30% 合并成一个材质层面色，提到下限之上。
- **nbook 把 `--strip-surface` 定成了 38% 半透明**，按新模型这是错的：面板里的操作条属于层级轴，应当是不透明色。
- `FormSelect` 的内联覆盖删除。
- 14 个消费 `.nb-ui-popover-surface` 的组件改名或走别名。
- 主应用里手工拼装表面的地方（Lab 顶栏、侧栏、画布盒子）改用新类，Lab 本地的 `--lab-surface` 两行删除。

**安全**：无。

**发布与回滚**：主题合同变更影响已装主题的兼容性。若材质层走 manifest 申报，旧写法的主题装不上，需要一次主题侧的版本升级。回滚方式是保留旧变量一个版本周期，新旧并行。

**风险**：

- 92% 只在 nbook·昼 + 一张照片背景 + Lab 这一种布局下验证过。已知规律是**面越大越需要不透明**，所以下限还可能与面积有关，而库里的类没法感知自己被贴在多大的面上。
- Carbon 式推导需要组件知道自己的层级。这套机制在 nb-ui 里还不存在，是本提案里工程量最大的一块。

## 未决

1. **产品适用范围**：本次只在 Lab 验证 Surface 模型。写作页、设置页和其他产品页面是否需要更多层级，不在本次验证范围内，后续另行走查。

以下三项是已决定、但尚未进入实现 follow-up 的工程细节：

- **超出三层**：钳制到第 3 层；开发环境发出警告，生产环境不中断。这样保留可用界面，同时暴露设计错误。
- **自动层级机制**：普通 Vue 嵌套通过 Vue 上下文自动推导；Portal 与纯 CSS 使用显式 `.nb-ui-layer-01/02/03` 边界。
- **暗色材质下限**：不设库级统一数值，由各主题自行决定；库不保证所有主题的材质层可读性。

实现 follow-up 必须另建或更新 Task；Surface token、公共类和现有消费方迁移不属于 `t05-component-lab` 的完成门禁。

## 对 Spec 的预期改动

- `packages/nb-ui/docs/ui-development-spec.md` 第 2 节第 1 条：材料判据从「装工具 vs 装长文」改写为两条轴，并写入材质层的不透明度下限与「只有材质层开模糊」。
- `packages/nb-ui/docs/design-language.md` 第一节：器械 / 稿面两栏表改为两条轴，补充实测证据与外部调研结论。
- 主题合同文档：新增材质层的申报方式与不透明度下限。

**注意**：`ui-development-spec.md` 的第 2 节第 2 条被 `packages/nb-ui/src/components/token-consumption.test.ts` 引用（第 12、88 行），第 2 节第 6 条被 `design-language.md` 第 462 行引用。改写正文时**不要重新编号**。

验收：在 Lab 里把桌面换成复杂照片，材质层的正文可不盯着读出；面板里嵌套三层色阶，每一层与下一层可区分；装载一个不满足下限的主题时被拒绝。

## 决策记录

| 日期 | 决策 | 结论 |
|---|---|---|
| 2026-09-02 | 分档轴（第一版） | 按「这块面装什么」分，三个盒子——**已作废** |
| 2026-09-02 | 模糊配方 | 不进合同，完全由主题决定；实测证明不影响可读性 |
| 2026-09-02 | 取值 | 材质层 92%，在整条栏上走查得到；四格实验的 65% 只在小色块上成立 |
| 2026-09-02 | 分档的适用条件 | 分档只在相邻对照下传达得出来；Lab 整页因此收敛到一档 |
| 2026-09-02 | **轴的数量** | **两条：材质轴与层级轴。材质只有一层在最底、只有它开模糊、只有它有下限** |
| 2026-09-02 | **层级色阶的做法** | **Carbon 式位置自动推导，同时保留编号档位** |
| 2026-09-02 | 层级方向 | 往上更亮，明暗两态都是 |
| 2026-09-02 | 下限把关机制 | 材质层走 manifest 申报、由库合成（原方案乙）；拆轴后代价从整套系统缩小到一个数 |
