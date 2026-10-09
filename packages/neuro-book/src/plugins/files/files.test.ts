/**
 * `nbook.files` 三端入口（docs/specs/workspace/resources.md 验收 1、7 的列出部分，folder-kinds.md，files.md 的“读取与
 * 保存”）：服务端、项目实例与浏览器窗口都是真实的内核实例，经进程内链路连到服务端路由，帧走 JSON 编解码；文件是真实
 * 临时目录里的文件（场景见 `testing/scene.ts`）。
 *
 * 权限用例要求以普通用户运行（root 不受文件权限约束）。
 */

import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {chmod, readFile, rm} from "node:fs/promises";
import {join} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import type {SettingsWorld} from "nbook/plugins/settings/testing/world";

import {encodedTextBytes, projectFilesContract, TEXT_BUDGET_BYTES, userFilesContract} from "./shared/contracts";
import type {Listing} from "./shared/contracts";
import {extraWindow, files, filesScene, hash, remote} from "./testing/scene";
import type {Layout, Scene} from "./testing/scene";

let tmp = "";
let counter = 0;
const worlds: SettingsWorld[] = [];

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-files", "files-plugin");
});

afterEach(async () => {
    const results = [];
    for (const world of worlds.splice(0)) results.push(...(await world.close()));
    for (const result of results) expect(result).toMatchObject({status: "closed"});
});

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

async function scene(layout: {readonly project?: Layout; readonly user?: Layout} = {}): Promise<Scene> {
    counter += 1;
    const created = await filesScene(join(tmp, `world-${String(counter)}`), layout);
    worlds.push(created.world);
    return created;
}

function names(listing: {readonly ok: boolean; readonly value?: Listing}): string[] {
    expect(listing).toMatchObject({ok: true});
    return (listing.value as Listing).entries.map((entry) => entry.name);
}

describe("Spec workspace.resources 读与列出：三种调用方经同一份合同", () => {
    it("窗口经 filesKey 列出、读取并按基线保存两个根；过期基线为冲突、带当前基线，磁盘不被覆盖", async () => {
        const {project, user, window} = await scene({project: {"chapter.md": "第一章", ".nbook/project.json": "{}"}, user: {"notes.md": "笔记"}});
        const client = files(window);

        expect(names(await client.list("project://"))).toEqual(["chapter.md"]);
        const read = await client.read("project://chapter.md");
        expect(read).toEqual({ok: true, value: {text: "第一章", baseline: {hash: hash("第一章")}}});
        const baseline = read.ok ? read.value.baseline : {hash: ""};
        expect(await client.write("project://chapter.md", "第一章（改）", baseline)).toEqual({ok: true, value: {baseline: {hash: hash("第一章（改）")}}});
        expect(await readFile(join(project, "chapter.md"), "utf8")).toBe("第一章（改）");
        expect(await client.write("project://chapter.md", "旧基线", baseline)).toEqual({ok: false, code: "conflict", detail: expect.any(String), current: {hash: hash("第一章（改）")}});
        expect(await readFile(join(project, "chapter.md"), "utf8")).toBe("第一章（改）");

        const notes = await client.read("user://notes.md");
        expect(notes).toMatchObject({ok: true, value: {text: "笔记"}});
        expect(await client.write("user://notes.md", "笔记二", {hash: hash("笔记")})).toMatchObject({ok: true});
        expect(await readFile(join(user, "notes.md"), "utf8")).toBe("笔记二");
    });

    it("项目实例与服务端里的插件直接用合同读写（调用方种类 project、server 都被接受）", async () => {
        const {project, user, inProject, hub} = await scene({project: {"a.md": "A"}, user: {"u.md": "U"}});
        expect(await remote(inProject).use(projectFilesContract).write({path: "a.md", text: "A2", baseline: {hash: hash("A")}})).toMatchObject({ok: true});
        expect(await readFile(join(project, "a.md"), "utf8")).toBe("A2");
        expect(await remote(inProject).use(userFilesContract).read({path: "u.md"})).toMatchObject({ok: true, value: {text: "U"}});
        expect(await remote(hub).use(userFilesContract).write({path: "u.md", text: "U2", baseline: {hash: hash("U")}})).toMatchObject({ok: true});
        expect(await readFile(join(user, "u.md"), "utf8")).toBe("U2");
    });

    it("失败可区分：地址不合法、没有这个方案、不存在、控制目录、读目录、列文件；只保存已有文件", async () => {
        const {project, window} = await scene({project: {"a.md": "A", ".nbook/project.json": "{}"}});
        const client = files(window);
        expect(await client.read("project://../x.md")).toMatchObject({ok: false, code: "invalid-address"});
        expect(await client.read("docs://guide.md")).toMatchObject({ok: false, code: "unknown-scheme"});
        expect(await client.read("project://missing.md")).toMatchObject({ok: false, code: "not-found"});
        expect(await client.read("project://.nbook/project.json")).toMatchObject({ok: false, code: "protected-path"});
        expect(await client.read("project://")).toMatchObject({ok: false, code: "not-a-file"});
        expect(await client.list("project://a.md")).toMatchObject({ok: false, code: "not-a-directory"});
        expect(await client.write("project://new.md", "N", {hash: hash("")})).toMatchObject({ok: false, code: "not-found"});
        expect(await readFile(join(project, "a.md"), "utf8")).toBe("A");
    });

    it("未绑定项目的窗口访问 project:// 得到路由层的失败，不是空目录", async () => {
        const created = await scene();
        const free = await extraWindow(created, "free", {bound: false});
        const listed = await files(free).list("project://");
        expect(listed.ok).toBe(false);
        expect(await files(free).list("user://")).toMatchObject({ok: true});
    });
});

