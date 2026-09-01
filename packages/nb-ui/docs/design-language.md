# NeuroBook 的设计语言

写给要动这套界面的人和 agent。**不是审美说明书，是判据清单**——每一条都能被证伪，
大部分是被实测推翻过一次才写成现在这样的。

产品默认主题叫 `nbook`，从 `macos` 衍生。`macos` 留在仓库里当参照实现（它复用 Apple HIG
里能查到出处的取值），`editorial` / `aurora` 是主题格式的示范。四套并存，随时可切换对照。

- 怎么写一套新主题：[`authoring-themes.md`](./authoring-themes.md)
- 对照页：`bun run dev` → <http://localhost:3003>，主题 × 配色两轴都能切

---

## 一、论点

**玻璃是器械，纸不是玻璃。**

Apple 给 Liquid Glass 定的硬规矩是：玻璃只属导航层和控件层，内容层不许套玻璃。
写作工具把这条推到底——内容层不只实心，还是**纸**：全屏唯一不透明、唯一浮起、唯一用衬线的面。

于是整个界面只有两种材质：

| | 器械（chrome） | 稿面（paper） |
| --- | --- | --- |
| 是什么 | 工具栏、侧栏、菜单、对话框、按钮、输入框 | 正文编辑区、章节内容 |
| 材质 | 半透明玻璃，磨砂 + 边缘折射 | 实心纸 |
| 色温 | 冷 | 暖 |
| 字体 | 黑体（`--font-ui`） | 宋体（`--font-display`） |
| 配色来源 | `--bg-sidebar` | `--bg-panel` |

冷暖分家不是装饰，是**这套主题唯一的身份**。第一版试过「整套都偏暖一点」，
实测下来色差只有 3–5 个通道单位，在低亮度下**根本看不出来**——和 macOS 摆在一起分不清谁是谁。
身份必须落在角色映射层（哪个面从哪个配色变量派生），不能靠全局色偏。

界面用黑体、正文用宋体是中文出版的默认分工，也是「器械 / 稿面」两种材质的字面证据。

---

## 二、材料与层级

### 玻璃是三层叠出来的，缺一层就不成立

```css
.glass {
    background: var(--overlay-surface);      /* ① 半透明 tint —— 没有它，模糊看不见 */
    backdrop-filter: var(--overlay-blur);    /* ② 磨砂 + 提饱和 + 提亮 */
    box-shadow: var(--elevation-popover);    /* ③ 外阴影 —— 层级靠它，不是靠模糊 */
}
```

**Liquid Glass ≠ 磨砂玻璃。** 区别在边缘：真玻璃的边缘会**折射**，把背后的东西挤压变形，
而不是均匀散焦。这一层用 SVG 位移滤镜做（`themes/*/assets/lens.ts`），通过
`backdrop-filter: url("#…") blur(…)` 接上。

三条边界写在明处：

1. `backdrop-filter` 里的 `url()` 滤镜引用**只有 Chromium 支持**（WebKit bug 245510 长期未解，
   Firefox 不支持）。所以必须 `@supports` 渐进增强，退化后仍要有纯 blur 的基线。
2. `backdrop-filter` 糊不到操作系统桌面。要糊真桌面得由桌面壳开窗体级 vibrancy。
   Web 侧的替代是**自带窗体底纹**（`--window-backdrop`）：没有它，折射和磨砂作用在一片纯色上，
   等于零效果。
3. Apple 没有公开 blur 半径与折射率，所有取值都是视觉近似，不要当规范引用。

### 层级只有三档，用阴影而不是边框表达

| 档 | 用在哪 | token |
| --- | --- | --- |
| raised | 按钮、输入框、键帽 | `--elevation-raised` |
| popover | 菜单、下拉、气泡、时间选择器 | `--elevation-popover` |
| dialog | 对话框 | `--elevation-dialog` |

暗色下**外阴影要加重**。理由是暗色里明度差本来就小，只靠面色区分不出层级
（Apple 侧的暗色规范也是这么说的：tint 换低亮度变体、提亮环境边缘光、加重外阴影）。

#### 一条阴影里该有什么：从官方文件逐图层读出来的结构

以下取自 Apple 官方 macOS 27 UI Kit 的 **Materials** 页，图层样式
`This Document/Liquid Glass/Light` 与 `…/Dark`（Sketch Cloud Inspect 模式逐图层导出的 CSS）：

```
/* Light · Regular - Large，580×400，Radius 20 Smooth Apple 60% */
-1.25px 0    0     -0.75px  #DBDBDB          ← 左右两道竖边缘光
 1.25px 0    0     -0.75px  #DBDBDB
 0      0    0.3px  0.3px   #DBDBDB          ← 一圈发丝轮廓
 0      18px 48px   0       rgb(0 0 0 / .25) ← 唯一一条环境投影
 0      2px  0.25px -1.5px  inset #FFFFFF    ← 顶高光＝入射光
 0     ±1px  1.5px  -0.5px  inset #272727    ← 上下对称的内边线＝玻璃的厚度
 0     ±4px  8px    -4px    inset #272727

/* Dark · Regular - Medium，Popover 240.5×230：同构，只换取值 */
轮廓 #A6A6A6 ／ 环境投影 rgb(0 0 0 / .45) ／ 内边线 #676767 ／ 顶高光 #FFFFFF 20%
```

三条判据：

1. **轮廓靠发丝阴影，不靠中等半径的投影。** `0 0 0.3px 0.3px` 几乎不糊、不透明度高，
   读起来是一条切出来的边；`0 2px 6px` 那种 Material 式近景投影读起来是「浮在绒布上」。
2. **环境投影只有一条。** 近 + 远两条叠加等于把同一件事说两遍，结果是边缘发灰、整块面下沉。
3. **内边线上下对称。** 「顶白 + 底黑」是拟物按钮的打光，不是玻璃；玻璃的上下两个面同色，
   入射光另由一条单独的顶高光表示。暗色下这三条**全部改为提亮**——压暗的边等于没有边。

两档的几何差一倍，这不是装饰而是层级本身：浮层 `0 18px 48px`，
Save Dialog `0 36px 100px`（后者是上一轮从同一份文件的 Dialogs 页读到的原值）。
对话框压住整个窗口，浮层只压住一小片。

翻译到 CSS 时有两处必然的偏离，写在这里以免下一个人以为是抄错了：
原件那几条外阴影是 **Plus darker** 混合模式，CSS 的 `box-shadow` 只有 normal，
所以轮廓不照抄「浅灰 100%」而是改从 `--shadow-color` 取低不透明度；
几何从 `0.3px` 放到 `0.5px`，因为原件按 2× 稿面画，`0.3px` 在 1× 下只剩抗锯齿。

### 浮层外观只有一个登记处

菜单、下拉、气泡、对话框、时间选择器的面板**全部**消费 `.nb-ui-popover-surface`
（`src/styles.css`）。它统一负责描边、外圈几何、面色、阴影与磨砂；菜单再显式叠加
`.nb-ui-menu-surface`，把外圈从 `--radius-panel` 切到 `--radius-menu`。

```css
.nb-ui-popover-surface {
    border: var(--border-w) solid var(--panel-outline);
    border-radius: var(--nb-popover-radius, var(--radius-panel));
    background-color: var(--overlay-surface);   /* tint */
    background-image: none;                     /* sheen 只由显式 modifier 接入 */
    box-shadow: var(--elevation-popover);
    backdrop-filter: var(--overlay-blur);
    -webkit-backdrop-filter: var(--overlay-blur);

    --nb-popover-pad: var(--space-3);            /* 模板上的 p-1.5 */
    --nb-popover-inner-radius: max(
        2px,
        calc(var(--nb-popover-radius, var(--radius-panel)) - var(--border-w) - var(--nb-popover-pad))
    );
}

.nb-ui-menu-surface {
    --nb-popover-radius: var(--radius-menu, var(--radius-panel));
}

.nb-ui-surface-rim {
    background-image: var(--overlay-sheen);
}
```

面色必须拆成 `background-color` 与 `background-image` 两条长写法，**不要写回 `background` 简写**：
简写会把没写出来的那条重置掉。基座默认不铺镜面；macOS 把 `--overlay-sheen` 映射到已有的
`--glass-rim`，但只有整块 Dialog / DialogWindow 显式挂 `.nb-ui-surface-rim`。nbook 保持
`--overlay-sheen: none`，小浮层继续 8px 纯 blur、无面渐变。

菜单、ContextMenu、Combobox、FormSelect、默认 TimePicker 与 macOS 滚轮 TimePicker 都必须挂
`.nb-ui-menu-surface`；Tooltip、Dialog 的基础外观不挂该 modifier。组件不要复制这组属性，也不要
往模板里加 `rounded-*`：基座排在 utilities 之后，原子类不会改变实际外圈；Tooltip 的小圆角仍走
自己的 inline 特例。

对话框在这个登记处上再叠一条 `.nb-ui-dialog-surface`，只覆盖**两项**：

