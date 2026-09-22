import {afterAll, beforeAll, describe, expect, test} from "bun:test";
import {mkdir, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {EditStore} from "@oh-my-pi/pi-natives";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {createReadTool, type PluginReadFormat} from "../src";

let root = "";
const store = new EditStore();

beforeAll(async () => {
    root = await createTestTmpRoot("nb-harness-read", "read-tool");
});

afterAll(async () => {
    if (root !== "") await rm(root, {recursive: true, force: true});
});

function textOf(result: unknown): string {
    const content = (result as {content: Array<{type: string; text?: string}>}).content;
    return content.map((part) => part.text ?? "").join("");
}

describe("read 工具", () => {
    test("文本输出带 [path#tag] 头与 N: 行号前缀，并登记快照", async () => {
        const file = join(root, "a.txt");
        await writeFile(file, "alpha\nbeta\ngamma\n", "utf-8");
        const tool = createReadTool({cwd: root, store});

        const result = await tool.execute("c1", {path: "a.txt"});
        const lines = textOf(result).split("\n");

        expect(lines[0]).toMatch(/^\[a\.txt#[0-9A-F]{4}\]$/u);
        expect(lines.slice(1)).toEqual(["1: alpha", "2: beta", "3: gamma", "4: "]);
        expect((result as {isError?: boolean}).isError).toBeUndefined();
        expect(store.headHash(file)).toBe(lines[0]?.slice(-5, -1) as string);
    });

    test("offset 与 limit 只展示请求的行，且快照只登记展示过的行", async () => {
        const file = join(root, "window.txt");
        await writeFile(file, "l1\nl2\nl3\nl4\n", "utf-8");
        const tool = createReadTool({cwd: root, store});

        const result = await tool.execute("c1", {path: "window.txt", offset: 2, limit: 2});
        const lines = textOf(result).split("\n");

        expect(lines.slice(1)).toEqual(["2: l2", "3: l3"]);
    });

    test("offset 越界报错", async () => {
        const result = await createReadTool({cwd: root}).execute("c1", {path: "window.txt", offset: 99});

        expect((result as {isError?: boolean}).isError).toBe(true);
        expect(textOf(result)).toContain("offset 越界");
    });

    test("超出预算时截断并报告原因", async () => {
        const file = join(root, "long.txt");
        await writeFile(file, `${Array.from({length: 10}, (_v, i) => `line-${i + 1}`).join("\n")}\n`, "utf-8");
        const tool = createReadTool({cwd: root, maxLines: 3});

        const result = await tool.execute("c1", {path: "long.txt"});
        const text = textOf(result);

        expect((result as {details?: {reason?: string}}).details?.reason).toBe("lines");
        expect(text).toContain("3: line-3");
        expect(text).not.toContain("4: line-4");
        expect(text).toContain("输出已截断：lines");
    });

    test("二进制文件被拒绝", async () => {
        const file = join(root, "bin.dat");
        await writeFile(file, Buffer.from([0x61, 0x00, 0x62]));

        const result = await createReadTool({cwd: root}).execute("c1", {path: "bin.dat"});

        expect((result as {isError?: boolean}).isError).toBe(true);
        expect(textOf(result)).toContain("二进制文件不受支持");
    });

    test("缺失文件报错", async () => {
        const result = await createReadTool({cwd: root}).execute("c1", {path: "nope.txt"});

        expect((result as {isError?: boolean}).isError).toBe(true);
        expect(textOf(result)).toContain("文件不存在");
    });

    test("目录列出一层条目，子目录带斜杠", async () => {
        await mkdir(join(root, "listing", "sub"), {recursive: true});
        await writeFile(join(root, "listing", "b.txt"), "b", "utf-8");

        const result = await createReadTool({cwd: root}).execute("c1", {path: "listing"});
        const text = textOf(result);

        expect(text.split("\n")).toEqual(["- b.txt", "- sub/"]);
        expect((result as {details?: {kind?: string}}).details?.kind).toBe("directory");
    });

    test("插件格式按注册顺序生效，先注册者优先", async () => {
        const file = join(root, "custom.bin");
        await writeFile(file, "原始内容", "utf-8");
        const first: PluginReadFormat = {
            id: "first-format",
            canRead: () => true,
            read: async () => ({text: "第一个格式的输出"}),
        };
        const second: PluginReadFormat = {
            id: "second-format",
            canRead: () => true,
            read: async () => ({text: "第二个格式的输出"}),
        };

        const result = await createReadTool({cwd: root, formats: [first, second]}).execute("c1", {path: "custom.bin"});

        expect(textOf(result)).toBe("第一个格式的输出");
        expect((result as {details?: {format?: string}}).details?.format).toBe("first-format");
    });
});
