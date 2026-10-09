/**
 * 目录项上的写原语（docs/specs/workspace/files.md 的“文件操作”，验收 2、8、9 的磁盘部分）：真实临时目录、真实符号链接、
 * FIFO 与文件权限。目录项解析经 `RootedRoot.resolveEntry`、`resolveSlot`，与文件服务同一入口。
 *
 * 权限用例要求以普通用户运行（root 不受文件权限约束），root 时跳过。
 */

import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {randomUUID} from "node:crypto";
import {chmod, lstat, mkdir, readdir, readFile, readlink, rm, stat, symlink, writeFile} from "node:fs/promises";
import {basename, dirname, join} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {copyEntry, createDirectory, createFile, deleteEntry, moveEntry} from "./entry-ops";
import type {CopyOptions} from "./entry-ops";
import {entryToken, openRoot} from "./rooted";
import type {ResolvedEntry, ResolvedSlot, RootedFailure, RootedRoot} from "./rooted";

const privileged = process.getuid?.() === 0;

let tmp = "";
let counter = 0;
const created: string[] = [];

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-files", "entry-ops");
});

afterEach(async () => {
    for (const directory of created.splice(0)) {
        // 权限用例留下的只读目录要先放开才删得掉。
        await chmodTree(directory);
        await rm(directory, {recursive: true, force: true});
    }
});

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

async function chmodTree(path: string): Promise<void> {
    const info = await lstat(path).catch(() => null);
    if (info === null || info.isSymbolicLink()) return;
    await chmod(path, info.isDirectory() ? 0o755 : 0o644);
    if (info.isDirectory()) for (const name of await readdir(path)) await chmodTree(join(path, name));
}

/** 一个新的项目根（有控制目录），外加根外的一个目录。 */
async function project(): Promise<{readonly dir: string; readonly outside: string; readonly root: RootedRoot}> {
    counter += 1;
    const base = join(tmp, `p${String(counter)}`);
    created.push(base);
    const dir = join(base, "project");
    const outside = join(base, "outside");
    await mkdir(join(dir, ".nbook"), {recursive: true});
    await mkdir(outside, {recursive: true});
    await writeFile(join(dir, ".nbook", "project.json"), "CONTROL");
    await writeFile(join(outside, "secret.md"), "OUTSIDE");
    const root = await openRoot(dir, {controlDirectory: true, lockDirectory: join(dir, ".nbook", "locks", "files"), report: () => undefined});
    if ("ok" in root) throw new Error(root.detail);
    return {dir, outside, root};
}

const copying: CopyOptions = {temporaryPath: (file) => join(dirname(file), `.${basename(file)}.nbook-test-${randomUUID()}.tmp`)};

async function entry(root: RootedRoot, path: string): Promise<ResolvedEntry> {
    const resolved = await root.resolveEntry(path);
    if ("ok" in resolved) throw new Error(`${path}：${resolved.detail}`);
    return resolved;
}

async function slot(root: RootedRoot, path: string): Promise<ResolvedSlot> {
    const resolved = await root.resolveSlot(path);
    if ("ok" in resolved) throw new Error(`${path}：${resolved.detail}`);
    return resolved;
}

const codeOf = (result: unknown): string | undefined => (result as Partial<RootedFailure>).code;