```css
.nb-ui-dialog-surface {
    border-radius: var(--radius-dialog);
    box-shadow: var(--elevation-dialog);
}
```

`.nb-ui-surface-rim` 是玻璃轮廓的 opt-in，不是第三种浮层基座。它只给整块玻璃的大面，
不能挂在工具栏、侧栏、菜单项或 nbook 小浮层上。

---

## 三、几何

### 控件高度与圆角

中文比拉丁文占满 em 框，同样的 px 下汉字更挤。这里原来据此整体比 macOS 加一档，
后来实际比对下来 macOS 那档更好看，字号与控件高度收回同档；**行高与字距不跟着回退**——
那两条不是密度偏好，是汉字没有升降部造成的硬约束：

| | macOS | nbook |
| --- | --- | --- |
| 控件高（sm / md / lg） | 26 / 32 / 40px | 26 / 32 / 40px |
| 界面正文 | 13px | 13px |
| 行高 | 1.35 | **1.5** |
| 字距 | −0.006em | **0** |
| 面板圆角 | 18px | 20px |
| 菜单外圈圆角 | 12px | 12px |

`FormInput`、`FormNumberInput`、`FormSelect` 的默认单行高度分别消费 `.nb-ui-control-h-md`，
水平内边距消费 `.nb-ui-control-px`，因此实际命中两套主题同为 32px 与同为 14px 的
`--control-px`。这几个静态类在 `src/styles.css` 登记，
不依赖 Tailwind 对 arbitrary value 的扫描。

控件圆角两套都是 10px——那一档本来就够小，加不加高度都不影响手感。

`20px` 是有出处的：Chromium 的提交记录写明 macOS 12–15 窗口圆角用 9pt，macOS 26 Tahoe 用 20pt
（Electron 为对齐 Tahoe 取 24pt）。Apple 自己没公布这个数。
`macos` 主题保持 18px 不动——那是更早的目测近似，也是用户已经认可的观感。

菜单的 12px 是独立语义档，不再把 18px / 20px 的 panel radius 画在窄小下拉上。

「加一档」这件事**是目测决定，没有可引的规范**。Apple HIG 的中文排版页需要 JS 才能读，
Ant Design / Arco / TDesign 三家的排版规范页也都取不到正文。别在文档里假装它有出处。

### 同心圆角

嵌套形状的圆角要同心，否则内外弧线不平行，看起来像贴歪了。
Apple 的官方落点是 UIKit 的 `containerConcentricRadius` 与 SwiftUI 的 `ConcentricRectangle`
（半径随嵌套层次自动递减）。

**但「子半径 = 父半径 − padding」这个具体公式不是 HIG 原文**，只是一个够用的近似。
可以照着算，不要当官方规范引用。

库里这条有**一个登记处**，在 `.nb-ui-popover-surface` 上：

```css
--nb-popover-pad: var(--space-3);                 /* 浮层的内边距，模板上是 p-1.5 */
--nb-popover-inner-radius: max(
    2px,
    calc(var(--nb-popover-radius, var(--radius-panel)) - var(--border-w) - var(--nb-popover-pad))
);
```

默认浮层沿用 `--radius-panel`；菜单 modifier 提供 `--radius-menu: 12px`，所以默认 1px 描边与
6px 内边距推出约 5px 的内圈。浮层里贴着边的盒子（列表项、菜单项、滚动区）一律挂
`.nb-ui-popover-item` 或直接取这个变量，**不要写 `rounded-*`**。改了浮层的内边距就得同时改
`--nb-popover-pad`，否则半径和留白对不上——这正是它是变量而不是一个写死的数的理由。
走偏了的现象见坑 #42。
浮层之外也有同心的地方，最典型的是分段控件：段是**贴着**外框四角的（内边距只有 `p-0.5` = 2px），
所以段的圆角要按同一条式子从外框推出来，而不是取一个「小一点的档」：

```html
<!-- SegmentedControl.vue -->
rounded-[max(2px,calc(var(--radius-control)_-_var(--border-w)_-_2px))]   <!-- 段 -->
```

`max()` 不是装饰：主题若把 `--radius-control` 调到比 `border + padding` 还小，
`calc()` 会算出负值，而**负的 `border-radius` 是非法值，整条声明被丢弃**——
表现是圆角控件突然变成方角，且没有任何报错。

内层形状不贴角就不必同心。`FileTree` 的展开箭头离行首至少 8px，`Badge`、`TagInput` 的芯片、
`FormCheckbox` 都是这种情况，它们保持自己的圆角是对的，别为了「统一」去套这条式子。

### 控件圆角只有 `--radius-control` 一个来源

按钮、输入框、下拉触发器、分页、开关、标签输入、文件树行——所有控件档的圆角都取
`rounded-[var(--radius-control)]`。**不要写 `rounded-md`**：那是 Tailwind 的 6px 常量，
和主题没有任何关系，主题把控件圆角调到 10px 时它一动不动。

这条是补出来的，不是一开始就有的：`--radius-control` 曾经全库只有 Tooltip 和 TimePicker
两个消费方，其余 12 个组件全写死 `rounded-md`，于是**主题里那一行 `--radius-control: 10px`
基本上是个死变量**——改它只有两处会跟着动。一个声明了却几乎没人消费的 token，
比没有这个 token 更糟：它让人以为这一档是可调的。


### 圆角是超椭圆，不是正圆弧——但玻璃面上做不了

Apple 的角不是一段正圆弧接上直边，而是**曲率连续**地收进去。官方 macOS 27 UI Kit
把这一层记作 `Radius 26 / Smooth / Apple (60%)`。差别在弧线与直边的接缝：正圆弧在接点上
曲率有跳变，读起来像「被咬掉一口」；超椭圆是渐渐收，同样的半径看着更饱满。

CSS 侧从 Chrome 139 起有 `corner-shape`，所以这一档**技术上**做得出来。
本项目试过一轮，**又撤了**：Chromium 把 `backdrop-filter` 裁到普通 `border-radius`，
不认 `corner-shape`（Chrome 151 实测），于是玻璃面的四个角各露出一牙没被模糊的背景。
详见坑 #37。

**结论：带 `backdrop-filter` 的面一律用正圆弧。** 不带模糊的面（按钮、卡片、输入框）
可以开这一档，但目前库内没有这样的消费方，所以 `--corner-shape` 这个变量也一并删了——
留一个没人消费的 token，比没有它更糟。

### 对话框不是「三段式盒子」

这是本轮从 **Apple 官方 macOS 27 UI Kit**（Sketch Cloud 公开分享件，
<https://www.sketch.com/s/57153a31-3379-4737-8ac6-dbfd6525f052>，可在 Inspect 里逐层读 CSS）
实测回来的，不是转述：

| | Alert（Side by Side） | Save Dialog |
| --- | --- | --- |
| 尺寸 | 260 × 170 | 390 × 318 |
| 布局 | `flex column; gap: 14px` | `flex column; gap: 20px` |
| 留白 | `padding: 20px 16px 16px` | `padding: 20px`（四边等距） |
| 圆角 | — | `26px` / Smooth / Apple 60% |
| 面 | Style = **Glass** | `rgba(255,255,255,1)`——**不透明** |
| 阴影 | — | `0 0 1px rgb(0 0 0 / .8), 0 36px 100px rgb(0 0 0 / .4)` |
| 标题 | SF Pro **Bold 13px** / 行高 16 | SF Pro Bold 14px / 行高 17 |
| 正文 | SF Pro **Regular 13px** / 行高 16 | SF Pro Medium 11px / 行高 14 |
| 标题↔正文 | 段后距 8px | `gap: 6px` |
| 按钮 | 110 × **28**，`gap: 8px`，**平分整行** | 76 × **24**，**右对齐** |
| 关闭 × | **没有** | **没有** |

四条结论：

1. **没有头尾条。** 标题只是这一列的第一个块，按钮只是最后一个块，留白由容器一处给。
   「标题独占一条带分隔线的横条 + 按钮独占底部一条横条」是 Web / Windows 的做法。
   留白一旦发给三个条各自持有，每加一段内容就多一道横向分界，读起来是三个堆叠的条。
2. **标题与正文同字号，只差字重和颜色。** Alert 两者都是 13px，差在 Bold / Regular。
   拉开字号（16px 标题 + 14px 正文）拉出来的是**网页 H2 + 段落**的关系。
3. **没有 ×。** 模态对话框的出口是一颗有名字的按钮（取消 / 存储 / 删除）。
   叉把「关掉这个框」和「放弃这次操作」说成两件事，用户得自己猜是不是同一件。
4. **按钮平分整行还是右对齐，看框窄不窄**，不看它是不是对话框。窄框（决定）平分，
   宽框（表单）右对齐——宽框里平分会得到两根夸张的长条，而且按钮离它要确认的字段太远。

按钮的高度刻度也一并记下（同一份文件的 Buttons 组）：
**Mini 16 / Small 20 / Regular 24 / Large 28 / XL 36**，且**从 Mini 到 XL 全是整颗胶囊**。
库里原先那句「Apple 只在 Large / X-Large 才走 capsule」是错的，已经改掉。

