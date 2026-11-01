/**
 * 启动环境快照（docs/specs/models/service.md 输出 1）：真实子进程里，家目录 `.env` 里的变量（OMP 导入时并进 `process.env`）
 * 不进快照；shell 导出的与 Bun 启动时读的当前目录 `.env` 进快照。每个能起服务端的入口第一条导入都是它。
 */

import {afterAll, beforeAll, describe, expect, test} from "bun:test";
import {mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

let root = "";
beforeAll(async () => {
    root = await createTestTmpRoot("neuro-book-server", "startup-env");
});
afterAll(async () => {
    if (root !== "") await rm(root, {recursive: true, force: true});
});

describe("启动环境快照", () => {
    test("家目录 .env 里的变量不算；shell 导出的与当前目录 .env 算", async () => {
        const home = join(root, "home");
        const cwd = join(root, "work");
        await mkdir(home, {recursive: true});
        await mkdir(cwd, {recursive: true});
        await writeFile(join(home, ".env"), "NB_STARTUP_HOME_ONLY=from-home\n");
        await writeFile(join(cwd, ".env"), "NB_STARTUP_CWD=from-cwd\n");
        const probe = Bun.spawn([process.execPath, join(import.meta.dir, "testing", "startup-env-probe.ts")], {
            cwd,
            env: {PATH: process.env.PATH ?? "", HOME: home, NB_STARTUP_SHELL: "from-shell"},
            stdout: "pipe",
            stderr: "pipe",
        });
        const [out, err, code] = await Promise.all([new Response(probe.stdout).text(), new Response(probe.stderr).text(), probe.exited]);
        expect({code, err: code === 0 ? "" : err}).toEqual({code: 0, err: ""});
        const seen = JSON.parse(out.trim().split("\n").at(-1)!) as {snapshot: Record<string, string | null>; live: Record<string, string | null>};
        // 前提：OMP 确实把家目录 .env 并进了 process.env，不然这条测试测不到东西。
        expect(seen.live.NB_STARTUP_HOME_ONLY).toBe("from-home");
        expect(seen.snapshot).toEqual({NB_STARTUP_HOME_ONLY: null, NB_STARTUP_CWD: "from-cwd", NB_STARTUP_SHELL: "from-shell"});
    });

    test("每个能起服务端的入口，第一条导入都是启动环境快照", async () => {
        const entries = ["server/main.ts", "server/development-main.ts", "server/testing/fixture-entry.ts", "cli/main.ts"];
        for (const entry of entries) {
            const text = await readFile(join(import.meta.dir, "..", entry), "utf8");
            const first = text.match(/^import\s[^;]*;/mu)?.[0];
            expect({entry, first}).toEqual({entry, first: expect.stringMatching(/startup-env";$/u)});
        }
    });
});
