import {afterAll, describe, expect, test} from "bun:test";
import {mkdir, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import type {ToolContext, ToolOutcome} from "../tools/tools";
import {createBuiltinTools, createResourceAccess, createSnapshotStores, readTool} from "./builtin";
import type {ResourceAccess} from "./builtin";
import {createLocalFileAccess} from "./local/local";

const roots: string[] = [];
afterAll(async () => {
    for (const root of roots) await rm(root, {recursive: true, force: true});
});

/** 临时根里有测试支持包的标记文件，所以根用它下面的子目录。 */
async function newRoot(): Promise<string> {
    const base = await createTestTmpRoot("nb-harness-builtin", "read");
    roots.push(base);
    const root = join(base, "project");
    await mkdir(root, {recursive: true});
    return root;
}

/** 一个方案 project:// 指向根：场景里的地址都写 project://。 */
export const projectOnly = (root: string): ResourceAccess => createResourceAccess({project: {provider: createLocalFileAccess({root}), doc: "作品目录"}});
export const context = (sessionId = "s1"): ToolContext => ({signal: new AbortController().signal, session: {id: sessionId}, toolCallId: "c1", report: () => undefined});
export const textOf = (outcome: ToolOutcome): string => (outcome.ok ? (typeof outcome.content === "string" ? outcome.content : outcome.content.map((block) => ("text" in block ? block.text : `[${block.type}]`)).join("")) : `${outcome.code}: ${outcome.message}`);

describe("read（输出 2–5、8）", () => {
    test("场景 2：文本带标签头与行号并登记快照；offset/limit 只展示请求的行；预算截断；二进制、缺失、目录、图片", async () => {
        const root = await newRoot();
        await writeFile(join(root, "a.txt"), "alpha\nbeta\ngamma\n", "utf8");
        await writeFile(join(root, "bin.dat"), Buffer.from([1, 0, 2]));
        await writeFile(join(root, "bad.txt"), Buffer.from([0xff, 0x61]));
        await writeFile(join(root, "pic.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
        await mkdir(join(root, "sub"));
        await writeFile(join(root, "sub", "z.txt"), "z", "utf8");
        await writeFile(join(root, "long.txt"), `${Array.from({length: 10}, (_v, i) => `line-${i + 1}`).join("\n")}\n`, "utf8");
        const resources = projectOnly(root);
        const stores = createSnapshotStores();
        const read = readTool({resources, stores});
        const limited = readTool({resources, stores, maxLines: 3});

        const whole = await read.execute({path: "project://a.txt"}, context());
        const lines = textOf(whole).split("\n");
        expect(lines[0]).toMatch(/^\[project:\/\/a\.txt#[0-9A-F]{4}\]$/u);
        expect(lines.slice(1)).toEqual(["1: alpha", "2: beta", "3: gamma", "4: "]);
        expect(whole.ok && whole.details).toEqual({path: "project://a.txt", lines: 4, truncated: false});
        expect(stores.forSession("s1").headText(join(root, "a.txt"))).toBe("alpha\nbeta\ngamma\n");

        const window = await read.execute({path: "project://a.txt", offset: 2, limit: 2}, context());
        expect(textOf(window).split("\n").slice(1)).toEqual(["2: beta", "3: gamma"]);
        expect(textOf(await read.execute({path: "project://a.txt", offset: 9}, context()))).toContain("invalid-arguments: offset 越界");

        const truncated = await limited.execute({path: "project://long.txt"}, context());
        expect(textOf(truncated).split("\n").slice(1)).toEqual(["1: line-1", "2: line-2", "3: line-3", "输出已截断：lines"]);
        expect(truncated.ok && truncated.details).toMatchObject({truncated: true, reason: "lines"});
        const bytes = await readTool({resources, stores, maxBytes: 12}).execute({path: "project://long.txt"}, context());
        expect(bytes.ok && bytes.details).toMatchObject({truncated: true, reason: "bytes", lines: 1});

        expect(textOf(await read.execute({path: "project://bin.dat"}, context()))).toBe("binary: 二进制文件不受支持（含 NUL）：project://bin.dat");
        // 不是合法 UTF-8 的也当二进制：不能把 � 替换过的内容登记成可编辑的快照
        expect(textOf(await read.execute({path: "project://bad.txt"}, context()))).toBe("binary: 二进制文件不受支持（不是合法 UTF-8）：project://bad.txt");
        expect(textOf(await read.execute({path: "project://nope.txt"}, context()))).toBe("not-found: 不存在：nope.txt");
        expect(textOf(await read.execute({path: "project://../x"}, context()))).toContain("invalid-address");
        expect(textOf(await read.execute({path: "a.txt"}, context()))).toContain("invalid-address");
        expect(textOf(await read.execute({path: "nowhere://a.txt"}, context()))).toContain("unknown-scheme");
        const dir = await read.execute({path: "project://"}, context());
        expect(textOf(dir).split("\n")).toEqual(["- a.txt", "- bad.txt", "- bin.dat", "- long.txt", "- pic.png", "- sub/"]);
        expect(dir.ok && dir.details).toEqual({path: "project://", kind: "directory", entries: 6});
        const pic = await read.execute({path: "project://pic.png"}, context());
        expect(pic.ok && pic.content).toEqual([{type: "image", mimeType: "image/png", data: Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64")}]);
        expect(pic.ok && pic.details).toEqual({path: "project://pic.png", bytes: 4});
    });

    test("输出 8：createBuiltinTools 列出 read 与 edit，get 返回同一份定义", async () => {
        const root = await newRoot();
        const source = createBuiltinTools({resources: projectOnly(root)});
        expect(source.list().map((tool) => `${tool.id}:${tool.risk}`)).toEqual(["read:read", "edit:write"]);
        expect(source.get("read")).toBe(source.get("read"));
        expect(source.get("nope")).toBeUndefined();
    });
});
