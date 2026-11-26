# 品牌标志

登录页与注册页表单下面的两枚社交图标（t10 计划 3.7；审定 D3：位置与大小照 t09 定稿，画法照两家的品牌规范）。文件从两家的官方压缩包里原样拷出，不改形、不改色；要换版本时重新下载、整份替换，并更新下表。用法在 `components/SocialButtons.vue`。

| 文件 | 来源 | 压缩包里的路径 | 取的日期 |
|---|---|---|---|
| `google-light.svg` | `https://developers.google.com/static/identity/images/signin-assets.zip`（sha256 `ba884069…1da1`） | `Android + Web/SVG/Light/Theme=Light, Show text=No, Shape=Square, Platform=Android+Web.svg` | 2026-11-26 |
| `google-dark.svg` | 同上 | `Android + Web/SVG/Dark/Theme=Dark, Show text=No, Shape=Square, Platform=Android+Web.svg` | 2026-11-26 |
| `github-invertocat-black.svg` | `https://brand.github.com/GitHub_Logos.zip`（sha256 `e2a67d6c…3194`） | `GitHub Logos/SVG/GitHub_Invertocat_Black.svg` | 2026-11-26 |
| `github-invertocat-white.svg` | 同上 | `GitHub Logos/SVG/GitHub_Invertocat_White.svg` | 2026-11-26 |

依据的规范页面：

- Google：`https://developers.google.com/identity/branding-guidelines`。只有“G”的按钮可以用，但要有按钮的边界并表明是登录的动作；“G”只用标准的全彩版。按钮只许三种底：亮色白底配 1px `#747775` 描边、暗色 `#131314` 底配 1px `#8E918F` 描边、中性 `#F2F2F2` 不描边。2026 年的素材包里没有单独的“G”，只有整枚按钮（底、描边与“G”都在里面），所以直接用整枚按钮的图，亮暗各一份。
- GitHub：`https://brand.github.com/foundations/logo`。Invertocat 只用黑、白两色（少数场合灰或绿），不改色、不变形、不加阴影。GitHub 没有规定登录按钮的画法，这里套用 Google 那枚按钮同样的底与描边，两枚图标是同一种画法（t09 第 10 条）。

没核实：Google 的“表明是登录的动作”对只有图标、靠悬停提示与读屏名字（“用 Google 登录”）的按钮算不算满足，规范页面没有明说（计划第 9 节 D3 记下的退路是改成带文字的按钮）。
