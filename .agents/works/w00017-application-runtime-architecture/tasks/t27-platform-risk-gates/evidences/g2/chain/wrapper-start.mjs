// 摘自 packages/neuro-book/server/runtime/product-start-command.mjs 第 46~100 行的子进程启动与退出转发（去掉资产与迁移步骤）。
import {spawn} from "node:child_process";
const entry = new URL("./fake-server.mjs", import.meta.url).pathname;
const child = spawn(process.execPath, [entry, ...process.argv.slice(2)], {
    cwd: process.cwd(),
    env: process.env,
    stdio: "ignore",
    windowsHide: false,
});
let shutdownSignal;
for (const signal of ["SIGINT", "SIGTERM"]) {
    process.once(signal, () => {
        shutdownSignal = signal;
        if (child.exitCode === null && child.signalCode === null) {
            child.kill(signal);
        }
    });
}
child.on("error", () => {
    process.exit(1);
});
child.on("exit", (code, signal) => {
    if (shutdownSignal) {
        process.exit(0);
    }
    if (signal) {
        process.kill(process.pid, signal);
        return;
    }
    process.exit(code ?? 1);
});
