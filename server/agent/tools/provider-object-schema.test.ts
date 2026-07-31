import {describe, expect, it} from "vitest";
import {Type} from "typebox";
import {Value} from "typebox/value";
import {providerObjectSchema} from "nbook/server/agent/tools/provider-object-schema";
import {operationSchemaForArguments} from "nbook/server/agent/tools/operation-schema";

describe("providerObjectSchema", () => {
    it("projects an operation union to an object root without weakening runtime validation", () => {
        const validationSchema = Type.Union([
            Type.Object({
                op: Type.Literal("read"),
                projectPath: Type.String(),
            }, {additionalProperties: false}),
            Type.Object({
                op: Type.Literal("write"),
                projectPath: Type.String(),
                value: Type.String(),
            }, {additionalProperties: false}),
        ]);

        const parameters = providerObjectSchema(validationSchema);

        expect(parameters).toMatchObject({
            type: "object",
            additionalProperties: false,
            required: expect.arrayContaining(["op", "projectPath"]),
        });
        expect(parameters).toHaveProperty("anyOf");
        expect(parameters.properties).toHaveProperty("value");
        expect(Value.Check(parameters, {op: "write", projectPath: "workspace/demo"})).toBe(false);
        expect(Value.Check(parameters, {op: "read", projectPath: "workspace/demo", value: "wrong branch"})).toBe(false);
        expect(Value.Check(validationSchema, {op: "write", projectPath: "workspace/demo"})).toBe(false);
        expect(Value.Check(validationSchema, {op: "write", projectPath: "workspace/demo", value: "ok"})).toBe(true);
        expect(operationSchemaForArguments(validationSchema, {op: "write"})).toBe(validationSchema.anyOf[1]);
    });
});
