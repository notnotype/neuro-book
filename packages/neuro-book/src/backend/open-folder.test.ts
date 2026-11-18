/**
 * 打开设置给出的目录（open-folder.ts 的 `revealFolder`）：真实目录、链接、文件与不可访问的父目录。环境设成 SSH，让走到“打开”
 * 这一步的用例停在 `no-desktop`，测试机上不会真的弹出文件管理器。
 */

import {afterEach, beforeEach, describe, expect, it} from "bun:test";
import {chmod, mkdir, mkdtemp, rm, symlink, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";

import {revealFolder} from "./open-folder";

const SSH = {SSH_CONNECTION: "1.2.3.4 5 6.7.8.9 22"};

describe("打开设置给出的目录", () => {
    let tmp: string;
    beforeEach(async () => {
        tmp = await mkdtemp(join(tmpdir(), "nbook-reveal-"));
    });
    afterEach(async () => {
        await chmod(join(tmp, "locked"), 0o755).catch(() => undefined);
        await rm(tmp, {recursive: true, force: true});
    });

    it("存在的目录与指向目录的链接都走到打开那一步", async () => {
        await mkdir(join(tmp, "library"));
        await symlink(join(tmp, "library"), join(tmp, "alias"));
        expect(await revealFolder(join(tmp, "library"), SSH, "linux")).toEqual({ok: false, code: "no-desktop"});
        expect(await revealFolder(join(tmp, "alias"), SSH, "linux")).toEqual({ok: false, code: "no-desktop"});
    });

    it("不存在为 missing；是文件或路径中间是文件为 not-directory", async () => {
        await writeFile(join(tmp, "file"), "x");
        expect(await revealFolder(join(tmp, "nothing"), SSH, "linux")).toEqual({ok: false, code: "missing"});
        expect(await revealFolder(join(tmp, "file"), SSH, "linux")).toEqual({ok: false, code: "not-directory"});
        expect(await revealFolder(join(tmp, "file", "inside"), SSH, "linux")).toEqual({ok: false, code: "not-directory"});
    });

    it.skipIf(process.getuid?.() === 0)("父目录不可进入时为 not-accessible，不说成不存在", async () => {
        await mkdir(join(tmp, "locked", "library"), {recursive: true});
        await chmod(join(tmp, "locked"), 0o000);
        const result = await revealFolder(join(tmp, "locked", "library"), SSH, "linux");
        expect(result.ok ? null : result.code).toBe("not-accessible");
    });
});
