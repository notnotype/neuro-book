import {describe, expect, it} from "vitest";
import {Type} from "typebox";
import {assertTypeBoxValue, formatTypeBoxValueErrors} from "nbook/server/agent/profiles/schema-validation";

describe("TypeBox schema validation errors", () => {
    const schema = Type.Object({
        sourceSessionId: Type.Number(),
        mode: Type.Union([Type.Literal("short"), Type.Literal("long")]),
    }, {additionalProperties: false});

    it("报告必填字段、额外字段和 JSON Pointer", () => {
        const message = formatTypeBoxValueErrors(schema, {extra: true});

        expect(message).toContain("/sourceSessionId：缺少必填字段");
        expect(message).toContain("/mode：缺少必填字段");
        expect(message).toContain("/extra：不允许的额外字段");
    });

    it("严格校验不执行转换", () => {
        expect(() => assertTypeBoxValue(schema, {
            sourceSessionId: "1",
            mode: "short",
        })).toThrow("/sourceSessionId");
    });
});