describe("Spec workspace.folder-kinds 列出：三类文件夹", () => {
    const manifest = `<?xml version="1.0"?>
<content>
  <item name="lin-feng" title="林峰"/>
  <item name="chen-yao" title="陈瑶" icon="user">
    <item name="portrait.png" title="立绘"/>
  </item>
  <item name="ghost" title="已删除"/>
</content>`;

    it("普通文件夹：目录在前，中文自然排序，相等按码元；只看后缀分类", async () => {
        const {window} = await scene({project: {"chapter-10.md": "", "chapter-2.md": "", "a.md": "", "A.md": "", "第10章.md": "", "第2章.md": "", "zz/x.md": "", "lorebook.content/x.md": "", "manuscripts.binder/00001-a.md": ""}});
        const listed = await files(window).list("project://");
        // zh-CN 的排序把汉字排在拉丁字母前。
        expect(names(listed)).toEqual(["lorebook.content", "manuscripts.binder", "zz", "第2章.md", "第10章.md", "A.md", "a.md", "chapter-2.md", "chapter-10.md"]);
        expect(listed.ok && listed.value.folder).toBe("plain");
        expect(listed.ok && listed.value.entries.slice(0, 3).map((entry) => entry.folder)).toEqual(["content", "binder", "plain"]);
    });

    it("内容文件夹：清单顺序与展示名，未列入项排在末尾，缺失条目标出；子目录带有无正文；清单文件标出", async () => {
        const {window} = await scene({project: {
            "lorebook.content/content.xml": manifest,
            "lorebook.content/chen-yao/index.md": "陈瑶正文",
            "lorebook.content/chen-yao/portrait.png": "png",
            "lorebook.content/chen-yao/notes.md": "",
            "lorebook.content/lin-feng/portrait.png": "png",
            "lorebook.content/zeta/index.md": "",
            "lorebook.content/a.md": "",
        }});
        const listed = await files(window).list("project://lorebook.content");
        expect(listed).toMatchObject({ok: true, value: {folder: "content", contentRoot: "lorebook.content", manifest: {status: "ok"}}});
        expect(listed.ok && listed.value.entries).toEqual([
            {name: "lin-feng", kind: "directory", folder: "plain", body: false, title: "林峰", listed: true},
            {name: "chen-yao", kind: "directory", folder: "plain", body: true, title: "陈瑶", icon: "user", listed: true},
            {name: "ghost", kind: "missing", title: "已删除", listed: true},
            {name: "zeta", kind: "directory", folder: "plain", body: true, listed: false},
            {name: "a.md", kind: "file", listed: false},
            {name: "content.xml", kind: "file", role: "manifest", listed: false},
        ]);

        const node = await files(window).list("project://lorebook.content/chen-yao");
        expect(node).toMatchObject({ok: true, value: {folder: "plain", contentRoot: "lorebook.content"}});
        expect(node.ok && node.value.entries).toEqual([
            {name: "portrait.png", kind: "file", title: "立绘", listed: true},
            {name: "index.md", kind: "file", role: "body", listed: false},
            {name: "notes.md", kind: "file", listed: false},
        ]);
        // 清单里没有的深层目录：整层都是未列入项。
        expect(await files(window).list("project://lorebook.content/zeta")).toMatchObject({ok: true, value: {entries: [{name: "index.md", role: "body", listed: false}]}});
    });

    it("清单不合法、缺失或读不出：按普通文件夹排序并报告状态，列出本身成功", async () => {
        const cases: ReadonlyArray<readonly [string, string | null, string]> = [
            ["broken.content", "<content><item name=\"b\"></content>", "invalid"],
            ["dup.content", "<content><item name=\"b\"/><item name=\"b\"/></content>", "invalid"],
            ["nested.content", "<content><item name=\"a/b\"/></content>", "invalid"],
            ["other.content", "<content><group/></content>", "invalid"],
            ["empty.content", null, "absent"],
        ];
        const layout: Record<string, string> = {};
        for (const [folder, text] of cases) {
            layout[`${folder}/b.md`] = "";
            layout[`${folder}/a.md`] = "";
            if (text !== null) layout[`${folder}/content.xml`] = text;
        }
        const {window} = await scene({project: layout});
        for (const [folder, , status] of cases) {
            const listed = await files(window).list(`project://${folder}`);
            expect(`${folder}：${listed.ok ? String(listed.value.manifest?.status) : listed.code}`).toBe(`${folder}：${status}`);
            expect(names(listed).filter((name) => name !== "content.xml")).toEqual(["a.md", "b.md"]);
        }
    });

    it("不可读的正文不妨碍列出；读它为 permission-denied", async () => {
        const {project, window} = await scene({project: {"open.md": "O", "closed.md": "C"}});
        await chmod(join(project, "closed.md"), 0o000);
        try {
            expect(names(await files(window).list("project://"))).toEqual(["closed.md", "open.md"]);
            expect(await files(window).read("project://closed.md")).toMatchObject({ok: false, code: "permission-denied"});
        } finally {
            await chmod(join(project, "closed.md"), 0o644);
        }
    });
});