describe("Spec workspace.files 文件操作：目录项与目标", () => {
    it("控制目录作为源与目标都拒绝（不区分大小写，含经链接别名）；根本身不能作为对象", async () => {
        const {dir, root} = await project();
        await symlink(".nbook", join(dir, "alias"));
        await symlink(".", join(dir, "self"));
        for (const path of [".nbook", ".NBOOK", ".nbook/project.json", "alias", "self/.nbook"]) {
            expect([path, codeOf(await root.resolveEntry(path))]).toEqual([path, "protected-path"]);
        }
        for (const path of [".nbook", ".Nbook", "self/.NBOOK", ".nbook/new.md"]) {
            expect([path, codeOf(await root.resolveSlot(path))]).toEqual([path, "protected-path"]);
        }
        expect(codeOf(await root.resolveEntry(""))).toBe("invalid-address");
        expect(codeOf(await root.resolveSlot(""))).toBe("invalid-address");
        expect(codeOf(await root.resolveEntry("../x"))).toBe("invalid-address");
        expect(await readFile(join(dir, ".nbook", "project.json"), "utf8")).toBe("CONTROL");
    });

    it("指向根外的链接本身可以改名与删除，目标不动；经链接进入根外的父路径拒绝", async () => {
        const {dir, outside, root} = await project();
        await symlink(outside, join(dir, "out"));
        const link = await entry(root, "out");
        expect(link.stats.isSymbolicLink()).toBe(true);
        expect(moveEntry(link, await slot(root, "renamed"))).toEqual({ok: true});
        expect(await readlink(join(dir, "renamed"))).toBe(outside);
        expect(await deleteEntry(await entry(root, "renamed"))).toEqual({ok: true});
        expect(await readFile(join(outside, "secret.md"), "utf8")).toBe("OUTSIDE");
        await symlink(outside, join(dir, "out2"));
        expect(codeOf(await root.resolveEntry("out2/secret.md"))).toBe("outside-root");
        expect(codeOf(await root.resolveSlot("out2/new.md"))).toBe("outside-root");
    });

    it("身份令牌：同一目录项不变；同路径换成同字节的文件后不同", async () => {
        const {dir, root} = await project();
        await writeFile(join(dir, "a.md"), "same");
        const before = entryToken((await entry(root, "a.md")).stats);
        expect(entryToken((await entry(root, "a.md")).stats)).toBe(before);
        await moveEntry(await entry(root, "a.md"), await slot(root, "kept.md"));
        await writeFile(join(dir, "a.md"), "same");
        expect(entryToken((await entry(root, "a.md")).stats)).not.toBe(before);
    });
});

describe("Spec workspace.files 文件操作：排他新建与移动", () => {
    it("新建：已有为 conflict 且原字节不变；父目录不存在为 not-found，不建中间目录", async () => {
        const {dir, root} = await project();
        await writeFile(join(dir, "a.md"), "A");
        expect(await createFile(await slot(root, "new.md"))).toEqual({ok: true});
        expect(await readFile(join(dir, "new.md"), "utf8")).toBe("");
        expect(codeOf(await createFile(await slot(root, "a.md")))).toBe("conflict");
        expect(await readFile(join(dir, "a.md"), "utf8")).toBe("A");
        expect(await createDirectory(await slot(root, "folder"))).toEqual({ok: true});
        expect(codeOf(await createDirectory(await slot(root, "folder")))).toBe("conflict");
        expect(codeOf(await root.resolveSlot("missing/new.md"))).toBe("not-found");
    });

    it("移动：目标已存在为 conflict 且两边不变；移到自身后代（含经链接别名）为 into-itself", async () => {
        const {dir, root} = await project();
        await mkdir(join(dir, "book", "part"), {recursive: true});
        await writeFile(join(dir, "book", "index.md"), "BODY");
        await writeFile(join(dir, "taken.md"), "TAKEN");
        await symlink("book", join(dir, "alias"));
        expect(codeOf(moveEntry(await entry(root, "book/index.md"), await slot(root, "taken.md")))).toBe("conflict");
        expect([await readFile(join(dir, "book", "index.md"), "utf8"), await readFile(join(dir, "taken.md"), "utf8")]).toEqual(["BODY", "TAKEN"]);
        expect(codeOf(moveEntry(await entry(root, "book"), await slot(root, "book/part/book")))).toBe("into-itself");
        expect(codeOf(moveEntry(await entry(root, "book"), await slot(root, "alias/part/book")))).toBe("into-itself");
        expect(codeOf(moveEntry(await entry(root, "book"), await slot(root, "alias/book")))).toBe("into-itself");
        expect(await readdir(join(dir, "book"))).toEqual(["index.md", "part"]);
        expect(moveEntry(await entry(root, "book"), await slot(root, "moved"))).toEqual({ok: true});
        expect(await readFile(join(dir, "moved", "index.md"), "utf8")).toBe("BODY");
    });
});

