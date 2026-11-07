/**
 * 粘贴计划、拖动落点与排序变换（docs/specs/workbench/files-explorer.md 的“拖动”“上移 / 下移”与验收 6、7）：纯函数。行数据
 * 由真实的投影从 Files 合同形状的列出结果算出。
 */

import {describe, expect, it} from "bun:test";

import type {DirectoryEntry, Listing} from "nbook/plugins/files/shared/contracts";

import type {DirectorySlot, RootState} from "../tree/model";
import {projectRows} from "../tree/rows";
import {resolveBlankDrop, resolveDrop, resolveEditorDrop} from "./drop";
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
        ["project://lore.content/b", loaded({folder: "content", contentRoot: "lore.content", manifest: {status: "ok"}, entries: [{name: "k.md", kind: "file", listed: true}, {name: "l.md", kind: "file", listed: true}]})],
    ]),
    expanded: new Set(["project://", "project://plain", "project://lore.content", "project://lore.content/b"]),
    showManifests: false,
});
const row = (id: string) => ROWS.find((candidate) => candidate.id === id);
const ORDER = ["a", "b", "c", "gone"];
const order = (parent: string) => (parent === "project://lore.content" ? ORDER : parent === "project://lore.content/b" ? ["k.md", "l.md"] : null);
/** 落在 `id` 那一行：`offset` 是纵向比例，`x` 是相对行左边的像素（200 在名字上，取最深的一层）。 */
const drop = (sources: ReadonlyArray<string>, id: string, offset: number, x = 200) => resolveDrop(sources, ROWS, {id, offset, x}, order);

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
    it("目录行中段移入（内容树里的目录标为有序）；源已在的目录、自己与后代、缺失条目、未绑定的根没有落点", () => {
        expect(drop(["project://a.md"], "project://plain", 0.5)).toEqual({kind: "move", target: "project://plain", ordered: false});
        expect(drop(["project://a.md"], "project://lore.content", 0.5)).toEqual({kind: "move", target: "project://lore.content", ordered: true});
        expect(drop(["project://a.md"], "project://lore.content/c", 0.5)).toEqual({kind: "move", target: "project://lore.content/c", ordered: true});
        expect(drop(["project://plain/b.md"], "project://", 0.1)).toEqual({kind: "move", target: "project://", ordered: false});
        expect(drop(["project://plain/b.md"], "project://plain", 0.5)).toEqual({kind: "none"});
        expect(drop(["project://plain"], "project://plain/sub", 0.5)).toEqual({kind: "none"});
        expect(drop(["project://plain"], "project://plain", 0.5)).toEqual({kind: "none"});
        expect(drop(["project://a.md"], "project://lore.content/gone", 0.9)).toEqual({kind: "none"});
        expect(drop(["project://a.md"], "user://", 0.5)).toEqual({kind: "none"});
    });

    it("普通文件夹里的缝移入接收目录；子树末尾按横向位置选层，往左到上一层", () => {
        expect(drop(["project://a.md"], "project://plain/b.md", 0.9)).toEqual({kind: "move", target: "project://plain", ordered: false});
        expect(drop(["project://a.md"], "project://plain/sub", 0.1)).toEqual({kind: "move", target: "project://plain", ordered: false});
        // 同一条缝靠左：接收目录是根，源已在根里，没有落点。
        expect(drop(["project://a.md"], "project://plain/b.md", 0.9, 10)).toEqual({kind: "none"});
        expect(drop(["project://plain/sub"], "project://plain/b.md", 0.1)).toEqual({kind: "none"});
    });

    it("内容文件夹里：展开目录与第一个子项之间放到第一项之前；同一层调整顺序，“之后”落在下一个不被拖动的项之前；没有变化没有落点", () => {
        expect(drop(["project://lore.content/c"], "project://lore.content/a", 0.1)).toEqual({kind: "reorder", parent: "project://lore.content", names: ["c", "a", "b", "gone"], before: "a", line: {row: "project://lore.content", depth: 2}, anchor: {id: "project://lore.content/a", side: "before"}});
        expect(drop(["project://lore.content/a"], "project://lore.content/c", 0.9)).toEqual({kind: "reorder", parent: "project://lore.content", names: ["b", "c", "a", "gone"], before: "gone", line: {row: "project://lore.content/c", depth: 2}, anchor: {id: "project://lore.content/c", side: "after"}});
        expect(drop(["project://lore.content/b"], "project://lore.content/a", 0.9)).toEqual({kind: "none"});
        // 落在自己的子树里。
        expect(drop(["project://lore.content/b"], "project://lore.content/b/k.md", 0.9)).toEqual({kind: "none"});
    });

    it("内容文件夹里别层或外面的源：移动并放到那个位置；子树末尾靠右进节点、靠左放到节点之后", () => {
        expect(drop(["project://a.md"], "project://lore.content", 0.9)).toEqual({kind: "place", target: "project://lore.content", before: "a", line: {row: "project://lore.content", depth: 2}, anchor: {id: "project://lore.content/a", side: "before"}});
        expect(drop(["project://lore.content/a"], "project://lore.content/b", 0.9)).toMatchObject({kind: "place", target: "project://lore.content/b", before: "k.md"});
        expect(drop(["project://a.md"], "project://lore.content/b/l.md", 0.9)).toEqual({kind: "place", target: "project://lore.content/b", before: null, line: {row: "project://lore.content/b/l.md", depth: 3}, anchor: {id: "project://lore.content/b/l.md", side: "after"}});
        expect(drop(["project://a.md"], "project://lore.content/b/l.md", 0.9, 30)).toEqual({kind: "place", target: "project://lore.content", before: "c", line: {row: "project://lore.content/b/l.md", depth: 2}, anchor: {id: "project://lore.content/b", side: "after"}});
        // 多选里混着这一层的项：整批放到同一个位置（服务端把这一层的那项也挪过去）。
        expect(drop(["project://lore.content/a", "project://lore.content/b/k.md"], "project://lore.content/c", 0.9)).toMatchObject({kind: "place", target: "project://lore.content", before: "gone"});
        // 未列入项之后：清单里没有它，放到末尾。
        expect(drop(["project://a.md"], "project://lore.content/x.md", 0.9)).toMatchObject({kind: "place", target: "project://lore.content", before: null});
    });

    it("树里行以外的空白移入源所在方案的根；树外打开源里能打开的项、目录跳过、超过上限的计数", () => {
        const drop = {action: {kind: "center", panel: "g1"}, key: "center", label: "放这里"} as const;
        const OVER = {kind: "editor", drop, host: {resolve: () => drop, show: () => undefined, commit: () => undefined}} as const;
        const find = (id: string) => row(id);
        expect(resolveBlankDrop(["project://plain/b.md"], find)).toEqual({kind: "move", target: "project://", ordered: false});
        expect(resolveBlankDrop(["project://a.md"], find)).toEqual({kind: "none"});
        expect(resolveEditorDrop(["project://a.md", "project://plain/sub", "project://plain/b.md"], OVER, find)).toEqual({kind: "open", drop: OVER.drop, addresses: ["project://a.md", "project://plain/b.md"], skipped: 0});
        expect(resolveEditorDrop(["project://plain/sub"], OVER, find)).toEqual({kind: "none"});
        const many = projectRows({
            roots: ROOTS,
            slots: new Map([["project://", loaded({folder: "plain", contentRoot: null, entries: Array.from({length: 12}, (_, at) => ({name: `${String(at)}.md`, kind: "file" as const}))})]]),
            expanded: new Set(["project://"]),
            showManifests: false,
        });
        const sources = Array.from({length: 12}, (_, at) => `project://${String(at)}.md`);
        expect(resolveEditorDrop(sources, OVER, (id) => many.find((candidate) => candidate.id === id))).toMatchObject({kind: "open", skipped: 2, addresses: sources.slice(0, 10)});
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
