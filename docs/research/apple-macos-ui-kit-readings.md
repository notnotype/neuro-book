# Apple macOS UI Kit 读数与平台引文（nb-ui 设计语言的外部依据）

状态：资料整理，非规范。本文从 [`packages/nb-ui/docs/design-language.md`](../../packages/nb-ui/docs/design-language.md) 迁出，原先散在其“材料与层级”“几何”“无障碍”“踩过的坑”各节里。

## 问题

nb-ui 的设计语言里有若干取值和判据引用了外部资料：Apple 官方 macOS 27 UI Kit 的图层读数、各平台设计系统的原话、Chromium 提交记录、公开性能实测。这些资料需要有一个可复查的落脚处，设计语言正文只留结论。

## 日期与核对状态

- 迁出日期：2026-11-04。
- 各条读数最早出现在设计语言文档里的日期：2026-08-17（仓库导入提交，之前的写入日期没有保留）；“为什么材质只能有一层”的四条来源在 2026-09-02 的提交里改写过。
- 本次迁移没有重新打开原网页或 Sketch Cloud 分享件，下面的数值和引文是迁移时从设计语言原文抄来的。逐条标注的“证据等级”是它们当初被记录时的来源类型，不是本次重新核对的结果。需要作为依据时，先回到原出处复查。

## 证据等级

| 等级 | 含义 |
| --- | --- |
| 官方文件读数 | 从官方发布的设计文件（Sketch Cloud 分享件，Inspect 模式）读出的 CSS，一手 |
| 官方文档 | 平台厂商的设计指南或规范原文 |
| 规范草案 | W3C 编辑草案与议题 |
| 源码或提交记录 | 浏览器或框架的提交说明 |
| 第三方实测 | 公开的性能文章或开源实现，二手 |
| 项目实测 | 在本仓库 Chrome 实测得到，见设计语言“踩过的坑” |

## 一、Apple macOS 27 UI Kit

来源：Sketch Cloud 公开分享件 <https://www.sketch.com/s/57153a31-3379-4737-8ac6-dbfd6525f052>（Apple 官方 macOS 27 UI Kit），在 Inspect 模式下逐图层导出 CSS。证据等级：官方文件读数。

### 1.1 Materials 页：Liquid Glass 的阴影图层

图层样式 `This Document/Liquid Glass/Light` 与 `…/Dark`。

```
/* Light · Regular - Large，580×400，Radius 20 Smooth Apple 60% */
-1.25px 0    0     -0.75px  #DBDBDB
 1.25px 0    0     -0.75px  #DBDBDB
 0      0    0.3px  0.3px   #DBDBDB
 0      18px 48px   0       rgb(0 0 0 / .25)
 0      2px  0.25px -1.5px  inset #FFFFFF
 0     ±1px  1.5px  -0.5px  inset #272727
 0     ±4px  8px    -4px    inset #272727

/* Dark · Regular - Medium，Popover 240.5×230：同构，只换取值 */
轮廓 #A6A6A6 ／ 环境投影 rgb(0 0 0 / .45) ／ 内边线 #676767 ／ 顶高光 #FFFFFF 20%
```

各层的读法（设计语言当时据此做的归纳，不是 Apple 的原话）：

- 前两条是左右两道竖边缘光；第三条 `0 0 0.3px 0.3px` 是一圈发丝轮廓。
- 第四条是文件里唯一的外环境投影。
- 第五条是顶部 inset 白线，第六、七条是上下对称的 inset 内边线。
- 暗色档同构，轮廓、内线、投影的取值都换成更亮或更重的值。

补充读数：

- 浮层档的环境投影是 `0 18px 48px`；Dialogs 页的 Save Dialog 是 `0 0 1px rgb(0 0 0 / .8), 0 36px 100px rgb(0 0 0 / .4)`。后者的读数记录于更早一次对同一份文件的读取。
- 原件外阴影使用 Plus darker 混合模式，CSS `box-shadow` 只有 normal。
- 原件按 2x 稿面绘制，`0.3px` 在 1x 屏幕下只剩抗锯齿。
- 页面中没有出现面渐变的图层；入射光只有一条顶部 inset 内发丝线。

### 1.2 圆角

- Materials 页的 Regular - Large 是 `Radius 20`，Smooth，Apple 60%。
- Dialogs 页的 Save Dialog 记作 `Radius 26`，Smooth，Apple 60%。
- “Smooth Apple 60%”即曲率连续的圆角（超椭圆一类）。Apple 没有公布 blur 半径、折射率这类数值（设计语言原文：所有取值都是视觉近似）。

### 1.3 Dialogs 页：Alert 与 Save Dialog

| | Alert（Side by Side） | Save Dialog |
| --- | --- | --- |
| 尺寸 | 260 x 170 | 390 x 318 |
| 布局 | `flex column; gap: 14px` | `flex column; gap: 20px` |
| 留白 | `padding: 20px 16px 16px` | `padding: 20px`（四边等距） |
| 圆角 | 未记录 | `26px`，Smooth，Apple 60% |
| 面 | Style = Glass | `rgba(255,255,255,1)`，不透明 |
| 阴影 | 未记录 | `0 0 1px rgb(0 0 0 / .8), 0 36px 100px rgb(0 0 0 / .4)` |
| 标题 | SF Pro Bold 13px，行高 16 | SF Pro Bold 14px，行高 17 |
| 正文 | SF Pro Regular 13px，行高 16 | SF Pro Medium 11px，行高 14 |
| 标题与正文间距 | 段后 8px | `gap: 6px` |
| 按钮 | 110 x 28，`gap: 8px`，平分整行 | 76 x 24，右对齐 |
| 关闭按钮 | 没有 | 没有 |