describe("Spec workspace.files 文件操作：复制", () => {
    it("文件：字节与权限位一致，源不变；目标已存在为 conflict，不留临时文件", async () => {
        const {dir, root} = await project();
        await writeFile(join(dir, "a.md"), "ALPHA");
        await chmod(join(dir, "a.md"), 0o750);
        await writeFile(join(dir, "taken.md"), "TAKEN");
        expect(await copyEntry(await entry(root, "a.md"), await slot(root, "b.md"), copying)).toEqual({ok: true});
        expect(await readFile(join(dir, "b.md"), "utf8")).toBe("ALPHA");
        expect((await stat(join(dir, "b.md"))).mode & 0o7777).toBe(0o750);
        expect(await readFile(join(dir, "a.md"), "utf8")).toBe("ALPHA");
        expect(codeOf(await copyEntry(await entry(root, "a.md"), await slot(root, "taken.md"), copying))).toBe("conflict");
        expect(codeOf(await copyEntry(await entry(root, "a.md"), await slot(root, "a.md"), copying))).toBe("conflict");
        expect(await readFile(join(dir, "taken.md"), "utf8")).toBe("TAKEN");
        expect((await readdir(dir)).sort()).toEqual([".nbook", "a.md", "b.md", "taken.md"]);
    });

    it("目录：正文、附件、嵌套目录都在，链接复制为链接（不跟随到根外）；目标已存在为 conflict 且不合并", async () => {
        const {dir, outside, root} = await project();
        await mkdir(join(dir, "node", "nested"), {recursive: true});
        await writeFile(join(dir, "node", "index.md"), "BODY");
        await writeFile(join(dir, "node", "image.png"), new Uint8Array([0, 1, 2, 255]));
        await writeFile(join(dir, "node", "nested", "deep.md"), "DEEP");
        await symlink(join(outside, "secret.md"), join(dir, "node", "out.md"));
        await mkdir(join(dir, "taken"));
        await writeFile(join(dir, "taken", "keep.md"), "KEEP");

        expect(await copyEntry(await entry(root, "node"), await slot(root, "copy"), copying)).toEqual({ok: true});
        expect(await readFile(join(dir, "copy", "index.md"), "utf8")).toBe("BODY");
        expect([...await readFile(join(dir, "copy", "image.png"))]).toEqual([0, 1, 2, 255]);
        expect(await readFile(join(dir, "copy", "nested", "deep.md"), "utf8")).toBe("DEEP");
        expect((await lstat(join(dir, "copy", "out.md"))).isSymbolicLink()).toBe(true);
        expect(await readlink(join(dir, "copy", "out.md"))).toBe(join(outside, "secret.md"));

        expect(await copyEntry(await entry(root, "node/out.md"), await slot(root, "out-copy.md"), copying)).toEqual({ok: true});
        expect(await readlink(join(dir, "out-copy.md"))).toBe(join(outside, "secret.md"));

        expect(codeOf(await copyEntry(await entry(root, "node"), await slot(root, "taken"), copying))).toBe("conflict");
        expect(await readdir(join(dir, "taken"))).toEqual(["keep.md"]);
    });

    it("复制到自身或后代（含经链接别名）在产生任何东西之前拒绝", async () => {
        const {dir, root} = await project();
        await mkdir(join(dir, "node", "child"), {recursive: true});
        await writeFile(join(dir, "node", "index.md"), "BODY");
        await symlink("node", join(dir, "alias"));
        expect(codeOf(await copyEntry(await entry(root, "node"), await slot(root, "node/child/copy"), copying))).toBe("into-itself");
        expect(codeOf(await copyEntry(await entry(root, "node"), await slot(root, "alias/copy"), copying))).toBe("into-itself");
        expect((await readdir(join(dir, "node"))).sort()).toEqual(["child", "index.md"]);
        expect(await readdir(join(dir, "node", "child"))).toEqual([]);
    });

    it("目录里有 FIFO：这一项失败为 unsupported，已产生的部分报告为残留", async () => {
        const {dir, root} = await project();
        await mkdir(join(dir, "node"));
        await writeFile(join(dir, "node", "a.md"), "A");
        expect(Bun.spawnSync(["mkfifo", join(dir, "node", "pipe")]).exitCode).toBe(0);
        const copied = await copyEntry(await entry(root, "node"), await slot(root, "copy"), copying);
        expect(copied).toMatchObject({ok: false, code: "unsupported", partial: {residual: ["copy"]}});
        expect(await readdir(join(dir, "copy"))).toEqual(["a.md"]);
    });

    it.skipIf(privileged)("目录复制中途遇到不可读的文件：停下，已产生的部分留在目标处并报告为残留，源不变", async () => {
        const {dir, root} = await project();
        await mkdir(join(dir, "node"));
        await writeFile(join(dir, "node", "a.md"), "A");
        await writeFile(join(dir, "node", "b.md"), "B");
        await writeFile(join(dir, "node", "c.md"), "C");
        await chmod(join(dir, "node", "b.md"), 0o000);
        const copied = await copyEntry(await entry(root, "node"), await slot(root, "copy"), copying);
        expect(copied).toMatchObject({ok: false, code: "permission-denied", partial: {residual: ["copy"]}});
        expect(await readdir(join(dir, "copy"))).toEqual(["a.md"]);
        expect((await readdir(join(dir, "node"))).sort()).toEqual(["a.md", "b.md", "c.md"]);
    });
});

