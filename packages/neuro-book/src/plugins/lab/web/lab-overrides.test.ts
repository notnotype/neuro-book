import {describe, expect, it} from "bun:test";

import {LAB_OVERRIDE_SCHEMA, LAB_OVERRIDE_VERSION, parseLabOverrideSnapshot, serializeLabOverrideSnapshot} from "./lab-overrides";

describe("变量覆盖的快照", () => {
    const allowed = new Set(["--radius-control", "--control-h-md"]);

    it("带版本的快照写出再读回来不变", () => {
        const raw = serializeLabOverrideSnapshot({"--radius-control": "8px"});
        expect(JSON.parse(raw)).toEqual({schema: LAB_OVERRIDE_SCHEMA, version: LAB_OVERRIDE_VERSION, overrides: {"--radius-control": "8px"}});
        expect(parseLabOverrideSnapshot(raw, allowed)).toEqual({"--radius-control": "8px"});
    });

    it("未登记的变量被拒", () => {
        expect(() => parseLabOverrideSnapshot(JSON.stringify({schema: LAB_OVERRIDE_SCHEMA, version: LAB_OVERRIDE_VERSION, overrides: {"--not-registered": "red"}}), allowed)).toThrow("未登记的变量");
    });

    it("schema 不对、值不是字符串、值里带规则边界都被拒", () => {
        expect(() => parseLabOverrideSnapshot(JSON.stringify({schema: "wrong", version: 1, overrides: {}}), allowed)).toThrow("schema");
        expect(() => parseLabOverrideSnapshot(JSON.stringify({schema: LAB_OVERRIDE_SCHEMA, version: LAB_OVERRIDE_VERSION, overrides: {"--radius-control": 8}}), allowed)).toThrow("字符串");
        expect(() => parseLabOverrideSnapshot(JSON.stringify({schema: LAB_OVERRIDE_SCHEMA, version: LAB_OVERRIDE_VERSION, overrides: {"--radius-control": "8px; color:red"}}), allowed)).toThrow("规则边界");
        expect(() => parseLabOverrideSnapshot("{坏的", allowed)).toThrow("JSON");
        expect(() => parseLabOverrideSnapshot(JSON.stringify({schema: LAB_OVERRIDE_SCHEMA, version: LAB_OVERRIDE_VERSION, overrides: {"--radius-control": "8px /*"}}), allowed)).toThrow("注释");
        expect(() => parseLabOverrideSnapshot(JSON.stringify({schema: LAB_OVERRIDE_SCHEMA, version: LAB_OVERRIDE_VERSION, overrides: {"--radius-control": "*/ 8px"}}), allowed)).toThrow("注释");
    });

    it("空值与超长的值被拒", () => {
        expect(() => parseLabOverrideSnapshot(JSON.stringify({schema: LAB_OVERRIDE_SCHEMA, version: LAB_OVERRIDE_VERSION, overrides: {"--radius-control": " "}}), allowed)).toThrow("不能为空");
        expect(() => parseLabOverrideSnapshot(JSON.stringify({schema: LAB_OVERRIDE_SCHEMA, version: LAB_OVERRIDE_VERSION, overrides: {"--radius-control": "x".repeat(513)}}), allowed)).toThrow("512");
    });

    it("导入是原子的：一项不合法整份拒绝", () => {
        const raw = serializeLabOverrideSnapshot({"--radius-control": "8px", "--control-h-md": "a;b"});
        expect(() => parseLabOverrideSnapshot(raw, allowed)).toThrow("规则边界");
    });
});
