/**
 * process-guard.test.ts 的宿主进程：自己挂 SIGTERM 与 `unhandledRejection`，按参数决定导入 OMP 之前要不要先接管，然后
 * 让自己出一个未处理的 rejection、再给自己发 SIGTERM。宿主的有序停止要花 200 毫秒，停完写一行并以 0 退出。
 * 参数：`guard` 先经 `takeOverOmpProcessHandlers` 导入；`plain` 直接导入（对照：OMP 抢先硬退出）。
 */

const mode = process.argv[2];

process.on("unhandledRejection", (reason) => {
    console.log(`host saw rejection: ${String(reason)}`);
});
process.on("SIGTERM", () => {
    void (async () => {
        await new Promise((resolve) => setTimeout(resolve, 200));
        if (guard !== null) await guard.cleanup();
        console.log("host stopped cleanly");
        process.exit(0);
    })();
});

let guard: {cleanup(): Promise<void>} | null = null;
if (mode === "guard") {
    const {takeOverOmpProcessHandlers} = await import("../../src/process-guard");
    const taken = await takeOverOmpProcessHandlers();
    console.log(`detached ${JSON.stringify(taken.detached)}`);
    guard = taken;
}
await import("@oh-my-pi/pi-catalog");

void Promise.reject(new Error("stray"));
await new Promise((resolve) => setTimeout(resolve, 50));
process.kill(process.pid, "SIGTERM");
await new Promise((resolve) => setTimeout(resolve, 5000));

export {};
