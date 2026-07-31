import {describe, expect, it} from "vitest";
import {Value} from "typebox/value";
import {createBuiltinTools} from "nbook/server/agent/tools";
import {assertMapPermission, rpMapTools} from "nbook/server/agent/tools/rp-map-tools";
import {assertNpcPermission, rpNpcTools} from "nbook/server/agent/tools/rp-npc-tools";

describe("RP P5 map and NPC tools", () => {
    it("注册 map 与 npc 两个内置工具", () => {
        expect(createBuiltinTools().map((tool) => tool.key)).toEqual(expect.arrayContaining(["rp_map", "rp_npc"]));
    });

    it("地图权限约束 screenwriter 提案、world 校验、leader 玩家决策", () => {
        expect(() => assertMapPermission("rp.screenwriter", {op: "propose", origin: "screenwriter"})).not.toThrow();
        expect(() => assertMapPermission(
            "rp.screenwriter",
            {op: "propose", origin: "bootstrap"},
            {phase: "bootstrapping", bootstrapStage: "map"},
        )).not.toThrow();
        expect(() => assertMapPermission(
            "rp.screenwriter",
            {op: "propose", origin: "bootstrap"},
            {phase: "bootstrapping", bootstrapStage: "world"},
        )).toThrow("bootstrapping/map");
        expect(() => assertMapPermission(
            "rp.screenwriter",
            {op: "propose", origin: "bootstrap"},
            {phase: "active", bootstrapStage: null},
        )).toThrow("bootstrapping/map");
        expect(() => assertMapPermission(
            "rp.world",
            {op: "propose", origin: "bootstrap"},
            {phase: "bootstrapping", bootstrapStage: "map"},
        )).toThrow("不允许");
        expect(() => assertMapPermission("rp.leader", {op: "propose", origin: "player"})).not.toThrow();
        expect(() => assertMapPermission("rp.screenwriter", {op: "replace_proposal", origin: "bootstrap"})).not.toThrow();
        expect(() => assertMapPermission("rp.world", {op: "replace_proposal", origin: "bootstrap"})).toThrow("不允许");
        expect(() => assertMapPermission("rp.leader", {op: "review"})).toThrow("不允许");
        expect(() => assertMapPermission("rp.world", {op: "review"})).not.toThrow();
        expect(() => assertMapPermission("rp.world", {op: "approve_conflict"})).toThrow("不允许");
    });

    it("地图 propose 每次只接受根字段中的一个地点", () => {
        const validationSchema = rpMapTools.rpMap.runtime().validationSchema!;
        const proposal = {
            op: "propose",
            projectPath: "workspace/demo",
            origin: "bootstrap",
            requestedId: "school",
            parentId: null,
            level: "town",
            canonicalName: "示例学校",
            playerSummary: "玩家就读的学校。",
            initialStatus: "familiar",
            persistenceBasis: ["world_structure"],
        };

        expect(Value.Check(validationSchema, proposal)).toBe(true);
        expect(Value.Check(validationSchema, {
            op: "propose",
            projectPath: "workspace/demo",
            origin: "bootstrap",
            candidates: [proposal],
        })).toBe(false);
    });

    it("NPC 权限约束 screenwriter 建议、leader 擢升、world 维护出场", () => {
        expect(() => assertNpcPermission("rp.screenwriter", "suggest")).not.toThrow();
        expect(() => assertNpcPermission("rp.screenwriter", "promote")).toThrow("不允许");
        expect(() => assertNpcPermission("rp.leader", "promote")).not.toThrow();
        expect(() => assertNpcPermission("rp.world", "set_presence")).not.toThrow();
        expect(() => assertNpcPermission("rp.world", "register_player")).toThrow("不允许");
    });

    it("地图冲突、导入确认与 NPC 擢升都触发真实玩家输入", async () => {
        const conflict = await rpMapTools.rpMap.runtime().userInputRequest!.when({
            args: {op: "approve_conflict", projectPath: "workspace/demo", proposalId: "proposal-1"},
            session: {sessionId: 1, profileKey: "rp.leader", workspaceRoot: "workspace", workspaceKey: "workspace", projectPath: "workspace/demo"},
        });
        const imports = await rpMapTools.rpMap.runtime().userInputRequest!.when({
            args: {op: "confirm_import", projectPath: "workspace/demo", decisions: [{proposalId: "proposal-1", include: true}]},
            session: {sessionId: 1, profileKey: "rp.leader", workspaceRoot: "workspace", workspaceKey: "workspace", projectPath: "workspace/demo"},
        });
        const promote = await rpNpcTools.rpNpc.runtime().userInputRequest!.when({
            args: {op: "promote", projectPath: "workspace/demo", npcId: "lin", targetTier: "major", reason: "关系深厚", tick: 5},
            session: {sessionId: 1, profileKey: "rp.leader", workspaceRoot: "workspace", workspaceKey: "workspace", projectPath: "workspace/demo"},
        });
        expect(conflict).not.toBeNull();
        expect(imports).not.toBeNull();
        expect(promote).not.toBeNull();
    });
});
