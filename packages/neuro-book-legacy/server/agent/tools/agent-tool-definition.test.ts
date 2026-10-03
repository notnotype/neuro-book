import {describe, expect, it} from "vitest";
import {Type} from "typebox";
import {defineAgentTool} from "nbook/server/agent/tools/types";

describe("defineAgentTool", () => {
    it("runtime 会保留定义层的 key/schema/description/executionMode", async () => {
        const parameters = Type.Object({
            text: Type.String(),
        });
        const definition = defineAgentTool({
            key: "definition_echo",
            name: "definition_echo",
            label: "Definition Echo",
            description: "Echo from definition.",
            parameters,
            executionMode: "sequential",
            async execute() {
                return {
                    content: [{type: "text", text: "ok"}],
                    details: {},
                };
            },
        });

        const runtime = definition.runtime();

        expect(runtime.key).toBe("definition_echo");
        expect(runtime.name).toBe("definition_echo");
        expect(runtime.label).toBe("Definition Echo");
        expect(runtime.description).toBe("Echo from definition.");
        expect(runtime.parameters).toBe(parameters);
        expect(runtime.executionMode).toBe("sequential");
        await expect(runtime.execute!("call", {text: "hello"})).resolves.toEqual({
            content: [{type: "text", text: "ok"}],
            details: {},
        });
    });

    it("bind 生成 profile binding 时携带 definition 但不携带 execute", () => {
        const definition = defineAgentTool({
            key: "definition_binding",
            description: "Binding test.",
            parameters: Type.Object({}),
            async execute() {
                return {
                    content: [{type: "text", text: "ok"}],
                    details: {},
                };
            },
        });

        expect(definition.bind({
            description: "Profile override.",
        })).toEqual({
            key: "definition_binding",
            definition,
            description: "Profile override.",
        });
    });
});