---

## 四、排版

字体栈**拉丁在前、CJK 在后**：

```css
--font-ui: -apple-system, "SF Pro Text", "Segoe UI",
           "PingFang SC", "Microsoft YaHei", "Noto Sans CJK SC", system-ui, sans-serif;
```

中文字体自带的拉丁字形质量普遍较差，放在前面会把西文一起接管。
（有中文技术文章主张相反顺序，来源是二手转述，本主题不采纳。）

三条平台覆盖缺一不可：PingFang SC 覆盖 macOS/iOS，Microsoft YaHei 覆盖 Windows 7+，
Noto Sans CJK SC 覆盖 Linux 与装了 Noto 的环境。

四条中文特有的规矩：

1. **字距归零。** macOS 的 `-0.006em` 是给 SF 的拉丁字形调的。查不到任何依据说汉字该用负字距，
   反而查到「请勿据此直接套用到汉字」的明确提醒。
2. **行高放松到 1.5。** 汉字没有升降部来制造行间空隙，同样的 1.35 在中文里会贴得多。
3. **中文没有斜体。** `font-style: italic` 是把字形剪切变形，看起来像渲染故障。
   强调**换字面不换字形**——用楷体（`--font-emphasis`）。
4. **稿面用宋、界面用黑。** 稿面比界面大一档（界面 14px、正文 17px），两个区的密度本来就不该一样。

版心宽度用 `em` 而不是 `ch` 或 `px`：CJK 下 1em 正好是一个汉字宽，
所以 `--reading-measure: 34em` 直接就是「每行 34 个字」。

---

## 五、颜色角色

**任何主题文件里都不许出现字面颜色。** 只许引用配色变量，或用 `color-mix()` 从配色派生。
唯一例外是纯白 / 纯黑的低透明度叠层——镜面高光和内阴影表达的是**光**不是颜色，
配色契约里没有对应的角色。

### 状态色的分工是固定的

| 角色 | 用在什么语义 |
| --- | --- |
| `--accent-main` | 选中、当前、主操作 |
| `--status-warning` | 草稿、待审、未保存 |
| `--status-success` | 完成、已同步 |
| `--status-danger` | 错误、删除、冲突 |
| `--status-info` | 运行中、引用、说明 |

强调色占了蓝，`--status-info` 就得让开——`nbook` 的 info 是青色而不是蓝色，
否则「当前章节」和「运行中」在余光里分不开。

### 玻璃上的高亮必须是半透明的：`--overlay-item-active`

浮层里「当前项 / 悬停项」的底色**不能**用 `--bg-hover`。配色层的 hover 色是给实心面用的，
它是不透明的；铺在玻璃上就成了一块**挖进材料里的实色补丁**——周围还是通透的玻璃，
那一条却把背后的内容整段挡住，看起来像贴纸而不是照亮。

所以库里有一个专门的角色：

```css
/* src/tokens.css —— 默认值退回 --bg-hover，没装主题时观感不变 */
--overlay-item-active: var(--bg-hover);
```

```css
/* themes/nbook/vars.css —— 玻璃上用材料自己的明度差 */
--overlay-item-active: color-mix(in srgb, var(--text-main) 12%, transparent);
```

取 `--text-main` 而不是写死白或黑，是为了**一条声明在明暗两套配色下都对**：
暗色里 `--text-main` 是浅色，12% 叠上去是提亮；亮色里它是深墨，12% 叠上去是压暗。
两边都朝「和面色拉开」的方向走。`--control-surface` 用的是同一个手法。

两个无障碍档要退回不透明：`prefers-reduced-transparency` 和 `prefers-contrast` 下玻璃已经
退成实心面，这时半透明高亮反而对比不足，两个 block 里都写回 `var(--bg-hover)`。

`.nb-ui-popover-item` 只管圆角，不管底色——底色由各组件按自己的状态语义
（`data-[highlighted]` / `aria-selected` / `:hover`）挂上去，但取的值必须是这个角色。

### 配色表的三条不变量

写新配色时必须满足，否则主题的派生取值会塌：

1. **`--bg-panel` 恒亮于 `--bg-main`**（纸比桌亮）。`--page-surface` 直接取 `--bg-panel`，
   这条不成立稿面就浮不起来。
2. **`--bg-input` 不低于 `--bg-panel`**（输入框不许挖成坑，见坑 #6）。
3. **`--accent-main` 与 `--status-warning` 不许取同一个值**。「当前」和「待审」同色，
   余光里就分不开了。

这三条在 `src/theme/theme-packages.test.ts` 里有对应用例，改配色表时会被挡下。

---

## 六、无障碍：三个 media query 是义务不是加分项

Apple 自己给 Liquid Glass 配了 Reduce Transparency / Increase Contrast 两个系统开关
（iOS 26 早期正是因为通透过头挨了可读性批评）。Web 侧只抄视觉不抄这两条，等于只复制了表面。

```css
@media (prefers-reduced-transparency: reduce) { /* 玻璃全部退成实心面 */ }
@media (prefers-contrast: more)                { /* 玻璃退实心 + 描边换 --border-strong */ }
@media (prefers-reduced-motion: reduce)        { /* 主题自己新增的动效变量自己关 */ }
```

两点容易漏：

- **库只把三个时长归零**（`src/tokens.css`，带 `!important`），它不知道你新增了
  `--glass-lift` 这种变量。**主题自己新增的动效必须由主题自己关掉**——这是「新增变量」这个能力
  的配套义务。
- **`mask-image` 也算「看不见的透明度」。** 滚轮的上下渐隐是用 mask 做的，
  `prefers-reduced-transparency` 下要一起收掉，否则轮子两端的字永远是半透明的。

还有一点比前两点更隐蔽，写了三个 media query 也照样能全军覆没：

> **媒体查询不提升特异性。** 三个块里写的是 `:root[data-nb-theme="x"]`（0,2,0），
> 而暗色分档是 `:root[data-nb-theme="x"][data-nb-appearance="dark"]`（0,3,0）——
> 分档稳赢，于是三个块在暗色下**一次都不会生效**，还不报任何错。
> 凡是要覆盖分档里的变量，选择器就得跟着带上 `[data-nb-appearance]`，并把整块排在分档之后。
> 详见坑 #31，那里有可复现的探针。

`prefers-reduced-transparency` 的浏览器覆盖不如 `prefers-reduced-motion`，
真要交付还得在产品里自带一个开关；CSS 侧先把合同立住。

窄屏另有性能降级（`@media (max-width: 768px)`）：丢掉折射、strong 档再收一档（10px → 6px）。
依据是模糊的开销随**面积 × 半径**增长，公开实测（HyperFrames 性能指南）给的量级是
「8 层半径 1/2/4/8/16/32/64/128px 的 blur，在 1920×1080 区域、中端 GPU 上可轻易吃掉每帧 200ms」，
并建议避开大面积的 `blur(64px)` / `blur(128px)`。同类开源实现（glassfx）也是在 <768px 直接丢弃折射。
这一块同样踩了上面那条特异性坑，暗色下曾经完全没生效。

---

## 七、动效

动效只解释空间关系和状态变化，不做装饰（`src/tokens.css` 的原话）。这一节规定
时长刻度、缓动和浮层编排；每一条都能用计算样式或静态扫描证伪。

### 时长只有三档，按语义选，不按感觉选

| 档 | 语义 | 用在哪 |
| --- | --- | --- |
| `--motion-fast` | 状态反馈 | hover / 按压变色、chevron 旋转、选项高亮 |
| `--motion-base` | 控件形变 | 开关滑球与轨道、分段控件与标签页指示线移动、对话框进出 |
| `--motion-enter` | 浮层入场 | 菜单、下拉、气泡、时间选择器的出现 |

**`fast < base < enter` 这个顺序是合同，绝对值归主题。** 当前登记值：
裸基线 120 / 180 / 220ms；nbook 与 macos 90 / 140 / 180ms；aurora 100 / 160 / 240ms；
editorial 同裸基线。这些数值是**目测决定，没有可引的规范**——Apple 没有公开过
时长刻度。主题可以改值，但不能打破大小顺序；新主题登记时按这条审。

「状态反馈最快、浮层入场最慢」不是拍脑袋：反馈是确认已经发生的事，拖长了像卡顿；
入场是建立「这层东西从哪来」的空间关系，眼睛需要时间去追踪。把两档对调，
界面会同时显得迟钝和突兀。

### 缓动只有一个来源

组件只消费 `--ease-standard`，不得在组件里写 `cubic-bezier(...)` 字面量。
主题可以覆盖这个变量（nbook / macos 取 `cubic-bezier(0.25, 0.1, 0.25, 1)`，
裸基线取 `cubic-bezier(0.2, 0, 0, 1)`），同样是目测决定。

