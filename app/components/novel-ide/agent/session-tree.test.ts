import {describe, expect, it} from "vitest";
import type {SessionTreeNode} from "nbook/server/agent/session/types";
import type {ChatEntryKind} from "nbook/shared/dto/agent-public-event.dto";
import {deriveAgentSessionTreeRows, deriveAgentTreeState, resolveBranchSwitchTarget} from "nbook/app/components/novel-ide/agent/session-tree";

/**
 * 按 type/role 推出默认 `chatEntry`，镜像服务端 `chatEntryKind()` 的常见情形。
 * 权威判据在服务端并由投影不变量测试守护；这里只是让 fixture 少写样板，
 * 需要偏离默认（幽灵 user 消息、报错 lifecycle）的用例必须显式声明 `chatEntry`。
 */
const defaultChatEntry = (type: SessionTreeNode["type"], role: string | undefined): ChatEntryKind | undefined => {
    if (type === "message") {
        if (role === "user") return "user";
        if (role === "assistant") return "assistant";
        return role === "toolResult" ? "tool_result" : undefined;
    }
    return type === "custom_message" || type === "compaction" || type === "branch_summary" ? "system" : undefined;
};

const node = (patch: Partial<SessionTreeNode> & Pick<SessionTreeNode, "id" | "parentId">): SessionTreeNode => {
    const type = patch.type ?? "message";
    const role = "role" in patch ? patch.role : "assistant";
    return {
        type,
        timestamp: 1,
        active: false,
        terminal: true,
        childCount: 0,
        role,
        chatEntry: defaultChatEntry(type, role),
        ...patch,
    };
};

/** 运行期记账 entry：不进 Chat Flow，对分支投影必须完全透明。 */
const bookkeeping = (
    id: string,
    parentId: string | null,
    type: SessionTreeNode["type"],
    patch: Partial<SessionTreeNode> = {},
): SessionTreeNode => node({id, parentId, type, role: undefined, chatEntry: undefined, ...patch});

