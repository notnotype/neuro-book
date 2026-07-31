import {describe, expect, it} from "vitest";
import {Value} from "typebox/value";
import {assertFocusPermission, rpFocusTools} from "nbook/server/agent/tools/rp-focus-tools";
import {assertPipelinePermission} from "nbook/server/agent/tools/rp-pipeline-tools";

describe("RP pipeline/focus tool permissions", () => {
    it("pipeline 产物按 Agent 职责分离", () => {
        expect(() => assertPipelinePermission("rp.leader", {op: "advance"})).not.toThrow();
        expect(() => assertPipelinePermission("rp.leader", {op: "submit_plan"})).toThrow("不允许");
        expect(() => assertPipelinePermission("rp.world", {op: "capture_snapshot"})).not.toThrow();
        expect(() => assertPipelinePermission("rp.screenwriter", {op: "submit_adjudication"})).not.toThrow();
        expect(() => assertPipelinePermission("rp.cast", {op: "submit_actor_proposals"})).not.toThrow();
        expect(() => assertPipelinePermission("rp.extras", {op: "submit_extras"})).not.toThrow();
        expect(() => assertPipelinePermission("rp.extras", {op: "report_failure", kind: "major_actor"})).toThrow("不允许");
        expect(() => assertPipelinePermission("rp.cast", {op: "report_failure", kind: "major_actor"})).not.toThrow();
    });

    it("关注度设置、自动平衡和运行计划职责分离", () => {
        expect(() => assertFocusPermission("rp.leader", "set_intensity")).not.toThrow();
        expect(() => assertFocusPermission("rp.world", "set_intensity")).toThrow("不允许");
        expect(() => assertFocusPermission("rp.world", "rebalance")).not.toThrow();
        expect(() => assertFocusPermission("rp.screenwriter", "plan_runtime")).not.toThrow();
        expect(() => assertFocusPermission("rp.screenwriter", "record_long_jump")).toThrow("不允许");
    });

    it("world rebalance 使用严格根字段且不能伪装成 set_focus", () => {
        const rebalance = {
            op: "rebalance",
            projectPath: "workspace/rp-project",
            tick: 1,
            current: [],
            activeBackground: [],
            lowFrequency: [],
        };
        expect(Value.Check(rpFocusTools.rpFocus.validationSchema!, rebalance)).toBe(true);
        expect(Value.Check(rpFocusTools.rpFocus.validationSchema!, {...rebalance, reason: "不允许的根字段"})).toBe(false);
        expect(() => assertFocusPermission("rp.world", "set_focus")).toThrow("不允许");
    });

    it("plan_runtime 的 Provider 与执行契约一致，并要求原始 Instant", () => {
        const tool = rpFocusTools.rpFocus.runtime();
        const valid = {
            op: "plan_runtime", projectPath: "workspace/rp-project", turnId: "turn-1", longJump: false,
            startInstant: "7808400", endInstant: "7808460", currentNpcIds: ["dingdang"], directInteractionNpcIds: ["dingdang"],
        };
        expect(Value.Check(tool.parameters, valid)).toBe(true);
        expect(Value.Check(tool.validationSchema!, valid)).toBe(true);
        expect(Value.Check(tool.parameters, {...valid, worldSummary: "错误分支字段"})).toBe(false);
        expect(Value.Check(tool.validationSchema!, {...valid, worldSummary: "错误分支字段"})).toBe(false);
        expect(Value.Check(tool.parameters, {...valid, startInstant: "地下城历1年1月1日 11:50"})).toBe(false);
    });
});