本库曾经有过一条回弹曲线（`cubic-bezier(0.34, 1.15, 0.64, 1)`，只被 DialogWindow
一处消费），本轮归并进 `--ease-standard`：单一消费点不够格登记 token
（`ui-development-spec §2.6`），而且回弹的趣味感和这套器械语言不是一回事。
如果哪天要让「弹性」成为正式词汇，先登记 token 并接上至少两个消费方，再写进这一节。

### 浮层入退场的编排是固定的

1. **入场 = opacity + scale(0.96 → 1)**，时长 `--motion-enter`。不加位移——
   浮层贴着触发器出现，位移会读成「从别处滑进来」而不是「从这里展开」。
   两个例外：通知横幅不贴触发器，从边缘滑入（translateY）是合法配方；
   Tooltip 跟随 macOS 的行为只淡入淡出，不做缩放。
2. **transform-origin 在贴触发器的那一头。** Reka 把方向算好暴露在
   `--reka-select-content-transform-origin` / `--reka-dropdown-menu-content-transform-origin`
   这类变量上，**消费它，不要自己根据 placement 推**——推一遍就是把原语已经解决的
   碰撞翻转逻辑再抄错一次。
3. **退场同配方，时长 `--motion-fast`。** 退场是「这件事结束了」，不需要入场那样的
   追踪时间；拖长的退场读作迟疑。
4. **退场动画靠原语的 Presence 续命**：CSS animation 挂在 `[data-state=open]` /
   `[data-state=closed]` 上，Reka 等到 `animationend` 才卸载内容树。
   判据：关闭浮层后目标元素在 DOM 里存活到动画结束才被移除（e2e 可断言）。
   若原语行为变了（不再等待），退回 Vue `<Transition>` 包装，并在坑节记录。
5. 共享实现只有一个登记处：`src/styles.css` 的 `.nb-ui-popover-motion` modifier，
   挂在浮层基座（`.nb-ui-popover-surface`）之上。已有自己过渡的浮层
   （Combobox / ContextMenu / Tooltip / DialogWindow / TimePicker / Dialog）不挂它，
   避免两层动画叠加；它们的配方同样服从本节第 1–3 条。

### 禁条

- **组件不得写死时长或缓动**：`duration-200`、`0.15s`、`transition: all 0.18s ease`
  这类字面量一律违规。`src/components/token-consumption.test.ts` 静态扫描归零。
- **禁 `transition-all` / `transition: all`**：它把布局属性也卷进过渡（尺寸变化被
  意外动画），并且让审查看不出「到底什么在变」。transition 的属性列表必须显式。
- 动效不承担必要信息（`ui-development-spec §5`）：状态必须同时有不依赖动画的表达。
- `prefers-reduced-motion` 下三个时长归零由库负责（`src/tokens.css`，带 `!important`）；
  **主题自己新增的动效变量由主题自己关**（见 §六），这是新增变量的配套义务。

### 判据

- 读**元素的计算样式**：`transition-duration` 必须等于对应 token 的解析值，
  不是「大概 0.2s」。
- 切主题 / 开浮层之后等 ≥500ms 再读数（坑 #18），否则读到的是过渡中间态。
- 入场方向看截图：origin 错了，浮层会从错误的一头长出来，计算样式看不出来。

---

## 八、踩过的坑

每条写「现象 → 根因 → 判据」。**判据是这一节的重点**——多数坑之所以活很久，
是因为当时用的判据本身是错的。

> 编号只增不改。正文里有「见坑 #6」这样的互引，重排会把它们指到别处去；
> 新坑一律接在所属分组的末尾拿下一个号。

### A. CSS / 渲染

**1. `var()` 拼进 `none`，整条声明作废**
现象：某个主题下玻璃完全消失，别的主题正常。
根因：`backdrop-filter: var(--a) var(--b)`，其中一个是 `none`，拼出来是 `blur(20px) none`，
整条无效。
判据：任何会被拼接的变量，取值必须是**完整的一条 filter 列表**，关闭时整条置 `none`，
不要留一半。

**2. `@supports` 返回 true 不等于渲染正确**
现象：`@supports (backdrop-filter: url("#x"))` 成立，分支生效，但视觉上没有折射。
根因：`@supports` 只测「这条声明是否被解析器接受」，测不出渲染结果。
判据：基线必须留住——不支持折射时纯 blur 的那条仍要成立。永远不要把 `@supports`
当成「功能可用」的证明。

**3. 边缘折射需要背后有细节才看得见**
现象：浮层浮在平滑渐变上时，折射效果为零。
根因：位移滤镜挤压的是背后的像素，背后没有高频内容就无处可挤。
判据：验收时把浮层压在**有细节的内容**上（表格、正文），不要压在渐变背景上。
对照页的菜单刻意压在表格上就是为了这个。

**4. 读变量 ≠ 元素吃到**
现象：页面顶部读数写着「边缘折射 有」，实际元素上一点折射都没有。
根因：那行读的是 `getPropertyValue("--glass-lens")`，只证明变量有值，
不证明任何元素消费了它。
判据：判据必须读**元素的计算样式**（`getComputedStyle(element).backdropFilter`），
不是根上的变量。

**5. 镜面高光画在方角子区域上，会在圆角处被斜切**
现象：窗口圆角附近出现一段被斜切的亮边，像「边框被 border-radius 切掉一部分」。
根因：高光用 `::after` + `border-radius: inherit`，挂在自身圆角为 0 的子分区（工具栏、侧栏）上，
而宿主是大圆角 + `overflow: hidden`。
判据：**镜面高光只画整块玻璃的轮廓**（窗口、菜单、对话框），不画贴在里面的分区。
验收方式是关掉高光拍一张对照图——沿圆弧采样读亮度是**不可用**的判据，
采样点跨过 1px 描边读到的是抗锯齿，不是高光断口。

**6. 输入框比窗体底还暗，看起来像没上样式的原生控件**
现象：暗色下输入框成了挖在面板上的黑洞，用户描述为「浏览器原生的那一条黑线好像没有删掉」。
根因：两处叠加——配色表里 `--bg-input` 比 `--bg-main` 还暗；`--inset-shadow` 在暗底上又压一条
黑线在上内边。
判据：`sign(输入框亮度 − 桌面亮度)` 必须与 `sign(面板亮度 − 桌面亮度)` **同号**，亮暗两档都要成立。
更稳的做法是让输入框从**它所在的面**上抬起，与配色解耦：
`--control-surface: color-mix(in srgb, var(--text-main) 7%, transparent)`。

**7. 暗色下的玻璃方向是反的**
现象：暗色配方照抄亮色，结果面发灰、边缘一圈灰边。
根因：暗色 Liquid Glass 是**压暗**（`brightness(0.76)`）不是提亮；
白色镜面高光在暗底上会过曝成灰边；面的透明度还要收一点，否则暗底透暗底什么都看不见。
判据：玻璃配方必须挂 `[data-nb-appearance]` 分档，且暗色档的 `brightness` < 1。

**8. 主题要响应配色的明暗属性，不是配色身份**
现象：用户自建的暗色配色下，主题的暗色分支不生效。
根因：分支挂在 `[data-nb-colorway="dark"]` 上，只对内置那一套有效。
判据：一律挂 `[data-nb-appearance="dark"]`。

**21. `url(#滤镜)` 排在 `blur()` 前面，模糊就没了**
现象：菜单、下拉、时间选择器**全都没有高斯模糊**，整套界面因此显得廉价。
读计算样式一切正常——完整的一条 filter 链原样在那里。
根因：`backdrop-filter` 的链子里，SVG 引用滤镜排在前面会让后面的模糊几乎不生效。
声明合法、`CSS.supports` 返 true、计算值也读得到，就是画不出来。
同一块浮层、同一处背景，四组实测：

| 链 | 结果 |
| --- | --- |
| `blur(50px)` | 完全糊掉 |
| `url(#lens) blur(50px)` | 背后文字**一个字都不糊**，只剩 tint 压暗 |
| `url(#lens) blur(20px)` | 半糊，字形还能认 |
| `blur(50px) url(#lens)` | 完全糊掉 ✓ |

判据：**滤镜链里 `url()` 必须排在 `blur()` 之后**，且验收只能看图，不能读计算样式——
这条正是坑 #2 的具体形态，`@supports` 与计算值都会给你一个假的绿灯。
代价一并记下：位移作用在已经糊过的背景上，边缘折射因此几乎看不出来
（blur-only 与 blur+lens 的截图肉眼分不出）。想省一道 GPU pass 就删掉 `url()` 那一截，
观感损失接近零；**但别再把它调回 blur 前面**。

**22. tint 太厚，等于把刚修好的模糊又盖掉**
现象：模糊修好了，浮层看起来还是一块实心板。
根因：暗色下 `--overlay-surface` 是 66% 不透明——那个数是在**模糊还没画出来的时候**调的，
当时只能靠厚 tint 把浮层和背景分开，于是越调越厚。模糊接通后它就纯粹是遮挡。
判据：层级由「模糊 + 外阴影」承担，tint 只负责压住对比、保证浮层里的字读得清。
**修完材料要回头复查为它打的补丁**，补丁往往比它要补的洞活得久。
（这一条自己又被打了第二次补丁，见坑 #28：52% 是在半径还是 50px 时定的，最终落在 24%。）