describe("Spec workspace.files 文件操作：删除", () => {
    it.skipIf(privileged)("只读文件拒绝删除且仍在；父目录不可写时递归删除停下，报告已删除的范围", async () => {
        const {dir, root} = await project();
        await writeFile(join(dir, "ro.md"), "RO");
        await chmod(join(dir, "ro.md"), 0o444);
        expect(codeOf(await deleteEntry(await entry(root, "ro.md")))).toBe("permission-denied");
        expect(await readFile(join(dir, "ro.md"), "utf8")).toBe("RO");

        await mkdir(join(dir, "tree", "done"), {recursive: true});
        await writeFile(join(dir, "tree", "a.md"), "A");
        await writeFile(join(dir, "tree", "done", "x.md"), "X");
        await mkdir(join(dir, "tree", "locked"));
        await writeFile(join(dir, "tree", "locked", "kept.md"), "KEPT");
        await writeFile(join(dir, "tree", "z.md"), "Z");
        await chmod(join(dir, "tree", "locked"), 0o555);
        const deleted = await deleteEntry(await entry(root, "tree"));
        expect(deleted).toMatchObject({ok: false, code: "permission-denied", partial: {removed: ["tree/a.md", "tree/done"]}});
        expect((await readdir(join(dir, "tree"))).sort()).toEqual(["locked", "z.md"]);
        expect(await readFile(join(dir, "tree", "locked", "kept.md"), "utf8")).toBe("KEPT");
    });

    it("目录整棵删除；链接只删链接本身", async () => {
        const {dir, root} = await project();
        await mkdir(join(dir, "tree", "sub"), {recursive: true});
        await writeFile(join(dir, "tree", "sub", "x.md"), "X");
        await writeFile(join(dir, "target.md"), "T");
        await symlink("target.md", join(dir, "link.md"));
        expect(await deleteEntry(await entry(root, "tree"))).toEqual({ok: true});
        expect(await deleteEntry(await entry(root, "link.md"))).toEqual({ok: true});
        expect((await readdir(dir)).sort()).toEqual([".nbook", "target.md"]);
    });
});
