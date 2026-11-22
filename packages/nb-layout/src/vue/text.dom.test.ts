/**
 * nb-layout 的文字（docs/specs/ui/i18n.md 输出 8，docs/specs/ui/nested-grid.md 输出 143）：自带的两份目录与按目录翻译的
 * `layoutCatalogTranslate`。仓库的目录检查（`scripts/ci/message-catalogs.ts`）只查 JSON 目录，这两份 `.ts` 目录在这里核对：
 * 键与 `LayoutTextKey` 里的键双向一一对应，两种语言的键与占位符相同，占位符只用 `{{名字}}`（翻译只认这一种）。
 * 放在 Vue 层（键的类型在 `text.ts`，核心不依赖 Vue 层），所以由 Vitest 跑；它不挂组件、不用 DOM。
 */

import {describe, expect, it} from "vitest";

import {NB_LAYOUT_CATALOGS, NB_LAYOUT_SOURCE_LOCALE} from "../locales";
import {layoutCatalogTranslate} from "./text";
import type {LayoutCatalogLocale, LayoutTextKey} from "./text";

/** `LayoutTextKey` 里的全部键：`satisfies` 让漏写或多写一个键都编译不过。 */
const KEYS = {
    "splitter.resizeWidth": true,
    "splitter.resizeHeight": true,
    "splitter.collapsed": true,
    "splitter.pixels": true,
    "floatWindow.resize": true,
    "floatWindow.move": true,
    "sortable.handle": true,
    "sortable.hint": true,
    "sortable.placeholder": true,
    "sortable.picked": true,
    "sortable.moved": true,
    "sortable.dropped": true,
    "sortable.cancelled": true,
    "sortable.unchanged": true,
} as const satisfies Record<LayoutTextKey, true>;

/** 目录展开成“点分键 → 文字”；叶子不是字符串时原样留着，让断言报出来。 */
function flatten(node: unknown, prefix = ""): Record<string, unknown> {
    if (typeof node !== "object" || node === null) return {[prefix]: node};
    return Object.fromEntries(Object.entries(node).flatMap(([name, child]) => Object.entries(flatten(child, prefix === "" ? name : `${prefix}.${name}`))));
}

/** 占位符：`{{名字}}` 与库认不出的 `{{名字, 格式}}` 都取出来，后者在下面报错。 */
function placeholders(text: string): string[] {
    return [...text.matchAll(/\{\{([^}]*)\}\}/gu)].map((match) => match[1]!.trim()).sort();
}

describe("nb-layout 的目录", () => {
    it("源语言是 en-US，目录里有 en-US 与 zh-CN 两种", () => {
        expect(NB_LAYOUT_SOURCE_LOCALE).toBe("en-US");
        expect(Object.keys(NB_LAYOUT_CATALOGS).sort()).toEqual(["en-US", "zh-CN"]);
    });

    for (const [locale, catalog] of Object.entries(NB_LAYOUT_CATALOGS)) {
        it(`${locale}：叶子恰好是 LayoutTextKey 里的键，都是非空字符串，占位符只用 {{名字}}`, () => {
            const flat = flatten(catalog);
            expect(Object.keys(flat).sort()).toEqual(Object.keys(KEYS).sort());
            for (const [key, text] of Object.entries(flat)) {
                expect(typeof text === "string" && text.length > 0, `${locale} ${key}`).toBe(true);
                for (const name of placeholders(text as string)) expect(name, `${locale} ${key}：占位符 {{${name}}}`).toMatch(/^\w+$/u);
            }
        });
    }

    it("同一个键在两种语言里的占位符相同", () => {
        const source = flatten(NB_LAYOUT_CATALOGS[NB_LAYOUT_SOURCE_LOCALE]);
        const chinese = flatten(NB_LAYOUT_CATALOGS["zh-CN"]);
        for (const key of Object.keys(KEYS)) expect(placeholders(chinese[key] as string), key).toEqual(placeholders(source[key] as string));
    });
});

/** 每个键的样例参数：覆盖目录里用到的全部占位符。 */
const PARAMS = {before: "a", after: "b", size: 2, name: "旧码头", index: 3, section: "第二卷"} as const;

describe("layoutCatalogTranslate", () => {
    it("按指定的语言取文字、代入参数", () => {
        expect(layoutCatalogTranslate("en-US")("splitter.resizeWidth", {before: "a", after: "b"})).toBe("Resize width between a and b");
        expect(layoutCatalogTranslate("zh-CN")("splitter.resizeWidth", {before: "a", after: "b"})).toBe("调整 a 与 b 的宽度");
        expect(layoutCatalogTranslate("zh-CN")("splitter.collapsed")).toBe("已收起");
    });

    for (const locale of Object.keys(NB_LAYOUT_CATALOGS) as LayoutCatalogLocale[]) {
        it(`${locale}：每个键都翻得出（不是键名），占位符都被代入`, () => {
            const translate = layoutCatalogTranslate(locale);
            for (const key of Object.keys(KEYS) as LayoutTextKey[]) {
                const text = translate(key, PARAMS);
                expect(text, key).not.toBe(key);
                expect(text, key).not.toContain("{{");
            }
        });
    }

    it("缺的参数保留占位，看得出少传了什么", () => {
        expect(layoutCatalogTranslate("en-US")("splitter.pixels")).toBe("{{size}} pixels");
    });

    it("目录里没有的语言（JS 调用方绕过类型）在提供文字时就抛 RangeError，原型上的名字也一样", () => {
        expect(() => layoutCatalogTranslate("zh" as LayoutCatalogLocale)).toThrow(RangeError);
        expect(() => layoutCatalogTranslate("constructor" as LayoutCatalogLocale)).toThrow(RangeError);
    });
});
