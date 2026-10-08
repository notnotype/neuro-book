import {describe, expect, it} from "bun:test";

import {contextTable, evaluateContextWhen, validateWhen} from "./context-keys";
import type {ContextKeyTable} from "./context-keys";

const keys: ContextKeyTable = {
    "editor-active": "需要活动编辑器",
    "editor-writable": "当前编辑器不可写",
    "editor-focus": "需要编辑区焦点",
};

describe("validateWhen", () => {
    it("没有谓词与空数组都合法；登记过的键放行", () => {
        expect(validateWhen(contextTable(keys), undefined).ok).toBe(true);
        expect(validateWhen(contextTable(keys), {requires: []}).ok).toBe(true);
        expect(validateWhen(contextTable(keys), {requires: ["editor-active", "editor-focus"]}).ok).toBe(true);
    });

    it("未登记的键被拒绝并指名；原型上的属性名不算登记", () => {
        expect(validateWhen(contextTable(keys), {requires: ["offline"]})).toEqual({ok: false, reason: "未登记的 when 取值：offline"});
        expect(validateWhen(contextTable(keys), {requires: ["constructor"]}).ok).toBe(false);
        expect(validateWhen(contextTable(keys), {requires: ["toString"]}).ok).toBe(false);
    });
});

describe("evaluateContextWhen", () => {
    it("requires 是 all-of：没给值或不为 true 的已登记键各产生一条原因", () => {
        const values = {"editor-active": true, "editor-writable": true, "editor-focus": false};
        expect(evaluateContextWhen(contextTable(keys, () => values), {requires: ["editor-active", "editor-writable"]})).toEqual({ok: true, value: {matches: true, reasons: []}});
        expect(evaluateContextWhen(contextTable(keys, () => ({"editor-active": true})), {requires: ["editor-active", "editor-focus"]})).toEqual({
            ok: true,
            value: {matches: false, reasons: ["需要编辑区焦点"]},
        });
        expect(evaluateContextWhen(contextTable(keys, () => values), {requires: ["editor-writable", "editor-focus"]})).toEqual({ok: true, value: {matches: false, reasons: ["需要编辑区焦点"]}});
    });

    it("空数组与缺省谓词恒真；未登记的键求值失败，不当作满足", () => {
        expect(evaluateContextWhen(contextTable(keys, () => ({})), undefined)).toEqual({ok: true, value: {matches: true, reasons: []}});
        expect(evaluateContextWhen(contextTable(keys, () => ({})), {requires: []})).toEqual({ok: true, value: {matches: true, reasons: []}});
        expect(evaluateContextWhen(contextTable(keys, () => ({offline: true})), {requires: ["offline"]}).ok).toBe(false);
    });
});
