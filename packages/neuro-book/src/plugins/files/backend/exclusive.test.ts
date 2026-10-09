/**
 * 排他改名（docs/specs/workspace/files.md 的“文件操作”）：真实临时目录，目标已存在时文件与目录都失败、目标不变。
 */

import {afterAll, beforeAll, describe, expect, it} from "bun:test";
import {lstat, mkdir, readFile, readdir, readlink, rm, symlink, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {renameNoReplace} from "./exclusive";

let tmp = "";

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-files", "exclusive");
});

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

describe("Spec workspace.files 排他改名", () => {
    it("目标是已有文件、空目录或悬空链接时失败、两边都不变；目标不存在时改名成功；链接改名的是链接本身", async () => {
        await writeFile(join(tmp, "a.md"), "A");
        await writeFile(join(tmp, "b.md"), "B");
        await mkdir(join(tmp, "src"));
        await writeFile(join(tmp, "src", "x.md"), "X");
        await mkdir(join(tmp, "empty"));

        expect(renameNoReplace(join(tmp, "a.md"), join(tmp, "b.md"))).toEqual({ok: false, reason: "exists", code: "EEXIST"});
        expect([await readFile(join(tmp, "a.md"), "utf8"), await readFile(join(tmp, "b.md"), "utf8")]).toEqual(["A", "B"]);
        expect(renameNoReplace(join(tmp, "src"), join(tmp, "empty"))).toMatchObject({ok: false, reason: "exists"});
        expect(await readdir(join(tmp, "empty"))).toEqual([]);
        // 悬空链接也是已存在的目录项：不能被覆盖。
        await symlink("nowhere", join(tmp, "dangling"));
        expect(renameNoReplace(join(tmp, "b.md"), join(tmp, "dangling"))).toMatchObject({ok: false, reason: "exists"});
        expect(await readlink(join(tmp, "dangling"))).toBe("nowhere");

        expect(renameNoReplace(join(tmp, "a.md"), join(tmp, "c.md"))).toEqual({ok: true});
        expect(await readFile(join(tmp, "c.md"), "utf8")).toBe("A");
        expect(renameNoReplace(join(tmp, "src"), join(tmp, "moved"))).toEqual({ok: true});
        expect(await readFile(join(tmp, "moved", "x.md"), "utf8")).toBe("X");

        await symlink("c.md", join(tmp, "link.md"));
        expect(renameNoReplace(join(tmp, "link.md"), join(tmp, "link2.md"))).toEqual({ok: true});
        expect((await lstat(join(tmp, "link2.md"))).isSymbolicLink()).toBe(true);
        expect(await readlink(join(tmp, "link2.md"))).toBe("c.md");

        expect(renameNoReplace(join(tmp, "nope.md"), join(tmp, "d.md"))).toMatchObject({ok: false, reason: "missing"});
    });
});