**23. 玻璃需要背后有东西，而多数页面是一片纯色**
现象：对照页上玻璃很漂亮，组件画廊里同一个菜单看着像不透明的。
根因：画廊整页是纯色 `--bg-main`，把纯色糊成纯色等于零效果。这是坑 #3 的页面级版本。
判据：任何要看玻璃的页面都得铺 `--window-backdrop`（非玻璃主题下它是 `none`，惰性）。
底纹挂**页面**不挂全局外壳——外壳要保持不动，主题的变化才归因得到内容区。

**28. 模糊半径越大，越不像玻璃**
现象：模糊终于画出来了，浮层反而更像一块塑料板。用户的原话是
「模糊有点过头了，没有那种 liquid 玻璃质感」。
根因：**玻璃的质感来自背后还认得出东西**——色块的位置、明暗的走向、边缘被挤压的那一下形变。
半径每大一档，这些信息掉一截，48px 之后只剩「有一层东西挡着」。
Apple 的 Liquid Glass 本来也不是重磨砂：力气花在边缘折射与镜面上，模糊只负责让背后的字读不出来。
判据：真实浮层的 `--overlay-blur` 取 **8px 纯 blur**；完整折射强档 `--glass-lens-strong` 取 14px，
只给大容器对照面使用。8px 能让浮层里的字不可读，同时保留色块与明暗走向；14px 折射若直接接入
小浮层，会把模糊与 SVG 位移叠成用户所说的「过糊 + 背景错位」。
压暗 / 提亮改由 `brightness` 承担——它是等比缩放，**保留背后的结构**；
tint 是往一个平色上做 alpha 合成，直接把结构抹掉。同样的可读性，
走 brightness 看着是玻璃，走 tint 看着是塑料板。

**浮层与大容器必须分开验收。** 浮层用真组件检查 `getComputedStyle(surface).backdropFilter`，确认
是 `blur(8px)` 且没有 `url(#...)`；大容器再单独看完整折射。不要用大容器的折射观感替浮层背书，
也不要为了修浮层错位去改 padding、radius 或组件结构。

**29. 只给模糊不给镜面，浮层是「一层色」不是「一块材料」**
现象：半径也对了、tint 也薄了，浮层还是不像玻璃。
根因：浮层基座只给了描边 / 圆角 / 面色 / 阴影 / 磨砂五项，**没有镜面**。
`--glass-rim` 只活在对照页手写的那块玻璃上，真组件一处都没有——和坑 #15 是同一种病的第二次发作。
判据：基座要留出镜面通道（`--overlay-sheen` 走 `background-image`，玻璃的厚度走
`--elevation-popover` 里的 inset 那两条）。写 `background-color` + `background-image` 两条长写法，
**不要写回 `background` 简写**：简写会把没写出来的那条重置掉，主题给的镜面会静默消失。

**这条坑的后半段被坑 #40 推翻了一半：通道该留，但小浮层不该往面上铺渐变。**
本主题最终给 `--overlay-sheen` 喂的是 `none`，浮层的高光只剩边上那一条。

**30. 遮罩压得越重，压在它上面的玻璃越没东西可采**
现象：对话框明明是玻璃，看起来是一块灰板。
根因：遮罩与面板是平级的两层，面板的 `backdrop-filter` 采的是**遮罩之后**的页面。
遮罩 55% 的黑先把整页压成近乎均匀的暗色，玻璃再怎么糊、怎么折射都无从下手。
判据：**重遮罩和玻璃对话框是互斥的两种做法**，二选一。选玻璃就把遮罩收到 28% 一档
（macOS 的 sheet 干脆不压暗底下的窗口，靠材质与影子分层）。同理，遮罩自己那层预模糊也要克制：
把页面先糊烂一遍，面板的折射就没有高频内容可挤了，见坑 #3。

**31. 媒体查询不提升特异性，挂 appearance 的分档会把整个 `@media` 块吃掉**
现象：暗色下窄屏降级、`prefers-reduced-transparency`、`prefers-contrast` **一次都没生效过**，
不报错、不告警，亮色下一切正常。
根因：`@media` 块里写的是 `:root[data-nb-theme="x"]`（0,2,0），而暗色分档是
`:root[data-nb-theme="x"][data-nb-appearance="dark"]`（0,3,0）。
**媒体查询只决定规则参不参加层叠，不改特异性**，所以分档稳赢，媒体查询写了等于没写。
判据：凡是要覆盖 appearance 分档里的变量，`@media` 的选择器就得跟着带上 `[data-nb-appearance]`，
并且整块排在分档之后。写成**选择器列表共用一个规则体**（`:root[…], :root[…][data-nb-appearance="dark"]`），
两条选择器各自保留自己的特异性，而规则体只有一份，不会改一处漏一处。
实测判据：同结构探针下旧写法读到 `GLASS`、新写法读到 `OFF`。

**37. `corner-shape: squircle` 和 `backdrop-filter` 是互斥的**
现象：用户的原话是「box 模糊的区域不对，好像错位了」。面板的背景、描边、投影都在，
玻璃也在，但四个角各有一牙背景**没被模糊**，读起来像滤镜和盒子没对齐。
根因：**Chromium 把 `backdrop-filter` 裁到普通 `border-radius`，不认 `corner-shape`**
（Chrome 151 实测）。而背景与描边是按 squircle 画的，超椭圆在角上比同半径的圆弧更外凸，
差出来的那一牙就露在滤镜之外。
判据（可复现）：给面板 `backdrop-filter: brightness(0)`、`background: transparent`、
`border-color: red`，背后铺纯白。**黑色区域是滤镜的实际生效范围，红线是盒子的真实轮廓**；
squircle 下两者之间有一圈灰月牙，强制 `corner-shape: round` 后月牙消失。
试过的补法与它为什么不划算：把模糊挪到内层、squircle + `overflow: hidden` 挂在外层，
裁切确实跟得上（同一判据下实测无月牙）。但 `.nb-ui-popover-surface` 是菜单 / 下拉共用的基座，
给它加 `overflow: hidden` 会把子菜单和锚定弹层一起裁掉。**为一档角的形状换掉子菜单不划算——
一个和自己的盒子对不齐的滤镜，比正圆弧难看得多。**
什么时候可以加回来：Chromium 让 `backdrop-filter` 的裁切跟随 `corner-shape` 之后，
复查方法就是上面那条判据。

**38. 把 Material 的「多层递增投影」当成通用做法**
现象：面板边缘发灰、说不清边在哪，整块面像往下沉；调不同的 alpha 都不解决。
根因：写的是「近景 `0 2px 6px` + 远景 `0 16px 40px`」两条叠加。Apple 不是这么做的——
官方文件里**环境投影只有一条**，轮廓另交给一条几乎不糊、不透明度高的发丝阴影
（`0 0 0.3px 0.3px`）。两条投影叠加等于把同一件事说两遍，第二遍只会把第一遍的边缘洗糊。
判据：读计算样式，外阴影（非 inset）应当只有**两条**——一条 blur ≤ 1px 的轮廓 +
一条 blur ≥ 40px 的环境投影。出现第三条 blur 在 4–20px 之间的，基本就是这个坑。

**40. 面上铺一层镜面渐变，小浮层会被读成「盖了一层渐变」而不是一块玻璃**
现象：用户的原话是「下拉选择框这个盒子的模糊有点浅，好像你做了个渐变，效果不是很好。
要做成那种通透玻璃的感觉」。
根因：镜面层（`--overlay-sheen`）是一条 radial + linear 的白色渐变，
**几何按百分比算**：同一条渐变铺在 900px 宽的窗口上是角上一点点提亮，
铺在 240px 宽的下拉上覆盖了将近一半的面。结果是**上半截被洗成均匀的灰、下半截还透着色**——
一块玻璃不会上半截糊下半截透，所以它读起来是渐变不是玻璃。
Apple 的做法里**面上没有渐变**：Materials 那页从头到尾没提过面渐变，
玻璃的光全在边上；官方 UI Kit 里唯一的入射光是一条顶部内发丝线。
判据（可复现）：在浮层背后铺 12px 四色斜条纹（高频、有色相差）。
镜面在时条纹**只在上半截消失**，关掉之后整块面里条纹连续可辨——
「上下不一致」本身就是判据，不用比绝对清晰度。
修法：小浮层 `--overlay-sheen: none`，高光改由 `--elevation-popover` 的
`inset 0 2px 0.25px -1.5px` 顶内线承担。`--glass-rim`（整块玻璃用的那条）可以留着，
它作用在窗口那种大面上，百分比几何正好落在角上。
反方向的错解：这条抱怨里的「模糊有点浅」**不能按字面加半径**。
实测 18 / 24 / 28 / 32 / 44px 一路加上去，四色条纹被平均成一块均匀的橄榄色，
面反而更像塑料板。半径决定背后的字读不读得出，**通透与否是不透明度的事**。
什么时候重新考虑：浮层稳定大于 400px 之后，那条渐变的覆盖比例才回到「角上一点点」的量级。

