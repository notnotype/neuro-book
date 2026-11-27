# 品牌标志

登录页与注册页表单下面的两枚社交图标（t10 计划 3.7；审定 D3：位置与大小照 t09 定稿，画法照两家的品牌规范）。文件从两家的官方素材里原样取出，不改形、不改色；要换版本时重新取、整份替换，并更新下表。用法在 `components/SocialButtons.vue`。

| 文件 | 来源 | 位置 | 取的日期 |
|---|---|---|---|
| `google-g.svg` | `https://developers.google.com/identity/branding-guidelines` | “Render HTML Button Element”一节内嵌的按钮代码：四条彩色 `path` 与一条透明的占位 `path`，`viewBox="0 0 48 48"` | 2026-11-27 |
| `github-invertocat-black.svg` | `https://brand.github.com/GitHub_Logos.zip`（sha256 `e2a67d6c…3194`） | `GitHub Logos/SVG/GitHub_Invertocat_Black.svg` | 2026-11-26 |
| `github-invertocat-white.svg` | 同上 | `GitHub Logos/SVG/GitHub_Invertocat_White.svg` | 2026-11-26 |

依据的规范页面：

- Google：`https://developers.google.com/identity/branding-guidelines`。只有“G”的按钮可以用，但要有按钮的边界并表明是登录的动作；“G”只用标准的全彩版。按钮只许三种底：亮色白底配 1px `#747775` 描边、暗色 `#131314` 底配 1px `#8E918F` 描边、中性 `#F2F2F2` 不描边。“G”占 40px 按钮里 20px 见方（同一段按钮代码的 `.gsi-material-button-icon`）。
  2026 年的素材包（`signin-assets.zip`）里没有单独的“G”，只有整枚按钮的图，而那份图的彩色部分是 `foreignObject` 里的 CSS 渐变加模糊滤镜，作为 `<img>` 引入时 WebKit 是否画得出没有把握（B4 审查第 22 条）。所以改用规范页按钮代码里的纯路径“G”，底与描边由 CSS 照上面的数值画，亮暗共用一份图。
- GitHub：`https://brand.github.com/foundations/logo`。Invertocat 只用黑、白两色（少数场合灰或绿），不改色、不变形、不加阴影。GitHub 没有规定登录按钮的画法，这里套用 Google 那枚按钮同样的底与描边，两枚图标是同一种画法（t09 第 10 条）。

没核实：Google 的“表明是登录的动作”对只有图标、靠悬停提示与读屏名字（“用 Google 登录”）的按钮算不算满足，规范页面没有明说（计划第 9 节 D3 记下的退路是改成带文字的按钮）。
