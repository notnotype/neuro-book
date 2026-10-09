/**
 * 树的纯函数（docs/specs/workbench/files-explorer.md 的“文件夹类型呈现”“基础文件操作”“增量刷新的依赖”，验收 1、3）：
 * 投影、选择、按键与失效规则。输入是 Files 合同形状的列出结果，与真实服务返回的同形（真实链路见 explorer/browse.test.ts）。
 */

import {describe, expect, it} from "bun:test";

import type {DirectoryEntry, Listing} from "nbook/plugins/files/shared/contracts";

import {invalidation} from "./invalidate";
import {treeKey} from "./keys";
import type {TreeKey} from "./keys";
import type {DirectorySlot, RootState} from "./model";
import {projectRows} from "./rows";
import type {EntryRow, Row} from "./rows";
import {click, contextSelect, EMPTY_SELECTION, followPaths, prune, selectAll} from "./selection";
import type {Selection} from "./selection";

const ROOTS: RootState[] = [
    {scheme: "project", address: "project://", status: {kind: "live"}},
    {scheme: "user", address: "user://", status: {kind: "live"}},
];

const loaded = (listing: Listing): DirectorySlot => ({listing, error: null, loading: false, stale: false});
const plain = (entries: DirectoryEntry[]): Listing => ({folder: "plain", contentRoot: null, entries});
const file = (name: string, extra: Partial<DirectoryEntry> = {}): DirectoryEntry => ({name, kind: "file", ...extra});
const dir = (name: string, extra: Partial<DirectoryEntry> = {}): DirectoryEntry => ({name, kind: "directory", ...extra});

/** 项目根：普通目录、内容文件夹、清单不合法的内容文件夹、活页夹。 */
const SLOTS = new Map<string, DirectorySlot>([
    ["project://", loaded(plain([dir("broken.content", {folder: "content"}), dir("lore.content", {folder: "content"}), dir("plain"), dir("story.binder", {folder: "binder"}), file("top.md")]))],
    ["project://plain", loaded(plain([dir("sub"), file("a.md"), file("index.md")]))],
    ["project://lore.content", loaded({folder: "content", contentRoot: "lore.content", manifest: {status: "ok"}, entries: [
        dir("alice", {title: "爱丽丝", icon: "person", listed: true, body: false}),
        dir("bob", {title: "鲍勃", listed: true, body: true}),
        {name: "gone", kind: "missing", title: "已删除", listed: true},
        file("stray.md", {listed: false}),
        file("content.xml", {role: "manifest"}),
    ]})],
    ["project://lore.content/bob", loaded({folder: "plain", contentRoot: "lore.content", manifest: {status: "ok"}, entries: [
        dir("sword", {title: "宝剑", listed: true, body: true}),
        file("index.md", {role: "body"}),
    ]})],
    ["project://broken.content", loaded({folder: "content", contentRoot: "broken.content", manifest: {status: "invalid", detail: "第 1 行不是 XML"}, entries: [
        dir("child"),
        file("content.xml", {role: "manifest"}),
    ]})],
    ["project://broken.content/child", loaded({folder: "plain", contentRoot: "broken.content", manifest: {status: "invalid", detail: "第 1 行不是 XML"}, entries: [file("index.md", {role: "body"})]})],
    ["project://story.binder", loaded({folder: "binder", contentRoot: null, entries: [file("binder.xml"), file("ch1.md")]})],
    ["project://empty", loaded(plain([]))],
]);

const EXPANDED = new Set(["project://", "project://plain", "project://lore.content", "project://lore.content/bob", "project://broken.content", "project://broken.content/child", "project://story.binder"]);

const rows = (overrides: {expanded?: ReadonlySet<string>; showManifests?: boolean; slots?: ReadonlyMap<string, DirectorySlot>; roots?: RootState[]} = {}): Row[] =>
    projectRows({roots: overrides.roots ?? ROOTS, slots: overrides.slots ?? SLOTS, expanded: overrides.expanded ?? EXPANDED, showManifests: overrides.showManifests ?? false});