### 1.4 Buttons 组

- 高度刻度：Mini 16、Small 20、Regular 24、Large 28、XL 36。
- 外形：Mini（41 x 16）到 XL（66 x 36）全部是整颗胶囊。
- nb-ui 的 Button 不取这组读数：按钮高度来自主题的 `--control-h-*`，圆角用 6、8、10px 的定值（`packages/nb-ui/src/components/controls/Button.vue`）。

### 1.5 其他

- sheet 的分隔线：Apple 的 sheet 平时不画头尾分隔线，内容滚到标题下面才浮出一条。依据来自设计语言当时对 Dialogs 页与系统 sheet 的观察，未保存单独的图层读数。
- Apple 官方对嵌套圆角的落点是 UIKit 的 `containerConcentricRadius` 与 SwiftUI 的 `ConcentricRectangle`（半径随嵌套层次自动递减）。“子半径等于父半径减内边距”这条具体公式不是 HIG 原文。证据等级：官方文档（API 名称），公式部分为项目自己的近似。
- Apple 为 Liquid Glass 提供 Reduce Transparency 与 Increase Contrast 两个系统开关。
- 暗色下的 Liquid Glass：tint 换低亮度变体、提亮环境边缘光、加重外阴影（设计语言原文转述 Apple 的暗色规范，未保留原文链接）。

## 二、平台厂商对“材质只能有一层”的原话

证据等级：官方文档，引文逐字抄自设计语言原文。

- 微软（Windows 材质指南）：`"Don't apply backdrop material more than once in an application."` 替代做法是在底下那层材质上叠一层低透明度纯色（`LayerFillColorDefaultBrush`）。
- 苹果（Liquid Glass）：`"avoid overcrowding or layering Liquid Glass elements on top of each other."` 以及 `"Don't use Liquid Glass in the content layer."`
- CSS 规范（Filter Effects Level 2，backdrop root 一节）：`"Each nesting level will double the number of these required re-paint cycles"`，规范原话描述的是指数级劣化。证据等级：规范草案。
- 嵌套语义：w3c/fxtf-drafts#500 记录了嵌套 `backdrop-filter` 的语义没有定死，Gecko 与 Chromium/WebKit 渲染结果不同，议题中有实测称 Chromium 不让子元素生效。证据等级：规范草案议题与第三方实测。
- 附带的会出 bug 的机制：`backdrop-filter` 为 `position: fixed` 后代创建包含块，开了毛玻璃的面板里 fixed 定位的下拉、Toast、对话框会被关在面板里。
- WebKit：`backdrop-filter` 里的 `url()` 滤镜引用只有 Chromium 支持，WebKit bug 245510 长期未解（出自设计语言原文）。

## 三、层级色阶不带模糊的参照

证据等级：官方文档，引文逐字抄自设计语言原文。

- Material Design 3 与 IBM Carbon 的层级是不透明色阶，没有模糊概念。Carbon 浅色主题在两档灰之间交替，深色主题每层变亮。
- 微软：`"In both light and dark color modes, darker colors indicate background surfaces of less importance."` 暗色下上层也变亮。
- Material Design 3 把面色与 elevation 解绑，官方说明：`"The new color roles are not tied to elevation"`。

## 四、Chromium 提交记录：窗口圆角

- 提交记录写明 macOS 12 到 15 的窗口圆角用 9pt，macOS 26 Tahoe 用 20pt；Electron 为对齐 Tahoe 取 24pt。证据等级：源码或提交记录。
- 提交号没有保留。Apple 没有公布这个数。
- nbook 主题的 `--radius-panel` 取 20px（`packages/nb-ui/themes/nbook/vars.css`），设计语言原文把它的出处指向这条提交记录；`macos` 主题保留更早的目测值 18px。

## 五、性能降级的公开实测

证据等级：第三方实测，未在本仓库复现。

- HyperFrames 性能指南：8 层半径 1、2、4、8、16、32、64、128px 的 blur，在 1920 x 1080 区域、中端 GPU 上可轻易吃掉每帧 200ms，并建议避开大面积的 `blur(64px)` 与 `blur(128px)`。
- 开源实现 glassfx：在宽度小于 768px 时直接丢弃折射。
- 项目内的窄屏降级写在 `packages/nb-ui/themes/nbook/vars.css`，是否与这两条实测一致没有对照过。

## 验证边界

- 本文没有重新访问任何外部页面，见上文“日期与核对状态”。
- Sketch Cloud 分享件可能被更新或下线；读数以迁移时的设计语言原文为准。
- Apple HIG 的中文排版页需要 JS 才能读，Ant Design、Arco、TDesign 的排版规范页取不到正文，所以 nb-ui 里“加一档字号”之类的取值没有可引的规范出处。
- 项目实测部分（Chromium 对 `backdrop-filter` 不认 `corner-shape`，Chrome 151）的记录在设计语言“踩过的坑”的 #37，不在本文。

## 当前状态

- 设计语言正文只保留结论，并链接本文。
- 本文不含推荐与取舍；采用哪些读数由设计语言与各主题的 `vars.css` 决定。
