/**
 * 资源管理器与编辑器的文档协调（docs/specs/workbench/editor.md 输出 23–25，docs/specs/workbench/files-explorer.md 验收 9）：
 * 同一个窗口里真实的资源管理器控制器与真实的文档模型（编辑器的 `documents/store.ts`），经同一个文件客户端访问真实
 * 目录。保存在途用链路闸门扣住回复制造，变化事件经场地时钟交付。
 */

import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {readFile, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {createDocumentStore} from "nbook/plugins/editor/web/documents/store";
import type {DocumentStore, TextDocument} from "nbook/plugins/editor/web/documents/store";
import type {Layout} from "nbook/plugins/files/testing/scene";
import {filesWrites} from "nbook/plugins/files/testing/tap";

import {explorerWorlds, select, until} from "./testing/world";
import type {ExplorerWorld} from "./testing/world";

let tmp = "";
const worlds = explorerWorlds(() => tmp);
const stores: DocumentStore[] = [];

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-explorer", "documents");
});

afterEach(async () => {
    for (const store of stores.splice(0)) store.dispose();
    await worlds.close();
});

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

const LAYOUT: Layout = {"plain/a.md": "A", "plain/b.md": "B", "dest/.keep": "", "other/.keep": "", "third/.keep": ""};
const EXPANDED = ["project://", "project://plain", "project://dest", "project://other", "project://third"];

interface Pair {
    readonly at: ExplorerWorld;
    readonly store: DocumentStore;
}

async function pair(): Promise<Pair> {
    let created: DocumentStore | null = null;
    const at = await worlds.world(LAYOUT, EXPANDED, ["project://plain/a.md", "project://dest/.keep"], {}, {documents: (files) => {
        created = createDocumentStore({files, workspaceKey: "p1", generation: 1, report: (error) => {
            throw error;
        }});
        stores.push(created);
        return created.coordinator;
    }});
    if (created === null) throw new Error("没有建文档模型");
    return {at, store: created};
}

const disk = (at: ExplorerWorld, path: string): Promise<string> => readFile(join(at.scene.project, path), "utf8");

async function dirty(p: Pair, address: string, text: string): Promise<TextDocument> {
    const document = p.store.acquire(address).document;
    await until(p.at, `${address} 读到`, () => document.status.value === "ready");
    p.store.commit(document, "v", document.revision.value, text);
    return document;
}

describe("Spec workbench.editor 输出 23：复制有未保存修改的文档", () => {
    it("提交之前问；取消不写；复制磁盘版本得到旧正文；先保存再复制得到新正文", async () => {
        const p = await pair();
        const {controller} = p.at;
        const document = await dirty(p, "project://plain/a.md", "A（未保存）");
        select(controller, "project://plain/a.md");
        await controller.copy();

        for (const [choice, target, expected] of [["cancel", "dest", null], ["disk", "other", "A"], ["save", "third", "A（未保存）"]] as const) {
            select(controller, `project://${target}`);
            const pasting = controller.paste();
            await until(p.at, "问", () => controller.dialog.value?.kind === "dirty-copy");
            expect(controller.dialog.value).toEqual({kind: "dirty-copy", documents: ["project://plain/a.md"]});
            controller.answerDirtyCopy(choice);
            await pasting;
            if (expected === null) expect(filesWrites(p.at.tap.requests)).toEqual([]);
            else expect(await disk(p.at, `${target}/a.md`)).toBe(expected);
        }
        expect(document.dirty.value).toBe(false);
        expect(await disk(p.at, "plain/a.md")).toBe("A（未保存）");
    });
});

