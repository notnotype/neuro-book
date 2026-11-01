/**
 * 接管 OMP 的进程级处理（src/process-guard.ts）：真实子进程里导入 OMP、给自己发信号，看宿主的有序停止有没有跑完。
 */

import {describe, expect, test} from "bun:test";
import {join} from "node:path";

const HOST = join(import.meta.dir, "fixtures", "omp-host.ts");

async function run(mode: "guard" | "plain"): Promise<{code: number | null; stdout: string}> {
    const child = Bun.spawn(["bun", HOST, mode], {stdout: "pipe", stderr: "pipe"});
    const [code, stdout] = await Promise.all([child.exited, new Response(child.stdout).text()]);
    return {code, stdout};
}

describe("takeOverOmpProcessHandlers", () => {
    test("先接管再导入 OMP：未处理的 rejection 交给宿主、进程不退出；SIGTERM 时宿主的有序停止跑完、以宿主给的 0 退出", async () => {
        const {code, stdout} = await run("guard");
        expect(stdout).toContain("detached");
        expect(JSON.parse(/detached (.*)/u.exec(stdout)![1]!)).toMatchObject({SIGINT: 1, SIGTERM: 1, SIGHUP: 1, uncaughtException: 1, unhandledRejection: 1});
        expect(stdout).toContain("host saw rejection: Error: stray");
        expect(stdout).toContain("host stopped cleanly");
        expect(code).toBe(0);
    }, 20_000);

    test("对照：不接管时 OMP 的处理抢先硬退出（上游 can1357/oh-my-pi#17674），宿主的停止没跑完", async () => {
        const {code, stdout} = await run("plain");
        expect(stdout).not.toContain("host stopped cleanly");
        expect(code).not.toBe(0);
    }, 20_000);
});
