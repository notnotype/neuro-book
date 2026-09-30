// 整个进程被暂停（SIGSTOP，相当于调试器暂停或系统睡眠）6 秒后恢复：看门狗是否误把它当成主线程卡死。
import {spawn} from "node:child_process";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
console.log(`# ${new Date().toISOString()} ${process.platform} bun ${Bun.version}；阈值 3s，暂停 6s`);
for (const mode of ["naive", "guarded"]) {
    const results = [];
    for (let i = 0; i < 5; i++) {
        const child = spawn("bun", ["pause-child.mjs", mode], {stdio: "inherit", env: {...process.env, OUT_DIR: "out"}});
        const exited = new Promise((r) => child.on("exit", (code, signal) => r(signal ?? code)));
        await sleep(2000);
        process.kill(child.pid, "SIGSTOP");
        await sleep(6000);
        process.kill(child.pid, "SIGCONT");
        await sleep(2500);
        try { process.kill(child.pid, "SIGTERM"); } catch {}
        results.push(await exited);
    }
    console.log(`${mode === "naive" ? "不识别整体暂停" : "识别整体暂停（worker 自身节拍间隔>2s 即重置）"}：5 次结果 ${JSON.stringify(results)}（76=误报结束进程，SIGTERM=存活到测试结束）`);
}
