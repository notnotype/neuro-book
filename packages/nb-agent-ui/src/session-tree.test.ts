import {describe, expect, test} from "bun:test";

import {graphEdgePath, graphPosition, sessionTreeGraph, sessionTreeRows} from "./session-tree";
import type {SessionTreeNodeView} from "./session-tree";

/** 一轮之后分成三条，内部节点穿插在中间，与内核写的一样细。 */
const NODES: SessionTreeNodeView[] = [
    {id: "created", parent: null, type: "sessionCreated"},
    {id: "run", parent: "created", type: "runStarted"},
    {id: "u1", parent: "run", type: "input", label: "开头"},
    {id: "m1", parent: "u1", type: "modelStarted"},
    {id: "a1", parent: "m1", type: "assistant", label: "回复一"},
    {id: "t1", parent: "a1", type: "toolStarted", label: "read"},
    {id: "r1", parent: "t1", type: "toolResult"},
    {id: "u2", parent: "r1", type: "input", label: "分支甲"},
    {id: "a2", parent: "u2", type: "assistant", label: "甲的回复"},
    {id: "u3", parent: "r1", type: "input", label: "分支乙"},
    {id: "a3", parent: "u3", type: "assistant", label: "乙的回复"},
    {id: "a4", parent: "r1", type: "assistant", label: "重试"},
    {id: "end", parent: "a2", type: "runEnded"},
];
const PATH = ["created", "run", "u1", "m1", "a1", "t1", "r1", "u2", "a2", "end"];

describe("列表", () => {
    test("内部节点穿过去；线性的不缩进；分叉进一层，最后一条是 end；当前路径的分支排最前", () => {
        const rows = sessionTreeRows({nodes: NODES, activePath: PATH, filter: "default"});
        expect(rows.map((row) => [row.id, row.guides.join(",")])).toEqual([
            ["u1", ""], ["a1", ""], ["t1", ""],
            ["u2", "branch"], ["a2", "line"],
            ["u3", "branch"], ["a3", "line"],
            ["a4", "end"],
        ]);
        expect(rows.find((row) => row.id === "t1")!.forks).toBe(3);
        expect(rows.filter((row) => row.onPath).map((row) => row.id)).toEqual(["u1", "a1", "t1", "u2", "a2"]);
        // 路径的末端是内部节点，“当前”落在最后一个显示的节点上。
        expect(rows.filter((row) => row.current).map((row) => row.id)).toEqual(["a2"]);
    });

    test("不含工具：穿过工具节点，分叉接到回复上；只看用户：只有用户的话；全部：连内部节点", () => {
        const noTools = sessionTreeRows({nodes: NODES, activePath: PATH, filter: "no-tools"});
        expect(noTools.map((row) => row.id)).not.toContain("t1");
        expect(noTools.find((row) => row.id === "a1")!.forks).toBe(3);
        expect(sessionTreeRows({nodes: NODES, activePath: PATH, filter: "user"}).map((row) => row.id)).toEqual(["u1", "u2", "u3"]);
        expect(sessionTreeRows({nodes: NODES, activePath: PATH, filter: "all"})).toHaveLength(NODES.length);
    });

    test("收起一条分支：藏掉后面的行，写藏了几行；搜索时展开全部，只留命中的", () => {
        const rows = sessionTreeRows({nodes: NODES, activePath: PATH, filter: "default", collapsed: new Set(["u3"])});
        expect(rows.map((row) => row.id)).not.toContain("a3");
        expect(rows.find((row) => row.id === "u3")).toMatchObject({collapsed: true, hidden: 1, collapsible: true});
        const found = sessionTreeRows({nodes: NODES, activePath: PATH, filter: "default", collapsed: new Set(["u3"]), query: "乙的"});
        expect(found.map((row) => row.id)).toEqual(["a3"]);
    });

    test("分支道：当前路径是 0，别的分支各一道，缩进线带着道号", () => {
        const rows = sessionTreeRows({nodes: NODES, activePath: PATH, filter: "default"});
        const row = (id: string) => rows.find((item) => item.id === id)!;
        expect(row("a1").lane).toBe(0);
        expect(row("u2").lane).toBe(0);
        expect(row("u3").lane).toBeGreaterThan(0);
        expect(row("a4").lane).not.toBe(row("u3").lane);
        expect(row("u3").guideLanes).toEqual([row("u3").lane]);
        expect(row("a3").guideLanes).toEqual([row("u3").lane]);
    });

    test("多层分叉：外层没走完时缩进线接着画，走完了留空", () => {
        const nodes: SessionTreeNodeView[] = [
            {id: "root", parent: null, type: "input", label: "根"},
            {id: "a", parent: "root", type: "input", label: "甲"},
            {id: "a1", parent: "a", type: "assistant", label: "甲一"},
            {id: "a2", parent: "a", type: "assistant", label: "甲二"},
            {id: "b", parent: "root", type: "input", label: "乙"},
            {id: "b1", parent: "b", type: "assistant", label: "乙一"},
            {id: "b2", parent: "b", type: "assistant", label: "乙二"},
        ];
        const rows = sessionTreeRows({nodes, activePath: ["root", "a", "a1"], filter: "default"});
        expect(rows.map((row) => [row.id, row.guides.join(",")])).toEqual([
            ["root", ""],
            ["a", "branch"], ["a1", "line,branch"], ["a2", "line,end"],
            ["b", "end"], ["b1", "space,branch"], ["b2", "space,end"],
        ]);
    });
});

