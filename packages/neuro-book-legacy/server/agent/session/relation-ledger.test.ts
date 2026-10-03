import {describe, expect, it} from "vitest";
import {reduceRelationLedger} from "nbook/server/agent/session/relation-ledger";
import type {SessionEntry} from "nbook/server/agent/session/types";

/** 构造关系账本测试使用的 custom entry。 */
function relationEntry(key: string, value: {sessionId: number; profileKey?: string}, id: string): SessionEntry {
    return {
        id,
        parentId: null,
        timestamp: Number(id),
        type: "custom",
        key,
        value,
    };
}

describe("relation ledger", () => {
    it("link → detach → link 会重新激活同一个 Agent", () => {
        expect(reduceRelationLedger([
            relationEntry("agent.link.7", {sessionId: 7, profileKey: "writer"}, "1"),
            relationEntry("agent.detach.7", {sessionId: 7}, "2"),
            relationEntry("agent.link.7", {sessionId: 7, profileKey: "writer"}, "3"),
        ])).toEqual([{sessionId: 7, profileKey: "writer", detached: false}]);
    });

    it("没有前置 link 的 detach 不会制造幽灵关系", () => {
        expect(reduceRelationLedger([
            relationEntry("agent.detach.7", {sessionId: 7}, "1"),
            relationEntry("agent.detach.7", {sessionId: 7}, "2"),
        ])).toEqual([]);
    });

    it("重复 detach 保持原关系身份并维持解除状态", () => {
        expect(reduceRelationLedger([
            relationEntry("agent.link.7", {sessionId: 7, profileKey: "writer"}, "1"),
            relationEntry("agent.detach.7", {sessionId: 7}, "2"),
            relationEntry("agent.detach.7", {sessionId: 7}, "3"),
        ])).toEqual([{sessionId: 7, profileKey: "writer", detached: true}]);
    });
});