const entry = (all: ReadonlyArray<Row>, id: string): EntryRow => {
    const found = all.find((row) => row.id === id);
    if (found?.kind !== "entry") throw new Error(`没有资源行 ${id}`);
    return found;
};

const ids = (all: ReadonlyArray<Row>): string[] => all.map((row) => row.id);

describe("Spec workbench.files-explorer 文件夹类型呈现：投影", () => {
    it("普通目录：真实名字，index.md 成行，目录只展开不打开；用户资产根默认折叠", () => {
        const all = rows();
        expect(all[0]).toMatchObject({kind: "root", id: "project://", expanded: true});
        expect(all.at(-1)).toMatchObject({kind: "root", id: "user://", expanded: false});
        expect(ids(all).filter((id) => id.startsWith("project://plain/"))).toEqual(["project://plain/sub", "project://plain/a.md", "project://plain/index.md"]);
        expect(entry(all, "project://plain/index.md")).toMatchObject({label: "index.md", opens: "project://plain/index.md", content: false});
        expect(entry(all, "project://plain/sub")).toMatchObject({node: false, expandable: true, opens: null, label: "sub", subtitle: null});
    });

    it("内容文件夹：展示名与可辨的真实名字、节点的正文入口、缺失与未列入；正文与清单文件不单列", () => {
        const all = rows();
        expect(entry(all, "project://lore.content/alice")).toMatchObject({label: "爱丽丝", subtitle: "alice", icon: "person", node: true, body: false, opens: null});
        expect(entry(all, "project://lore.content/bob")).toMatchObject({label: "鲍勃", node: true, body: true, opens: "project://lore.content/bob/index.md"});
        expect(entry(all, "project://lore.content/gone")).toMatchObject({type: "missing", label: "已删除", expandable: false, opens: null});
        expect(entry(all, "project://lore.content/stray.md")).toMatchObject({listed: false, label: "stray.md"});
        // 嵌套层的子目录自身是普通目录类型，仍按内容文件夹呈现。
        expect(entry(all, "project://lore.content/bob/sword")).toMatchObject({label: "宝剑", node: true, body: true, depth: 3});
        expect(ids(all)).not.toContain("project://lore.content/bob/index.md");
        expect(ids(all)).not.toContain("project://lore.content/content.xml");
    });

    it("显示清单文件：清单文件出现，正文仍不单列；活页夹的 binder.xml 不是清单角色，始终按普通文件显示", () => {
        const all = rows({showManifests: true});
        expect(entry(all, "project://lore.content/content.xml")).toMatchObject({manifest: true});
        expect(ids(all)).not.toContain("project://lore.content/bob/index.md");
        expect(entry(rows(), "project://story.binder/binder.xml")).toMatchObject({manifest: false, label: "binder.xml"});
        expect(entry(rows(), "project://story.binder")).toMatchObject({binder: true, node: false});
    });

    it("清单不合法：退回普通目录呈现，内容根那一层提示一次错误，index.md 成行", () => {
        const all = rows();
        expect(all.filter((row) => row.kind === "status" && row.status === "manifest")).toEqual([
            {kind: "status", id: "project://broken.content#manifest", depth: 2, parent: "project://broken.content", status: "manifest", code: "invalid", detail: "第 1 行不是 XML"},
        ]);
        expect(entry(all, "project://broken.content/child")).toMatchObject({node: false, label: "child"});
        expect(entry(all, "project://broken.content/child/index.md")).toMatchObject({opens: "project://broken.content/child/index.md"});
        // 清单文件仍按角色默认隐藏。
        expect(ids(all)).not.toContain("project://broken.content/content.xml");
    });

    it("状态行：加载中、读取失败、空目录各自成行；同层位置按完整的同层集合计", () => {
        const slots = new Map(SLOTS);
        slots.set("project://plain/sub", {listing: null, error: null, loading: true, stale: false});
        slots.set("project://story.binder", {listing: null, error: {code: "permission-denied", detail: "没有权限"}, loading: false, stale: false});
        const all = rows({slots, expanded: new Set([...EXPANDED, "project://plain/sub", "project://empty"])});
        expect(all.filter((row) => row.kind === "status").map((row) => row.kind === "status" && [row.parent, row.status, row.code])).toEqual([
            ["project://broken.content", "manifest", "invalid"],
            ["project://plain/sub", "loading", null],
            ["project://story.binder", "error", "permission-denied"],
        ]);
        expect(entry(all, "project://plain/a.md")).toMatchObject({position: 2, siblings: 3});
        const empty = rows({slots: new Map([["project://", loaded(plain([dir("empty")]))], ["project://empty", loaded(plain([]))]]), expanded: new Set(["project://", "project://empty"])});
        expect(empty.at(-2)).toMatchObject({kind: "status", status: "empty", parent: "project://empty"});
    });

    it("没有绑定项目：项目根不展开，没有子行", () => {
        const all = rows({roots: [{scheme: "project", address: "project://", status: {kind: "unbound"}}, ROOTS[1] as RootState]});
        expect(all.map((row) => row.id)).toEqual(["project://", "user://"]);
        expect(all[0]).toMatchObject({expanded: false, status: {kind: "unbound"}});
    });
});

