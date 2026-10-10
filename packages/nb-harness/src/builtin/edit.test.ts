import {afterAll, describe, expect, test} from "bun:test";
import {mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import type {ToolDefinition} from "../tools/tools";
import {createSnapshotStores, editTool, readTool} from "./builtin";
import {createLocalFileAccess} from "./local/local";
import {context, textOf} from "./read.test";

const roots: string[] = [];
afterAll(async () => {
    for (const root of roots) await rm(root, {recursive: true, force: true});
});

async function setup(): Promise<{root: string; read: ToolDefinition; edit: ToolDefinition}> {
    const base = await createTestTmpRoot("nb-harness-builtin", "edit");
    roots.push(base);
    const root = join(base, "project");
    await mkdir(root, {recursive: true});
    const access = createLocalFileAccess({root});
    const stores = createSnapshotStores();
    return {root, read: readTool({access, stores}), edit: editTool({access, stores})};
}

/** 先读拿到 `[path#tag]` 头，模拟模型的“先读后改”。 */
async function header(read: ToolDefinition, path: string, sessionId = "s1", limit?: number): Promise<string> {
    const result = await read.execute(limit === undefined ? {path} : {path, limit}, context(sessionId));
    return textOf(result).split("\n")[0]!;
}

describe("edit（输出 6、7）", () => {
    test("场景 3：先读后改落盘正确并回显新标签；用回显的标签连续第二次编辑", async () => {
        const {root, read, edit} = await setup();
        await writeFile(join(root, "a.txt"), "alpha\nbeta\ngamma\n", "utf8");
        const first = await edit.execute({input: `${await header(read, "a.txt")}\nPUT 2.=2:\n+BETA\n`}, context());
        expect(first.ok).toBe(true);
        expect(await readFile(join(root, "a.txt"), "utf8")).toBe("alpha\nBETA\ngamma\n");
        expect(textOf(first)).toContain("2:BETA");
        expect(first.ok && first.details).toMatchObject({files: [{path: "a.txt", op: "update", warnings: []}]});
        const echoed = textOf(first).split("\n")[0]!;
        const second = await edit.execute({input: `${echoed}\nPUT 3.=3:\n+GAMMA\n`}, context());
        expect(second.ok).toBe(true);
        expect(await readFile(join(root, "a.txt"), "utf8")).toBe("alpha\nBETA\nGAMMA\n");
    });

    test("场景 3：未展示的行、伪造的标签、另一会话的标签都被拒且磁盘不变；文件被外部改动后按 OMP 语义重映射并带警告", async () => {
        const {root, read, edit} = await setup();
        await writeFile(join(root, "b.txt"), "alpha\nbeta\ngamma\n", "utf8");
        const partial = await header(read, "b.txt", "s1", 1);
        const unseen = await edit.execute({input: `${partial}\nPUT 3.=3:\n+DELTA\n`}, context());
        expect(unseen.ok ? null : unseen.code).toBe("edit-rejected");
        expect(textOf(unseen)).toContain("never displayed");
        expect(await readFile(join(root, "b.txt"), "utf8")).toBe("alpha\nbeta\ngamma\n");

        const forged = await edit.execute({input: "[b.txt#0000]\nPUT 2.=2:\n+BETA\n"}, context());
        expect(forged.ok ? null : forged.code).toBe("edit-rejected");
        expect(await readFile(join(root, "b.txt"), "utf8")).toBe("alpha\nbeta\ngamma\n");

        // 快照存储按会话分开：s1 只展示过第 1 行，这条记录不约束 s2；标签本身是内容哈希，s2 拿同样的标签、文件没变时引擎照常接受。
        // 用新文件：引擎拒绝时回显的内容也算展示过（OMP 语义），b.txt 在 s1 里已经整个展示过了
        await writeFile(join(root, "d.txt"), "alpha\nbeta\ngamma\n", "utf8");
        const partialD = await header(read, "d.txt", "s1", 1);
        expect((await edit.execute({input: `${partialD}\nPUT 3.=3:\n+DELTA\n`}, context("s1"))).ok).toBe(false);
        const other = await edit.execute({input: `${partialD}\nPUT 3.=3:\n+GAMMA2\n`}, context("s2"));
        expect(other.ok).toBe(true);
        expect(await readFile(join(root, "d.txt"), "utf8")).toBe("alpha\nbeta\nGAMMA2\n");
        const fromS1 = await header(read, "b.txt", "s1");

        await writeFile(join(root, "b.txt"), "# 外部注释\nalpha\nbeta\ngamma\n", "utf8");
        const drifted = await edit.execute({input: `${fromS1}\nPUT 2.=2:\n+BETA\n`}, context());
        expect(drifted.ok).toBe(true);
        expect(await readFile(join(root, "b.txt"), "utf8")).toBe("# 外部注释\nalpha\nBETA\ngamma\n");
        expect(drifted.ok && (drifted.details as {files: {warnings: string[]}[]}).files[0]!.warnings.join("")).toContain("Recovered by remapping stale line anchors");
    });

    test("场景 3：引擎要写根外路径时 outside-root 且不落盘；解析失败的输入是 edit-rejected", async () => {
        const {root, read, edit} = await setup();
        await writeFile(join(root, "c.txt"), "one\ntwo\n", "utf8");
        const head = await header(read, "c.txt");
        // 把标签里的路径换成根外：在交给引擎之前拦下（引擎会读那个文件并在错误里回显内容）
        await writeFile(join(root, "..", "c.txt"), "OUT1\nOUT2\n", "utf8");
        const outside = head.replace("[c.txt#", "[../c.txt#");
        const escaped = await edit.execute({input: `${outside}\nPUT 1.=1:\n+ONE\n`}, context());
        expect(escaped.ok ? null : escaped.code).toBe("outside-root");
        expect(textOf(escaped)).not.toContain("OUT1");
        expect(await readFile(join(root, "c.txt"), "utf8")).toBe("one\ntwo\n");
        expect(await readFile(join(root, "..", "c.txt"), "utf8")).toBe("OUT1\nOUT2\n");
        const garbage = await edit.execute({input: "不是 hashline"}, context());
        expect(garbage.ok ? null : garbage.code).toBe("edit-rejected");
    });
});
