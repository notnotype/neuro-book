import type {NbThemeManifest} from "../../src/theme/theme-manifest";

/**
 * macOS 是**格式天花板**的证据：把每个扩展点都压满——新增变量（各带 fallback）、
 * 自带亮暗两套配色、带 SVG 资源、（批 5 起）覆盖一个组件。
 *
 * 10 个新变量全部是「派生型」：每个都给了一个能从配色契约算出来的 fallback，
 * 所以别的主题在的时候引用它们不会塌，用户新建配色时也不需要为 macOS 填任何东西。
 * 玻璃那 8 个的 fallback 大多是 `none`——正确的兜底不是「差一点的玻璃」而是「没有玻璃」，
 * 半透明糊在纯色上只会得到一层脏膜。两个 --chrome-* 的 fallback 则是「归标题栏」，
 * 也就是没有主题时的默认窗口形态。
 */
export const manifest: NbThemeManifest = {
    id: "macos",
    name: "macOS",
    tagline: "Liquid Glass",
    description: "分层通透：窗体底纹透出来，侧栏比内容区更透，浮层最透；控件反而是实心的。密度高。",
    version: "1.0.0",
    author: "nb-ui",
    hostVersion: "^0.3.0",
    declares: [
        {
            name: "--glass-blur",
            fallback: "none",
            description: "导航面的磨砂配方（blur + 饱和 + 明度）。没有玻璃主题时就该是 none。",
        },
        {
            name: "--glass-blur-strong",
            fallback: "none",
            description: "菜单、对话框这类大容器的磨砂配方，比 --glass-blur 更重。",
        },
        {
            name: "--glass-lens",
            fallback: "none",
            description: "带边缘折射的完整配方，含 url(#nb-lens-sm)。只有 Chromium 支持，@supports 分支专用。",
        },
        {
            name: "--glass-lens-strong",
            fallback: "none",
            description: "大容器的折射配方，含 url(#nb-lens)。",
        },
        {
            name: "--glass-rim",
            fallback: "none",
            description: "镜面高光层（background-image）。替代固定白边：白边在浅底上消失、在深底上过亮。",
        },
        {
            name: "--glass-rim-inset",
            fallback: "none",
            description: "沿轮廓的内阴影，与 --glass-rim 配套画出玻璃的厚度。",
        },
        {
            name: "--glass-lift",
            fallback: "none",
            description: "交互时的抬起变换。Apple 的说法是控件会 flex / lift / 短暂浮起。",
        },
        {
            name: "--window-backdrop",
            // 与 aurora 声明的是同一个变量，见 themes/aurora/manifest.ts 里的说明
            fallback: "none",
            description: "窗体底纹。折射与磨砂作用在纯色上等于零效果，所以玻璃主题必须自带一层。",
        },
        {
            name: "--chrome-surface",
            /*
             * 窗口左上角那一格归谁：默认归标题栏——于是标题栏从左到右连成一条横带，
             * 侧栏从它下面开始。Windows / Linux 桌面应用、VS Code、当前 NeuroBook 都是这样。
             */
            fallback: "var(--toolbar-surface)",
            description:
                "窗口左上角那一格的面。macOS 原生窗口把它判给侧栏，于是侧栏从窗口顶端一路通到底、"
                + "工具栏只盖住内容区；默认判给标题栏，于是标题栏是一条全宽横带。"
                + "这是桌面应用最主要的一处布局差异，且只是归属不同，不是两套 DOM。",
        },
        {
            name: "--chrome-seam",
            /* 与 --chrome-surface 配套：那一格和谁连成一片，分隔线就画在另一边 */
            fallback: "0 1px 0 var(--divider)",
            description: "窗口左上角那一格的分隔线。归标题栏时画在下边，归侧栏时画在右边。",
        },
    ],
    providesColorways: ["macos-light", "macos-dark"],
    defaultColorway: {light: "macos-light", dark: "macos-dark"},
};
