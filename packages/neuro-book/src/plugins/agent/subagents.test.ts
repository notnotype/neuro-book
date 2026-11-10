/**
 * 子代理（docs/specs/agent/subagents.md）。测试名里的编号是那份 Spec 的输出条目与验收场景。
 */
import {describe, expect, test} from "bun:test";

import {subagentsSection} from "./backend/subagents/prompt";
import {SessionRelations} from "./backend/subagents/relations";
import type {ProfileEntry} from "./shared/contracts";
import {profileAgents} from "./shared/profile-agents";

describe("白名单", () => {
    test("声明的加用户加的、减用户去掉的；推荐只留仍在白名单里的", () => {
        expect(profileAgents({allowed: ["a", "b"], recommended: ["a", "b"]}, {added: ["c"], removed: ["a"]})).toEqual({allowed: ["b", "c"], recommended: ["b"]});
        expect(profileAgents(undefined, undefined)).toEqual({allowed: [], recommended: []});
        expect(profileAgents(undefined, {added: ["user.x"], removed: []})).toEqual({allowed: ["user.x"], recommended: []});
    });
});

describe("提示词里的“可派的子代理”", () => {
    const entry = (key: string, name: string, agents?: ProfileEntry["agents"]): ProfileEntry => ({key, name, description: `${name}的说明`, source: "nbook.agent", status: "ok", ...(agents === undefined ? {} : {agents})});
    const catalog = [
        entry("main", "主创", {allowed: ["helper", "checker"], recommended: ["helper"]}),
        entry("helper", "临时帮手"),
        entry("checker", "设定核对"),
    ];
    const deps = (binding?: {added: string[]; removed: string[]}) => ({catalog: () => catalog, binding: () => binding});
    const noShapes = {get: () => undefined};

    test("输出 20：推荐的写名字、说明与形状，其余写名字与说明", () => {
        const shapes = {get: (key: string) => (key === "helper" ? {initial: {type: "object"}, result: {type: "string"}} : undefined)};
        const section = subagentsSection("main", true, deps(), shapes)!;
        expect(section).toContain("helper（临时帮手）：临时帮手的说明");
        expect(section).toContain(`初始输入（initial）：${JSON.stringify({type: "object"})}`);
        expect(section).toContain(`结果（交回时调用 yield）：${JSON.stringify({type: "string"})}`);
        expect(section).toContain("checker（设定核对）：设定核对的说明");
        expect(section.indexOf("helper")).toBeLessThan(section.indexOf("checker"));
    });

    test("输出 20：没有 agent_spawn、白名单为空时没有这一节；用户去掉之后不再写", () => {
        expect(subagentsSection("main", false, deps(), noShapes)).toBeNull();
        expect(subagentsSection("helper", true, deps(), noShapes)).toBeNull();
        expect(subagentsSection("main", true, deps({added: [], removed: ["helper", "checker"]}), noShapes)).toBeNull();
        expect(subagentsSection("main", true, deps({added: [], removed: ["helper"]}), noShapes)).not.toContain("helper");
    });
});

describe("会话关系", () => {
    const child = (id: string, parent: string, extra: {origin?: string; invocation?: string} = {}) => ({id, caller: {kind: "session" as const, id: parent, callId: `call-${id}`, ...(extra.invocation === undefined ? {} : {invocation: extra.invocation})}, ...(extra.origin === undefined ? {} : {origin: extra.origin})});

    test("深度、祖先、后代、根；fork 出来的标出来；Workflow 发起的不算父子", () => {
        const relations = new SessionRelations();
        relations.load([{id: "root"}, child("a", "root", {invocation: "inv-a"}), child("b", "a"), child("c", "a"), child("b2", "a", {origin: "b"}), {id: "wf", caller: {kind: "workflow", id: "flow", callId: "x"}}]);
        expect(relations.depthOf("root")).toBe(0);
        expect(relations.depthOf("b")).toBe(2);
        expect(relations.ancestorsOf("b")).toEqual(["a", "root"]);
        expect(relations.rootOf("c")).toBe("root");
        expect(relations.descendantsOf("root")).toEqual(["a", "b", "c", "b2"]);
        expect(relations.isForked("b2")).toBe(true);
        expect(relations.callOf("a")).toEqual({callId: "call-a", invocation: "inv-a"});
        expect(relations.parentOf("wf")).toBeNull();
    });

    test("扫描结果不盖掉扫描期间已经登记的；会话头成环时不死循环", () => {
        const relations = new SessionRelations();
        relations.register(child("a", "p2"));
        relations.load([child("a", "p1"), child("x", "y"), child("y", "x")]);
        expect(relations.parentOf("a")).toBe("p2");
        expect(relations.childrenOf("p1")).toEqual([]);
        expect(relations.ancestorsOf("x")).toEqual(["y"]);
        expect(relations.depthOf("x")).toBe(1);
    });
});