describe("Spec workbench.editor 输出 24：移动与改名", () => {
    it("剪切后保存再粘贴：冻结的身份经保存的身份链换新，移动成功；文档跟到新地址，正文与 dirty 保留", async () => {
        const p = await pair();
        const {controller} = p.at;
        const document = await dirty(p, "project://plain/a.md", "A1");
        select(controller, "project://plain/a.md");
        await controller.cut();
        expect(await p.store.save(document)).toEqual({ok: true});
        p.store.commit(document, "v", document.revision.value, "A2");
        select(controller, "project://dest");
        await controller.paste();
        expect(controller.report.value).toBeNull();
        expect(await disk(p.at, "dest/a.md")).toBe("A1");
        expect(document.target.value.path).toBe("project://dest/a.md");
        expect(document.dirty.value).toBe(true);
        expect(await p.store.save(document)).toEqual({ok: true});
        expect(await disk(p.at, "dest/a.md")).toBe("A2");
    });

    it("保存在途时移动：等保存结束再提交，期间的新输入保持 dirty、跟到新地址", async () => {
        const p = await pair();
        const {controller} = p.at;
        const document = await dirty(p, "project://plain/a.md", "A1");
        const held = p.at.tap.hold((request) => request.method === "write");
        const saving = p.store.save(document);
        await held.arrived;
        select(controller, "project://plain/a.md");
        await controller.cut();
        select(controller, "project://dest");
        const pasting = controller.paste();
        // 粘贴先列出目标、再取租约；租约等在途的保存。
        await until(p.at, "列出了目标", () => p.at.tap.requests.some((request) => request.method === "list" && JSON.stringify(request.input).includes("dest")));
        p.store.commit(document, "v", document.revision.value, "A2");
        expect(p.at.tap.requests.some((request) => request.method === "move")).toBe(false);
        held.release();
        await saving;
        await pasting;
        expect(await disk(p.at, "dest/a.md")).toBe("A1");
        expect(document.target.value.path).toBe("project://dest/a.md");
        expect(document.text.value).toBe("A2");
        expect(document.dirty.value).toBe(true);
    });

    it("外部替换了源：身份链认不出，仍是源已换", async () => {
        const p = await pair();
        const {controller} = p.at;
        await dirty(p, "project://plain/a.md", "A1");
        select(controller, "project://plain/a.md");
        await controller.cut();
        await rm(join(p.at.scene.project, "plain/a.md"));
        await writeFile(join(p.at.scene.project, "plain/a.md"), "A（外部）");
        select(controller, "project://dest");
        await controller.paste();
        expect(controller.report.value?.items).toEqual([expect.objectContaining({address: "project://plain/a.md", result: expect.objectContaining({status: "failed", code: "source-changed"})})]);
    });

    it("有未裁决输入的文档挡住移动：说明原因，不发移动请求", async () => {
        const p = await pair();
        const {controller} = p.at;
        const document = await dirty(p, "project://plain/a.md", "A1");
        p.store.commit(document, "v2", document.revision.value - 1, "另一视图");
        select(controller, "project://plain/a.md");
        await controller.cut();
        select(controller, "project://dest");
        await controller.paste();
        expect(controller.notice.value).toMatchObject({kind: "failed", action: "move", code: "document-unsettled", address: "project://plain/a.md"});
        expect(filesWrites(p.at.tap.requests)).toEqual([]);
    });

    it("改名：文档跟到新名字；有未裁决输入时原位说明、不改名", async () => {
        const p = await pair();
        const {controller} = p.at;
        const document = await dirty(p, "project://plain/a.md", "A1");
        select(controller, "project://plain/a.md");
        await controller.rename();
        controller.editName("c.md");
        await controller.commitEdit();
        expect(document.target.value.path).toBe("project://plain/c.md");
        expect(await disk(p.at, "plain/c.md")).toBe("A");

        const other = await dirty(p, "project://plain/b.md", "B1");
        p.store.commit(other, "v2", other.revision.value - 1, "另一视图");
        await until(p.at, "c.md 列出", () => controller.rows.value.some((row) => row.id === "project://plain/c.md"));
        select(controller, "project://plain/b.md");
        await controller.rename();
        controller.editName("d.md");
        await controller.commitEdit();
        expect(controller.editing.value).toMatchObject({mode: "rename", busy: false, error: {code: "unsettled", detail: "project://plain/b.md"}});
        expect(await disk(p.at, "plain/b.md")).toBe("B");
    });
});

describe("Spec workbench.editor 输出 24：改名等保存期间取消", () => {
    it("改名的租约在等在途保存：期间取消输入，保存结束后不发改名请求", async () => {
        const p = await pair();
        const {controller} = p.at;
        const document = await dirty(p, "project://plain/a.md", "A1");
        const held = p.at.tap.hold((request) => request.method === "write");
        const saving = p.store.save(document);
        await held.arrived;
        select(controller, "project://plain/a.md");
        await controller.rename();
        controller.editName("c.md");
        const committing = controller.commitEdit();
        await until(p.at, "改名在等", () => controller.editing.value?.busy === true);
        controller.cancelEdit();
        held.release();
        await saving;
        await committing;
        expect(p.at.tap.requests.some((request) => request.method === "rename")).toBe(false);
        expect(await disk(p.at, "plain/a.md")).toBe("A1");
        expect(document.target.value.path).toBe("project://plain/a.md");
    });
});

describe("Spec workbench.editor 输出 25：删除", () => {
    it("确认框列出会丢失未保存修改的文档；删除成功后关闭这些文档", async () => {
        const p = await pair();
        const {controller} = p.at;
        await dirty(p, "project://plain/a.md", "A1");
        select(controller, "project://plain");
        await controller.delete();
        expect(controller.dialog.value).toMatchObject({kind: "delete", unsaved: ["project://plain/a.md"]});
        await controller.confirmDelete();
        expect(p.store.get("project://plain/a.md")).toBeNull();
    });
});
