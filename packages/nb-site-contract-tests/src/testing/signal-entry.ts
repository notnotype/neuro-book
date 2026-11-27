/**
 * `src/sandbox.test.ts` 按路径用 `bun` 运行的入口（不是测试文件）：像 Playwright 的 worker 那样自己接住 `SIGINT`、`SIGTERM`，
 * 用 `handleSignals: false` 的沙箱起一个服务，就绪后在标准输出写一行 `SIGNAL_ENTRY_READY <JSON>`，每收到一个信号写一行
 * `SIGNAL_ENTRY_GOT <信号>`。标准输入读到 `close` 时按顺序收口：收口成功以 0 退出，收口报错时把错误写到标准错误、以 1 退出。
 */

import {createSiteSandbox} from "./process";

// 与 `src/sandbox.test.ts` 里的同名常量一致。
const READY_PREFIX = "SIGNAL_ENTRY_READY ";
const GOT_PREFIX = "SIGNAL_ENTRY_GOT ";

// 先于沙箱登记，与 Playwright 的 worker 一样（它一启动就登记）：同一个信号的处理函数按登记的先后同步调用，
// 外面的用例读到这一行时，沙箱若也装了处理函数，它已经跑过了。
for (const signal of ["SIGINT", "SIGTERM"] as const) process.on(signal, () => console.log(`${GOT_PREFIX}${signal}`));

const sandbox = createSiteSandbox("signal-entry.ts", {handleSignals: false});
await sandbox.open();
let failed = false;
try {
    const site = await sandbox.start({dataDir: await sandbox.dataDir()});
    await site.ready();
    console.log(`${READY_PREFIX}${JSON.stringify({pid: site.pid, url: site.url, root: sandbox.root})}`);
    await new Promise<void>((resolve) => {
        let input = "";
        process.stdin.on("data", (chunk: Buffer) => {
            input += chunk.toString("utf8");
            if (input.includes("close")) resolve();
        });
    });
} catch (error) {
    failed = true;
    console.error(error);
}
try {
    await sandbox.close();
} catch (error) {
    failed = true;
    console.error(error);
}
process.exit(failed ? 1 : 0);