describe("agent session tree", () => {
    it("为 active path 上每个有 sibling 的消息派生切换状态", () => {
        const tree = [
            node({id: "u1", parentId: null, role: "user", timestamp: 1, active: true, childCount: 2}),
            node({id: "a1", parentId: "u1", timestamp: 2, active: false}),
            node({id: "a2", parentId: "u1", timestamp: 3, active: true, childCount: 2}),
            node({id: "u2", parentId: "a2", role: "user", timestamp: 4, active: true}),
            node({id: "u3", parentId: "a2", role: "user", timestamp: 5, active: false}),
        ];

        const state = deriveAgentTreeState(tree);

        expect(state.switcherByMessageId.a2).toEqual({
            nodeIds: ["a1", "a2"],
            currentIndex: 1,
            total: 2,
        });
        expect(state.switcherByMessageId.u2).toEqual({
            nodeIds: ["u2", "u3"],
            currentIndex: 0,
            total: 2,
        });
    });

    it("切换 sibling 时定位到该分支最新 terminal descendant", () => {
        const tree = [
            node({id: "u1", parentId: null, role: "user", timestamp: 1, active: true, childCount: 2}),
            node({id: "a1", parentId: "u1", timestamp: 2, active: false, terminal: false, childCount: 1}),
            node({id: "a1-u1", parentId: "a1", role: "user", timestamp: 10, active: false}),
            node({id: "a2", parentId: "u1", timestamp: 3, active: true}),
        ];

        const state = deriveAgentTreeState(tree);
        const target = resolveBranchSwitchTarget(state, "a2", 1);

        expect(target?.id).toBe("a1-u1");
    });

    it("消息切分支使用 continuation lane roots 而不是同 role message sibling", () => {
        const tree = [
            node({id: "A", parentId: null, role: "assistant", timestamp: 1, active: true, childCount: 1}),
            node({id: "B", parentId: "A", role: "toolResult", toolName: "report_result", timestamp: 2, active: true, childCount: 2}),
            node({id: "C1", parentId: "B", role: "user", timestamp: 3, active: true}),
            node({id: "C2", parentId: "B", role: "assistant", timestamp: 4, active: false}),
        ];

        const state = deriveAgentTreeState(tree);

        expect(state.switcherByMessageId.C1).toEqual({
            nodeIds: ["C1", "C2"],
            currentIndex: 0,
            total: 2,
        });
        expect(state.switcherByMessageId.C2).toBeUndefined();
        expect(resolveBranchSwitchTarget(state, "C1", 1)?.id).toBe("C2");
    });

    // 以下形状全部取自 workspace/.nbook/agent/sessions 的真实会话。
    // 每次 invoke 写入的第一条 entry 必然是 invocation_lifecycle:start，它会挡在分叉点和新消息之间；
    // 旧实现要求分支根自己就是消息，因此真实的重试分支一个都显示不出来。
    describe("真实 session 形状", () => {
        it("重试：lifecycle start 挡在分叉点和新回复之间，切换器仍落在新回复上", () => {
            const tree = [
                node({id: "U", parentId: null, role: "user", timestamp: 1, active: true, childCount: 2, terminal: false}),
                node({id: "A_old", parentId: "U", timestamp: 2, active: false}),
                bookkeeping("L2", "U", "invocation_lifecycle", {timestamp: 3, active: true, childCount: 1, terminal: false}),
                node({id: "A_new", parentId: "L2", timestamp: 4, active: true}),
            ];

            const state = deriveAgentTreeState(tree);

            expect(state.switcherByMessageId.A_new).toEqual({
                nodeIds: ["A_old", "A_new"],
                currentIndex: 1,
                total: 2,
            });
            expect(state.switcherByMessageId.L2).toBeUndefined();
            expect(resolveBranchSwitchTarget(state, "A_new", -1)?.id).toBe("A_old");
        });

        it("换模型重试：model_change 不构成独立分支", () => {
            const tree = [
                node({id: "U", parentId: null, role: "user", timestamp: 1, active: true, childCount: 2, terminal: false}),
                node({id: "A_old", parentId: "U", timestamp: 2, active: false}),
                bookkeeping("MC", "U", "model_change", {timestamp: 3, active: true, childCount: 1, terminal: false}),
                bookkeeping("L2", "MC", "invocation_lifecycle", {timestamp: 4, active: true, childCount: 1, terminal: false}),
                node({id: "A_new", parentId: "L2", timestamp: 5, active: true}),
            ];

            const state = deriveAgentTreeState(tree);

            expect(state.switcherByMessageId.A_new).toEqual({
                nodeIds: ["A_old", "A_new"],
                currentIndex: 1,
                total: 2,
            });
            expect(state.switcherByMessageId.MC).toBeUndefined();
        });

        it("连续失败后成功（会话 775 形状）：两次报错各算一条分支", () => {
            const tree = [
                node({id: "U", parentId: null, role: "user", timestamp: 1, active: true, childCount: 3, terminal: false}),
                bookkeeping("E1", "U", "invocation_lifecycle", {timestamp: 2, chatEntry: "invocation_error"}),
                bookkeeping("L2", "U", "invocation_lifecycle", {timestamp: 3, childCount: 1, terminal: false}),
                bookkeeping("E2", "L2", "invocation_lifecycle", {timestamp: 4, chatEntry: "invocation_error"}),
                bookkeeping("MC", "U", "model_change", {timestamp: 5, active: true, childCount: 1, terminal: false}),
                bookkeeping("L3", "MC", "invocation_lifecycle", {timestamp: 6, active: true, childCount: 1, terminal: false}),
                node({id: "A", parentId: "L3", timestamp: 7, active: true}),
            ];

            const state = deriveAgentTreeState(tree);

            expect(state.switcherByMessageId.A).toEqual({
                nodeIds: ["E1", "E2", "A"],
                currentIndex: 2,
                total: 3,
            });
        });

        it("停在报错分支时仍能切回上一个好答案", () => {
            const tree = [
                node({id: "U", parentId: null, role: "user", timestamp: 1, active: true, childCount: 2, terminal: false}),
                node({id: "A_good", parentId: "U", timestamp: 2, active: false}),
                bookkeeping("L2", "U", "invocation_lifecycle", {timestamp: 3, active: true, childCount: 1, terminal: false}),
                bookkeeping("E", "L2", "invocation_lifecycle", {timestamp: 4, active: true, chatEntry: "invocation_error"}),
            ];

            const state = deriveAgentTreeState(tree);

            expect(state.switcherByMessageId.E).toEqual({
                nodeIds: ["A_good", "E"],
                currentIndex: 1,
                total: 2,
            });
            expect(resolveBranchSwitchTarget(state, "E", -1)?.id).toBe("A_good");
        });

        it("agent.link 记账 entry 不构成假分支（会话 177 形状）", () => {
            const tree = [
                node({id: "A0", parentId: null, timestamp: 1, active: true, childCount: 1, terminal: false}),
                node({id: "TR", parentId: "A0", role: "toolResult", toolName: "read", timestamp: 2, active: true, childCount: 2, terminal: false}),
                bookkeeping("LINK", "TR", "custom", {timestamp: 3}),
                node({id: "A1", parentId: "TR", timestamp: 4, active: true}),
            ];

            const state = deriveAgentTreeState(tree);

            expect(state.switcherByMessageId).toEqual({});
        });

        it("harness / workflow 注入的 user 消息不构成分支", () => {
            const tree = [
                node({id: "A0", parentId: null, timestamp: 1, active: true, childCount: 2, terminal: false}),
                node({id: "ghost", parentId: "A0", role: "user", chatEntry: undefined, timestamp: 2, active: false}),
                node({id: "A1", parentId: "A0", timestamp: 3, active: true}),
            ];

            const state = deriveAgentTreeState(tree);

            expect(state.switcherByMessageId).toEqual({});
        });

        it("编辑重发：新旧用户消息各算一条分支，system reminder 透明", () => {
            const tree = [
                bookkeeping("L1", null, "invocation_lifecycle", {timestamp: 1, active: true, childCount: 2, terminal: false}),
                node({id: "U_old", parentId: "L1", role: "user", timestamp: 2, active: false}),
                node({id: "R", parentId: "L1", type: "custom_message", role: "user", timestamp: 3, active: true, childCount: 1, terminal: false}),
                node({id: "U_new", parentId: "R", role: "user", timestamp: 4, active: true}),
            ];

            const state = deriveAgentTreeState(tree);

            expect(state.switcherByMessageId.U_new).toEqual({
                nodeIds: ["U_old", "U_new"],
                currentIndex: 1,
                total: 2,
            });
            expect(state.switcherByMessageId.R).toBeUndefined();
        });

        it("分叉整体不在 active path 上时不显示切换器", () => {
            const tree = [
                node({id: "U", parentId: null, role: "user", timestamp: 1, active: true, childCount: 1, terminal: false}),
                node({id: "A", parentId: "U", timestamp: 2, active: true, childCount: 2, terminal: false}),
                node({id: "dead1", parentId: "A", role: "user", timestamp: 3, active: false}),
                node({id: "dead2", parentId: "A", role: "user", timestamp: 4, active: false}),
            ];

            const state = deriveAgentTreeState(tree);

            expect(state.switcherByMessageId).toEqual({});
        });
    });

    it("按树结构 preorder 展开，而不是按 JSONL append 顺序展示", () => {
        const tree = [
            node({id: "u1", parentId: null, role: "user", timestamp: 1, active: true}),
            node({id: "a1", parentId: "u1", timestamp: 2, active: true}),
            node({id: "u2", parentId: "a1", role: "user", timestamp: 3, active: true}),
            node({id: "a2", parentId: "u1", timestamp: 4, active: false}),
            node({id: "a2-u1", parentId: "a2", role: "user", timestamp: 10, active: false}),
        ];

        const state = deriveAgentTreeState(tree);

        expect(state.flattenedNodes.map((item) => item.id)).toEqual(["u1", "a1", "u2", "a2", "a2-u1"]);
    });

    it("projection 在线性链上保持同一 lane", () => {
        const tree = [
            node({id: "A", parentId: null, timestamp: 1, childCount: 1}),
            node({id: "B", parentId: "A", timestamp: 2, childCount: 1}),
            node({id: "C", parentId: "B", timestamp: 3, childCount: 1}),
            node({id: "D", parentId: "C", timestamp: 4}),
        ];

        const rows = deriveAgentSessionTreeRows({tree, filterMode: "all"});

        expect(rows.map((row) => [row.node.id, row.laneDepth])).toEqual([
            ["A", 0],
            ["B", 0],
            ["C", 0],
            ["D", 0],
        ]);
    });

    it("projection 只有进入真实分支时才增加 laneDepth", () => {
        const tree = [
            node({id: "A", parentId: null, timestamp: 1, childCount: 1}),
            node({id: "B", parentId: "A", timestamp: 2, childCount: 2}),
            node({id: "C1", parentId: "B", timestamp: 3, childCount: 1}),
            node({id: "D1", parentId: "C1", timestamp: 4}),
            node({id: "C2", parentId: "B", timestamp: 5, childCount: 1}),
            node({id: "D2", parentId: "C2", timestamp: 6}),
        ];

        const rows = deriveAgentSessionTreeRows({tree, filterMode: "all"});

        expect(rows.map((row) => [row.node.id, row.laneDepth])).toEqual([
            ["A", 0],
            ["B", 0],
            ["C1", 1],
            ["D1", 1],
            ["C2", 1],
            ["D2", 1],
        ]);
        expect(rows.find((row) => row.node.id === "B")).toMatchObject({
            isBranchPoint: true,
            branchSiblingCount: 0,
            branchIndex: null,
        });
        expect(rows.find((row) => row.node.id === "C1")).toMatchObject({
            isBranchPoint: false,
            branchSiblingCount: 2,
            branchIndex: 0,
        });
        expect(rows.find((row) => row.node.id === "D1")).toMatchObject({
            branchSiblingCount: 0,
            branchIndex: null,
        });
        expect(rows.map((row) => [row.node.id, row.guideParts])).toEqual([
            ["A", ["root"]],
            ["B", ["root"]],
            ["C1", ["branch"]],
            ["D1", ["line"]],
            ["C2", ["end"]],
            ["D2", ["space"]],
        ]);
    });

    it("projection 默认保持分支全展开", () => {
        const tree = [
            node({id: "A", parentId: null, timestamp: 1, childCount: 1}),
            node({id: "B", parentId: "A", timestamp: 2, childCount: 2}),
            node({id: "C1", parentId: "B", timestamp: 3, childCount: 1}),
            node({id: "D1", parentId: "C1", timestamp: 4}),
            node({id: "C2", parentId: "B", timestamp: 5}),
        ];

        const rows = deriveAgentSessionTreeRows({tree, filterMode: "all"});

        expect(rows.map((row) => row.node.id)).toEqual(["A", "B", "C1", "D1", "C2"]);
        expect(rows.find((row) => row.node.id === "B")).toMatchObject({
            collapsible: true,
            collapsed: false,
            hiddenDescendantCount: 0,
        });
    });

    it("projection 收起 branch point 时保留自身并隐藏整段子树", () => {
        const tree = [
            node({id: "A", parentId: null, timestamp: 1, childCount: 1}),
            node({id: "B", parentId: "A", timestamp: 2, childCount: 2}),
            node({id: "C1", parentId: "B", timestamp: 3, childCount: 1}),
            node({id: "D1", parentId: "C1", timestamp: 4}),
            node({id: "C2", parentId: "B", timestamp: 5, childCount: 1}),
            node({id: "D2", parentId: "C2", timestamp: 6}),
        ];

        const rows = deriveAgentSessionTreeRows({
            tree,
            filterMode: "all",
            collapsedBranchIds: new Set(["B"]),
        });

        expect(rows.map((row) => row.node.id)).toEqual(["A", "B"]);
        expect(rows.find((row) => row.node.id === "B")).toMatchObject({
            collapsible: true,
            collapsed: true,
            hiddenDescendantCount: 4,
        });
    });

    it("projection 只在嵌套分支处继续增加 laneDepth", () => {
        const tree = [
            node({id: "A", parentId: null, timestamp: 1, childCount: 1}),
            node({id: "B", parentId: "A", timestamp: 2, childCount: 2}),
            node({id: "C1", parentId: "B", timestamp: 3, childCount: 1}),
            node({id: "D1", parentId: "C1", timestamp: 4, childCount: 2}),
            node({id: "E1", parentId: "D1", timestamp: 5}),
            node({id: "E2", parentId: "D1", timestamp: 6}),
            node({id: "C2", parentId: "B", timestamp: 7, childCount: 1}),
            node({id: "D2", parentId: "C2", timestamp: 8}),
        ];

        const rows = deriveAgentSessionTreeRows({tree, filterMode: "all"});

        expect(rows.map((row) => [row.node.id, row.laneDepth])).toEqual([
            ["A", 0],
            ["B", 0],
            ["C1", 1],
            ["D1", 1],
            ["E1", 2],
            ["E2", 2],
            ["C2", 1],
            ["D2", 1],
        ]);
        expect(rows.find((row) => row.node.id === "E1")?.guideParts).toEqual(["line", "branch"]);
        expect(rows.find((row) => row.node.id === "E2")?.guideParts).toEqual(["line", "end"]);
    });

    it("projection 收起嵌套分支时外层 sibling lane 仍显示", () => {
        const tree = [
            node({id: "A", parentId: null, timestamp: 1, childCount: 1}),
            node({id: "B", parentId: "A", timestamp: 2, childCount: 2}),
            node({id: "C1", parentId: "B", timestamp: 3, childCount: 1}),
            node({id: "D1", parentId: "C1", timestamp: 4, childCount: 2}),
            node({id: "E1", parentId: "D1", timestamp: 5}),
            node({id: "E2", parentId: "D1", timestamp: 6}),
            node({id: "C2", parentId: "B", timestamp: 7, childCount: 1}),
            node({id: "D2", parentId: "C2", timestamp: 8}),
        ];

        const rows = deriveAgentSessionTreeRows({
            tree,
            filterMode: "all",
            collapsedBranchIds: new Set(["D1"]),
        });

        expect(rows.map((row) => [row.node.id, row.guideParts])).toEqual([
            ["A", ["root"]],
            ["B", ["root"]],
            ["C1", ["branch"]],
            ["D1", ["line"]],
            ["C2", ["end"]],
            ["D2", ["space"]],
        ]);
        expect(rows.find((row) => row.node.id === "D1")).toMatchObject({
            collapsed: true,
            hiddenDescendantCount: 2,
        });
    });

    it("projection 在过滤工具时保留 branch point 和直接 continuation", () => {
        const tree = [
            node({id: "A", parentId: null, role: "user", timestamp: 1, childCount: 1}),
            node({id: "T", parentId: "A", role: "toolResult", toolName: "read", timestamp: 2, childCount: 2}),
            node({id: "U1", parentId: "T", role: "user", timestamp: 3}),
            node({id: "R1", parentId: "T", role: "toolResult", toolName: "read", timestamp: 4}),
        ];

        const rows = deriveAgentSessionTreeRows({tree, filterMode: "no-tools"});

        expect(rows.map((row) => row.node.id)).toEqual(["A", "T", "U1", "R1"]);
        expect(rows.find((row) => row.node.id === "T")?.isBranchPoint).toBe(true);
        expect(rows.find((row) => row.node.id === "R1")?.laneDepth).toBe(1);
    });

    it("projection 在过滤工具时按过滤后的可见行统计隐藏数量", () => {
        const tree = [
            node({id: "A", parentId: null, role: "user", timestamp: 1, childCount: 1}),
            node({id: "T", parentId: "A", role: "toolResult", toolName: "read", timestamp: 2, childCount: 2}),
            node({id: "U1", parentId: "T", role: "user", timestamp: 3}),
            node({id: "R1", parentId: "T", role: "toolResult", toolName: "read", timestamp: 4}),
        ];

        const rows = deriveAgentSessionTreeRows({
            tree,
            filterMode: "no-tools",
            collapsedBranchIds: new Set(["T"]),
        });

        expect(rows.map((row) => row.node.id)).toEqual(["A", "T"]);
        expect(rows.find((row) => row.node.id === "T")).toMatchObject({
            collapsed: true,
            hiddenDescendantCount: 2,
        });
    });

    it("projection 搜索深层命中时只保留命中路径的 branch anchor", () => {
        const tree = [
            node({id: "A", parentId: null, timestamp: 1, childCount: 1}),
            node({id: "B", parentId: "A", timestamp: 2, childCount: 2}),
            node({id: "C1", parentId: "B", timestamp: 3, childCount: 1}),
            node({id: "D1", parentId: "C1", timestamp: 4, childCount: 1}),
            node({id: "E1", parentId: "D1", timestamp: 5, preview: "needle"}),
            node({id: "C2", parentId: "B", timestamp: 6, childCount: 1}),
            node({id: "D2", parentId: "C2", timestamp: 7}),
        ];

        const rows = deriveAgentSessionTreeRows({tree, filterMode: "default", query: "needle"});

        expect(rows.map((row) => row.node.id)).toEqual(["B", "C1", "E1"]);
        expect(rows.find((row) => row.node.id === "B")?.isBranchPoint).toBe(true);
        expect(rows.find((row) => row.node.id === "C1")?.laneDepth).toBe(1);
        expect(rows.find((row) => row.node.id === "E1")?.laneDepth).toBe(1);
    });

    it("projection 搜索时临时忽略折叠状态", () => {
        const tree = [
            node({id: "A", parentId: null, timestamp: 1, childCount: 1}),
            node({id: "B", parentId: "A", timestamp: 2, childCount: 2}),
            node({id: "C1", parentId: "B", timestamp: 3, childCount: 1}),
            node({id: "D1", parentId: "C1", timestamp: 4, childCount: 1}),
            node({id: "E1", parentId: "D1", timestamp: 5, preview: "needle"}),
            node({id: "C2", parentId: "B", timestamp: 6}),
        ];

        const rows = deriveAgentSessionTreeRows({
            tree,
            filterMode: "default",
            query: "needle",
            collapsedBranchIds: new Set(["B"]),
        });

        expect(rows.map((row) => row.node.id)).toEqual(["B", "C1", "E1"]);
        expect(rows.find((row) => row.node.id === "B")).toMatchObject({
            collapsed: false,
            hiddenDescendantCount: 0,
        });
    });

    it("projection 显示 sidecar enter 与 lifecycle end sibling 形成的 branch group", () => {
        const tree = [
            node({id: "tool-result", parentId: null, role: "toolResult", toolName: "report_result", timestamp: 1, childCount: 2}),
            node({id: "sidecar-enter", parentId: "tool-result", role: "user", timestamp: 2, preview: "sidecar: actor.memory-save"}),
            node({
                id: "run-end",
                parentId: "tool-result",
                type: "invocation_lifecycle",
                role: undefined,
                chatEntry: undefined,
                timestamp: 3,
                preview: "run end",
            }),
        ];

        const rows = deriveAgentSessionTreeRows({tree, filterMode: "default"});

        expect(rows.map((row) => row.node.id)).toEqual(["tool-result", "sidecar-enter", "run-end"]);
        expect(rows.find((row) => row.node.id === "sidecar-enter")).toMatchObject({
            laneDepth: 1,
            branchSiblingCount: 2,
            branchIndex: 0,
        });
        expect(rows.find((row) => row.node.id === "run-end")).toMatchObject({
            laneDepth: 1,
            branchSiblingCount: 2,
            branchIndex: 1,
        });
    });
});
