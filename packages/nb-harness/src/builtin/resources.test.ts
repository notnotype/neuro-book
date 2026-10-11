import {afterAll, describe, expect, test} from "bun:test";
import {mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {createResourceAccess, createSnapshotStores, editTool, formatAddress, parseAddress, readTool} from "./builtin";
import type {VirtualProvider} from "./builtin";
import {createLocalFileAccess, createSessionDirectories} from "./local/local";
import {context, textOf} from "./read.test";

const roots: string[] = [];
afterAll(async () => {
    for (const root of roots) await rm(root, {recursive: true, force: true});
});

async function base(name: string): Promise<string> {
    const root = await createTestTmpRoot("nb-harness-builtin", name);
    roots.push(root);
    return root;
}

describe("资源地址（输入与前置条件）", () => {
    test("合法与非法地址逐条：根是空路径；空段、.、..、反斜杠、NUL、盘符、裸路径、超长都是 invalid-address", () => {
        expect(parseAddress("project://")).toEqual({ok: true, value: {scheme: "project", path: ""}});
        expect(parseAddress("project://a/b c.md")).toEqual({ok: true, value: {scheme: "project", path: "a/b c.md"}});
        expect(parseAddress("local+x.y-z://..foo")).toEqual({ok: true, value: {scheme: "local+x.y-z", path: "..foo"}});
        for (const bad of ["a.txt", "/abs", "project:/a", "Project://a", "project://a//b", "project:///a", "project://a/", "project://./a", "project://a/../b", "project://a\\b", "project://a\0b", "project://C:notes.md", `project://${"x".repeat(4097)}`]) {
            const parsed = parseAddress(bad);
            expect(parsed.ok ? bad : parsed.code).toBe("invalid-address");
        }
        expect(formatAddress({scheme: "project", path: "a/b"})).toBe("project://a/b");
    });

    test("登记：方案名不合规则或没有说明时抛 TypeError；未登记的方案 open 为 undefined；工厂按会话各建一份并复用", async () => {
        const root = await base("resources-factory");
        expect(() => createResourceAccess({"Bad": {provider: createLocalFileAccess({root}), doc: "x"}})).toThrow(TypeError);
        expect(() => createResourceAccess({local: {provider: createLocalFileAccess({root}), doc: " "}})).toThrow(TypeError);
        const resources = createResourceAccess({local: {provider: createSessionDirectories({root: join(root, "local")}), doc: "本会话的工作目录"}});
        expect(resources.schemes()).toEqual([{scheme: "local", doc: "本会话的工作目录"}]);
        expect(resources.open("nowhere", {sessionId: "s1"})).toBeUndefined();
        const s1 = resources.open("local", {sessionId: "s1"});
        const s2 = resources.open("local", {sessionId: "s2/../x"});
        if (s1?.kind !== "directory" || s2?.kind !== "directory") throw new Error("应是目录型提供者");
        expect(s1.root).toBe(join(root, "local", "s1"));
        expect(s2.root).toBe(join(root, "local", "s2_.._x"));
        expect(resources.open("local", {sessionId: "s1"})).toBe(s1);
        expect(await s1.write("n.md", "x")).toEqual({ok: true, value: undefined});
        expect(await readFile(join(root, "local", "s1", "n.md"), "utf8")).toBe("x");
        expect((await s2.stat("n.md")).ok ? "存在" : "不存在").toBe("不存在");
    });
});

describe("方案与提供者（输出 9）", () => {
    test("一次 edit 可以跨方案改两个文件；只读方案与虚拟方案的资源能 read、不能 edit；虚拟方案的 read 没有标签头", async () => {
        const root = await base("resources-schemes");
        const project = join(root, "project");
        const docs = join(root, "docs");
        await mkdir(project);
        await mkdir(docs);
        await writeFile(join(project, "a.txt"), "alpha\nbeta\n", "utf8");
        await writeFile(join(docs, "guide.md"), "# 指南\n不要改我\n", "utf8");
        const virtual: VirtualProvider = {
            kind: "virtual",
            stat: async (path) => (path === "." ? {ok: true, value: {kind: "directory", bytes: 0}} : path === "3" ? {ok: true, value: {kind: "file", bytes: 7}} : {ok: false, code: "not-found", detail: `没有 ${path}`}),
            readText: async (path) => (path === "3" ? {ok: true, value: "one\ntwo\nthree"} : {ok: false, code: "not-found", detail: `没有 ${path}`}),
            list: async () => ({ok: true, value: [{name: "3", kind: "file"}]}),
        };
        const resources = createResourceAccess({
            project: {provider: createLocalFileAccess({root: project}), doc: "作品目录"},
            local: {provider: createSessionDirectories({root: join(root, "local")}), doc: "会话目录"},
            docs: {provider: createLocalFileAccess({root: docs, readonly: true}), doc: "参考文档，只读"},
            artifact: {provider: virtual, doc: "溢出的工具结果"},
        });
        const stores = createSnapshotStores();
        const read = readTool({resources, stores});
        const edit = editTool({resources, stores});

        // 会话目录是按会话建的：先经提供者放一个文件进去
        const local = resources.open("local", {sessionId: "s1"});
        if (local?.kind !== "directory") throw new Error("local 应是目录型");
        await local.write("notes.md", "x\ny\n");
        const h1 = textOf(await read.execute({path: "project://a.txt"}, context())).split("\n")[0]!;
        const h2 = textOf(await read.execute({path: "local://notes.md"}, context())).split("\n")[0]!;
        expect(h1).toMatch(/^\[project:\/\/a\.txt#[0-9A-Fa-f]{4}\]$/u);
        const crossed = await edit.execute({input: `${h1}\nPUT 2.=2:\n+BETA\n${h2}\nPUT 1.=1:\n+X2\n`}, context());
        expect(crossed.ok).toBe(true);
        expect(crossed.ok && crossed.details).toEqual({files: [{path: "project://a.txt", op: "update", warnings: []}, {path: "local://notes.md", op: "update", warnings: []}]});
        expect(textOf(crossed)).toContain("[project://a.txt#");
        expect(textOf(crossed)).toContain("[local://notes.md#");
        expect(await readFile(join(project, "a.txt"), "utf8")).toBe("alpha\nBETA\n");
        expect(await readFile(join(root, "local", "s1", "notes.md"), "utf8")).toBe("X2\ny\n");

        // 只读方案：能读、带标签头，但 edit 在交给引擎之前就按 read-only 拒绝；提供者自己的写也拒绝
        const guide = await read.execute({path: "docs://guide.md"}, context());
        const h3 = textOf(guide).split("\n")[0]!;
        expect(h3).toMatch(/^\[docs:\/\/guide\.md#/u);
        const denied = await edit.execute({input: `${h3}\nPUT 2.=2:\n+改了\n`}, context());
        expect(denied.ok ? null : denied.code).toBe("read-only");
        expect(await readFile(join(docs, "guide.md"), "utf8")).toBe("# 指南\n不要改我\n");
        const docsProvider = resources.open("docs", {sessionId: "s1"});
        if (docsProvider?.kind !== "directory") throw new Error("docs 应是目录型");
        expect((await docsProvider.write("guide.md", "x")).ok ? null : "read-only").toBe("read-only");
        expect((await docsProvider.remove("guide.md")).ok ? null : "read-only").toBe("read-only");

        // 虚拟方案：目录列表、按 offset/limit 读文本、没有标签头、details.editable 为 false；edit 为 read-only
        const listed = await read.execute({path: "artifact://"}, context());
        expect(textOf(listed)).toBe("- 3");
        const page = await read.execute({path: "artifact://3", offset: 2, limit: 1}, context());
        expect(textOf(page)).toBe("2: two");
        expect(page.ok && page.details).toEqual({path: "artifact://3", lines: 1, truncated: false, editable: false});
        expect(textOf(await read.execute({path: "artifact://9"}, context()))).toBe("not-found: 没有 9");
        const virtualEdit = await edit.execute({input: "[artifact://3#0000]\nPUT 1.=1:\n+x\n"}, context());
        expect(virtualEdit.ok ? null : virtualEdit.code).toBe("read-only");
    });
});
