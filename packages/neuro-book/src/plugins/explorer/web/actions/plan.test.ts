/**
 * 粘贴计划、拖动落点与排序变换（docs/specs/workbench/files-explorer.md 的“拖动”“上移 / 下移”与验收 6、7）：纯函数。行数据
 * 由真实的投影从 Files 合同形状的列出结果算出。
 */

import {describe, expect, it} from "bun:test";

import type {DirectoryEntry, Listing} from "nbook/plugins/files/shared/contracts";

import type {DirectorySlot, RootState} from "../tree/model";
import {projectRows} from "../tree/rows";
import {resolveDrop, zoneOf} from "./drop";
import {candidateName, planNames} from "./paste-plan";
import type {CollisionChoice, PlanSource} from "./paste-plan";
import {placeNames, shiftNames} from "./reorder-plan";

const ROOTS: RootState[] = [
    {scheme: "project", address: "project://", status: {kind: "live"}},
    {scheme: "user", address: "user://", status: {kind: "unbound"}},
];
const loaded = (listing: Listing): DirectorySlot => ({listing, error: null, loading: false, stale: false});
const dir = (name: string, extra: Partial<DirectoryEntry> = {}): DirectoryEntry => ({name, kind: "directory", ...extra});
const ROWS = projectRows({
    roots: ROOTS,
    slots: new Map([
        ["project://", loaded({folder: "plain", contentRoot: null, entries: [dir("lore.content", {folder: "content"}), dir("plain"), {name: "a.md", kind: "file"}]})],
        ["project://plain", loaded({folder: "plain", contentRoot: null, entries: [dir("sub"), {name: "b.md", kind: "file"}]})],
        ["project://lore.content", loaded({folder: "content", contentRoot: "lore.content", manifest: {status: "ok"}, entries: [
            dir("a", {listed: true}), dir("b", {listed: true}), dir("c", {listed: true}), {name: "gone", kind: "missing", listed: true}, {name: "x.md", kind: "file", listed: false},
        ]})],
    ]),
    expanded: new Set(["project://", "project://plain", "project://lore.content"]),
    showManifests: false,
});
const row = (id: string) => ROWS.find((candidate) => candidate.id === id);
const ORDER = ["a", "b", "c", "gone"];
const order = (parent: string) => (parent === "project://lore.content" ? ORDER : null);

describe("Spec workbench.files-explorer 上移 / 下移与拖动排序：变换", () => {
    it("整体移动一位并保持相对顺序；已在首末的一段不动；没有变化为 null", () => {
        expect(shiftNames(["a", "b", "c", "d"], new Set(["b", "d"]), "up")).toEqual(["b", "a", "d", "c"]);
        expect(shiftNames(["a", "b", "c", "d"], new Set(["a", "b"]), "up")).toBeNull();
        expect(shiftNames(["a", "b", "c", "d"], new Set(["a", "c"]), "down")).toEqual(["b", "a", "d", "c"]);
        expect(shiftNames(["a", "b", "c", "d"], new Set(["a", "b", "d"]), "up")).toEqual(["a", "b", "d", "c"]);
    });

    it("放到某项之前或末尾，保持被移动项的相对顺序", () => {
        expect(placeNames(["a", "b", "c", "d"], new Set(["d", "b"]), "a")).toEqual(["b", "d", "a", "c"]);
        expect(placeNames(["a", "b", "c", "d"], new Set(["a"]), null)).toEqual(["b", "c", "d", "a"]);
        expect(placeNames(["a", "b", "c"], new Set(["a"]), "b")).toBeNull();
        expect(placeNames(["a", "b", "c"], new Set(["a"]), "a")).toBeNull();
    });
});