describe("Spec workbench.files-explorer 基础文件操作：选择", () => {
    const all = rows();
    const plainOnly = (selection: Selection): ReadonlyArray<string> => selection.selected;

    it("单击单选；Ctrl/Meta 切换；Shift 选锚点到当前行的可见范围；Ctrl+Shift 并入", () => {
        let state = click(EMPTY_SELECTION, all, "project://plain/sub", {toggle: false, range: false});
        expect(state).toEqual({selected: ["project://plain/sub"], focus: "project://plain/sub", anchor: "project://plain/sub"});
        state = click(state, all, "project://plain/index.md", {toggle: false, range: true});
        expect(plainOnly(state)).toEqual(["project://plain/sub", "project://plain/a.md", "project://plain/index.md"]);
        expect(state.anchor).toBe("project://plain/sub");
        state = click(state, all, "project://plain/a.md", {toggle: true, range: false});
        expect(plainOnly(state)).toEqual(["project://plain/sub", "project://plain/index.md"]);
        state = click(state, all, "project://top.md", {toggle: true, range: true});
        expect(plainOnly(state)).toContain("project://top.md");
        expect(plainOnly(state)).toContain("project://plain/index.md");
    });

    it("右键已选行保留整个选择，未选行先单选", () => {
        const two: Selection = {selected: ["project://plain/a.md", "project://top.md"], focus: "project://top.md", anchor: "project://plain/a.md"};
        expect(contextSelect(two, "project://plain/a.md")).toEqual({...two, focus: "project://plain/a.md"});
        expect(contextSelect(two, "project://plain/sub")).toEqual({selected: ["project://plain/sub"], focus: "project://plain/sub", anchor: "project://plain/sub"});
    });

    it("全选只选可见的资源行：不含根、缺失条目、状态行与隐藏的正文", () => {
        const selected = selectAll(EMPTY_SELECTION, all).selected;
        expect(selected).toContain("project://lore.content/stray.md");
        expect(selected).not.toContain("project://");
        expect(selected).not.toContain("project://lore.content/gone");
        expect(selected).not.toContain("project://lore.content/bob/index.md");
        expect(selected.some((id) => id.includes("#"))).toBe(false);
    });

    it("可见行变了：不可见的去掉；焦点回到最近的可见祖先，没有祖先时到原位置附近", () => {
        const state: Selection = {selected: ["project://plain/a.md", "project://top.md"], focus: "project://plain/a.md", anchor: "project://plain/a.md"};
        const collapsed = rows({expanded: new Set([...EXPANDED].filter((id) => id !== "project://plain"))});
        expect(prune(state, collapsed, all)).toEqual({selected: ["project://top.md"], focus: "project://plain", anchor: null});
        const userOnly = rows({roots: [ROOTS[1] as RootState]});
        expect(prune({selected: [], focus: "project://plain/a.md", anchor: null}, userOnly, all).focus).toBe("user://");
    });

    it("改名与删除：选择与焦点按段边界跟随，被删的移除", () => {
        const state: Selection = {selected: ["project://plain/sub/x.md", "project://plain/subway.md", "project://top.md"], focus: "project://plain/sub", anchor: "project://top.md"};
        expect(followPaths(state, {moves: [{from: "project://plain/sub", to: "project://plain/sub2"}], removed: ["project://top.md"]})).toEqual({
            selected: ["project://plain/sub2/x.md", "project://plain/subway.md"],
            focus: "project://plain/sub2",
            anchor: null,
        });
    });
});

