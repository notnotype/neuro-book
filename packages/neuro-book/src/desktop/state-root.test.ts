/** 桌面壳的状态根（docs/specs/runtime/desktop-shell.md 的“输入与前置条件”、输出 24）。 */

import {afterAll, beforeAll, describe, expect, it} from "bun:test";
import {chmod, mkdir, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {PORTABLE_MARKER, resolveDesktopStateRoot} from "./state-root";

let tmp = "";
beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-desktop", "state-root");
});
afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

const base = {platform: "win32" as const, home: "C:\\Users\\u"};

describe("桌面壳的状态根", () => {
    it("环境变量优先（相对路径按工作目录），其次便携标记，最后是与 nbook 共用的平台缺省", async () => {
        const program = join(tmp, "installed");
        await mkdir(program, {recursive: true});
        expect(await resolveDesktopStateRoot({...base, env: {LOCALAPPDATA: "C:\\Users\\u\\AppData\\Local"}, cwd: tmp, programRoot: program})).toEqual({ok: true, stateRoot: "C:\\Users\\u\\AppData\\Local\\NeuroBook", portable: false, source: "default"});
        expect(await resolveDesktopStateRoot({...base, env: {NBOOK_STATE_ROOT: "rel/state"}, cwd: tmp, programRoot: program})).toMatchObject({ok: true, stateRoot: join(tmp, "rel", "state"), source: "env"});
        // 空串算没给。
        expect(await resolveDesktopStateRoot({...base, env: {NBOOK_STATE_ROOT: "  "}, cwd: tmp, programRoot: program})).toMatchObject({ok: true, source: "default"});

        const portable = join(tmp, "portable");
        await mkdir(portable, {recursive: true});
        await writeFile(join(portable, PORTABLE_MARKER), "");
        expect(await resolveDesktopStateRoot({...base, env: {}, cwd: tmp, programRoot: portable})).toEqual({ok: true, stateRoot: join(portable, "data"), portable: true, source: "portable"});
        expect(await resolveDesktopStateRoot({...base, env: {NBOOK_STATE_ROOT: join(tmp, "explicit")}, cwd: tmp, programRoot: portable})).toMatchObject({stateRoot: join(tmp, "explicit"), portable: true, source: "env"});
    });

    it("便携版的程序目录不可写：交回错误与实际路径，不改用缺省位置", async () => {
        const program = join(tmp, "readonly");
        await mkdir(program, {recursive: true});
        await writeFile(join(program, PORTABLE_MARKER), "");
        await chmod(program, 0o555);
        try {
            expect(await resolveDesktopStateRoot({...base, env: {}, cwd: tmp, programRoot: program})).toMatchObject({ok: false, reason: "portable-unwritable", path: join(program, "data")});
        } finally {
            await chmod(program, 0o755);
        }
    });
});
