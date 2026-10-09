/**
 * 受根约束的文件原语（docs/specs/workspace/files.md 的“读取与保存”，验收 4、6 的服务侧）：真实临时目录、真实符号链接与
 * 文件权限。保存的“按基线”由测试里的 `conditional` 决定，与文件服务的判定同形：当前内容 hash 等于基线才写。
 *
 * 只读用例要求以普通用户运行（root 不受文件权限约束）。
 */

import {afterAll, beforeAll, describe, expect, it} from "bun:test";
import {createHash} from "node:crypto";
import {chmod, lstat, mkdir, readdir, readFile, readlink, rename, rm, stat, symlink, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import type {CurrentFile, ReplaceDecision} from "nbook/backend/locked-replace";

import {openRoot} from "./rooted";
import type {RootedFailure, RootedRoot} from "./rooted";

let tmp = "";
let counter = 0;

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-files", "rooted");
});

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

const hash = (bytes: Uint8Array | string): string => createHash("sha256").update(bytes).digest("hex");

type Saved = {readonly code: "conflict" | "not-found"};

/** 当前内容的 hash 等于基线才写 `text`，否则以冲突结束。 */
function conditional(baseline: string, text: string): (current: CurrentFile) => ReplaceDecision<Saved, string> {
    return (current) => {
        if (current === null) return {done: {code: "not-found"}};
        return hash(current.bytes) === baseline ? {write: text} : {done: {code: "conflict"}};
    };
}

/** 一个新的项目根（有控制目录），外加根外的一个目录。 */
async function project(): Promise<{readonly dir: string; readonly outside: string; readonly root: RootedRoot}> {
    counter += 1;
    const dir = join(tmp, `p${String(counter)}`, "project");
    const outside = join(tmp, `p${String(counter)}`, "outside");
    await mkdir(join(dir, ".nbook"), {recursive: true});
    await mkdir(outside, {recursive: true});
    await writeFile(join(dir, ".nbook", "project.json"), "CONTROL");
    await writeFile(join(outside, "secret.md"), "OUTSIDE");
    const root = await openRoot(dir, {controlDirectory: true, lockDirectory: join(dir, ".nbook", "locks", "files"), report: () => undefined});
    if ("ok" in root) throw new Error(root.detail);
    return {dir, outside, root};
}

function failure(result: unknown): RootedFailure {
    expect(result).toMatchObject({ok: false});
    return result as RootedFailure;
}