describe("Spec workbench.files-explorer 基础文件操作：树内按键", () => {
    const all = rows();
    const key = (name: string, modifiers: Partial<TreeKey> = {}): TreeKey => ({key: name, shift: false, toggle: false, alt: false, ...modifiers});
    const at = (id: string): Selection => ({selected: [id], focus: id, anchor: id});

    it("上下移动焦点与选择；Ctrl 加方向键只移焦点，Space 切换选择；Shift 加方向键扩展范围；Home/End", () => {
        expect(treeKey(all, at("project://plain/sub"), key("ArrowDown"), 10)).toEqual({kind: "select", selection: at("project://plain/a.md")});
        expect(treeKey(all, at("project://plain/sub"), key("ArrowDown", {toggle: true}), 10)).toEqual({kind: "select", selection: {...at("project://plain/sub"), focus: "project://plain/a.md"}});
        expect(treeKey(all, {...at("project://plain/sub"), focus: "project://plain/a.md"}, key(" "), 10)).toEqual({kind: "select", selection: {selected: ["project://plain/sub", "project://plain/a.md"], focus: "project://plain/a.md", anchor: "project://plain/a.md"}});
        expect(treeKey(all, at("project://plain/sub"), key("ArrowDown", {shift: true}), 10)).toEqual({kind: "select", selection: {selected: ["project://plain/sub", "project://plain/a.md"], focus: "project://plain/a.md", anchor: "project://plain/sub"}});
        expect(treeKey(all, at("project://plain/sub"), key("Home"), 10)).toEqual({kind: "select", selection: at("project://")});
        expect(treeKey(all, at("project://plain/sub"), key("End"), 10)).toEqual({kind: "select", selection: at("user://")});
    });

    it("右键展开或进入第一个子项；左键收起或回到父目录；没有子项的不动", () => {
        expect(treeKey(all, at("project://plain/sub"), key("ArrowRight"), 10)).toEqual({kind: "expand", address: "project://plain/sub"});
        expect(treeKey(all, at("project://plain"), key("ArrowRight"), 10)).toEqual({kind: "select", selection: at("project://plain/sub")});
        expect(treeKey(all, at("project://plain"), key("ArrowLeft"), 10)).toEqual({kind: "collapse", address: "project://plain"});
        expect(treeKey(all, at("project://plain/a.md"), key("ArrowLeft"), 10)).toEqual({kind: "select", selection: at("project://plain")});
        expect(treeKey(all, at("project://plain/a.md"), key("ArrowRight"), 10)).toEqual({kind: "none"});
    });

    it("Enter：文件与有正文的节点打开，没有正文的节点与普通目录展开收起", () => {
        expect(treeKey(all, at("project://plain/a.md"), key("Enter"), 10)).toEqual({kind: "open", address: "project://plain/a.md"});
        expect(treeKey(all, at("project://lore.content/bob"), key("Enter"), 10)).toEqual({kind: "open", address: "project://lore.content/bob/index.md"});
        expect(treeKey(all, at("project://lore.content/alice"), key("Enter"), 10)).toEqual({kind: "expand", address: "project://lore.content/alice"});
        expect(treeKey(all, at("project://plain"), key("Enter"), 10)).toEqual({kind: "collapse", address: "project://plain"});
    });

    it("Ctrl+A 全选；Shift+F10 与 ContextMenu 键在焦点行开菜单；其它键不处理", () => {
        expect(treeKey(all, at("project://plain/a.md"), key("a", {toggle: true}), 10)).toMatchObject({kind: "select"});
        expect(treeKey(all, at("project://plain/a.md"), key("F10", {shift: true}), 10)).toEqual({kind: "menu", id: "project://plain/a.md"});
        expect(treeKey(all, at("project://plain/a.md"), key("ContextMenu"), 10)).toEqual({kind: "menu", id: "project://plain/a.md"});
        expect(treeKey(all, at("project://plain/a.md"), key("x"), 10)).toEqual({kind: "none"});
    });

    it("具名动作的键给出命令 id：F2 改名、Delete 删除、Ctrl/Meta+C/X/V 复制剪切粘贴、Escape 清除剪切、Alt+上下 上移下移；带别的修饰键不算", () => {
        expect(treeKey(all, at("project://plain/a.md"), key("c", {toggle: true}), 10)).toEqual({kind: "command", id: "nbook.files.copy"});
        expect(treeKey(all, at("project://plain/a.md"), key("X", {toggle: true}), 10)).toEqual({kind: "command", id: "nbook.files.cut"});
        expect(treeKey(all, at("project://plain/a.md"), key("v", {toggle: true}), 10)).toEqual({kind: "command", id: "nbook.files.paste"});
        expect(treeKey(all, at("project://plain/a.md"), key("Escape"), 10)).toEqual({kind: "command", id: "nbook.files.clear-cut"});
        expect(treeKey(all, at("project://plain/a.md"), key("v", {toggle: true, shift: true}), 10)).toEqual({kind: "none"});
        expect(treeKey(all, at("project://plain/a.md"), key("c"), 10)).toEqual({kind: "none"});
        expect(treeKey(all, at("project://plain/a.md"), key("F2"), 10)).toEqual({kind: "command", id: "nbook.files.rename"});
        expect(treeKey(all, at("project://plain/a.md"), key("Delete"), 10)).toEqual({kind: "command", id: "nbook.files.delete"});
        expect(treeKey(all, at("project://plain/a.md"), key("ArrowUp", {alt: true}), 10)).toEqual({kind: "command", id: "nbook.files.move-up"});
        expect(treeKey(all, at("project://plain/a.md"), key("ArrowDown", {alt: true}), 10)).toEqual({kind: "command", id: "nbook.files.move-down"});
        expect(treeKey(all, at("project://plain/a.md"), key("ArrowDown", {alt: true, shift: true}), 10)).toEqual({kind: "none"});
        expect(treeKey(all, at("project://plain/a.md"), key("Delete", {toggle: true}), 10)).toEqual({kind: "none"});
    });
});

