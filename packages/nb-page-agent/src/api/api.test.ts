/** 定位对象的校验（docs/specs/agent/page-agent.md 输入与前置条件、输出 5）。 */

import {describe, expect, it} from "bun:test";
import {Value} from "typebox/value";

import {LocatorSchema, SnapshotArgsSchema, locatorKind} from "./index";

describe("locatorKind", () => {
    it("恰好一种主定位：交回种类", () => {
        expect(locatorKind({ref: "t1.3"})).toEqual({ok: true, kind: "ref"});
        expect(locatorKind({target: "settings.row", key: "a"})).toEqual({ok: true, kind: "target"});
        expect(locatorKind({role: "button", name: "保存", nth: 1, exact: true})).toEqual({ok: true, kind: "role"});
        expect(locatorKind({text: "外观"})).toEqual({ok: true, kind: "text"});
    });

    it("没给、给了两种、key 或 name 没有配对时说明哪里不对", () => {
        for (const locator of [{}, {ref: "t1.3", text: "x"}, {key: "a"}, {name: "保存"}, {exact: true}]) {
            const result = locatorKind(locator);
            expect(result.ok, JSON.stringify(locator)).toBe(false);
        }
    });
});

describe("schema", () => {
    it("within 里不能再套 within；多余的字段不收", () => {
        expect(Value.Check(LocatorSchema, {text: "打开", within: {role: "region", name: "右"}})).toBe(true);
        expect(Value.Check(LocatorSchema, {text: "打开", within: {role: "region", within: {ref: "t1.1"}}})).toBe(false);
        expect(Value.Check(LocatorSchema, {ref: "t1.1", selector: "#x"})).toBe(false);
    });

    it("maxTokens 在 200 到 8000 之间", () => {
        expect(Value.Check(SnapshotArgsSchema, {maxTokens: 8000})).toBe(true);
        expect(Value.Check(SnapshotArgsSchema, {maxTokens: 8001})).toBe(false);
        expect(Value.Check(SnapshotArgsSchema, {maxTokens: 199})).toBe(false);
    });
});
