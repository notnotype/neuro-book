import {afterAll, describe, expect, test} from "bun:test";
import {mkdir, readFile, rm, symlink, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import type {ToolDefinition} from "../tools/tools";
import {createResourceAccess, createSnapshotStores, editTool, readTool} from "./builtin";
import {createLocalFileAccess} from "./local/local";
import {context, projectOnly, textOf} from "./read.test";

const roots: string[] = [];
afterAll(async () => {
    for (const root of roots) await rm(root, {recursive: true, force: true});
});

async function setup(): Promise<{root: string; read: ToolDefinition; edit: ToolDefinition}> {
    const base = await createTestTmpRoot("nb-harness-builtin", "edit");
    roots.push(base);
    const root = join(base, "project");
    await mkdir(root, {recursive: true});
    const resources = projectOnly(root);
    const stores = createSnapshotStores();
    return {root, read: readTool({resources, stores}), edit: editTool({resources, stores})};
}

/** 先读拿到 `[path#tag]` 头，模拟模型的“先读后改”。 */
async function header(read: ToolDefinition, path: string, sessionId = "s1", limit?: number): Promise<string> {
    const result = await read.execute(limit === undefined ? {path} : {path, limit}, context(sessionId));
    return textOf(result).split("\n")[0]!;
}

describe("写入失败的结果（输出 6、状态与转换）", () => {
    test("writer 失败不会被引擎吞成 edit-rejected：保留访问层的码，details.written 列出已落盘的文件", async () => {
        const base = await createTestTmpRoot("nb-harness-builtin", "edit-fail");
        roots.push(base);
        const root = join(base, "project");
        await mkdir(root, {recursive: true});
        await writeFile(join(root, "first.txt"), "one\ntwo\n", "utf8");
        await writeFile(join(root, "second.txt"), "a\nb\n", "utf8");
        const real = createLocalFileAccess({root});
        // 第二个文件写入时访问层报越界（模拟悬空链接那类情况）
        const access = {...real, write: async (path: string, content: string) => (path === "second.txt" ? {ok: false as const, code: "outside-root" as const, detail: "模拟越界"} : real.write(path, content))};
        const resources = createResourceAccess({project: {provider: access, doc: "作品目录"}});
        const stores = createSnapshotStores();
        const read = readTool({resources, stores});
        const edit = editTool({resources, stores});
        const h1 = textOf(await read.execute({path: "project://first.txt"}, context())).split("\n")[0]!;
        const h2 = textOf(await read.execute({path: "project://second.txt"}, context())).split("\n")[0]!;
        const result = await edit.execute({input: `${h1}\nPUT 1.=1:\n+ONE\n${h2}\nPUT 1.=1:\n+A\n`}, context());
        expect(result.ok ? null : result.code).toBe("outside-root");
        expect(result.ok ? null : result.details).toEqual({written: ["project://first.txt"]});
        expect(await readFile(join(root, "first.txt"), "utf8")).toBe("ONE\ntwo\n");
        expect(await readFile(join(root, "second.txt"), "utf8")).toBe("a\nb\n");
    });
});

describe("edit（输出 6、7）", () => {
    test("场景 3：先读后改落盘正确并回显新标签；用回显的标签连续第二次编辑", async () => {
        const {root, read, edit} = await setup();
        await writeFile(join(root, "a.txt"), "alpha\nbeta\ngamma\n", "utf8");
        const first = await edit.execute({input: `${await header(read, "project://a.txt")}\nPUT 2.=2:\n+BETA\n`}, context());
        expect(first.ok).toBe(true);
        expect(await readFile(join(root, "a.txt"), "utf8")).toBe("alpha\nBETA\ngamma\n");
        expect(textOf(first)).toContain("2:BETA");
        expect(first.ok && first.details).toMatchObject({files: [{path: "project://a.txt", op: "update", warnings: []}]});
        const echoed = textOf(first).split("\n")[0]!;
        const second = await edit.execute({input: `${echoed}\nPUT 3.=3:\n+GAMMA\n`}, context());
        expect(second.ok).toBe(true);
        expect(await readFile(join(root, "a.txt"), "utf8")).toBe("alpha\nBETA\nGAMMA\n");
    });

    test("场景 3：未展示的行、伪造的标签被拒且磁盘不变；会话隔离的是展示记录（另一会话拿同样的内容哈希标签照常接受）；文件被外部改动后按 OMP 语义重映射并带警告", async () => {
        const {root, read, edit} = await setup();
        await writeFile(join(root, "b.txt"), "alpha\nbeta\ngamma\n", "utf8");
        const partial = await header(read, "project://b.txt", "s1", 1);
        const unseen = await edit.execute({input: `${partial}\nPUT 3.=3:\n+DELTA\n`}, context());
        expect(unseen.ok ? null : unseen.code).toBe("edit-rejected");
        expect(textOf(unseen)).toContain("never displayed");
        expect(await readFile(join(root, "b.txt"), "utf8")).toBe("alpha\nbeta\ngamma\n");

        const forged = await edit.execute({input: "[project://b.txt#0000]\nPUT 2.=2:\n+BETA\n"}, context());
        expect(forged.ok ? null : forged.code).toBe("edit-rejected");
        expect(await readFile(join(root, "b.txt"), "utf8")).toBe("alpha\nbeta\ngamma\n");

        // 快照存储按会话分开：s1 只展示过第 1 行，这条记录不约束 s2；标签本身是内容哈希，s2 拿同样的标签、文件没变时引擎照常接受。
        // 用新文件：引擎拒绝时回显的内容也算展示过（OMP 语义），b.txt 在 s1 里已经整个展示过了
        await writeFile(join(root, "d.txt"), "alpha\nbeta\ngamma\n", "utf8");
        const partialD = await header(read, "project://d.txt", "s1", 1);
        expect((await edit.execute({input: `${partialD}\nPUT 3.=3:\n+DELTA\n`}, context("s1"))).ok).toBe(false);
        const other = await edit.execute({input: `${partialD}\nPUT 3.=3:\n+GAMMA2\n`}, context("s2"));
        expect(other.ok).toBe(true);
        expect(await readFile(join(root, "d.txt"), "utf8")).toBe("alpha\nbeta\nGAMMA2\n");
        const fromS1 = await header(read, "project://b.txt", "s1");

        await writeFile(join(root, "b.txt"), "# 外部注释\nalpha\nbeta\ngamma\n", "utf8");
        const drifted = await edit.execute({input: `${fromS1}\nPUT 2.=2:\n+BETA\n`}, context());
        expect(drifted.ok).toBe(true);
        expect(await readFile(join(root, "b.txt"), "utf8")).toBe("# 外部注释\nalpha\nBETA\ngamma\n");
        expect(drifted.ok && (drifted.details as {files: {warnings: string[]}[]}).files[0]!.warnings.join("")).toContain("Recovered by remapping stale line anchors");
    });

    test("场景 3：引擎要写根外路径时 outside-root 且不落盘；解析失败的输入是 edit-rejected", async () => {
        const {root, read, edit} = await setup();
        await writeFile(join(root, "c.txt"), "one\ntwo\n", "utf8");
        const head = await header(read, "project://c.txt");
        // 把标签里的路径换成根外：在交给引擎之前拦下（引擎会读那个文件并在错误里回显内容）
        await writeFile(join(root, "..", "c.txt"), "OUT1\nOUT2\n", "utf8");
        const outside = head.replace("[project://c.txt#", "[project://../c.txt#");
        const escaped = await edit.execute({input: `${outside}\nPUT 1.=1:\n+ONE\n`}, context());
        expect(escaped.ok ? null : escaped.code).toBe("invalid-address");
        expect(textOf(escaped)).not.toContain("OUT1");
        expect(await readFile(join(root, "c.txt"), "utf8")).toBe("one\ntwo\n");
        expect(await readFile(join(root, "..", "c.txt"), "utf8")).toBe("OUT1\nOUT2\n");
        const garbage = await edit.execute({input: "不是 hashline"}, context());
        expect(garbage.ok ? null : garbage.code).toBe("edit-rejected");
        // 根内的符号链接指向根外：字面在根内、真实路径在根外，也不能交给引擎（它会读目标并在拒绝时回显内容）
        await writeFile(join(root, "..", "secret.txt"), "SECRET-LINE\n", "utf8");
        await symlink(join(root, "..", "secret.txt"), join(root, "linked.txt"));
        const viaLink = await edit.execute({input: "[project://linked.txt#0000]\nPUT 1.=1:\n+CHANGED\n"}, context());
        expect(viaLink.ok ? null : viaLink.code).toBe("outside-root");
        expect(textOf(viaLink)).not.toContain("SECRET-LINE");
        expect(await readFile(join(root, "..", "secret.txt"), "utf8")).toBe("SECRET-LINE\n");
        // 裸路径、带空白、~、没登记的方案：都在交给引擎之前拒绝，根外内容不回显
        for (const [header, code] of [["[ project://secret.txt#0000]", "invalid-address"], ["[~/../secret.txt#0000]", "invalid-address"], ["[project://c.txt #0000]", "invalid-address"], ["[../secret.txt#0000]", "invalid-address"], ["[file://x#0000]", "unknown-scheme"]] as const) {
            const odd = await edit.execute({input: `${header}\nPUT 1.=1:\n+X\n`}, context());
            expect(odd.ok ? null : odd.code).toBe(code);
            expect(textOf(odd)).not.toContain("SECRET-LINE");
        }
    });
});

describe("工具说明（输出 6）", () => {
    test("edit 的说明是 OMP 的 hashline 语法说明加本模块的约束", async () => {
        const root = await createTestTmpRoot("nb-harness-edit", "description");
        roots.push(root);
        const edit = editTool({resources: createResourceAccess({project: {provider: createLocalFileAccess({root}), doc: "作品目录"}}), stores: createSnapshotStores()});
        expect(edit.description).toContain("PUT N.=M:");
        expect(edit.description).toContain("project://（作品目录）");
        expect(edit.description).toContain("[PATH#TAG]");
        expect(edit.description).toContain("<harness>");
        // OMP 18.4 的说明压缩到约 2 KB；判据是“含 OMP 的语法说明”，不是具体长度
        expect(edit.description.length).toBeGreaterThan(1500);
    });
});
