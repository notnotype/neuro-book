/**
 * Monaco 的主题（docs/specs/workbench/editor.md 输出 65，docs/specs/theme/system.md）：底色、前景、选区与语法着色都取自文档根上
 * 当前产品主题的变量，明暗按文档根的 `color-scheme`。主题或明暗变了重新生成。
 *
 * 不继承 Monaco 自带的 `vs`、`vs-dark`（`inherit: false`）：继承带来的是它为白底、黑底配的五十来条专门规则，要逐条压掉；
 * 不继承时只有下面这张表，没写到的成分落到前景色。`base` 仍然决定查找框这些部件按明还是暗取 Monaco 的缺省色。
 */

import type * as Monaco from "monaco-editor/esm/vs/editor/editor.api.js";

export const MONACO_THEME = "nbook";

/** 一条着色规则：Monaco 按点号分段的前缀匹配，`string` 管全部 `string.*`，除非另有更具体的一条。 */
export interface SyntaxRule {
    readonly token: string;
    /** 颜色取哪个变量；只改字形的规则没有。 */
    readonly color?: string;
    readonly fontStyle?: "italic" | "bold" | "underline";
}

/**
 * 语法成分到主题变量（nb-ui 的 `--syntax-*`）的归类。token 名来自 Monaco 各语言的 Monarch 语法：没有统一的词表，
 * 这里列的是它们共用的那些前缀。
 */
export const SYNTAX_RULES: ReadonlyArray<SyntaxRule> = [
    {token: "comment", color: "--syntax-comment"},
    {token: "keyword", color: "--syntax-keyword"},
    {token: "string", color: "--syntax-string"},
    // JSON 的键是 `string.key.json`：按属性名着色，和字符串值分开。
    {token: "string.key", color: "--syntax-attribute"},
    {token: "string.escape", color: "--syntax-regexp"},
    {token: "regexp", color: "--syntax-regexp"},
    {token: "number", color: "--syntax-number"},
    {token: "constant", color: "--syntax-number"},
    {token: "type", color: "--syntax-type"},
    {token: "namespace", color: "--syntax-type"},
    {token: "annotation", color: "--syntax-type"},
    {token: "tag", color: "--syntax-tag"},
    {token: "metatag", color: "--syntax-tag"},
    {token: "attribute.name", color: "--syntax-attribute"},
    {token: "attribute.value", color: "--syntax-string"},
    {token: "variable", color: "--syntax-variable"},
    {token: "delimiter", color: "--syntax-punctuation"},
    {token: "operator", color: "--syntax-punctuation"},
    {token: "invalid", color: "--status-danger", fontStyle: "underline"},
    {token: "emphasis", fontStyle: "italic"},
    {token: "strong", fontStyle: "bold"},
];

type Rgba = readonly [number, number, number, number];

/** 读不出颜色时的记号：任何主题都不会用到的一个颜色，计算样式里原样回读。 */
const SENTINEL = "rgb(1, 2, 3)";

const byte = (value: number): string => value.toString(16).padStart(2, "0");

/**
 * 把一个 CSS 颜色表达式（多半是 `var(--x)`）算成 Monaco 认的十六进制。两步：先放到一个挂在页面里的元素的 `color` 上读
 * 计算值，`var()`、`light-dark()`、`color-mix()` 由浏览器解掉；再把计算值填进 1×1 的画布读回像素，`rgb()`、`rgba()`、
 * `color(srgb …)`、`oklch()` 各种写法都落成 8 位的 RGBA。直接读自定义属性拿到的是没算过的原文，换算不了。
 */
function createColorReader(owner: Document): {read(expression: string): Rgba | null; dispose(): void} {
    const probe = owner.createElement("span");
    probe.style.display = "none";
    owner.body.append(probe);
    const canvas = owner.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const context = canvas.getContext("2d", {willReadFrequently: true});
    return {
        read: (expression) => {
            if (context === null) return null;
            // 先放一个哨兵色：表达式写错（这一行不生效）或变量不存在（`var()` 在计算时无效，继承正文色），读到的都不是
            // 想要的颜色，有哨兵垫底才认得出来、改用后备色。
            probe.style.color = SENTINEL;
            probe.style.color = expression.replace(/^var\((--[\w-]+)\)$/u, `var($1, ${SENTINEL})`);
            if (getComputedStyle(probe).color === SENTINEL) return null;
            context.clearRect(0, 0, 1, 1);
            context.fillStyle = getComputedStyle(probe).color;
            context.fillRect(0, 0, 1, 1);
            const [red = 0, green = 0, blue = 0, alpha = 0] = context.getImageData(0, 0, 1, 1).data;
            return [red, green, blue, alpha];
        },
        dispose: () => probe.remove(),
    };
}

export function buildMonacoTheme(root: HTMLElement): Monaco.editor.IStandaloneThemeData {
    const style = getComputedStyle(root);
    const dark = style.colorScheme.includes("dark") || root.dataset.nbAppearance === "dark";
    const reader = createColorReader(root.ownerDocument);
    /** 不透明的颜色：`#rrggbb`。变量没有或换算不了时用 `fallback`。 */
    const solid = (name: string, fallback: string): string => {
        const color = reader.read(`var(${name})`);
        return color === null || color[3] === 0 ? fallback : `#${byte(color[0])}${byte(color[1])}${byte(color[2])}`;
    };
    /** 可以半透明的颜色（选区）：`#rrggbbaa`。 */
    const translucent = (name: string, fallback: string): string => {
        const color = reader.read(`var(${name})`);
        return color === null || color[3] === 0 ? fallback : `#${color.map(byte).join("")}`;
    };
    try {
        // 与 Markdown 稿纸同一档（docs/specs/theme/system.md）：编辑组的面是 `--panel-surface`，自带主题里它就是 `--bg-panel`。
        // 读配色变量、不读面变量：编辑内核要不透明的颜色，面变量在别的主题里可以是半透明的。
        const background = solid("--bg-panel", dark ? "#1f1f1f" : "#ffffff");
        const foreground = solid("--text-main", dark ? "#e6e6e6" : "#1f2328");
        const muted = solid("--text-muted", dark ? "#8b949e" : "#6e7781");
        return {
            base: dark ? "vs-dark" : "vs",
            inherit: false,
            rules: [
                {token: "", foreground: foreground.slice(1), background: background.slice(1)},
                ...SYNTAX_RULES.map((rule) => ({
                    token: rule.token,
                    ...(rule.color === undefined ? {} : {foreground: solid(rule.color, foreground).slice(1)}),
                    ...(rule.fontStyle === undefined ? {} : {fontStyle: rule.fontStyle}),
                })),
            ],
            // 失焦的选区与“相同内容”的高亮不写：不继承基底时 Monaco 由选区色派生它们。
            colors: {
                "editor.background": background,
                "editor.foreground": foreground,
                "editorGutter.background": background,
                "editorLineNumber.foreground": muted,
                "editorLineNumber.activeForeground": foreground,
                "editorCursor.foreground": solid("--accent-main", "#3b82f6"),
                "editor.lineHighlightBackground": solid("--bg-hover", dark ? "#2a2a2a" : "#f3f4f6"),
                "editor.selectionBackground": translucent("--selection-bg", dark ? "#264f78" : "#add6ff"),
                "editorIndentGuide.background1": solid("--border-color", dark ? "#404040" : "#d3d3d3"),
                "editorIndentGuide.activeBackground1": solid("--border-strong", dark ? "#707070" : "#939393"),
            },
        };
    } finally {
        reader.dispose();
    }
}