describe("Spec workspace.files 读取与保存：文本与上限", () => {
    it("BOM 与 CRLF 原样往返：读到的文本带 BOM，原样保存后字节不变", async () => {
        const bytes = new Uint8Array([0xef, 0xbb, 0xbf, 0x61, 0x0d, 0x0a]);
        const {project, window} = await scene({project: {"bom.md": bytes}});
        const read = await files(window).read("project://bom.md");
        expect(read).toEqual({ok: true, value: {text: "﻿a\r\n", baseline: {hash: hash(bytes)}}});
        expect(await files(window).write("project://bom.md", "﻿a\r\n", {hash: hash(bytes)})).toEqual({ok: true, value: {baseline: {hash: hash(bytes)}}});
        expect(new Uint8Array(await readFile(join(project, "bom.md")))).toEqual(bytes);
    });

    it("含 NUL 或非法 UTF-8 为 not-text", async () => {
        const {window} = await scene({project: {"nul.md": new Uint8Array([0x61, 0x00, 0x62]), "latin.md": new Uint8Array([0x61, 0xe9, 0x62])}});
        expect(await files(window).read("project://nul.md")).toMatchObject({ok: false, code: "not-text"});
        expect(await files(window).read("project://latin.md")).toMatchObject({ok: false, code: "not-text"});
    });

    it("正文上限按 JSON 编码后的字节：恰在上限内可读可存；换行多的文件不到上限字节也会超；超出时客户端与提供者都拒绝", async () => {
        // JSON 编码多出两个引号。
        const fits = "x".repeat(TEXT_BUDGET_BYTES - 2);
        const escaped = "\n".repeat(Math.ceil(TEXT_BUDGET_BYTES / 2));
        expect([encodedTextBytes(fits), encodedTextBytes(escaped) > TEXT_BUDGET_BYTES]).toEqual([TEXT_BUDGET_BYTES, true]);
        const {project, window, inProject} = await scene({project: {"fits.md": fits, "escaped.md": escaped, "small.md": "s"}});
        const read = await files(window).read("project://fits.md");
        expect(read).toMatchObject({ok: true});
        expect(await files(window).write("project://fits.md", `${fits.slice(1)}y`, {hash: hash(fits)})).toMatchObject({ok: true});
        expect(await files(window).read("project://escaped.md")).toMatchObject({ok: false, code: "too-large"});

        expect(await files(window).write("project://small.md", `${fits}x`, {hash: hash("s")})).toMatchObject({ok: false, code: "too-large"});
        expect(await remote(inProject).use(projectFilesContract).write({path: "small.md", text: `${fits}x`, baseline: {hash: hash("s")}})).toMatchObject({ok: false, code: "too-large"});
        expect(await readFile(join(project, "small.md"), "utf8")).toBe("s");
    });
});
