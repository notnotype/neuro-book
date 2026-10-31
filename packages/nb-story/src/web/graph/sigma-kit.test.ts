/**
 * 排版（docs/specs/story/viewer.md 输出 25）：应力排版连着的点比不连的靠得近、不重合、同样的起点排出同样的位置；力导向与应力
 * 排版按画布的宽高比铺开，点和名字在铺满时的屏幕上不重叠；点多时只挑主要的点强制出名字。
 */

import {describe, expect, test} from "bun:test";

import Graph from "graphology";

import {chooseForcedLabels, layoutForce, layoutStress, seedSpiral} from "./sigma-kit";

/** 两个三角形用一条线连起来，外加一个不连通的点。 */
function build(): Graph {
    const graph = new Graph({type: "undirected", multi: false});
    for (const id of ["a", "b", "c", "d", "e", "f", "lone"]) graph.addNode(id, {size: 6, weight: 1, label: id});
    for (const [x, y] of [["a", "b"], ["b", "c"], ["a", "c"], ["d", "e"], ["e", "f"], ["d", "f"], ["c", "d"]] as const) graph.addEdge(x, y, {weight: 1});
    seedSpiral(graph, () => 1);
    return graph;
}

const distance = (graph: Graph, p: string, q: string) => Math.hypot(Number(graph.getNodeAttribute(p, "x")) - Number(graph.getNodeAttribute(q, "x")), Number(graph.getNodeAttribute(p, "y")) - Number(graph.getNodeAttribute(q, "y")));

describe("应力排版", () => {
    test("同一个三角形里的点比隔着一条线的点近，不连通的点离得最远，没有两个点重合", () => {
        const graph = build();
        layoutStress(graph, {frame: {width: 800, height: 500}});
        expect(distance(graph, "a", "b")).toBeLessThan(distance(graph, "a", "d"));
        expect(distance(graph, "d", "e")).toBeLessThan(distance(graph, "a", "e"));
        for (const other of ["a", "b", "c", "d", "e", "f"]) expect(distance(graph, "lone", other)).toBeGreaterThan(distance(graph, "a", "b"));
        const ids = graph.nodes();
        for (let i = 0; i < ids.length; i += 1) for (let j = i + 1; j < ids.length; j += 1) expect(distance(graph, ids[i]!, ids[j]!)).toBeGreaterThan(0);
    });

    test("同样的起点排出同样的位置", () => {
        const first = build();
        const second = build();
        layoutStress(first, {frame: {width: 800, height: 500}});
        layoutStress(second, {frame: {width: 800, height: 500}});
        for (const id of first.nodes()) expect(first.getNodeAttributes(id)).toMatchObject({x: second.getNodeAttribute(id, "x"), y: second.getNodeAttribute(id, "y")});
    });
});

/** 六个社团、每个 8 个点，社团内连成环，社团之间用一条线连起来；点带名字、强制出名字。 */
function clusters(): Graph {
    const graph = new Graph({type: "undirected", multi: false});
    for (let c = 0; c < 6; c += 1) {
        for (let i = 0; i < 8; i += 1) graph.addNode(`n${c}-${i}`, {size: 8, weight: 1 + i, label: `人物${c}${i}`, forceLabel: true});
        for (let i = 0; i < 8; i += 1) graph.addEdge(`n${c}-${i}`, `n${c}-${(i + 1) % 8}`, {weight: 2});
        if (c > 0) graph.addEdge(`n${c}-0`, `n${c - 1}-0`, {weight: 1});
    }
    seedSpiral(graph, (node) => Number(graph.getNodeAttribute(node, "weight")));
    return graph;
}

const LABEL_WIDTH = 64;
const extentOf = (graph: Graph, axis: "x" | "y") => {
    const values = graph.mapNodes((_, attributes) => Number(attributes[axis]));
    return Math.max(...values) - Math.min(...values);
};

