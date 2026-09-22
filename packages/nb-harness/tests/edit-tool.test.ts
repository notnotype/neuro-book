import {afterAll, beforeAll, describe, expect, test} from "bun:test";
import {mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";
import type {AgentTool} from "@oh-my-pi/pi-agent-core";
import {EditStore} from "@oh-my-pi/pi-natives";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {createEditTool, createReadTool} from "../src";

let root = "";

beforeAll(async () => {
    root = await createTestTmpRoot("nb-harness-edit", "edit-tool");
});

afterAll(async () => {
    if (root !== "") await rm(root, {recursive: true, force: true});
});

function textOf(result: unknown): string {
    const content = (result as {content: Array<{type: string; text?: string}>}).content;
    return content.map((part) => part.text ?? "").join("");
}

function isError(result: unknown): boolean {
    return (result as {isError?: boolean}).isError === true;
}

/** 用 read 工具读一次拿到 `[path#tag]` 头，模拟模型的「先读后改」。 */
async function readHeader(tool: AgentTool, path: string): Promise<string> {
    const result = await tool.execute("read-1", {path});
    return textOf(result).split("\n")[0] as string;
}

describe("edit 工具（hashline，OMP 语义）", () => {
    test("先读后改：读出的 tag 直接可用，落盘内容正确", async () => {
        const file = join(root, "a.txt");
        await writeFile(file, "alpha\nbeta\ngamma\n", "utf-8");
        const store = new EditStore();
        const readTool = createReadTool({cwd: root, store});
        const editTool = createEditTool({cwd: root, store});

        const header = await readHeader(readTool, "a.txt");
        const result = await editTool.execute("edit-1", {input: `${header}\nPUT 2.=2:\n+BETA\n`});

        expect(isError(result)).toBe(false);
        expect(await readFile(file, "utf-8")).toBe("alpha\nBETA\ngamma\n");
        expect(textOf(result)).toContain("2:BETA");
    });

    test("连续两次编辑：第二次用第一次回显的新 tag", async () => {
        const file = join(root, "chain.txt");
        await writeFile(file, "alpha\nbeta\ngamma\n", "utf-8");
        const store = new EditStore();
        const readTool = createReadTool({cwd: root, store});
        const editTool = createEditTool({cwd: root, store});

        const first = await editTool.execute("edit-1", {input: `${await readHeader(readTool, "chain.txt")}\nPUT 2.=2:\n+BETA\n`});
        const echoed = textOf(first).split("\n")[0] as string;
        const second = await editTool.execute("edit-2", {input: `${echoed}\nPUT 3.=3:\n+GAMMA\n`});

        expect(isError(first)).toBe(false);
        expect(isError(second)).toBe(false);
        expect(await readFile(file, "utf-8")).toBe("alpha\nBETA\nGAMMA\n");
    });

    test("未展示的行不能改（seen 守卫）", async () => {
        const file = join(root, "unseen.txt");
        await writeFile(file, "alpha\nbeta\ngamma\n", "utf-8");
        const store = new EditStore();
        const readTool = createReadTool({cwd: root, store});
        const editTool = createEditTool({cwd: root, store});

        // 只展示第 1 行，却去改第 3 行
        const partial = await readTool.execute("read-1", {path: "unseen.txt", limit: 1});
        const header = textOf(partial).split("\n")[0] as string;
        const result = await editTool.execute("edit-1", {input: `${header}\nPUT 3.=3:\n+DELTA\n`});

        expect(isError(result)).toBe(true);
        expect(await readFile(file, "utf-8")).toBe("alpha\nbeta\ngamma\n");
        expect(textOf(result)).toContain("never displayed");
    });

    test("伪造的 tag 被拒绝且磁盘不变", async () => {
        const file = join(root, "forged.txt");
        await writeFile(file, "alpha\nbeta\ngamma\n", "utf-8");
        const store = new EditStore();
        createReadTool({cwd: root, store});
        const editTool = createEditTool({cwd: root, store});

        const result = await editTool.execute("edit-1", {input: "[forged.txt#0000]\nPUT 2.=2:\n+BETA\n"});

        expect(isError(result)).toBe(true);
        expect(await readFile(file, "utf-8")).toBe("alpha\nbeta\ngamma\n");
    });

    test("文件被外部改动后按 OMP 语义重映射锚点（同 session 的旧 tag 仍可用）", async () => {
        const file = join(root, "drift.txt");
        await writeFile(file, "alpha\nbeta\ngamma\n", "utf-8");
        const store = new EditStore();
        const readTool = createReadTool({cwd: root, store});
        const editTool = createEditTool({cwd: root, store});

        const header = await readHeader(readTool, "drift.txt");
        await writeFile(file, `# 外部注释\nalpha\nbeta\ngamma\n`, "utf-8");
        const result = await editTool.execute("edit-1", {input: `${header}\nPUT 2.=2:\n+BETA\n`});

        expect(isError(result)).toBe(false);
        expect(await readFile(file, "utf-8")).toBe("# 外部注释\nalpha\nBETA\ngamma\n");
        expect(textOf(result)).toContain("Recovered by remapping stale line anchors");
    });

    test("confirmWrite 拒绝时不落盘", async () => {
        const file = join(root, "denied.txt");
        await writeFile(file, "alpha\nbeta\ngamma\n", "utf-8");
        const store = new EditStore();
        const readTool = createReadTool({cwd: root, store});
        const editTool = createEditTool({cwd: root, store, confirmWrite: () => false});

        const header = await readHeader(readTool, "denied.txt");
        const result = await editTool.execute("edit-1", {input: `${header}\nPUT 2.=2:\n+BETA\n`});

        expect(isError(result)).toBe(true);
        expect(textOf(result)).toContain("已拒绝写入");
        expect(await readFile(file, "utf-8")).toBe("alpha\nbeta\ngamma\n");
    });
});

describe("edit 工具（apply_patch 模式）", () => {
    test("Move to 与 Delete File 生效", async () => {
        const dir = join(root, "patch-case");
        await mkdir(dir, {recursive: true});
        await writeFile(join(dir, "old.txt"), "beta\n", "utf-8");
        await writeFile(join(dir, "remove.txt"), "remove me\n", "utf-8");
        const store = new EditStore();
        const editTool = createEditTool({cwd: dir, store, mode: "apply_patch"});

        const payload = [
            "*** Begin Patch",
            `*** Update File: old.txt`,
            `*** Move to: nested/new.txt`,
            "@@",
            "-beta",
            "+BETA",
            `*** Delete File: remove.txt`,
            "*** End Patch",
            "",
        ].join("\n");
        const result = await editTool.execute("edit-1", {input: payload});

        expect(isError(result)).toBe(false);
        expect(await readFile(join(dir, "nested", "new.txt"), "utf-8").catch(() => "<缺失>")).toBe("BETA\n");
        expect(await readFile(join(dir, "old.txt"), "utf-8").catch(() => "<缺失>")).toBe("<缺失>");
        expect(await readFile(join(dir, "remove.txt"), "utf-8").catch(() => "<缺失>")).toBe("<缺失>");
    });
});
