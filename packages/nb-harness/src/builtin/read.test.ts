import {afterAll, describe, expect, test} from "bun:test";
import {mkdir, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import type {ToolContext, ToolOutcome} from "../tools/tools";
import {createBuiltinTools, createSnapshotStores, readTool} from "./builtin";
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

export const context = (sessionId = "s1"): ToolContext => ({signal: new AbortController().signal, session: {id: sessionId}, toolCallId: "c1", report: () => undefined});
export const textOf = (outcome: ToolOutcome): string => (outcome.ok ? (typeof outcome.content === "string" ? outcome.content : outcome.content.map((block) => ("text" in block ? block.text : `[${block.type}]`)).join("")) : `${outcome.code}: ${outcome.message}`);

describe("read（输出 2–5、8）", () => {
    test("场景 2：文本带标签头与行号并登记快照；offset/limit 只展示请求的行；预算截断；二进制、缺失、目录、图片", async () => {
        const root = await newRoot();
        await writeFile(join(root, "a.txt"), "alpha\nbeta\ngamma\n", "utf8");
        await writeFile(join(root, "bin.dat"), Buffer.from([1, 0, 2]));
        await writeFile(join(root, "pic.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
        await mkdir(join(root, "sub"));
        await writeFile(join(root, "sub", "z.txt"), "z", "utf8");
        await writeFile(join(root, "long.txt"), `${Array.from({length: 10}, (_v, i) => `line-${i + 1}`).join("\n")}\n`, "utf8");
        const access = createLocalFileAccess({root});
        const stores = createSnapshotStores();
        const read = readTool({access, stores});
        const limited = readTool({access, stores, maxLines: 3});

        const whole = await read.execute({path: "a.txt"}, context());
        const lines = textOf(whole).split("\n");
        expect(lines[0]).toMatch(/^\[a\.txt#[0-9A-F]{4}\]$/u);
        expect(lines.slice(1)).toEqual(["1: alpha", "2: beta", "3: gamma", "4: "]);
        expect(whole.ok && whole.details).toEqual({path: "a.txt", lines: 4, truncated: false});
        expect(stores.forSession("s1").headText(join(root, "a.txt"))).toBe("alpha\nbeta\ngamma\n");

        const window = await read.execute({path: "a.txt", offset: 2, limit: 2}, context());
        expect(textOf(window).split("\n").slice(1)).toEqual(["2: beta", "3: gamma"]);
        expect(textOf(await read.execute({path: "a.txt", offset: 9}, context()))).toContain("invalid-arguments: offset 越界");

        const truncated = await limited.execute({path: "long.txt"}, context());
        expect(textOf(truncated).split("\n").slice(1)).toEqual(["1: line-1", "2: line-2", "3: line-3", "输出已截断：lines"]);
        expect(truncated.ok && truncated.details).toMatchObject({truncated: true, reason: "lines"});
        const bytes = await readTool({access, stores, maxBytes: 12}).execute({path: "long.txt"}, context());
        expect(bytes.ok && bytes.details).toMatchObject({truncated: true, reason: "bytes", lines: 1});

        expect(textOf(await read.execute({path: "bin.dat"}, context()))).toBe("binary: 二进制文件不受支持：bin.dat");
        expect(textOf(await read.execute({path: "nope.txt"}, context()))).toBe("not-found: 不存在：nope.txt");
        expect(textOf(await read.execute({path: "../x"}, context()))).toContain("outside-root");
        const dir = await read.execute({path: "."}, context());
        expect(textOf(dir).split("\n")).toEqual(["- a.txt", "- bin.dat", "- long.txt", "- pic.png", "- sub/"]);
        expect(dir.ok && dir.details).toEqual({path: ".", kind: "directory", entries: 5});
        const pic = await read.execute({path: "pic.png"}, context());
        expect(pic.ok && pic.content).toEqual([{type: "image", mimeType: "image/png", data: Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64")}]);
        expect(pic.ok && pic.details).toEqual({path: "pic.png", bytes: 4});
    });

    test("输出 8：createBuiltinTools 列出 read 与 edit，get 返回同一份定义", async () => {
        const root = await newRoot();
        const source = createBuiltinTools({access: createLocalFileAccess({root})});
        expect(source.list().map((tool) => `${tool.id}:${tool.risk}`)).toEqual(["read:read", "edit:write"]);
        expect(source.get("read")).toBe(source.get("read"));
        expect(source.get("nope")).toBeUndefined();
    });
});