**42. 列表项写死 `rounded-md`，圆角在角上会被挤没**
现象：用户的原话是「他的宽度和圆角没有对齐」，指着下拉里那一行说的。
量下来项与项之间宽度完全一致（都是 520px）、圆角完全一致（都是 6px）——**看上去不齐，量出来齐**。
根因：不齐的不是项与项，是**项与外框**。外框 20px 圆角、内边距 6px、描边 1px，
所以直边上项与框之间有 6px 留白；绕到角上，6px 的小弧线画在 20px 的大弧线里，
两条弧线不平行，留白被挤到不足 1px。人眼读到的是「这一行比框宽了一圈」。
判据：**把一角放大到 4 倍再截图**，看两条弧线平不平行、之间的留白等不等宽。
1 倍的整体图分辨不出来——本轮就是放大之后才敢说根因的。放大的做法：
给 `[data-reka-popper-content-wrapper]` 临时 `zoom: 4` 再截，不要靠截完再放大（那只会放大马赛克）。
修法：项挂 `.nb-ui-popover-item`，半径由 `--nb-popover-inner-radius` 从外框推出来
（20 − 1 − 6 = 13px），见 §三。**别去调 6px 这个数**——它每次都得跟着外框和内边距变，
写死一个数就是把同一个约束抄进 N 个模板。
连带的一处：`.nb-ui-popover-scroll` 挂在浮层自己身上的组件（Dropdown / Combobox）
本来就是坑 #24 那一条，滚动条会画进圆角里；本轮只统一了内边距，那条债还在。
**这条债已在下一轮还掉**：两个组件都把滚动下沉到内层（Dropdown 用 `role="none"` 的包装，
Combobox 用原本就在的 `<ul role="listbox">`），外框只剩 `overflow: hidden`。

**43. 玻璃上的选中态用了实心 hover 色，成了挖进材料里的补丁**
现象：浮层整体是通透的，唯独当前项那一条把背后的内容完全挡住，像贴了一张纸条。
根因：`--bg-hover` 是配色层给**实心面**准备的角色，它不透明。玻璃的高亮应该是
「同一块材料被照亮了一点」，不是「换了一种不透明的材料」。
判据：读高亮项的 `backgroundColor`，alpha 必须 < 1。
`color(srgb … / 0.12)` 是对的，`rgb(…)` 无 alpha 就是这条坑。
修法：新增角色 `--overlay-item-active`（库默认退回 `--bg-hover`，主题给
`color-mix(in srgb, var(--text-main) 12%, transparent)`），见 §五。
易漏：两个无障碍 media query 里要写回不透明值——那时玻璃已经退成实心面了。

**44. 声明了却几乎没人消费的 token，比没有更糟**
现象：主题里 `--radius-control: 10px` 改了，界面上的按钮、输入框、下拉触发器一动不动。
根因：全库只有 Tooltip 和 TimePicker 两处消费它，其余 12 个组件写死 Tailwind 的
`rounded-md`（6px 常量，与主题无关）。变量在，通路不在。
判据：逐个读取上述控件外框的计算样式，必须等于 `--radius-control`；这些外框不许以 `rounded-md` / `rounded-sm` / `rounded-lg` 提供圆角。
`Skeleton`、`Notification`、`Panel` 和不贴外框角的内部形状保留各自圆角，不纳入控件圆角迁移判据。
修法：控件档一律 `rounded-[var(--radius-control)]`。
这和 §二 记的 `--elevation-dialog` 一度没有消费方是同一类问题的两个实例：
**新增角色时必须同时接上消费方，否则设计意图只留在变量表里。**

**45. `backdrop-filter` 的 SVG 位移会让背景纹理看起来错位**
现象：浮层的几何边界和列表项都对齐，但压在高对比条纹、表格或正文上时，边缘附近的背景纹理出现阶梯、挤压或偏移；用户通常会描述为「模糊背景位置错了」。
根因：`backdrop-filter` 链里的 `url("#...")` 不只是模糊。`feDisplacementMap` 会按元素局部位移图移动 backdrop sample；`scale` 越大，边缘的挤压越明显。它不改变浮层 DOM 的矩形，也不是 padding、圆角或滚动层错位。nbook 的 `nbook-lens` / `nbook-lens-sm` 分别是 30 / 14 的既定折射档。
判据：固定一张高频背景，把浮层内容、边框和阴影暂时隐藏，分别对照 `backdrop-filter: none`、`blur(0)` 与 `blur(0) url("#主题滤镜")`。若只有带 `url()` 的组在浮层边缘移动纹理，而三组浮层矩形相同，就归类为折射采样位移；必须以截图判定，不能只读计算样式。
修法边界：不要用降低 blur、改变 tint、padding、radius 或浮层结构来掩盖这条现象。用户不接受位移观感时，进入主题折射配方评审，保留纯 blur 基线；组件层不做补偿。

### B. DOM / 组件

**9. 原生 `<select>` 的弹出列表由操作系统绘制**
现象：整套主题只到控件本身为止，一点开就露出一个系统菜单。
根因：不是样式没调好，是原生控件的硬边界——任何 CSS 都够不着那个列表。
判据：`document.querySelector("[role='listbox']")` 能查到 ⇒ 不是原生。
查不到就说明列表根本不在页面里。

**10. 弹出层原地绝对定位，一定会被 `overflow: hidden` 的祖先切掉**
现象：时间选择器摆进面板里只露出顶上一条边。
根因：面板为了圆角本来就得 `overflow: hidden`。同一个原因还会让弹出层被祖先的
`backdrop-filter` 圈成 backdrop root，自己的磨砂采不到页面背景。
判据：**只能用命中测试，不能用 `getBoundingClientRect()`**——后者不反映裁剪，
被切掉一半的弹出层量出来的位置、尺寸、对齐全是完美的。
在弹出层自己的矩形里取若干点做 `document.elementFromPoint`，命中的元素还在弹出层里才算数。

**11. `scrollIntoView` 会连带滚动所有可滚的祖先**
现象：点开一个下拉，整页跳走。
根因：`scrollIntoView({block: "center"})` 逐层向上滚，不只滚最近的滚动容器。
判据：直接算 `scrollTop = selected.offsetTop − (container.clientHeight − selected.offsetHeight) / 2`。
验收：打开前后 `window.scrollY` 必须不变（且测试前要先让页面处在**非零**滚动位置，
否则这条判据是白测的）。

**12. Reka `SelectValue` 关着的时候是空白的**
现象：没点开过的下拉显示空白，点开选一次之后才正常。
根因：`SelectValue` 的默认文本取自 `SelectItem` 挂载时注册进来的选项表，
而 item 在 portal 里的 `SelectContent` 中——关着时整棵内容树没挂载，选项表是空的。
原生 `<select>` 不会这样，所以照搬原语的默认行为是一处真回归。
判据：持有 options 的组件自己算显示文字，不依赖原语去发现。

**13. `isolation: isolate` 不创建 backdrop root**
现象：为了「隔离」加了 `isolation: isolate`，以为切断了后代的 backdrop 取样。
根因：按 Filter Effects Level 2 §3，触发清单是**根元素、`filter`、`opacity < 1`、`mask*`、
`clip-path`、`backdrop-filter`、`mix-blend-mode`、`will-change`**。
`isolation` 不在其中；`z-index`、`fixed/sticky`、`transform` 也都不触发
（规范特意注明 backdrop root 的触发面比层叠上下文窄）。
判据：真正会切断后代取样的是 `backdrop-filter` 本身。规范目前是编辑草案，以实测为准。

**14. SVG defs 的 id 是文档级全局的**
现象：两套玻璃主题同时装上，其中一套的折射效果变成了另一套的。
根因：`url(#id)` 在文档里解析，两套主题用同名 id 会静默命中先装的那一个，不报错。
判据：所有 defs id 加主题前缀（`nbook-lens` / `nb-lens`）。
装载器已经会拒绝重名（拒绝理由 `svg-defs-id-collides`）。

**15. 真组件必须和对照页吃同一份材料**
现象：对照页里玻璃很漂亮，实际用起来菜单是不透明的。
根因：对照页是手写标记，真组件走的是另一条通路。
判据：任何「材料级」的改动，验收必须在**真组件**上做一遍，不能只看对照页。
本轮就是靠这条发现 `macos` 主题的浮层比它自己的对照页少一层折射。

**24. `overflow` 不要加在浮层本体上**
现象：时间选择器一打开，首项被横着削掉半个字，右边缘的滚动条两头也缺一块，
看起来像描边裂了。
根因：滚动与外观挂在同一个元素上。浮层圆角越大越明显——菜单在 macOS / nbook 下现在独立取 12px，
而 Dialog 仍有自己的大圆角；贴着边缘的滚动条和滚到顶的首项都正好压在那道弧线上。
判据：浮层本体只管外观并 `overflow: hidden`，滚动交给内部一层，并让它比外框缩进一圈；
内层半径统一从 `--nb-popover-inner-radius`（外圈 − 描边 − 内边距）推导。截断本身是滚动列表的正常样子，
问题只在于**截在哪儿**：截在描边上读作「画坏了」，隔着渐隐收进去才读作「上面还有」。
渐隐要 opt-in——菜单多数时候不溢出，无条件加会把首尾两项无缘无故洗淡。

