/**
 * nb-ui 给布局组件的桥接（docs/specs/theme/system.md 的“布局组件的桥接”）与 nb-layout 的变量清单一一对应。两个包互不依赖，
 * 应用两边都看得到，所以在这里核对：桥接拼错一个名字，nb-layout 只会静默落到回退，截图看不出时长、层级与暗色的差别。
 */

import {describe, expect, it} from "bun:test";
import {readFileSync} from "node:fs";
import {fileURLToPath} from "node:url";

import {NB_LAYOUT_THEME_VARS} from "@notnotype/nb-layout";

const stylesheet = (name: string): string => readFileSync(fileURLToPath(import.meta.resolve(`@notnotype/nb-ui/${name}`)), "utf8").replace(/\/\*[\s\S]*?\*\//gu, "");

/** 样式表里每个自定义属性第一次声明的值（减少动效里的重声明在后面，不算）。 */
function declarations(text: string): Map<string, string> {
    const found = new Map<string, string>();
    for (const match of text.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;{}]+);/gu)) {
        if (!found.has(match[1]!)) found.set(match[1]!, match[2]!.replace(/\s+/gu, " ").trim());
    }
    return found;
}

const tokens = declarations(stylesheet("tokens.css"));
/** 字体族、字号、行高声明在 theme.css（Tailwind 的主题键），其余在 tokens.css。 */
const defaults = new Map([...declarations(stylesheet("theme.css")), ...tokens]);
const bridged = NB_LAYOUT_THEME_VARS.flatMap((entry) => (entry.kind === "bridged" ? [entry] : []));

/** 旧名在 nb-ui 里的缺省值，顺着 `var(--另一个)` 往下找；中途是组合值（`color-mix`、带回退的 `var`）就不算标量，返回 undefined。 */
function scalarDefault(name: string): string | undefined {
    let value = defaults.get(name);
    for (let hops = 0; value !== undefined && hops < 5; hops += 1) {
        const alias = /^var\((--[a-z0-9-]+)\)$/u.exec(value);
        if (alias === null) break;
        value = defaults.get(alias[1]!);
    }
    return value === undefined || /var\(|color-mix|rgb|#/u.test(value) ? undefined : value;
}

/** 回退用了系统色的是颜色类：不装 nb-ui 时故意与 nb-ui 的配色不同，不比。 */
const SYSTEM_COLOR = /\b(?:Canvas|CanvasText|Highlight|HighlightText|GrayText|LinkText)\b/u;

describe("nb-ui 给 nb-layout 的桥接", () => {
    it("清单里经桥接的每一项在 tokens.css 里有一行，接的是清单写的旧名；没有清单之外的 --nb-layout-*", () => {
        for (const entry of bridged) {
            if (entry.from !== null) expect(`${entry.name}: ${String(tokens.get(entry.name))}`).toBe(`${entry.name}: var(${entry.from})`);
        }
        const declared = [...tokens.keys()].filter((name) => name.startsWith("--nb-layout-")).sort();
        expect(declared).toEqual(bridged.map((entry) => entry.name as string).sort());
    });

    it("nb-ui 直接写数值的几项（两个落点浮层的层级）：nb-layout 的回退等于桥接的值；桥接等于层级登记表由 nb-ui 的 z-index.test.ts 核对", () => {
        const valued = bridged.filter((entry) => entry.from === null);
        expect(valued.map((entry) => entry.name)).toEqual(["--nb-layout-z-drop-sectors", "--nb-layout-z-drop-feedback"]);
        for (const entry of valued) expect(`${entry.name}: ${entry.fallback}`).toBe(`${entry.name}: ${String(tokens.get(entry.name))}`);
    });

    it("尺寸、时长、圆角、字体这类标量的回退与 nb-ui 的缺省相同（不装 nb-ui 时外观一样，只有颜色换成系统色）", () => {
        const compared: string[] = [];
        for (const entry of bridged) {
            if (entry.from === null || SYSTEM_COLOR.test(entry.fallback)) continue;
            const expected = scalarDefault(entry.from);
            if (expected === undefined) continue;
            compared.push(entry.name);
            expect(`${entry.name}: ${entry.fallback}`).toBe(`${entry.name}: ${expected}`);
        }
        // 防止解析失效后什么都不比：时长、线宽、圆角、字号至少都在里面。
        expect(compared).toEqual(expect.arrayContaining(["--nb-layout-motion-layout", "--nb-layout-sash-line-size", "--nb-layout-card-radius", "--nb-layout-text-xs", "--nb-layout-font-ui"]));
    });
});
