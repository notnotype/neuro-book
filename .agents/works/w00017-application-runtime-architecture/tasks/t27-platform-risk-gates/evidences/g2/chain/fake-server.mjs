// 模拟产品服务端进程（.output/server/index.mjs）。mode 决定它如何结束。
import {writeFileSync} from "node:fs";
import {startMainThreadWatchdog} from "../watchdog/watchdog-host.mjs";
const mode = process.argv[2];
writeFileSync(`${process.env.CHAIN_OUT}/server.pid`, String(process.pid));
setInterval(() => {}, 1000);
if (mode === "hang-sigkill" || mode === "hang-ffi76") {
    startMainThreadWatchdog({
        thresholdMs: 2000, beatMs: 500, checkMs: 250,
        reportPath: `${process.env.CHAIN_OUT}/hang-report-${mode}.json`,
        exitMethod: mode === "hang-sigkill" ? "sigkill" : "ffi-exit", exitCode: 76,
    });
    setTimeout(() => { while (true) {} }, 800);
} else if (mode === "exit75") {
    setTimeout(() => process.exit(75), 800);
} else if (mode === "exit1") {
    setTimeout(() => { throw new Error("启动失败（模拟 setImmediate 抛出）"); }, 800);
}
// external-kill：等待编排器从外部 SIGKILL（模拟 OOM killer 或用户在任务管理器结束进程）
