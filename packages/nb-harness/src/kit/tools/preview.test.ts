/**
 * 审批预览的试算（docs/specs/agent/builtin-tools.md 输出 26）：按当前磁盘算出改前改后，不写盘、不动会话的行锚快照；太大的不算，
 * 算不出来的写明。哪个工具按哪种写法试算、预览怎么送到界面由宿主定，留在宿主的测试里。
 */

import {afterEach, beforeEach, describe, expect, test} from "bun:test";
import {mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {EditStore} from "@oh-my-pi/pi-natives";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import type {ToolContext, ToolResult, ToolSessionContext} from "../../kernel/contracts.js";
import type {ArtifactStore, SessionFiles} from "../files/index.js";
import {localFiles} from "../files/local.js";
import {hashlineTool, previewEdit} from "./edit.js";
import {previewChanges} from "./preview.js";
import {readTool} from "./read.js";
import {SessionEditStores} from "./snapshot.js";
import type {KitToolImplementation} from "./types.js";

let root = "";
let home = "";
let files: SessionFiles;
let artifacts: ArtifactStore;
let stores: SessionEditStores;
const GLOBAL = "work://home";
const SESSION = "s-1";
const context = {sessionId: SESSION, profile: "p"} as ToolSessionContext;
const signal = new AbortController().signal;

beforeEach(async () => {
    root = await createTestTmpRoot("nb-harness-kit", "tools-preview");
    home = join(root, "work", "home");
    await mkdir(home, {recursive: true});
    stores = new SessionEditStores();
    ({files, artifacts} = localFiles({
        roots: {work: join(root, "work")},
        aliases: {home: GLOBAL},
        layout: {working: "home://", scratch: [], localWrites: [], shellEnv: {}, searchExcludes: () => []},
        classify: () => "allowed",
        artifacts: "work://artifacts",
    }));
});
afterEach(async () => {
    if (root !== "") await rm(root, {recursive: true, force: true});
});

async function call(tool: KitToolImplementation, args: Readonly<Record<string, unknown>>): Promise<ToolResult> {
    const result = await tool.create(context, {files, artifacts}).execute(args, {callId: "c-1", signal} as unknown as ToolContext);
    return typeof result === "string" ? {text: result} : result;
}
const tagOf = async (path: string): Promise<string> => /#([0-9A-F]{4})\]/u.exec((await call(readTool(stores), {path})).text)?.[1] ?? "";
const hashline = (address: string, tag: string, body: string) => `[${address}#${tag}]\n${body}\n`;

describe("审批预览的试算（输出 26）", () => {
    test("write：新文件改前是空的，已有文件是现在的内容；不写盘", async () => {
        await writeFile(join(home, "a.md"), "旧\n");
        expect(await previewChanges("write", {path: "home://新.md", content: "新内容\n"}, files, stores, SESSION, signal)).toEqual({files: [{address: `${GLOBAL}/新.md`, kind: "diff", before: "", after: "新内容\n"}]});
        await expect(readFile(join(home, "新.md"), "utf8")).rejects.toThrow();
        expect(await previewChanges("write", {path: "home://a.md", content: "新\n"}, files, stores, SESSION, signal)).toEqual({files: [{address: `${GLOBAL}/a.md`, kind: "diff", before: "旧\n", after: "新\n"}]});
        expect(await readFile(join(home, "a.md"), "utf8")).toBe("旧\n");
    });

    test("hashline 一次改两个文件按文件分节；预览两次结果相同、不写盘；会话的行锚不受影响，之后照样改得成", async () => {
        await writeFile(join(home, "a.md"), "一\n二\n");
        await writeFile(join(home, "b.md"), "甲\n乙\n");
        const input = `${hashline("home://a.md", await tagOf("home://a.md"), "PUT 2.=2:\n+贰")}${hashline("home://b.md", await tagOf("home://b.md"), "PUT 2.=2:\n+丙")}`;
        const first = await previewChanges("hashline", {input}, files, stores, SESSION, signal);
        expect(first.files).toEqual([
            {address: `${GLOBAL}/a.md`, kind: "diff", before: "一\n二\n", after: "一\n贰\n"},
            {address: `${GLOBAL}/b.md`, kind: "diff", before: "甲\n乙\n", after: "甲\n丙\n"},
        ]);
        expect(await previewChanges("hashline", {input}, files, stores, SESSION, signal)).toEqual(first);
        expect(await readFile(join(home, "a.md"), "utf8")).toBe("一\n二\n");
        expect((await call(hashlineTool(stores), {input})).status).toBeUndefined();
        expect(await readFile(join(home, "a.md"), "utf8")).toBe("一\n贰\n");
        expect(await readFile(join(home, "b.md"), "utf8")).toBe("甲\n丙\n");
    });

    test("试算在快照的副本上跑：引擎写完会更新快照，原来那份不变", async () => {
        await writeFile(join(home, "a.md"), "一\n二\n");
        const located = await files.readPath("home://a.md");
        if (!located.ok) throw new Error(located.code);
        const store = new EditStore();
        const tag = store.recordSnapshot(located.value.path, "一\n二\n", [1, 2]);
        const {written, failure} = await previewEdit("hashline", {input: hashline("home://a.md", tag, "PUT 2.=2:\n+贰")}, files, store, 1024 * 1024, signal);
        expect(failure).toBeNull();
        expect([...written.values()]).toEqual(["一\n贰\n"]);
        expect(store.headText(located.value.path)).toBe("一\n二\n");
        expect(await readFile(join(home, "a.md"), "utf8")).toBe("一\n二\n");
    });

    test("原文件太大不试算：报原文件的大小，不是改完的；小的照常", async () => {
        const big = "大".repeat(100_000);
        await writeFile(join(home, "expand.md"), big);
        expect((await previewChanges("replace", {path: "home://expand.md", old_string: "大", new_string: "很长很长很长很长的一段替换文字", replace_all: true}, files, stores, SESSION, signal)).files).toEqual([{address: `${GLOBAL}/expand.md`, kind: "too-large", bytes: Buffer.byteLength(big)}]);
        await writeFile(join(home, "small.md"), "一二三");
        expect((await previewChanges("replace", {path: "home://small.md", old_string: "二", new_string: "贰"}, files, stores, SESSION, signal)).files).toEqual([{address: `${GLOBAL}/small.md`, kind: "diff", before: "一二三", after: "一贰三"}]);
    });

    test("前面的调用存的寄存器副本里没有：写明算不出来，不说没有改动", async () => {
        await writeFile(join(home, "source.md"), "甲\n乙\n");
        await writeFile(join(home, "target.md"), "一\n二\n");
        expect((await call(hashlineTool(stores), {input: `[home://source.md#${await tagOf("home://source.md")}]\nCUT 2.=2 @saved\n`})).status).toBeUndefined();
        const paste = {input: `[home://target.md#${await tagOf("home://target.md")}]\nPUT >1 @saved\n`};
        expect((await previewChanges("hashline", paste, files, stores, SESSION, signal)).files).toEqual([{address: `${GLOBAL}/target.md`, kind: "failed", code: "edit-no-preview"}]);
        expect((await call(hashlineTool(stores), paste)).status).toBeUndefined();
        expect(await readFile(join(home, "target.md"), "utf8")).toBe("一\n乙\n二\n");
    });

    test("算不出来的得 failed：文件不存在、改不上", async () => {
        expect((await previewChanges("replace", {path: "home://没有.md", old_string: "一", new_string: "二"}, files, stores, SESSION, signal)).files).toEqual([{address: `${GLOBAL}/没有.md`, kind: "failed", code: "not-found"}]);
        await writeFile(join(home, "a.md"), "一二三");
        expect((await previewChanges("replace", {path: "home://a.md", old_string: "没有这段", new_string: "二"}, files, stores, SESSION, signal)).files).toMatchObject([{address: `${GLOBAL}/a.md`, kind: "failed"}]);
    });
});
