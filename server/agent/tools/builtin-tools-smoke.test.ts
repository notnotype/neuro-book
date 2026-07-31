import {describe, expect, test} from "vitest";
import {createBuiltinTools} from "./index";

describe("createBuiltinTools smoke test", () => {
    test("should not throw on initialization", () => {
        expect(() => createBuiltinTools()).not.toThrow();
    });

    test("should include unified world engine tool", () => {
        const tools = createBuiltinTools();
        const keys = tools.map((t) => t.key);

        expect(keys).toContain("execute_world");
        expect(keys).toContain("variable_schema");
        expect(keys).toContain("variable_read");
        expect(keys).toContain("variable_patch");

        // 确认旧的固定工具已移除。
        expect(keys).not.toContain("execute_world_query");
        expect(keys).not.toContain("write_world_slice");
        expect(keys).not.toContain("delete_world_slice");
        expect(keys).not.toContain("get_world_state");
        expect(keys).not.toContain("list_world_slices");
        expect(keys).not.toContain("edit_world_slice");
        expect(keys).not.toContain("create_world_subject");
        expect(keys).not.toContain("get_world_schema");
        expect(keys).not.toContain("list_world_subjects");
    });

    test("all provider-visible schemas should have an object root", () => {
        const tools = createBuiltinTools();

        for (const tool of tools) {
            expect(tool.parameters, tool.key).toMatchObject({type: "object"});
        }
    });

    test("RP operation tools should retain strict union validation", () => {
        const rpOperationKeys = [
            "rp_cognition",
            "rp_event",
            "rp_intake",
            "rp_mechanics",
            "rp_map",
            "rp_npc",
            "rp_pipeline",
            "rp_focus",
            "rp_turn",
        ];
        const tools = createBuiltinTools();

        for (const key of rpOperationKeys) {
            const tool = tools.find((candidate) => candidate.key === key);
            expect(tool, key).toBeDefined();
            expect(tool!.validationSchema, key).toHaveProperty("anyOf");
        }
    });
});