**25. 原语的子组件渲染的是 slot，不是 value**
现象：下拉点开是一片空白，只剩勾选标记；而关着的时候显示一切正常。
根因：`<SelectItemText />` 写成自闭合就没有 slot 内容，每一项都渲染成空白。
触发器上的当前值是组件自己从 `options` 算的（那是坑 #12 的修法），所以关着看不出来。
判据：换原语时，**每一处 slot 都要确认有内容**；原生 `<option>` 自带文字，原语不会替你补。
更要紧的是断言面——见坑 #26。

**32. 常驻的头尾细线把对话框切成三段**
现象：对话框「还是不好看」，读起来像后台管理面板，不像一块面板。
根因：`header` / `footer` 上常驻 `border-b` / `border-t`。
**Apple 的 sheet 平时一条线都不画**，内容滚到标题下面去了才浮出一条——
那条线说的是「上面还有内容」，不是「这里是标题栏」。没有内容可滚时它就不该存在。
判据：分隔线由正文的滚动状态驱动（`scrollTop > 0` / `scrollTop + clientHeight < scrollHeight`），
并且要挂 `ResizeObserver`：只在 `@scroll` 里算的话，一段「打开时是空的、随后异步填满」的内容
永远读到「不用滚」。
断言面**两种状态都要测**：只测「不滚时没有线」的话，把逻辑写死成 `false` 也能过；
只测「能滚时有线」的话，退回常驻细线同样能过。两条合起来才卡得住。

**33. 原语默认按模态处理浮层，一个下拉会把整页锁死**
现象：select 一打开，页面就滚不动了，别的地方也点不动。
根因：Reka 的 `SelectContentImpl` 把 `bodyLock` 和 `disableOutsidePointerEvents`
两个 prop 的默认值都设成 `true`，开着的时候往 `body` 上写 `overflow: hidden`
和 `pointer-events: none`。**对话框那样占据全屏注意力的浮层该这么做，一个下拉不该**：
它是就地展开的一段选项，页面在它背后仍然是活的。
判据：两个都得关，只关一个是半吊子——只关 `body-lock` 页面能滚但仍然点不动，
只关 `pointer-events` 能点但滚不动。关掉之后位置由 popper（floating-ui）维持，
页面滚动时浮层跟着触发器走，不会掉队（实测滚 300px 后触发器底边 587 / 浮层顶边 591）。
断言面：用例里先断言「列表真的开着」再断言 `document.body.style` 两条为空，
否则浮层根本没打开也会假绿。

**34. 内联 `:style` 写死的背景，做不出任何 `:hover`**
现象：时间选择器的选项点得动，但鼠标划过去一点反馈都没有。
根因：外观整套写在 `:style` 里。**内联样式的优先级压过任何类**，
于是 `.nb-time-option:hover { background: … }` 写了也白写。
判据：会有交互态的元素，外观走类不走内联；选中态同样走类——它要和 hover 在同一套层叠里比大小。
排在 hover 之后且同为单类选择器的话，选中态照样赢，hover 只在未选中项上看得出来，
而这正好是想要的（「当前值」不需要靠 hover 再强调一次）。
实测判据：`getComputedStyle` 读 hover 前后的 `backgroundColor`，
从 `rgba(0, 0, 0, 0)` 变成 `--bg-hover` 的实色才算数。

**35. 照着 Web 的模态盒子做，怎么调都还是个盒子**
现象：对话框的留白、圆角、玻璃、分隔线一轮一轮调，用户仍然说「还是不好看」「没有学到精髓」。
根因：调的是**盒子的参数**，而形态本身是 Web / Bootstrap 的：标题条 + 正文 + 按钮条，
右上角一个 ×，标题比正文大一号，按钮右对齐。Apple 的 alert 与 sheet 一条都不是这样
（实测见「对话框不是三段式盒子」那节）。参数调得再准，读出来的仍然是三个堆叠的条。
判据：**先看解剖，再看取值。** 三个可证伪的问题——头尾有没有自己的 padding？
标题和正文是不是同字号？有没有 ×？三条里中一条，就还是那个盒子。
`getComputedStyle(panel).padding` 读到一个值、而 header/footer 的 style 里没有 `padding`，
才算留白归了容器。

**36. 拿旧版 HIG 的记忆当规范，会把已经变了的东西写进注释**
现象：库里注释写着「Apple 只在 Large / X-Large 才走 capsule，全部 pill 化会显得松散」，
于是对话框按钮一直是 10px 圆角。
根因：那是更早的目测印象，不是当前规范。Apple 官方 macOS 27 UI Kit 的 Buttons 组里，
从 Mini（41×16）到 XL（66×36）**全部是整颗胶囊**。
判据：凡是写进注释、又会被后来的人当依据的取值，必须能指到**可复查的出处**。
Sketch Cloud 上那份官方分享件带 Inspect，能逐层读出 CSS——这类文件比 HIG 正文更能给出数值，
因为 HIG 正文基本不写具体 px。查不到就写「目测决定，没有可引的规范」，别写成有出处的样子。

### C. 探针 / 验收方法

**16. 量「模糊真的渲染了吗」，浮层自己的内容会把结论稀释成 0**
现象：A/B 比较像素方差，读出「细节抹掉 0%」，看起来玻璃完全没生效。
根因：菜单里的三行字、滚轮里的两列数字，在「有玻璃」和「关掉玻璃」两组里都在，
贡献的方差一模一样，把背景那点差异淹没了。
判据：量之前先把浮层的子元素 `visibility: hidden`。同一块玻璃、同一个裁剪区，
一次按现状截图、一次强制 `backdrop-filter: none` 再截图。
修正判据后的真实读数是**抹掉 77–86%**，而不是 0%。

**17. 无头浏览器要先自证会画 backdrop-filter**
现象：怀疑是环境不支持，但没有证据。
根因：无从判断「页面里有东西切断了模糊」和「浏览器根本不画」。
判据：拿一张**最小页面**（一段高频文字 + 一块玻璃，别的什么都没有）单独测一次。
本项目实测：默认 headless、SwiftShader、`--headless=old` 三种都会画，抹掉 95%。

**18. 探针等待必须 ≥500ms**
现象：读到的模糊值介于两个主题之间。
根因：`--motion-fast` 是 90–120ms，120ms 的等待会读到过渡的中间态。
判据：切主题 / 开浮层之后等 ≥500ms 再读。

**19. Chromium 把 `color-mix()` 序列化成 0–1 通道**
现象：算出来的输入框亮度是 0.004，明显不对。
根因：计算值是 `color(srgb 0.94 0.92 0.89 / 0.07)`，通道是 **0–1** 不是 0–255；
而且半透明填充必须先与它所在的面**做 alpha 合成**，才谈得上比亮度。
判据：解析器要认 `color(srgb …)` 与 `rgb(…)` 两种刻度，并实现 `over()` 合成。

**20. Playwright 只能用 Node 跑**
Bun 下 CDP 握手超时。探针脚本一律 `node xxx.mjs`。

**26. 只测关着的状态，测不出弹出层**
现象：下拉的契约用例全绿（id、describedby、invalid、emits、当前值标签都对），
而列表点开是一片空白。
根因：断言面全在关闭态。弹出层的整棵内容树关着时根本没挂载，测了个寂寞。
判据：**每个弹出层组件至少有一条用例把它打开并断言内容**。它被 portal 到 body，
所以要 `attachTo: document.body` 并从 `document` 查，从 wrapper 查不到。
补测试时先把修复退回去跑一遍——**在 bug 上不失败的回归测试不算测试**
（本轮那条退回后读到 `['', '', '']`，正是线上的症状）。

**27. 改了 `src/styles.css` 而页面没变，先看是不是在吃编译产物**
现象：类明明在元素上、规则明明在文件里，计算样式就是不认。
根因：playground 经 Nuxt module 注入的是 `dist/nb-ui.css`，不是源码 CSS。
判据：改完跑 `bun run build:css`；dev server 会缓存旧产物，**还要重启它**。
重启后确认端口——`bun run dev` 会挑第一个空闲端口，主仓的 dev server 停了它就跑去 3000，
而不是你以为的 3003。查一句：页面里有没有哪个 `<style>` 含新规则。

**39. 扫「不许出现字面色」的断言会被自己的注释绊倒**
现象：`themes/*/vars.css` 的字面色检查突然红了，报的是 `#DBDBDB` / `#A6A6A6` / `#676767`——
而这几个值一个都不在声明里，全在**解释取值来源的注释**里。
根因：断言直接对整份文件做正则，没区分声明与散文。
判据：先 `replaceAll(/\/\*[\s\S]*?\*\//g, "")` 再扫。这条规则管的是声明，
而注释里引用原件取值是**证据**——把证据删掉去迁就断言，等于让下一个人重新目测一遍。
同一个形状在 `data-nb-colorway` 那条断言里已经踩过一次，这是第二次。
放宽断言之后**必须红翻转一次**（塞一个真的字面色进声明，确认它仍然失败）。

