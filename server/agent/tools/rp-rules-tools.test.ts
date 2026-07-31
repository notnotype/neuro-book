import {describe, expect, it} from "vitest";
import {createBuiltinTools} from "nbook/server/agent/tools";
import {assertPermission as assertMechanicsPermission, rpMechanicsTools} from "nbook/server/agent/tools/rp-mechanics-tools";
import {assertPermission as assertCognitionPermission, rpCognitionTools} from "nbook/server/agent/tools/rp-cognition-tools";

describe("RP P4 rule tools", () => {
    it("注册 mechanics/relation/cognition 三个工具", () => {
        const keys = createBuiltinTools().map((tool) => tool.key);
        expect(keys).toEqual(expect.arrayContaining(["rp_mechanics", "rp_relation", "rp_cognition"]));
    });

    it("mechanics 权限区分玩家审批与 world 客观维护", () => {
        expect(() => assertMechanicsPermission("rp.leader", "plan_jump")).not.toThrow();
        expect(() => assertMechanicsPermission("rp.leader", "approve_jump")).not.toThrow();
        expect(() => assertMechanicsPermission("rp.leader", "resolve_risk")).toThrow("不允许");
        expect(() => assertMechanicsPermission("rp.world", "resolve_risk")).not.toThrow();
        expect(() => assertMechanicsPermission("rp.screenwriter", "define_resource")).toThrow("不允许");
    });

    it("长跳审批和 OOC 解锁都必须触发真实用户输入", async () => {
        const jump = await rpMechanicsTools.rpMechanics.runtime().userInputRequest!.when({
            args: {op: "approve_jump", projectPath: "workspace/demo", turnId: "turn-1", startTime: "T0", endTime: "T100"},
            session: {sessionId: 1, profileKey: "rp.leader", workspaceRoot: "workspace", workspaceKey: "workspace", projectPath: "workspace/demo"},
        });
        const reveal = await rpCognitionTools.rpCognition.runtime().userInputRequest!.when({
            args: {op: "set_visibility", projectPath: "workspace/demo", factId: "fact:x", visible: true, reason: "玩家要求"},
            session: {sessionId: 1, profileKey: "rp.leader", workspaceRoot: "workspace", workspaceKey: "workspace", projectPath: "workspace/demo"},
        });
        expect(jump).not.toBeNull();
        expect(reveal).not.toBeNull();
        expect(() => assertCognitionPermission("rp.world", "set_visibility")).toThrow("不允许");
        expect(() => assertCognitionPermission("rp.leader", "set_visibility")).not.toThrow();
    });
});
