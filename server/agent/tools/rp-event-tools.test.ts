import {describe, expect, it} from "vitest";
import {assertOperationPermission} from "nbook/server/agent/tools/rp-event-tools";
import {createBuiltinTools} from "nbook/server/agent/tools";

describe("rp_event tool permissions", () => {
    it("注册为内置事件工具", () => {
        expect(createBuiltinTools().map((tool) => tool.key)).toContain("rp_event");
    });

    it("screenwriter 只校验、leader 只执行玩家选择、world 维护客观生命周期", () => {
        expect(() => assertOperationPermission("rp.screenwriter", "validate_candidates")).not.toThrow();
        expect(() => assertOperationPermission("rp.screenwriter", "register_candidates")).toThrow("不允许");
        expect(() => assertOperationPermission("rp.leader", "select")).not.toThrow();
        expect(() => assertOperationPermission("rp.leader", "activate")).toThrow("不允许");
        expect(() => assertOperationPermission("rp.world", "register_candidates")).not.toThrow();
        expect(() => assertOperationPermission("rp.world", "finish")).not.toThrow();
        expect(() => assertOperationPermission("rp.world", "random_select")).toThrow("不允许");
    });
});
