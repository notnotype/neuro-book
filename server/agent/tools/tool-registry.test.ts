import {describe, expect, it} from "vitest";
import {Type} from "typebox";
import {AgentToolRegistry} from "nbook/server/agent/tools/tool-registry";
import {defineAgentTool} from "nbook/server/agent/tools/types";

describe("AgentToolRegistry provider schema contract", () => {
    it("rejects a function schema without an object root before provider dispatch", () => {
        const registry = new AgentToolRegistry();
        registry.register(defineAgentTool({
            key: "invalid_union",
            description: "Invalid provider schema fixture.",
            parameters: Type.Union([
                Type.Object({op: Type.Literal("read")}),
                Type.Object({op: Type.Literal("write"), value: Type.String()}),
            ]),
        }).runtime());

        expect(() => registry.allowed(["invalid_union"])).toThrow(
            "工具 invalid_union 的模型可见 parameters 必须是顶层 object",
        );
    });

    it("accepts an object provider schema with a separate strict validation schema", () => {
        const registry = new AgentToolRegistry();
        const validationSchema = Type.Union([
            Type.Object({op: Type.Literal("read")}),
            Type.Object({op: Type.Literal("write"), value: Type.String()}),
        ]);
        registry.register(defineAgentTool({
            key: "valid_envelope",
            description: "Valid provider schema fixture.",
            parameters: Type.Object({
                op: Type.Union([Type.Literal("read"), Type.Literal("write")]),
                value: Type.Optional(Type.String()),
            }),
            validationSchema,
        }).runtime());

        expect(registry.allowed(["valid_envelope"])).toHaveLength(1);
    });
});