**41. 后台标签页的截图是上一帧，探针会静默报告交互前的状态**
现象：点开 Dialog、右键菜单，截出来的图和交互前**逐像素相同**；
而同一个脚本里 `page.evaluate` 读到的矩形、`opacity`、`visibility`、`display` 全部正常
（实测 `rect {x:430,y:244,w:420,h:232}` / `opacity:"1"` / `visibility:"visible"`）。
根因：Chromium 对**没有前置**的标签页不再合成新帧，`screenshot()` 拿到的是最后一次绘制的结果。
探针开了别的标签页（或浏览器窗口在后台）就会触发。
判据：截图之前先 `await page.bringToFront()`。
一旦「DOM 说它在、图上没有」，先怀疑这条，再怀疑样式——
这个组合最容易被误判成「浮层没渲染」，然后一路去改根本没问题的 CSS。

---

## 九、给 UI agent 的检查表

动完界面，逐条过：
- [ ] 模糊半径克制：真实浮层 `--overlay-blur` 为纯 `blur(8px)`；大容器完整折射强档约 14px（坑 #28 / #45）
- [ ] 分清两件事：**模糊半径决定背后的字读不读得出，tint 与 `brightness` 决定这块面有多不透明**。
      嫌「不通透」时该动的是后者；加半径只会把背后的颜色平均掉，更像塑料板（坑 #28 / #40）
- [ ] 带 `backdrop-filter` 的面**没有** `corner-shape`（Chromium 的裁切不跟随，四角会露月牙，坑 #37）
- [ ] 小浮层不接 `url(#...)` 位移滤镜；固定高频背景对照时，浮层的 `none` / `blur-only` 应保持纹理位置，
      完整 `lens` 只在大容器单独验收（坑 #45）
- [ ] 镜面高光只画在整块玻璃的轮廓上，没画在方角子分区上
- [ ] 折射走 `@supports`，退化后纯 blur 的基线仍成立
- [ ] 滤镜链里 `url()` 排在 `blur()` **之后**（顺序反了模糊会静默失效，见坑 #21）

**阴影**
- [ ] 外阴影只有两条：一条 blur ≤ 1px 的发丝轮廓 + 一条 blur ≥ 40px 的环境投影。
      出现第三条 blur 落在 4–20px 的，就是 Material 那套多层递增投影（坑 #38）
- [ ] 内边线上下**对称**，不是「顶白底黑」；入射光另由一条单独的顶高光表示
- [ ] 暗色下轮廓与内边线**改为提亮**（压暗的边在暗面上等于没画），环境投影加重约一倍
- [ ] 对话框吃的是 `--elevation-dialog` 而不是浮层档——两者的环境投影按 Apple 实测差一倍
- [ ] 浮层的高光在**边上**，不在面上：`--overlay-sheen` 喂 `none`，靠 `--elevation-popover`
      里的顶内线（坑 #40）。面上铺渐变会被读成「盖了一层渐变」而不是一块玻璃
- [ ] 玻璃对话框的遮罩是淡的——重遮罩会把玻璃能采的东西先抹掉（坑 #30）
- [ ] 要看玻璃的页面铺了 `--window-backdrop`，不是一片纯色

**颜色**
- [ ] 主题文件里没有字面颜色（纯白 / 纯黑的低透明度叠层除外）
- [ ] 暗色分支挂 `[data-nb-appearance]`，不是 `[data-nb-colorway]`
- [ ] 输入框亮度与面板同侧，亮暗两档都成立
- [ ] 状态色按语义用，没有拿 accent 当 info 使
- [ ] 浮层里的高亮 / 选中底色取 `--overlay-item-active`，不是 `--bg-hover`——
      玻璃上的不透明高亮是一块挖进材料里的补丁（坑 #43）。判据：读到的 alpha < 1
- [ ] 明暗通吃的叠层从 `--text-main` 派生（暗色提亮、亮色压暗，一条声明两边都对），
      不写死白或黑

**几何**
- [ ] 控件外框圆角一律 `rounded-[var(--radius-control)]`；不贴外框角的内部形状和 Skeleton / Notification / Panel 的独立圆角不纳入此项——
      写死的 Tailwind 常量不能让 `--radius-control` 负责控件外框（坑 #44）
- [ ] 贴着外框四角的内层形状（浮层里的项、分段控件的段）按
      `外框 − 描边 − 内边距` 推半径，且用 `max()` 兜底（负半径会让整条声明作废，变方角）
- [ ] 不贴角的内层形状（文件树的箭头、芯片、复选框）保持自己的圆角，不必套这条式子

**排版**
- [ ] 字体栈拉丁在前、CJK 在后，三大平台各有一条回退
- [ ] 字距为 0，没有给汉字上负字距
- [ ] 强调用楷体，没有用 `font-style: italic`

**动效**（合同见 §七）
- [ ] 时长按语义选档：状态反馈 `--motion-fast`、控件形变 `--motion-base`、浮层入场 `--motion-enter`，
      没有写死的 `duration-*` / `0.15s` / `cubic-bezier(...)` 字面量（静态扫描归零）
- [ ] 没有 `transition-all` / `transition: all`；transition 属性列表显式
- [ ] 缓动只消费 `--ease-standard`

**弹出层**
- [ ] 传送到 body（`Teleport` 或原语的 Portal），不是原地绝对定位
- [ ] 点外面能关，且**不回滚值**（回滚是 Esc 的语义）
- [ ] 打开时 `window.scrollY` 不变
- [ ] 关闭后焦点回到触发器（点外面关闭除外——那时不要抢焦点）
- [ ] `overflow` 在内部滚动层，不在浮层本体上；滚动区比外框缩进一圈
- [ ] 列表项 / 菜单项挂 `.nb-ui-popover-item`，没有自己写 `rounded-*`——
      圆角要与外框同心，写死的小半径在角上会被挤没（坑 #42）
- [ ] 有一条用例把它**打开**并断言里面的内容，不是只测关闭态
- [ ] 非模态的浮层（下拉 / 菜单）关掉了原语的 `body-lock` 与 `disable-outside-pointer-events`——
      默认值都是 true，开着的时候整页既不能滚也不能点（坑 #33）
- [ ] 有交互态的选项外观走类不走内联 `:style`，否则 `:hover` 永远做不出来（坑 #34）
- [ ] 浮层有入场 / 退场过渡（入场 enter 档 = opacity + scale，退场 fast 档），
      缩放原点消费 Reka 的 `--reka-*-content-transform-origin`，不是自己推方向（§七）
- [ ] 对话框的头尾没有常驻细线，分隔由滚动状态驱动（坑 #32）

**对话框的解剖**（三条里中一条就还是个 Web 盒子，见坑 #35）
- [ ] 留白在**面板**上，header / footer 自己没有 padding——不是三段各自持有配额
- [ ] 标题与正文**同字号**，只差字重和颜色，不是 16px 标题配 14px 正文
- [ ] 默认**没有 ×**；出口是一颗有名字的按钮
- [ ] 按钮是胶囊、高度落在 Apple 的刻度上（Mini 16 / Sm 20 / Rg 24 / Lg 28 / XL 36）
- [ ] 窄框（决定）按钮平分整行，宽框（表单）按钮右对齐
- [ ] 遮罩只压暗、不预模糊——重遮罩会把玻璃能采的东西先抹掉（坑 #30）

**无障碍**
- [ ] 三个 media query 都写了，且主题自己新增的动效 / 透明度变量自己关掉了
- [ ] 三个 media query 的选择器带了 `[data-nb-appearance]` 并排在明暗分档**之后**——
      否则它们在暗色下一次都不会生效，而且不报任何错（坑 #31）
- [ ] 焦点环可见，Tab 没有被拦截

**验收**
- [ ] 判据读的是**元素的计算样式**，不是根上的变量
- [ ] 涉及模糊的判据做了 A/B，且量之前隐藏了浮层自己的内容
- [ ] 模糊这一项**看过图**：计算样式合法但画不出来是真实存在的一档（坑 #21）
- [ ] 截图之前 `page.bringToFront()` 了——后台标签页返回的是上一帧，
      「DOM 说浮层在、图上没有」多半是这个而不是样式（坑 #41）
- [ ] 涉及裁剪的判据用命中测试，不是 `getBoundingClientRect()`
- [ ] 切主题 / 开浮层后等了 ≥500ms
- [ ] 改过 `src/*.css` 的话跑了 `build:css` 并重启了 dev server
- [ ] 主题 × 配色两轴都跑过，包括「一个主题都没装」这一档
- [ ] 无障碍那三档在**暗色**下也实测过，不是只看亮色（坑 #31）
