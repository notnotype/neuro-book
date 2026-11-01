import type {NbThemeManifest} from "../../src/theme/theme-manifest";

/**
 * aurora 是**新增变量**这个能力的第二个用例，也是它的边界证据。
 *
 * 它只多要一样东西：一层窗体底纹（--window-backdrop），用来给多层阴影一个可分层的背景。
 * macOS 那套玻璃也要同一个变量——按 NbThemeVarDeclaration 上写的判据，
 * **两套主题都要用的变量说明配色契约漏了一个角色**，该去补契约而不是各写各的。
 * 这里先各自 declare，把这个信号留在代码里，等阶段 2 一起收口。
 */
export const manifest: NbThemeManifest = {
    id: "aurora",
    name: "Aurora",
    tagline: "现代精致",
    description: "大圆角 8px、不透明的面 + 真正看得见的多层阴影、顶部环境光、双层焦点环。不用磨砂。",
    version: "1.0.0",
    author: "nb-ui",
    hostVersion: "^0.3.0",
    declares: [
        {
            name: "--window-backdrop",
            // 从配色的强调色派生：任意配色下都成立，且换配色时底纹跟着走
            fallback:
                "radial-gradient(72% 48% at 50% -8%, color-mix(in srgb, var(--accent-main) 10%, transparent) 0%, transparent 68%)",
            description: "窗体底纹。给阴影和折射一个可分层的背景，纯色背景上这两者等于零效果。",
        },
    ],
};
