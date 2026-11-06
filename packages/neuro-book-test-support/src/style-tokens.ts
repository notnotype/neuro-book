/**
 * 前端包的样式 token 检查：扫 Vue 单文件组件的源码文字，找出绕开 nb-ui token 的写法。规则在这里，nb-ui、nb-agent-ui 的
 * 测试共用，各包只写自己的扫描目录与豁免。守的是 nb-ui 规范里能机械检查的几条；为什么这样写见各规则的 reason。
 *
 * 不解析语法树，按行匹配文字，宁可误报，误报写进带理由的豁免。扫的是代码不是散文，所以先去掉注释，并用空白回填，报出的行号
 * 仍是原文件的行号。本模块不依赖 nb-ui：排版 token 与配色变量的名单由调用方传入。
 */

import {readdirSync, readFileSync} from "node:fs";
import {join, relative} from "node:path";

export type StyleRuleId =
    | "literal-radius"
    | "literal-duration"
    | "literal-easing"
    | "literal-color"
    | "transition-all"
    | "inline-overlay-material"
    | "untyped-text-token"
    | "typography-in-font-utility"
    | "literal-font-size";

export interface StyleRule {
    readonly id: StyleRuleId;
    /** 用作测试标题。 */
    readonly name: string;
    readonly pattern: RegExp;
    readonly reason: string;
}

/** 一条豁免。缺 `values` 时放过这个文件里的全部命中；有 `values` 时只放过这些字面值。 */
export interface StyleExemption {
    readonly file: string;
    readonly reason: string;
    readonly values?: ReadonlyArray<string>;
}

export type StyleExemptions = Partial<Record<StyleRuleId, ReadonlyArray<StyleExemption>>>;

/** 一个已去掉注释的源文件；`rel` 是相对扫描目录的路径，用 `/` 分隔。 */
export interface StyleSource {
    readonly rel: string;
    readonly text: string;
}

