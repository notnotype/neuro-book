/**
 * 资源管理器的单项动作与删除（docs/specs/workbench/files-explorer.md 验收 2、4、8，以及“新应用的插件、命令与界面”的
 * 当前根、剪贴板之外的冻结意图、焦点）：真实内核实例、真实目录与清单，经窗口里的文件客户端（`testing/world.ts`）。
 * “没有写入”看窗口链路上记下的请求。
 */

import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {chmod, lstat, readdir, readFile, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import type {Layout} from "nbook/plugins/files/testing/scene";
import {filesWrites} from "nbook/plugins/files/testing/tap";

import {barrier, entry, exists, explorerWorlds, row, select, until} from "./testing/world";
import type {ExplorerWorld} from "./testing/world";

/** 权限用例要求以普通用户运行，root 时跳过。 */
const privileged = process.getuid?.() === 0;

let tmp = "";
const worlds = explorerWorlds(() => tmp);

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-explorer", "actions");
});

afterEach(async () => {
    await worlds.close((scene) => chmod(join(scene.project, "locked"), 0o755).catch(() => undefined));
});

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

const MANIFEST = `<?xml version="1.0" encoding="UTF-8"?>
<content>
  <item name="alice" title="爱丽丝"/>
  <item name="bob" title="鲍勃"/>
  <item name="gone" title="已删除"/>
</content>
`;

const LAYOUT: Layout = {
    "lore.content/content.xml": MANIFEST,
    "lore.content/alice/notes.md": "A",
    "lore.content/bob/index.md": "BOB",
    "lore.content/stray.md": "S",
    "plain/a.md": "PA",
    "plain/sub/x.md": "X",
    "plain/z.md": "Z",
};

const EXPANDED = ["project://", "project://plain", "project://lore.content"];

const world = (layout: Layout = LAYOUT): Promise<ExplorerWorld> => worlds.world(layout, EXPANDED, ["project://lore.content/alice", "project://plain/a.md"]);
const manifest = (at: ExplorerWorld): Promise<string> => readFile(join(at.scene.project, "lore.content", "content.xml"), "utf8");

