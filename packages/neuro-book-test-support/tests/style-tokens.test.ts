import {describe, expect, it} from "vitest";

import {
    findStaleExemptions,
    findStyleViolations,
    findUndeclaredVars,
    LITERAL_COLOR,
    LITERAL_DURATION,
    LITERAL_FONT_SIZE,
    stripStyleComments,
    styleTokenRules,
    typographyInFontUtilityPattern,
    untypedTextTokenPattern,
} from "../src/style-tokens";

const TOKENS = ["--text-2xs", "--text-xs", "--text-sm", "--text-md", "--weight-medium", "--weight-strong", "--font-mono"];
const RULES = styleTokenRules({typographyTokens: TOKENS});

function rule(id: (typeof RULES)[number]["id"]) {
    return RULES.find((candidate) => candidate.id === id)!;
}

/** 样例里该命中的都命中、该放过的都放过；不一致的样例留在结果里，失败时能直接看到。 */
function misjudged(pattern: RegExp, flagged: ReadonlyArray<string>, allowed: ReadonlyArray<string>): string[] {
    return [...flagged.filter((sample) => !pattern.test(sample)), ...allowed.filter((sample) => pattern.test(sample))];
}

describe("样式写法的匹配", () => {
    it("字号类认得出不带类型提示的写法，放过带提示的与配色变量", () => {
        expect(misjudged(
            untypedTextTokenPattern(TOKENS),
            ["text-[var(--text-xs)]", "hover:text-[var(--text-sm)]", "text-[var(--text-2xs,11px)]", "text-(--text-md)"],
            ["text-[length:var(--text-xs)]", "text-(length:--text-xs)", "text-[var(--text-main)]", "text-[var(--text-muted)]", "text-[var(--text-secondary)]"],
        )).toEqual([]);
    });

    it("字号认得出字面像素，放过 token 与非字号的方括号值", () => {
        expect(misjudged(
            LITERAL_FONT_SIZE,
            ["text-[13px]", "sm:text-[11px]", "text-[length:9.6px]", "text-[0.8rem]", "text-[.8rem]", "font-size: 12px;", "font-size: 0.75rem;", "font: 13px/1.5 var(--font-ui);", 'fontSize: "13px"', "fontSize: 13", '"fontSize": 13'],
            ["text-[length:var(--text-sm)]", "text-[var(--text-main)]", "font-size: var(--text-xs);", "font-size: 0.88em;", "font-size: 0;", "font: inherit;", "min-w-[24px]", "leading-[18px]"],
        )).toEqual([]);
    });

    it("字重类认得出 font-[…] 里的排版 token，放过任意属性写法与常量档", () => {
        expect(misjudged(
            typographyInFontUtilityPattern(TOKENS),
            ["font-[var(--weight-medium)]", "data-[selected]:font-[var(--weight-medium)]", "font-[number:var(--weight-strong)]", "font-(--weight-strong)", "font-[var(--font-mono)]"],
            ["[font-weight:var(--weight-medium)]", "data-[selected]:[font-weight:var(--weight-medium)]", "[font-family:var(--font-mono)]", "font-medium", "font-mono"],
        )).toEqual([]);
    });

    it("时长放过关掉动效的 0s 与类名里的片段", () => {
        expect(misjudged(
            LITERAL_DURATION,
            ["duration-200", "duration-[300ms]", "transition: opacity 120ms", "animation: spin 1s linear"],
            ["transition: none 0s", "transition-duration: 0ms", "w-2s-x", "var(--motion-base)"],
        )).toEqual([]);
    });

    it("颜色认得出十六进制与 rgb，放过后面还连着别的字符的片段", () => {
        expect(misjudged(LITERAL_COLOR, ["#fff", "#000000", "color: #abcdef;", "rgb(0 0 0)", "rgba(0,0,0,.5)"], ["#fff-card", "var(--accent-main)"])).toEqual([]);
    });
});

describe("扫描", () => {
    it("去注释后行号不变，注释里的写法不算", () => {
        const source = ["<!-- rounded-md -->", "/* #fff */", "// rgb(0 0 0)", "<div class=\"rounded-md\"/>"].join("\n");
        const text = stripStyleComments(source);
        expect(text.split("\n")).toHaveLength(4);
        expect(findStyleViolations(rule("literal-radius"), [{rel: "A.vue", text}])).toEqual([
            `A.vue:4 命中「rounded-md」——${rule("literal-radius").reason}`,
        ]);
    });

    it("整个文件的豁免与只放过某个字面值的豁免", () => {
        const sources = [{rel: "A.vue", text: "#000000 #ffffff"}, {rel: "B.vue", text: "#111111"}, {rel: "C.vue", text: "#ffffff"}];
        const exemptions = {
            "literal-color": [
                {file: "B.vue", reason: "整个文件"},
                {file: "C.vue", reason: "只放过黑", values: ["#000000"]},
            ],
        };
        const hits = findStyleViolations(rule("literal-color"), sources, exemptions);
        expect(hits.map((hit) => hit.split(" ")[0])).toEqual(["A.vue:1", "C.vue:1"]);
    });

    it("报出文件没了或不再命中的豁免", () => {
        const sources = [{rel: "A.vue", text: "#000000"}, {rel: "B.vue", text: "clean"}, {rel: "C.vue", text: "#ffffff"}];
        const exemptions = {
            "literal-color": [
                {file: "A.vue", reason: "仍命中"},
                {file: "B.vue", reason: "写法已改"},
                {file: "Gone.vue", reason: "文件没了"},
                {file: "C.vue", reason: "字面值变了", values: ["#000000"]},
            ],
        };
        expect(findStaleExemptions(RULES, sources, exemptions)).toEqual([
            "literal-color 的豁免 B.vue 已不命中，应当移除",
            "literal-color 的豁免 Gone.vue 已不命中，应当移除",
            "literal-color 的豁免 C.vue 已不命中，应当移除",
        ]);
    });

    it("CSS 变量：认得各种声明，放过宿主覆盖点与运行时前缀", () => {
        const sources = [{
            rel: "A.vue",
            text: [
                "--own: 1px; [--tailwind:2px] :style=\"{'--keyed': 1}\" style.setProperty('--set', '1')",
                "var(--own) var(--tailwind) var(--keyed) var(--set)",
                "var(--from-sheet) var(--colorway) var(--hook, 1px) var(--tw-ring) var(--reka-x)",
                "var(--missing)",
            ].join("\n"),
        }];
        expect(findUndeclaredVars({
            sources,
            declaringTexts: ["--from-sheet: 1;"],
            declared: ["--colorway"],
            hostVars: new Set(["--hook"]),
            runtimePrefixes: ["--tw-", "--reka-"],
        })).toEqual(["A.vue 用了没有声明的 --missing"]);
    });
});