export function stripStyleComments(source: string): string {
    const blank = (text: string) => text.replace(/[^\n]/gu, " ");
    return source
        .replace(/<!--[\s\S]*?-->/gu, blank)
        .replace(/\/\*[\s\S]*?\*\//gu, blank)
        .replace(/^[ \t]*\/\/.*$/gmu, blank);
}

function vueFiles(directory: string): string[] {
    return readdirSync(directory, {withFileTypes: true}).flatMap((entry) => {
        const path = join(directory, entry.name);
        if (entry.isDirectory()) return vueFiles(path);
        return entry.name.endsWith(".vue") ? [path] : [];
    });
}

/** 读目录下全部 `.vue`（含子目录）并去掉注释。 */
export function readVueSources(directory: string): StyleSource[] {
    return vueFiles(directory).map((path) => ({
        rel: relative(directory, path).replaceAll("\\", "/"),
        text: stripStyleComments(readFileSync(path, "utf8")),
    }));
}

/**
 * Tailwind v4 把方括号里不带类型提示的 `var()` 当成颜色：`text-[var(--text-xs)]` 编译成 `color: var(--text-xs)`，字号没设上，
 * 颜色也作废。名单只认排版 token，所以配色变量（`--text-main` 这类）写成 `text-[var(--text-main)]` 当颜色是对的。
 */
export function untypedTextTokenPattern(typographyTokens: ReadonlyArray<string>): RegExp {
    return new RegExp(String.raw`\btext-(?:\[var\(|\()(?:${typographyTokens.join("|")})(?=[,)])`, "u");
}

/** `var()` 放进 `font-[…]` 时可能被当字重，也可能被当字体族，靠引擎猜不可靠。 */
export function typographyInFontUtilityPattern(typographyTokens: ReadonlyArray<string>): RegExp {
    return new RegExp(String.raw`\bfont-(?:\[(?:[a-z-]+:)?var\(|\((?:[a-z-]+:)?)(?:${typographyTokens.join("|")})(?=[,)])`, "u");
}

/**
 * 方括号里的 px、rem 字号，样式里的 `font-size`、`font` 简写，与 `:style` 里的 `fontSize`。相对字号（`em`、`%`）跟着上下文走，
 * 不算字面量；`font-size: 0` 也放过。
 */
export const LITERAL_FONT_SIZE = /\btext-\[(?:length:)?\d*\.?\d+(?:px|rem)\]|\bfont-size\s*:\s*(?:\d*\.)?\d*[1-9]\d*(?:\.\d+)?(?:px|rem)|\bfont\s*:[^;"'`]*?\b\d*\.?\d+(?:px|rem)\b|\bfontSize['"]?\s*:\s*['"`]?\d/u;

/** `0s` 是关掉动效（减少动效时常写），不是写死时长；后面跟连字符的是类名或变量名的一部分。 */
export const LITERAL_DURATION = /\bduration-\[?\d|\b(?!0m?s\b)\d+(?:\.\d+)?m?s\b(?![-\w])/u;

/** 后面跟连字符或单词字符的 `#abc` 不是颜色（例如锚点、选择器的一部分）。 */
export const LITERAL_COLOR = /#[0-9a-fA-F]{3,8}\b(?![-\w])|\brgba?\(/u;

/** 全部规则。排版 token 名单来自 nb-ui 的 `nbTypographyTokens`，新增字号档不用改规则。 */
export function styleTokenRules(options: {readonly typographyTokens: ReadonlyArray<string>}): ReadonlyArray<StyleRule> {
    return [
        {
            id: "literal-radius",
            name: "控件圆角只消费 token",
            pattern: /\brounded-(?:sm|md|lg|xl|2xl|3xl)\b/u,
            reason: "写死的圆角常量档不随主题，会让 --radius-control 成为死变量；控件外框用 rounded-[var(--radius-control)]",
        },
        {
            id: "literal-duration",
            name: "动效时长只消费 --motion-*",
            pattern: LITERAL_DURATION,
            reason: "写死的时长不随主题；用 var(--motion-fast/base/enter)",
        },
        {
            id: "literal-easing",
            name: "缓动只消费 --ease-standard",
            pattern: /cubic-bezier\(/u,
            reason: "写死的缓动不随主题；用 var(--ease-standard)",
        },
        {
            id: "literal-color",
            name: "不写字面颜色",
            pattern: LITERAL_COLOR,
            reason: "颜色来自配色变量或 token",
        },
        {
            id: "transition-all",
            name: "不写 transition-all",
            pattern: /\btransition-all\b|transition\s*:\s*all\b/u,
            reason: "transition 的属性列表必须写明，否则布局属性也会跟着过渡",
        },
        {
            id: "inline-overlay-material",
            name: "浮层材质只走外框类，不内联",
            pattern: /\b(?:backdropFilter|WebkitBackdropFilter)\s*:|\bbackgroundColor\s*:\s*['"]color-mix\(in srgb, var\(--bg-panel\)/u,
            reason: "浮层材质只来自 .nb-ui-popover-surface 与 .nb-ui-menu-surface，内联会绕开主题",
        },
        {
            id: "untyped-text-token",
            name: "字号类带 length: 类型提示",
            pattern: untypedTextTokenPattern(options.typographyTokens),
            reason: "不带类型提示的 var() 被当成颜色，字号没设上；写 text-[length:var(--text-xs)]",
        },
        {
            id: "typography-in-font-utility",
            name: "字重与字体族用任意属性写",
            pattern: typographyInFontUtilityPattern(options.typographyTokens),
            reason: "font-[var(--weight-*)] 里 var() 当字重还是字体族靠引擎猜；写 [font-weight:var(--weight-*)] 或 [font-family:var(--font-*)]",
        },
        {
            id: "literal-font-size",
            name: "字号只消费排版 token",
            pattern: LITERAL_FONT_SIZE,
            reason: "字面像素不随主题的字号刻度变；写 text-[length:var(--text-*)] 或 font-size: var(--text-*)，可以在 token 上加减",
        },
    ];
}

function exemptionMatches(exemption: StyleExemption, rel: string, hit: string): boolean {
    return exemption.file === rel && (exemption.values === undefined || exemption.values.includes(hit));
}

/** 一条规则在这些文件里的违规，写成 `文件:行 命中「…」——理由`。 */
export function findStyleViolations(rule: StyleRule, sources: ReadonlyArray<StyleSource>, exemptions: StyleExemptions = {}): string[] {
    const ruleExemptions = exemptions[rule.id] ?? [];
    return sources.flatMap(({rel, text}) => text.split("\n").flatMap((line, index) => {
        const hit = line.match(rule.pattern)?.[0];
        if (hit === undefined || ruleExemptions.some((exemption) => exemptionMatches(exemption, rel, hit))) return [];
        return [`${rel}:${String(index + 1)} 命中「${hit}」——${rule.reason}`];
    }));
}

/** 不再命中任何代码的豁免（文件没了，或写法已经改掉）。豁免不清理，以后同一处写回去就查不出来。 */
export function findStaleExemptions(rules: ReadonlyArray<StyleRule>, sources: ReadonlyArray<StyleSource>, exemptions: StyleExemptions): string[] {
    return rules.flatMap((rule) => (exemptions[rule.id] ?? []).flatMap((exemption) => {
        const hits = sources.filter(({rel}) => rel === exemption.file)
            .flatMap(({rel, text}) => text.split("\n").flatMap((line) => {
                const hit = line.match(rule.pattern)?.[0];
                return hit !== undefined && exemptionMatches(exemption, rel, hit) ? [hit] : [];
            }));
        return hits.length === 0 ? [`${rule.id} 的豁免 ${exemption.file} 已不命中，应当移除`] : [];
    }));
}

export interface UndeclaredVarsOptions {
    /** 要检查的文件。 */
    readonly sources: ReadonlyArray<StyleSource>;
    /** 只提供声明、自己不受检查的文本，例如 nb-ui 的样式表（已去掉注释）。 */
    readonly declaringTexts?: ReadonlyArray<string>;
    /** 配色变量等由契约声明的名字。 */
    readonly declared?: Iterable<string>;
    /** 组件读、库里不声明、由宿主按需设置的变量；每个都要带缺省值。 */
    readonly hostVars?: ReadonlySet<string>;
    /** 不管的前缀，例如 Tailwind 的内部变量、原语在运行时写到元素上的尺寸。 */
    readonly runtimePrefixes?: ReadonlyArray<string>;
}

/**
 * 用到却没有声明的 CSS 变量。没有声明的变量在计算值阶段无效，整条声明退回初始值，不报任何错。声明包括样式里的 `--x:`、
 * Tailwind 任意属性 `[--x:…]`、`:style` 对象的键 `"--x":` 与 `style.setProperty("--x", …)`。
 */
export function findUndeclaredVars(options: UndeclaredVarsOptions): string[] {
    const declared = new Set<string>(options.declared ?? []);
    for (const text of [...(options.declaringTexts ?? []), ...options.sources.map((source) => source.text)]) {
        for (const match of text.matchAll(/["']?(--[a-z0-9-]+)["']?\s*:|setProperty\(\s*["'](--[a-z0-9-]+)["']/gu)) declared.add((match[1] ?? match[2])!);
    }
    const isKnown = (name: string) => declared.has(name) || options.hostVars?.has(name) === true || options.runtimePrefixes?.some((prefix) => name.startsWith(prefix)) === true;
    return options.sources.flatMap(({rel, text}) => [...text.matchAll(/var\(\s*(--[a-z0-9-]+)/gu)]
        .map((match) => match[1]!)
        .filter((name) => !isKnown(name))
        .map((name) => `${rel} 用了没有声明的 ${name}`));
}