describe("Spec workspace.files 读取与保存：包含校验与控制目录", () => {
    it("列根不出现控制目录（含大小写变体）；嵌套的 .nbook 是普通目录；用户资产根没有控制目录", async () => {
        const {dir, root} = await project();
        await mkdir(join(dir, ".NBook"));
        await mkdir(join(dir, "notes", ".nbook"), {recursive: true});
        await writeFile(join(dir, "notes", ".nbook", "a.md"), "A");
        await writeFile(join(dir, "a.md"), "A");
        const listed = await root.list("");
        expect(listed).toMatchObject({ok: true});
        expect(listed.ok && listed.entries.map((entry) => entry.name).sort()).toEqual(["a.md", "notes"]);
        expect(await root.read("notes/.nbook/a.md", 1024)).toMatchObject({ok: true});

        const user = await openRoot(dir, {controlDirectory: false, lockDirectory: join(tmp, "user-locks"), report: () => undefined});
        if ("ok" in user) throw new Error(user.detail);
        const all = await user.list("");
        expect(all.ok && all.entries.map((entry) => entry.name).sort()).toEqual([".NBook", ".nbook", "a.md", "notes"]);
    });

    it("控制目录的字面地址、大小写变体与根内链接别名：读、列出、保存都为 protected-path，控制文件不变", async () => {
        const {dir, root} = await project();
        await symlink(".nbook", join(dir, "meta"));
        await symlink(join(".nbook", "project.json"), join(dir, "identity.md"));
        const before = hash("CONTROL");
        for (const path of [".nbook/project.json", ".NBOOK/project.json", "meta/project.json", "identity.md"]) {
            expect(failure(await root.read(path, 1024)).code).toBe("protected-path");
            expect(failure(await root.replace(path, conditional(before, "CHANGED"))).code).toBe("protected-path");
        }
        expect(failure(await root.list("meta")).code).toBe("protected-path");
        expect(failure(await root.list(".nbook")).code).toBe("protected-path");
        expect(await readFile(join(dir, ".nbook", "project.json"), "utf8")).toBe("CONTROL");
    });

    it("经符号链接指向根外为 outside-root，根外数据不变；悬空链接为 not-found；根内链接照常读", async () => {
        const {dir, outside, root} = await project();
        await symlink(join(outside, "secret.md"), join(dir, "leak.md"));
        await symlink(outside, join(dir, "out"));
        await symlink(join(dir, "nowhere.md"), join(dir, "dangling.md"));
        await writeFile(join(dir, "chapter.md"), "CHAPTER");
        await mkdir(join(dir, "actual"));
        await symlink("actual", join(dir, "alias"));
        await writeFile(join(dir, "actual", "story.md"), "STORY");

        expect(failure(await root.read("leak.md", 1024)).code).toBe("outside-root");
        expect(failure(await root.read("out/secret.md", 1024)).code).toBe("outside-root");
        expect(failure(await root.list("out")).code).toBe("outside-root");
        expect(failure(await root.replace("leak.md", conditional(hash("OUTSIDE"), "OVERWRITTEN"))).code).toBe("outside-root");
        expect(await readFile(join(outside, "secret.md"), "utf8")).toBe("OUTSIDE");
        expect(failure(await root.read("dangling.md", 1024)).code).toBe("not-found");
        expect(failure(await root.read("missing/x.md", 1024)).code).toBe("not-found");
        expect(failure(await root.read("chapter.md/x", 1024)).code).toBe("not-found");

        const viaAlias = await root.read("alias/story.md", 1024);
        expect(viaAlias).toMatchObject({ok: true, resolved: {realPath: "actual/story.md"}});
    });

    it("类型不符：列文件为 not-a-directory，读目录为 not-a-file", async () => {
        const {dir, root} = await project();
        await writeFile(join(dir, "a.md"), "A");
        expect(failure(await root.list("a.md")).code).toBe("not-a-directory");
        expect(failure(await root.read("", 1024)).code).toBe("not-a-file");
    });

    it("根被移走、删除或在原路径换成指向别处的链接：之后的请求为 root-gone，不读到别处的内容", async () => {
        const moved = await project();
        await writeFile(join(moved.dir, "secret.md"), "INSIDE");
        await rename(moved.dir, `${moved.dir}-moved`);
        await symlink(moved.outside, moved.dir);
        expect(failure(await moved.root.read("secret.md", 1024)).code).toBe("root-gone");
        expect(failure(await moved.root.replace("secret.md", conditional(hash("OUTSIDE"), "OVERWRITTEN"))).code).toBe("root-gone");
        expect(await readFile(join(moved.outside, "secret.md"), "utf8")).toBe("OUTSIDE");

        const recreated = await project();
        await rm(recreated.dir, {recursive: true});
        expect(failure(await recreated.root.list("")).code).toBe("root-gone");
        await mkdir(recreated.dir);
        expect(failure(await recreated.root.list("")).code).toBe("root-gone");
    });

    it("读取超过上限为 too-large", async () => {
        const {dir, root} = await project();
        await writeFile(join(dir, "big.md"), "x".repeat(2048));
        expect(failure(await root.read("big.md", 2047)).code).toBe("too-large");
        expect(await root.read("big.md", 2048)).toMatchObject({ok: true});
    });
});