describe("Spec workbench.files-explorer 新建：内联输入", () => {
    it("目标是选中的目录；空名、含 / 与同名在输入框原位提示且不写；合法名字排他新建空文件，新项被选中", async () => {
        const at = await world();
        const {controller} = at;
        select(controller, "project://plain/sub");
        expect(controller.create("file")).toEqual({ok: true});
        expect(controller.editing.value).toMatchObject({mode: "create", creating: {parent: "project://plain/sub", entry: "file", before: null}});
        // 目标目录先展开、列出，输入行才出现在它的子项之前。
        await until(at, "输入行出现", () => row(controller, "project://plain/sub#new") !== undefined);
        expect(row(controller, "project://plain/sub#new")).toMatchObject({kind: "edit", depth: 3});
        await controller.commitEdit();
        expect(controller.editing.value?.error).toEqual({code: "empty"});
        controller.editName("a/b");
        await controller.commitEdit();
        expect(controller.editing.value?.error).toEqual({code: "invalid"});
        controller.editName("x.md");
        await controller.commitEdit();
        expect(controller.editing.value).toMatchObject({error: {code: "conflict"}, busy: false});
        expect(await readFile(join(at.scene.project, "plain", "sub", "x.md"), "utf8")).toBe("X");
        controller.editName("new.md");
        await controller.commitEdit();
        expect(controller.editing.value).toBeNull();
        expect(await readFile(join(at.scene.project, "plain", "sub", "new.md"), "utf8")).toBe("");
        await until(at, "新项出现并被选中", () => controller.selection.value.focus === "project://plain/sub/new.md");
        expect(controller.selection.value.selected).toEqual(["project://plain/sub/new.md"]);
        expect(controller.focusRequest.value).toBeGreaterThan(0);
    });

    it("选中文件时目标是它的父目录；内容文件夹里新项插到选中项之前；Escape 取消不写", async () => {
        const at = await world();
        const {controller} = at;
        select(controller, "project://lore.content/stray.md");
        expect(controller.create("directory")).toEqual({ok: true});
        expect(controller.editing.value).toMatchObject({creating: {parent: "project://lore.content", before: "stray.md"}});
        controller.cancelEdit();
        expect(controller.editing.value).toBeNull();
        select(controller, "project://lore.content/stray.md");
        controller.create("directory");
        controller.editName("carol");
        await controller.commitEdit();
        expect([...(await manifest(at)).matchAll(/name="([^"]+)"/gu)].map((match) => match[1])).toEqual(["alice", "bob", "gone", "carol"]);
        expect((await lstat(join(at.scene.project, "lore.content", "carol"))).isDirectory()).toBe(true);
        expect(filesWrites(at.tap.requests).map((request) => request.method)).toEqual(["create"]);
    });

    it("多个选中项时不猜目标；没有选择时取当前根", async () => {
        const at = await world();
        const {controller} = at;
        select(controller, "project://plain/a.md", "project://plain/z.md");
        expect(controller.create("file")).toEqual({ok: false, reason: "no-target"});
        select(controller, "user://");
        expect(controller.create("file")).toEqual({ok: true});
        expect(controller.editing.value).toMatchObject({creating: {parent: "user://"}});
    });
});

describe("Spec workbench.files-explorer 改名：冻结身份", () => {
    it("改名带开始时的令牌；名字不变直接结束、不写；新名字改真实名字，选择跟到新地址", async () => {
        const at = await world();
        const {controller} = at;
        select(controller, "project://plain/a.md");
        expect(await controller.rename()).toEqual({ok: true});
        expect(controller.editing.value).toMatchObject({mode: "rename", address: "project://plain/a.md", name: "a.md"});
        await controller.commitEdit();
        expect(controller.editing.value).toBeNull();
        // Escape 取消改了一半的名字：同样不写（同字节写回也算写入，看写请求，不看字节）。
        await controller.rename();
        controller.editName("half.md");
        controller.cancelEdit();
        await barrier(at);
        expect(filesWrites(at.tap.requests)).toEqual([]);
        await controller.rename();
        controller.editName("b.md");
        await controller.commitEdit();
        expect(await readFile(join(at.scene.project, "plain", "b.md"), "utf8")).toBe("PA");
        await until(at, "选择跟到新名字", () => controller.selection.value.focus === "project://plain/b.md");
        expect(filesWrites(at.tap.requests)).toEqual([expect.objectContaining({method: "rename", input: expect.objectContaining({expected: expect.any(String)})})]);
    });

    it("开始改名后源被同字节的新文件替换：提交为源已换，原位提示，磁盘不变", async () => {
        const at = await world();
        const {controller} = at;
        select(controller, "project://plain/a.md");
        await controller.rename();
        await rm(join(at.scene.project, "plain", "a.md"));
        await writeFile(join(at.scene.project, "plain", "a.md"), "PA");
        controller.editName("b.md");
        await controller.commitEdit();
        expect(controller.editing.value?.error).toEqual({code: "failed", detail: expect.stringContaining("source-changed")});
        expect(await exists(join(at.scene.project, "plain", "b.md"))).toBe(false);
    });
});

describe("Spec workbench.files-explorer 删除：确认与逐项结果", () => {
    it("父子同时选中只删最外层；确认前不写，取消不写；确认后删除，焦点到下一个存活的同层项", async () => {
        const at = await world();
        const {controller} = at;
        controller.click("project://plain/sub", {toggle: false, range: false}, "twisty");
        await until(at, "sub 列出", () => row(controller, "project://plain/sub/x.md") !== undefined);
        select(controller, "project://plain/sub", "project://plain/sub/x.md");
        expect(await controller.delete()).toEqual({ok: true});
        expect(controller.dialog.value).toEqual({kind: "delete", items: [{address: "project://plain/sub", token: expect.any(String)}], busy: false});
        controller.closeDialog();
        expect(controller.dialog.value).toBeNull();
        await barrier(at);
        expect(filesWrites(at.tap.requests)).toEqual([]);

        select(controller, "project://plain/sub");
        await controller.delete();
        await controller.confirmDelete();
        expect(await exists(join(at.scene.project, "plain", "sub"))).toBe(false);
        expect(controller.report.value).toBeNull();
        expect(controller.selection.value.focus).toBe("project://plain/a.md");
    });

    it.skipIf(privileged)("部分失败：逐项结果列出失败的项与原因，成功的项照常删除", async () => {
        const at = await world({...LAYOUT, "locked/inner.md": "L"});
        const {controller} = at;
        controller.click("project://locked", {toggle: false, range: false}, "row");
        await until(at, "locked 列出", () => row(controller, "project://locked/inner.md") !== undefined);
        await chmod(join(at.scene.project, "locked"), 0o555);
        select(controller, "project://locked/inner.md", "project://plain/z.md");
        await controller.delete();
        await controller.confirmDelete();
        expect(controller.report.value).toEqual({
            action: "delete",
            items: [
                {address: "project://locked/inner.md", target: null, result: expect.objectContaining({status: "failed", code: "permission-denied"})},
                {address: "project://plain/z.md", target: null, result: {status: "done"}},
            ],
            manifests: [],
            truncated: false,
        });
        expect(await exists(join(at.scene.project, "plain", "z.md"))).toBe(false);
        expect(await exists(join(at.scene.project, "locked", "inner.md"))).toBe(true);
    });
});

describe("Spec workbench.files-explorer 验收 2、4：内容文件夹的动作只改清单或排他创建", () => {
    it("创建内容：排他创建空白 index.md，节点有了正文入口；已有正文的节点不可用", async () => {
        const at = await world();
        const {controller} = at;
        select(controller, "project://lore.content/alice");
        expect(await controller.createContent()).toEqual({ok: true});
        expect(await readFile(join(at.scene.project, "lore.content", "alice", "index.md"), "utf8")).toBe("");
        await until(at, "alice 有了正文", () => entry(controller, "project://lore.content/alice").body);
        select(controller, "project://lore.content/bob");
        expect(await controller.createContent()).toEqual({ok: false, reason: "not-applicable"});
        expect(await readFile(join(at.scene.project, "lore.content", "bob", "index.md"), "utf8")).toBe("BOB");
    });

    it.skipIf(privileged)("创建内容失败：列出之后外部已占用为冲突、不覆盖；没有写权限时提示原因，节点仍没有正文", async () => {
        const at = await world();
        const {controller} = at;
        const alice = join(at.scene.project, "lore.content", "alice");
        // 选择仍基于旧列出（没有正文）时外部写了 index.md：排他创建不覆盖它。
        select(controller, "project://lore.content/alice");
        await writeFile(join(alice, "index.md"), "外部");
        expect(await controller.createContent()).toEqual({ok: true});
        expect(controller.notice.value).toMatchObject({kind: "failed", action: "create-content", address: "project://lore.content/alice", code: "conflict"});
        expect(await readFile(join(alice, "index.md"), "utf8")).toBe("外部");

        await rm(join(alice, "index.md"));
        await until(at, "alice 又没有正文", () => !entry(controller, "project://lore.content/alice").body);
        await chmod(alice, 0o555);
        try {
            controller.dismissNotice();
            expect(await controller.createContent()).toEqual({ok: true});
            expect(controller.notice.value).toMatchObject({kind: "failed", action: "create-content", code: "permission-denied"});
            expect(await exists(join(alice, "index.md"))).toBe(false);
            await barrier(at);
            expect(entry(controller, "project://lore.content/alice").body).toBe(false);
        } finally {
            await chmod(alice, 0o755);
        }
    });

    it("展示名、加入清单、从清单移除、上移下移只改清单，文件路径与字节不变", async () => {
        const at = await world();
        const {controller} = at;
        const before = (await readdir(join(at.scene.project, "lore.content"), {recursive: true})).sort();
        select(controller, "project://lore.content/alice");
        expect(controller.editDisplay()).toEqual({ok: true});
        expect(controller.dialog.value).toMatchObject({kind: "display", address: "project://lore.content/alice", title: "爱丽丝"});
        await controller.commitDisplay("艾丽斯", "person");
        expect(await manifest(at)).toContain('<item name="alice" title="艾丽斯" icon="person"/>');
        await until(at, "标签更新", () => entry(controller, "project://lore.content/alice").label === "艾丽斯");
        // 留空即去掉：清单里不再有展示名，标签回到真实名字。
        select(controller, "project://lore.content/alice");
        controller.editDisplay();
        await controller.commitDisplay("", "person");
        expect(await manifest(at)).toContain('<item name="alice" icon="person"/>');
        await until(at, "标签回到真实名字", () => entry(controller, "project://lore.content/alice").label === "alice");

        select(controller, "project://lore.content/stray.md");
        expect(await controller.include()).toEqual({ok: true});
        expect(await manifest(at)).toContain('name="stray.md"');
        select(controller, "project://lore.content/gone");
        expect(await controller.drop()).toEqual({ok: true});
        expect(await manifest(at)).not.toContain('name="gone"');

        await until(at, "清单变化反映到树上", () => row(controller, "project://lore.content/gone") === undefined && entry(controller, "project://lore.content/stray.md").listed === true);
        select(controller, "project://lore.content/alice");
        expect(controller.available.value.moveUp).toBe(false);
        select(controller, "project://lore.content/bob", "project://lore.content/stray.md");
        expect(await controller.move("up")).toEqual({ok: true});
        const order = [...(await manifest(at)).matchAll(/name="([^"]+)"/gu)].map((match) => match[1]);
        expect(order).toEqual(["bob", "stray.md", "alice"]);
        expect((await readdir(join(at.scene.project, "lore.content"), {recursive: true})).sort()).toEqual(before);
        expect(await readFile(join(at.scene.project, "lore.content", "bob", "index.md"), "utf8")).toBe("BOB");
    });

    it("转换：普通目录转为内容文件夹再转回，带冻结的令牌", async () => {
        const at = await world();
        const {controller} = at;
        select(controller, "project://plain/sub");
        expect(await controller.convert()).toEqual({ok: true});
        expect((await lstat(join(at.scene.project, "plain", "sub.content"))).isDirectory()).toBe(true);
        await until(at, "转换后的目录被选中", () => controller.selection.value.focus === "project://plain/sub.content");
        expect(await controller.convert()).toEqual({ok: true});
        expect((await lstat(join(at.scene.project, "plain", "sub"))).isDirectory()).toBe(true);
        expect(filesWrites(at.tap.requests).map((request) => (request.input as {expected?: string}).expected)).toEqual([expect.any(String), expect.any(String)]);
    });
});
