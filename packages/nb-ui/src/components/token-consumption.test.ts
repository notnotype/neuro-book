import {readdirSync, readFileSync} from "node:fs";
import {join} from "node:path";
import {describe, expect, it} from "vitest";

/**
 * 组件 token 消费静态扫描（Task 150）。
 *
 * 守的是 design-language.md / ui-development-spec.md 里「可被机械检查」的那几条：
 * 1. 控件外框圆角只消费 token，不写 Tailwind 常量档（坑 #44：写死 rounded-md 会让
 *    --radius-control 成为死变量）。
 * 2. 动效只消费 --motion-* / --ease-standard，不写死时长或缓动（design-language.md 动效节）。
 * 3. 组件不写字面颜色（ui-development-spec §2.2；颜色来自配色变量或 token）。
 * 4. 禁 transition-all / transition: all（属性列表必须显式，动效节禁条）。
 *
 * 凡是「扫源码找有没有出现 X」的断言都必须先剥注释——本仓同一形状的坑已经踩过两次
 * （见 theme-packages.test.ts 里 readVarsDeclarations 的注释），扫的是代码不是散文。
 *
 * 每条规则合入前做过红翻转：临时把真违规塞回组件，确认对应规则报错后再还原。
 */

const COMPONENTS_DIR = import.meta.dirname;

/** 规则 1 的豁免清单。只收坑 #44 判断里明确「保留各自圆角」的表面，每个都必须有理由。 */
const LITERAL_RADIUS_ALLOWLIST = new Map<string, string>([
    ["display/Skeleton.vue", "坑 #44：Skeleton 保留各自圆角，不纳入控件圆角判据"],
    ["feedback/Notification.vue", "坑 #44：Notification 保留各自圆角，不纳入控件圆角判据"],
    ["layout/Panel.vue", "坑 #44：Panel 保留各自圆角，不纳入控件圆角判据"],
    ["feedback/DialogWindow.vue", "窗口外框圆角是否消费 --radius-dialog 是独立设计决策，未裁决前登记在此"],
]);

const LITERAL_COLOR_ALLOWLIST = new Map<string, string>([
    ["form/ColorPicker.vue", "ColorPicker 是取色器与调色板，预设色板需要字面色彩常量"],
]);

const LITERAL_COLOR_VALUE_ALLOWLIST = new Map<string, ReadonlySet<string>>([
    ["form/FormCheckbox.vue", new Set(["#000000"])],
]);

function collectVueFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir, {withFileTypes: true})) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) {
            out.push(...collectVueFiles(path));
        } else if (entry.name.endsWith(".vue")) {
            out.push(path);
        }
    }
    return out;
}

/** 剥掉 HTML 注释、块注释和整行 // 注释；用空白回填保持行号不漂移。 */
function stripComments(source: string): string {
    const blank = (text: string) => text.replace(/[^\n]/g, " ");
    return source
        .replace(/<!--[\s\S]*?-->/g, blank)
        .replace(/\/\*[\s\S]*?\*\//g, blank)
        .replace(/^[ \t]*\/\/.*$/gm, blank);
}

interface Rule {
    name: string;
    pattern: RegExp;
    reason: string;
    allowlist?: Map<string, string>;
}

const RULES: Rule[] = [
    {
        name: "控件圆角只消费 token",
        pattern: /\brounded-(?:sm|md|lg|xl|2xl|3xl)\b/,
        reason: "写死的圆角常量档不随主题（坑 #44）；控件外框用 rounded-[var(--radius-control)]",
        allowlist: LITERAL_RADIUS_ALLOWLIST,
    },
    {
        name: "动效时长只消费 --motion-*",
        pattern: /\bduration-\[?\d|\b\d+(?:\.\d+)?m?s\b/,
        reason: "写死的时长不随主题（design-language.md 动效节）；用 var(--motion-fast/base/enter)",
    },
    {
        name: "缓动只消费 --ease-standard",
        pattern: /cubic-bezier\(/,
        reason: "组件不得写 cubic-bezier 字面量（design-language.md 动效节）",
    },
    {
        name: "组件不写字面颜色",
        pattern: /#[0-9a-fA-F]{3,8}\b|\brgba?\(/,
        reason: "颜色来自配色变量或 token（ui-development-spec §2.2）",
        allowlist: LITERAL_COLOR_ALLOWLIST,
    },
    {
        name: "禁 transition-all",
        pattern: /\btransition-all\b|transition\s*:\s*all\b/,
        reason: "transition 属性列表必须显式（design-language.md 动效节）",
    },
    {
        name: "浮层材质统一走 token 与 composable，禁内联写死 backdropFilter/boxShadow/surface",
        pattern: /\b(?:backdropFilter|WebkitBackdropFilter)\s*:|\bbackgroundColor\s*:\s*['"]color-mix\(in srgb, var\(--bg-panel\)/,
        reason: "浮层材质必须统一消费 --overlay-surface / --overlay-blur / --elevation-popover 或 useDropdownSurfaceStyle / useDropdownFloating（ui-development-spec §9）",
    },
];

function violationsFor(rule: Rule, files: string[]): string[] {
    const violations: string[] = [];
    for (const path of files) {
        const rel = join(path).slice(COMPONENTS_DIR.length + 1).replaceAll("\\", "/");
        if (rule.allowlist?.has(rel)) {
            continue;
        }
        const allowedValues = rule.name === "组件不写字面颜色" ? LITERAL_COLOR_VALUE_ALLOWLIST.get(rel) : undefined;
        const lines = stripComments(readFileSync(path, "utf-8")).split("\n");
        lines.forEach((line, index) => {
            const match = line.match(rule.pattern);
            if (match && !allowedValues?.has(match[0])) {
                violations.push(`${rel}:${index + 1} 命中「${match[0]}」——${rule.reason}`);
            }
        });
    }
    return violations;
}

describe("组件 token 消费静态扫描", () => {
    const files = collectVueFiles(COMPONENTS_DIR);
    // 本文件也是 .test.ts 不是 .vue，不在扫描面内；规则样例都写在上面的注释里，不会被自己绊倒

    for (const rule of RULES) {
        it(rule.name, () => {
            expect(violationsFor(rule, files)).toEqual([]);
        });
    }

    it("豁免清单里的文件仍然存在（防止豁免变成死条目）", () => {
        const existing = new Set(files.map((path) => join(path).slice(COMPONENTS_DIR.length + 1).replaceAll("\\", "/")));
        for (const rel of [...LITERAL_RADIUS_ALLOWLIST.keys(), ...LITERAL_COLOR_ALLOWLIST.keys(), ...LITERAL_COLOR_VALUE_ALLOWLIST.keys()]) {
            expect(existing.has(rel), `${rel} 已不存在，应从豁免清单移除`).toBe(true);
        }
    });
});