describe("Spec workspace.files 读取与保存：加锁提交", () => {
    it("同一基线的两次并发保存恰好一次成功、另一次冲突，磁盘等于成功的那次；之后用新基线能再保存", async () => {
        const {dir, root} = await project();
        await writeFile(join(dir, "chapter.md"), "A");
        const results = await Promise.all([root.replace("chapter.md", conditional(hash("A"), "B")), root.replace("chapter.md", conditional(hash("A"), "C"))]);
        const written = results.filter((result) => result.ok && "written" in result);
        const conflicts = results.filter((result) => result.ok && "done" in result && result.done.code === "conflict");
        expect([written.length, conflicts.length]).toEqual([1, 1]);
        const disk = await readFile(join(dir, "chapter.md"), "utf8");
        expect(written[0]).toMatchObject({written: disk});
        expect(await root.replace("chapter.md", conditional(hash(disk), "D"))).toMatchObject({ok: true, written: "D"});
        expect(await readFile(join(dir, "chapter.md"), "utf8")).toBe("D");
        expect((await readdir(dir)).sort()).toEqual([".nbook", "chapter.md"]);
    });

    it("文件不存在时由调用方决定（这里为 not-found），不新建文件", async () => {
        const {dir, root} = await project();
        await mkdir(join(dir, "notes"));
        expect(failure(await root.replace("notes/new.md", conditional(hash(""), "X"))).code).toBe("not-found");
        expect(await readdir(join(dir, "notes"))).toEqual([]);
    });

    it("只读文件为 permission-denied，字节与权限不变；可执行文件保存后权限位不变", async () => {
        const {dir, root} = await project();
        await writeFile(join(dir, "ro.md"), "RO");
        await chmod(join(dir, "ro.md"), 0o444);
        expect(failure(await root.replace("ro.md", conditional(hash("RO"), "CHANGED"))).code).toBe("permission-denied");
        expect(await readFile(join(dir, "ro.md"), "utf8")).toBe("RO");
        expect((await stat(join(dir, "ro.md"))).mode & 0o777).toBe(0o444);

        await writeFile(join(dir, "run.sh"), "#!/bin/sh\n");
        await chmod(join(dir, "run.sh"), 0o750);
        expect(await root.replace("run.sh", conditional(hash("#!/bin/sh\n"), "#!/bin/sh\necho\n"))).toMatchObject({ok: true});
        expect((await stat(join(dir, "run.sh"))).mode & 0o777).toBe(0o750);
    });

    it("经文件链接保存：替换最终目标，链接保留；经目录链接保存落在真实目录", async () => {
        const {dir, root} = await project();
        await writeFile(join(dir, "chapter.md"), "CHAPTER");
        await symlink("chapter.md", join(dir, "chapter-link.md"));
        expect(await root.replace("chapter-link.md", conditional(hash("CHAPTER"), "SAVED"))).toMatchObject({ok: true, resolved: {realPath: "chapter.md"}});
        expect((await lstat(join(dir, "chapter-link.md"))).isSymbolicLink()).toBe(true);
        expect(await readlink(join(dir, "chapter-link.md"))).toBe("chapter.md");
        expect(await readFile(join(dir, "chapter.md"), "utf8")).toBe("SAVED");

        await mkdir(join(dir, "actual"));
        await symlink("actual", join(dir, "alias"));
        await writeFile(join(dir, "actual", "story.md"), "STORY");
        expect(await root.replace("alias/story.md", conditional(hash("STORY"), "ALIAS"))).toMatchObject({ok: true, resolved: {realPath: "actual/story.md"}});
        expect(await readFile(join(dir, "actual", "story.md"), "utf8")).toBe("ALIAS");
        expect((await lstat(join(dir, "alias"))).isSymbolicLink()).toBe(true);
    });

    it("锁目录在控制目录里，保存后不在用户目录留下锁或临时文件", async () => {
        const {dir, root} = await project();
        await writeFile(join(dir, "a.md"), "A");
        expect(await root.replace("a.md", conditional(hash("A"), "B"))).toMatchObject({ok: true});
        expect((await readdir(dir)).sort()).toEqual([".nbook", "a.md"]);
        expect(await readdir(join(dir, ".nbook", "locks", "files"))).toEqual([]);
    });
});
