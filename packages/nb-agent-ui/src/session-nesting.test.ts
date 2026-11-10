import {describe, expect, test} from "bun:test";

import {autoExpanded, nestSessions, type SessionNode} from "./session-nesting";
import type {AgentSessionListItem} from "./types";

const item = (id: string, extra: Partial<AgentSessionListItem> = {}): AgentSessionListItem => ({id, title: id, updatedAt: 0, status: "idle", ...extra});
const shape = (nodes: readonly SessionNode[]): unknown => nodes.map((node) => (node.children.length === 0 ? node.item.id : {[node.item.id]: shape(node.children)}));

describe("会话面板的子会话", () => {
    test("按 parentId 挂在父会话下、保持顺序；父会话不在条目里的不列出；成环的按根列出", () => {
        expect(shape(nestSessions([item("p"), item("a", {parentId: "p"}), item("q"), item("b", {parentId: "a"}), item("c", {parentId: "p"})]))).toEqual([{p: [{a: ["b"]}, "c"]}, "q"]);
        expect(shape(nestSessions([item("orphan", {parentId: "gone"})]))).toEqual([]);
        expect(shape(nestSessions([item("x", {parentId: "y"}), item("y", {parentId: "x"})]))).toEqual([{x: ["y"]}]);
    });

    test("自动展开选中会话与 expandFor 的祖先、有后代在等用户的", () => {
        const items = [item("p", {childCount: 1}), item("a", {parentId: "p", childCount: 1}), item("b", {parentId: "a"}), item("q", {childCount: 2, childWaiting: true}), item("r", {childCount: 1})];
        expect([...autoExpanded(items, "b")].sort()).toEqual(["a", "p", "q"]);
        expect([...autoExpanded(items, null, ["a"])].sort()).toEqual(["p", "q"]);
    });
});
