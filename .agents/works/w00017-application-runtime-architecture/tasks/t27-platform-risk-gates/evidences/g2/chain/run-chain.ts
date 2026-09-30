// 用仓库真实的 owned-process 与 Manager 退出判定（只读导入），观察产品服务端以不同方式结束时 Manager 看到什么。
import {readFileSync, mkdirSync} from "node:fs";
import {spawnOwnedProcess} from "/home/notnotype/CodeRepository/neuro-book/.worktree/w00017-runtime-foundation/packages/owned-process/src/index.ts";
import {assertProductExit, productExitErrorMessage} from "/home/notnotype/CodeRepository/neuro-book/.worktree/w00017-runtime-foundation/packages/neuro-book-manager/src/app-commands.ts";
const out = `${import.meta.dir}/out`;
mkdirSync(out, {recursive: true});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const alive = (pid: number) => { try { process.kill(pid, 0); return true; } catch { return false; } };
console.log(`# ${new Date().toISOString()} ${process.platform} bun ${Bun.version}；Manager → owned-process 监督进程 → [product-command → start] → 模拟服务端`);
for (const chain of ["wrapped", "direct"] as const) {
    for (const mode of ["hang-sigkill", "hang-ffi76", "exit75", "exit1", "external-kill"]) {
        const script = chain === "wrapped" ? "wrapper-command.mjs" : "fake-server.mjs";
        const started = Date.now();
        const lease = spawnOwnedProcess({
            command: process.execPath,
            args: [`${import.meta.dir}/${script}`, mode],
            cwd: import.meta.dir,
            env: {...process.env, CHAIN_OUT: out},
            stdin: "ignore", stdout: "inherit", stderr: "ignore",
            graceMs: 2_000, hardKillWaitMs: 5_000,
        });
        if (mode === "external-kill") {
            await sleep(1500);
            process.kill(Number(readFileSync(`${out}/server.pid`, "utf8")), "SIGKILL");
        }
        const completion = await lease.completion;
        const serverPid = Number(readFileSync(`${out}/server.pid`, "utf8"));
        const result = {code: completion.exitCode, signal: completion.signal};
        let verdict = "ok";
        try { assertProductExit(result, "NeuroBook 服务退出"); } catch (e) { verdict = (e as Error).message; }
        console.log(`${chain} ${mode}: completion=${JSON.stringify(completion)} 用时=${Date.now() - started}ms 服务端存活=${alive(serverPid)} Manager 文案=「${verdict}」`);
    }
}
