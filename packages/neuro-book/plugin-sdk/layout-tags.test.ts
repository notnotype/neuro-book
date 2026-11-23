import {describe, expect, it} from "bun:test";

import {tagLayoutComponents} from "./pack";

/** SDK 打包给 nb-layout 组件插稳定性标注（w00026 t48）；整份打包的效果由 `pack.test.ts` 在真实产物上核对。 */
describe("tagLayoutComponents", () => {
    const entry = 'export {default as NestedGrid} from "./NestedGrid.vue"; // @experimental\nexport {default as Splitter} from "./Splitter.vue"; // @stable\n';

    it("按导出列表找到 SDK 转出的组件，插它在 nb-layout 入口里的标注；SDK 没转出的跳过，别的声明不动", () => {
        const declarations = "declare const _default$3: typeof __VLS_export$1;\ndeclare const Button: unknown;\nexport {\n  Button,\n  _default$3 as NestedGrid\n};\n";
        expect(tagLayoutComponents(declarations, entry)).toBe("/** @experimental */\ndeclare const _default$3: typeof __VLS_export$1;\ndeclare const Button: unknown;\nexport {\n  Button,\n  _default$3 as NestedGrid\n};\n");
    });

    it("nb-layout 的组件行缺标注、或转出了却找不到声明时抛出", () => {
        expect(() => tagLayoutComponents("\nexport { x as NestedGrid };\n", 'export {default as NestedGrid} from "./NestedGrid.vue";\n')).toThrow("nb-layout 的组件行没有稳定性标注");
        expect(() => tagLayoutComponents("\nexport { _default as NestedGrid };\n", entry)).toThrow("components.d.ts 里找不到 NestedGrid 的声明（_default）");
    });
});
