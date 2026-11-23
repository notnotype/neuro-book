import {readFileSync} from "node:fs";
import {join} from "node:path";

import {describe, expect, it} from "bun:test";

import {componentTags, tagComponentDeclarations} from "./component-tags";

describe("组件的稳定性标注", () => {
    it("读入口里组件行的行尾标注；入口里 7 个组件都有", () => {
        const tags = componentTags(readFileSync(join(import.meta.dir, "../src/vue/index.ts"), "utf8"));
        expect([...tags.keys()].sort()).toEqual(["DropFeedbackOverlay", "DropIndicatorLabel", "DropSectorsOverlay", "FloatWindowHandles", "NestedGrid", "SortableList", "Splitter"]);
        expect(new Set(tags.values())).toEqual(new Set(["experimental"]));
    });

    it("组件行缺标注或标注不认识时抛出", () => {
        expect(() => componentTags(`export {default as Box} from "./Box.vue";\n`)).toThrow("component Box needs a trailing");
        expect(() => componentTags(`export {default as Box} from "./Box.vue"; // @beta\n`)).toThrow("component Box needs a trailing");
        expect(componentTags(`export {default as Box} from "./Box.vue"; // @stable\nexport {helper} from "./helper";\n`)).toEqual(new Map([["Box", "stable"]]));
    });

    it("按导出列表找到组件的声明，在前面插标注；别的声明不动", () => {
        const declarations = [
            "declare const _default: typeof __VLS_export$1;",
            "declare const _default$1: typeof __VLS_export;",
            "declare const other: number;",
            "export { _default$1 as Box, _default as Card, other };",
            "",
        ].join("\n");
        expect(tagComponentDeclarations(declarations, new Map([["Box", "experimental"], ["Card", "stable"]]))).toBe(
            [
                "/** @stable */",
                "declare const _default: typeof __VLS_export$1;",
                "/** @experimental */",
                "declare const _default$1: typeof __VLS_export;",
                "declare const other: number;",
                "export { _default$1 as Box, _default as Card, other };",
                "",
            ].join("\n"),
        );
    });

    it("组件不在导出列表或找不到声明时抛出", () => {
        expect(() => tagComponentDeclarations("export { other };\n", new Map([["Box", "experimental"]]))).toThrow("component Box is not in the declaration export list");
        expect(() => tagComponentDeclarations("export { _default as Box };\n", new Map([["Box", "experimental"]]))).toThrow("component Box (_default) has no declaration");
    });
});