describe("Spec workbench.files-explorer 增量刷新的依赖：失效规则", () => {
    const user = {kind: "user", plugin: null} as const;
    const loadedDirs = ["project://", "project://lore.content", "project://lore.content/bob", "project://lore.content/bob/sword", "project://plain", "project://plain/sub"];

    it("普通变化标脏父目录；改名标脏新旧父目录、作废旧子树并改写地址；删除作废并移除", () => {
        const change = invalidation("project", [
            {type: "created", path: "plain/new.md", source: user},
            {type: "renamed", path: "plain/sub2", from: "plain/sub", source: user},
            {type: "deleted", path: "top.md", source: user},
        ], loadedDirs);
        expect([...change.dirty]).toEqual(expect.arrayContaining(["project://plain", "project://"]));
        expect(change.gone).toEqual(["project://plain/sub", "project://top.md"]);
        expect(change.moves).toEqual([{from: "project://plain/sub", to: "project://plain/sub2"}]);
        expect(change.removed).toEqual(["project://top.md"]);
    });

    it("清单变化标脏同一内容根下全部已加载的层；节点正文的增删还标脏列出该节点的上一层", () => {
        const manifest = invalidation("project", [{type: "changed", path: "lore.content/content.xml", source: user}], loadedDirs);
        expect([...manifest.dirty]).toEqual(expect.arrayContaining(["project://lore.content", "project://lore.content/bob", "project://lore.content/bob/sword"]));
        expect([...manifest.dirty]).not.toContain("project://plain");
        const body = invalidation("project", [{type: "created", path: "lore.content/bob/sword/index.md", source: user}], loadedDirs);
        expect([...body.dirty]).toEqual(expect.arrayContaining(["project://lore.content/bob/sword", "project://lore.content/bob"]));
    });
});
