import {readFileSync} from "node:fs";
import {join} from "node:path";
import {describe, expect, it} from "vitest";

import {
    findStaleExemptions,
    findStyleViolations,
    findUndeclaredVars,
    readVueSources,
    stripStyleComments,
    styleTokenRules,
    type StyleExemptions,
} from "@notnotype/neuro-book-test-support/style-tokens";

import {nbColorwayVarKeys} from "../colorway/colorway-contract";
import {nbTypographyTokens} from "../theme/tokens";

/**
 * 组件 token 消费静态扫描。规则与它们的理由在 `@notnotype/neuro-book-test-support/style-tokens`，这里只写本包的豁免与声明来源。
 *
 * 新增规则合入前做红翻转：临时把真违规塞回组件，确认对应规则报错后再还原。
 */

const COMPONENTS_DIR = import.meta.dirname;

/** 每条豁免都要写理由。`values` 只放过这些字面值，同一文件的别的写法照样报。 */
const EXEMPTIONS: StyleExemptions = {
    "literal-color": [
        {file: "form/ColorPickerPanel.vue", reason: "取色面板读不懂传入的颜色时要落回一个具体颜色，是取色器本身的需要"},
        {file: "form/Checkbox.vue", reason: "选中底的渐变往黑混 12% 表达压暗，黑不随配色变", values: ["#000000"]},
    ],
    "literal-font-size": [
        {file: "controls/IconButton.vue", reason: "最小一档 14px 的方块里图标字形按方块定 9.6px，随方块而不是随正文字号"},
    ],
};

/** 组件读、库里不声明、由宿主按需设置的变量。每个都带缺省值（`var(--x, 缺省)`），没设时组件照常工作。 */
const HOST_HOOK_VARS = new Map<string, string>([
    ["--nb-splitter-seam", "Splitter 接缝颜色，工作台外壳按卡片或平铺设置（Splitter.vue 的注释）"],
    ["--nb-splitter-seam-inset", "Splitter 接缝两端的缩进，缺省铺满"],
    ["--nb-popover-scroll-fade", "弹出列表顶底渐隐的高度，缺省 22px"],
    ["--nb-collapsible-row-px", "CollapsibleRow 的左右内边距，缺省 8px；行排在已有缩进的列表里时宿主收窄（CollapsibleRow.md）"],
]);

/** reka 在运行时写到元素上的尺寸、Tailwind 自己的内部变量，以及对话框入场的起点（useDialogOrigin 打开时量了写到面上）。 */
const RUNTIME_VAR_PREFIXES = ["--reka-", "--tw-", "--nb-dialog-from-", "--nb-dialog-enter-", "--nb-dialog-leave-"];

const RULES = styleTokenRules({typographyTokens: nbTypographyTokens});

describe("组件 token 消费静态扫描", () => {
    const sources = readVueSources(COMPONENTS_DIR);

    for (const rule of RULES) {
        it(rule.name, () => {
            expect(findStyleViolations(rule, sources, EXEMPTIONS)).toEqual([]);
        });
    }

    it("用到的 CSS 变量都有声明", () => {
        const stylesheets = ["../theme.css", "../tokens.css", "../styles.css"].map((rel) => ({rel, text: stripStyleComments(readFileSync(join(COMPONENTS_DIR, rel), "utf8"))}));
        expect(findUndeclaredVars({
            sources: [...stylesheets, ...sources],
            declared: nbColorwayVarKeys,
            hostVars: new Set(HOST_HOOK_VARS.keys()),
            runtimePrefixes: RUNTIME_VAR_PREFIXES,
        })).toEqual([]);
    });

    it("宿主覆盖点仍有组件在读（防止豁免变成死条目）", () => {
        const text = [readFileSync(join(COMPONENTS_DIR, "../styles.css"), "utf8"), ...sources.map((source) => source.text)].join("\n");
        for (const name of HOST_HOOK_VARS.keys()) {
            expect(text.includes(`var(${name}`), `${name} 已没有组件读取，应从 HOST_HOOK_VARS 移除`).toBe(true);
        }
    });

    it("豁免都还命中代码（防止豁免变成死条目）", () => {
        expect(findStaleExemptions(RULES, sources, EXEMPTIONS)).toEqual([]);
    });
});
