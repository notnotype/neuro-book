/** 属性声明的形状（docs/specs/workbench/markdown-editing.md 输出 59、61）：合格的收，不合格的逐类被拒。 */

import {describe, expect, it} from "bun:test";

import {Value} from "typebox/value";

import {PropertyDeclarationSchema} from "./properties";

const ok = (declaration: unknown): boolean => Value.Check(PropertyDeclarationSchema, declaration);

describe("PropertyDeclarationSchema", () => {
    it("合格：名字加图标、显示名、类型中的任意一项或几项；显示名可以是字符串、文字引用或按语言的表", () => {
        expect(ok({name: "视角", icon: "i-lucide-eye"})).toBe(true);
        expect(ok({name: "视角", label: "叙述视角"})).toBe(true);
        expect(ok({name: "视角", label: {"zh-CN": "叙述视角", "en-US": "Point of view"}})).toBe(true);
        expect(ok({name: "视角", label: {kind: "text", ns: "nbook.canon", key: "pov"}})).toBe(true);
        for (const kind of ["text", "number", "checkbox", "date", "list"]) expect(ok({name: "时间", kind})).toBe(true);
        expect(ok({name: "含 空格 与 符号-1", icon: "i-lucide-calendar-days", label: "x", kind: "date"})).toBe(true);
    });

    it("不合格：名字为空或含控制字符、三项都没给、类型不在五种之内（含表示不了的 complex）、图标不是类名、有别的字段", () => {
        for (const bad of [
            {name: "", icon: "i-lucide-eye"},
            {name: "视\n角", icon: "i-lucide-eye"},
            {name: "视\u0000角", icon: "i-lucide-eye"},
            {name: "视角"},
            {icon: "i-lucide-eye"},
            {name: "视角", kind: "complex"},
            {name: "视角", kind: "Text"},
            {name: "视角", icon: "lucide-eye"},
            {name: "视角", icon: "i-lucide"},
            {name: "视角", icon: "<svg/>"},
            {name: "视角", icon: "i-lucide-eye", extra: 1},
            {name: 1, icon: "i-lucide-eye"},
        ]) expect([JSON.stringify(bad), ok(bad)]).toEqual([JSON.stringify(bad), false]);
    });
});