describe("图", () => {
    test("当前路径一道到底，别的分支各开一道；分叉知道孩子和当前走哪个", () => {
        const graph = sessionTreeGraph({nodes: NODES, activePath: PATH, filter: "default"});
        const lane = (id: string) => graph.nodes.find((node) => node.id === id)!.lane;
        expect(["u1", "a1", "t1", "u2", "a2"].map(lane)).toEqual([0, 0, 0, 0, 0]);
        expect(lane("u3")).toBe(1);
        expect(lane("a3")).toBe(1);
        expect(lane("a4")).toBe(2);
        expect(graph.lanes).toBe(3);
        expect(graph.depth).toBe(5);
        expect(graph.nodes.find((node) => node.id === "t1")!.fork).toEqual({children: ["u2", "u3", "a4"], index: 0});
        expect(graph.edges.filter((edge) => edge.onPath).map((edge) => edge.to)).toEqual(["a1", "t1", "u2", "a2"]);
    });

    test("两个方向只是换轴；同一道是直线，换道是曲线", () => {
        const node = {depth: 2, lane: 1};
        const down = graphPosition(node, "down");
        const right = graphPosition(node, "right");
        expect(down.y).toBeGreaterThan(down.x / 2);
        expect(right.x).toBeGreaterThan(right.y);
        expect(graphEdgePath({depth: 0, lane: 0}, {depth: 1, lane: 0}, "down")).toContain("L");
        expect(graphEdgePath({depth: 0, lane: 0}, {depth: 1, lane: 1}, "down")).toContain("C");
        expect(graphEdgePath({depth: 0, lane: 0}, {depth: 1, lane: 1}, "right")).toContain("C");
    });

    test("很长的对话不会撑爆调用栈", () => {
        const nodes: SessionTreeNodeView[] = [{id: "n0", parent: null, type: "input", label: "0"}];
        for (let index = 1; index < 200_000; index += 1) nodes.push({id: `n${index}`, parent: `n${index - 1}`, type: "assistant", label: "x"});
        const graph = sessionTreeGraph({nodes, activePath: nodes.map((node) => node.id), filter: "default"});
        expect(graph.depth).toBe(200_000);
        expect(sessionTreeRows({nodes, activePath: [], filter: "default", collapsed: new Set()})).toHaveLength(200_000);
    });
});
