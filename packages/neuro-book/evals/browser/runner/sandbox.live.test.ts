/**
 * 沙箱实机（真 bwrap）：看不到家目录下的东西与用户总线，绑进来的工作目录可写，本机端口连得上，环境变量只有给的那些。
 * 只检查路径在不在，不读任何密钥文件的内容。
 */

import {afterEach, describe, expect, test} from "bun:test";
import {existsSync} from "node:fs";
import {readFile, rm} from "node:fs/promises";
import {homedir} from "node:os";
import {join} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {defaultEnvFile} from "../env";
import {sandboxArgv} from "./sandbox";

const live = process.env.NBOOK_EVAL_LIVE === "1";
const roots: string[] = [];
afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, {recursive: true, force: true})));
});

async function inSandbox(script: string, options: {binds?: Array<{host: string; sandbox: string; writable: boolean}>; env?: Record<string, string>} = {}): Promise<{code: number; out: string}> {
    const argv = sandboxArgv({command: ["/bin/bash", "-c", script], binds: options.binds, env: {PATH: "/usr/bin:/bin", ...options.env}, cwd: "/tmp"});
    const child = Bun.spawn(argv, {stdout: "pipe", stderr: "pipe"});
    const [out, code] = await Promise.all([new Response(child.stdout).text(), child.exited]);
    return {code, out: out.trim()};
}

describe.skipIf(!live)("沙箱实机", () => {
    test("家目录下的 .env、~/.omp 与评测的私有目录在沙箱里都不存在；用户总线也不在", async () => {
        const envFile = await defaultEnvFile(import.meta.dir);
        const omp = join(homedir(), ".omp");
        const privateDir = join(envFile, "..", ".local");
        const bus = `/run/user/${process.getuid?.() ?? 1000}/bus`;
        // 宿主上这些路径是在的（否则这条用例证明不了什么）。
        expect([existsSync(envFile), existsSync(omp), existsSync(privateDir), existsSync(bus)]).toEqual([true, true, true, true]);
        const {out} = await inSandbox(`for p in "${envFile}" "${omp}" "${privateDir}" "${bus}"; do [ -e "$p" ] && echo present || echo absent; done`);
        expect(out.split("\n")).toEqual(["absent", "absent", "absent", "absent"]);
    }, 20_000);

    test("绑进来的工作目录可写，写的东西宿主上看得到；宿主的 /tmp 看不到", async () => {
        const root = await createTestTmpRoot("neuro-book-browser-eval", "沙箱");
        roots.push(root);
        const {code, out} = await inSandbox(`echo hello > /tmp/work/note.txt && ls ${root} 2>&1 | head -1; [ -e ${root} ] && echo host-tmp-visible || echo host-tmp-hidden`, {binds: [{host: root, sandbox: "/tmp/work", writable: true}]});
        expect(code).toBe(0);
        expect(out).toContain("host-tmp-hidden");
        expect(await readFile(join(root, "note.txt"), "utf8")).toBe("hello\n");
    }, 20_000);

    test("本机端口连得上；环境变量只有给的那些", async () => {
        const server = Bun.serve({hostname: "127.0.0.1", port: 0, fetch: () => new Response("pong")});
        try {
            const {out} = await inSandbox(`exec 3<>/dev/tcp/127.0.0.1/${server.port} && printf 'GET / HTTP/1.0\\r\\n\\r\\n' >&3 && tail -1 <&3; echo; env | sort | cut -d= -f1 | tr '\\n' ' '`, {env: {GIVEN: "1"}});
            expect(out).toContain("pong");
            expect(out.split("\n").at(-1)?.trim().split(" ").filter((key) => !["PWD", "SHLVL", "_", "OLDPWD"].includes(key))).toEqual(["GIVEN", "PATH"]);
        } finally {
            await server.stop(true);
        }
    }, 20_000);
});