describe("Spec workbench.files-explorer 拖动：落点", () => {
    it("行里的位置：目录行上中下三段，其它行上下两半", () => {
        expect([0.1, 0.5, 0.9].map((offset) => zoneOf(row("project://plain")!, offset))).toEqual(["before", "inside", "after"]);
        expect([0.3, 0.7].map((offset) => zoneOf(row("project://a.md")!, offset))).toEqual(["before", "after"]);
    });

    it("目录行中间移入；源已在的目录、自己与后代、缺失条目、未绑定的根没有落点", () => {
        expect(resolveDrop(["project://a.md"], row("project://plain"), "inside", order)).toEqual({kind: "move", target: "project://plain"});
        expect(resolveDrop(["project://plain/b.md"], row("project://"), "before", order)).toEqual({kind: "move", target: "project://"});
        expect(resolveDrop(["project://plain/b.md"], row("project://plain"), "inside", order)).toEqual({kind: "none"});
        expect(resolveDrop(["project://plain"], row("project://plain/sub"), "inside", order)).toEqual({kind: "none"});
        expect(resolveDrop(["project://plain"], row("project://plain"), "inside", order)).toEqual({kind: "none"});
        expect(resolveDrop(["project://a.md"], row("project://lore.content/gone"), "after", order)).toEqual({kind: "none"});
        expect(resolveDrop(["project://a.md"], row("user://"), "inside", order)).toEqual({kind: "none"});
        expect(resolveDrop(["project://a.md"], row("project://plain/b.md"), "after", order)).toEqual({kind: "none"});
    });

    it("内容文件夹里同一层两行之间调整顺序；“之后”落在下一项之前；不在清单里的源或别层的源没有排序落点", () => {
        expect(resolveDrop(["project://lore.content/c"], row("project://lore.content/a"), "before", order)).toEqual({kind: "reorder", parent: "project://lore.content", names: ["c", "a", "b", "gone"], anchor: "project://lore.content/a", zone: "before"});
        expect(resolveDrop(["project://lore.content/a"], row("project://lore.content/b"), "after", order)).toEqual({kind: "reorder", parent: "project://lore.content", names: ["b", "a", "c", "gone"], anchor: "project://lore.content/b", zone: "after"});
        expect(resolveDrop(["project://lore.content/b"], row("project://lore.content/a"), "after", order)).toEqual({kind: "none"});
        expect(resolveDrop(["project://lore.content/x.md"], row("project://lore.content/a"), "before", order)).toEqual({kind: "none"});
        expect(resolveDrop(["project://a.md"], row("project://lore.content/a"), "before", order)).toEqual({kind: "none"});
        expect(resolveDrop(["project://lore.content/c"], row("project://lore.content/a"), "inside", order)).toEqual({kind: "move", target: "project://lore.content/a"});
    });
});

describe("Spec workbench.files-explorer 验收 7：粘贴的名字", () => {
    const source = (name: string, directory = false): PlanSource => ({address: `project://src/${name}`, token: `t-${name}`, name, directory});

    it("候选名在扩展名之前加序号，目录不拆扩展名，跳过已占用的", () => {
        expect(candidateName("a.md", false, new Set(["a.md"]))).toBe("a (2).md");
        expect(candidateName("a.md", false, new Set(["a.md", "a (2).md"]))).toBe("a (3).md");
        expect(candidateName("v1.content", true, new Set())).toBe("v1.content (2)");
        expect(candidateName(".hidden", false, new Set())).toBe(".hidden (2)");
    });

    it("不相撞的用原名；相撞的按决定改名或跳过，取消时其余都不做；本批里排好的名字也算占用", async () => {
        const asked: string[] = [];
        const answers: CollisionChoice[] = [{kind: "rename", name: "a (2).md"}, {kind: "skip"}, {kind: "cancel"}];
        const plan = await planNames([source("a.md"), source("new.md"), source("b.md"), source("new.md"), source("c.md"), source("d.md")], new Set(["a.md", "b.md", "c.md"]), async (item) => {
            asked.push(item.name);
            return answers.shift() as CollisionChoice;
        });
        expect(asked).toEqual(["a.md", "b.md", "new.md"]);
        expect(plan.items.map((item) => [item.source.name, item.name])).toEqual([["a.md", "a (2).md"], ["new.md", "new.md"]]);
        expect(plan.skipped.map((item) => item.name)).toEqual(["b.md"]);
        expect(plan.cancelled.map((item) => item.name)).toEqual(["new.md", "c.md", "d.md"]);
    });
});