/** 按铺满的比例换成屏幕像素后，圆圈加右边名字的矩形互相重叠的点对数。 */
function overlappingPairs(graph: Graph, frame: {width: number; height: number}): number {
    const scale = Math.min(frame.width / extentOf(graph, "x"), frame.height / extentOf(graph, "y"));
    const ids = graph.nodes();
    const box = (id: string) => {
        const x = Number(graph.getNodeAttribute(id, "x")) * scale;
        const y = Number(graph.getNodeAttribute(id, "y")) * scale;
        return {left: x - 8, right: x + 8 + (graph.getNodeAttribute(id, "forceLabel") === true ? 5 + LABEL_WIDTH : 0), top: y - 8, bottom: y + 8};
    };
    let count = 0;
    for (let i = 0; i < ids.length; i += 1) {
        for (let j = i + 1; j < ids.length; j += 1) {
            const a = box(ids[i]!);
            const b = box(ids[j]!);
            if (a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom) count += 1;
        }
    }
    return count;
}

describe("按画布铺开", () => {
    test.each([["宽画布", {width: 1200, height: 500}], ["高画布", {width: 400, height: 900}]])("%s：外框的宽高比跟着画布走", (_, frame) => {
        for (const layout of [layoutForce, layoutStress] as const) {
            const graph = clusters();
            layout(graph, {frame, linLog: false, labelWidth: () => LABEL_WIDTH} as never);
            const aspect = extentOf(graph, "x") / extentOf(graph, "y");
            expect(aspect / (frame.width / frame.height)).toBeGreaterThan(0.7);
            expect(aspect / (frame.width / frame.height)).toBeLessThan(1.4);
        }
    });

    test("画布放得下时，点和名字在铺满的屏幕上互不重叠；同样的输入排出同样的位置", () => {
        const frame = {width: 1200, height: 560};
        const first = clusters();
        const second = clusters();
        layoutForce(first, {frame, linLog: false, labelWidth: () => LABEL_WIDTH});
        layoutForce(second, {frame, linLog: false, labelWidth: () => LABEL_WIDTH});
        expect(overlappingPairs(first, frame)).toBe(0);
        for (const id of first.nodes()) expect(first.getNodeAttributes(id)).toMatchObject({x: second.getNodeAttribute(id, "x"), y: second.getNodeAttribute(id, "y")});
    });
});

describe("强制出名字的点", () => {
    function ranked(count: number): Graph {
        const graph = new Graph({type: "undirected", multi: false});
        for (let i = 0; i < count; i += 1) graph.addNode(`n${i}`, {size: 8, weight: count - i, label: `人物${i}`});
        return graph;
    }

    test("点少时名字全出", () => {
        const graph = ranked(10);
        chooseForcedLabels(graph, {width: 1200, height: 560}, {pinned: new Set(), labelWidth: () => LABEL_WIDTH});
        expect(graph.nodes().every((node) => graph.getNodeAttribute(node, "forceLabel") === true)).toBe(true);
    });

    test("点多时只出权重大的，名字框合计不超过画布的三成；主要人物一定出", () => {
        const graph = ranked(300);
        const frame = {width: 1200, height: 560};
        chooseForcedLabels(graph, frame, {pinned: new Set(["n299"]), labelWidth: () => LABEL_WIDTH});
        const forced = graph.nodes().filter((node) => graph.getNodeAttribute(node, "forceLabel") === true);
        expect(forced.length).toBeGreaterThan(20);
        expect(forced.length).toBeLessThan(300);
        // 每个名字框约 (8+3+5+64+8+3)×20 = 1820 像素，合计不到画布的三成（pinned 的那一个是额外的）
        expect(forced.length * 1820).toBeLessThanOrEqual(0.3 * frame.width * frame.height + 1820);
        expect(forced).toContain("n299");
        // 出名字的是权重最大的那些：n0 权重最大，n298 权重最小的未被选中
        expect(forced).toContain("n0");
        expect(forced).not.toContain("n298");
    });
});
