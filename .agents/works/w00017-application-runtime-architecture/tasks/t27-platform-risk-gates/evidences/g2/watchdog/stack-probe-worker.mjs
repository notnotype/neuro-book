// 在 worker 里经 node:inspector 连接主线程并暂停它，读取主线程的 JS 调用栈。
import {writeSync} from "node:fs";
const say = (s) => writeSync(1, `${s}\n`);
let result;
try {
    const inspector = await import("node:inspector");
    const session = new inspector.Session();
    if (typeof session.connectToMainThread !== "function") throw new Error("Session.connectToMainThread 不存在");
    session.connectToMainThread();
    session.post("Debugger.enable");
    session.on("Debugger.paused", (m) => {
        result = m.params.callFrames.map((f) => `${f.functionName || "<anon>"} ${f.url}:${f.location.lineNumber + 1}`).slice(0, 3);
        say(`worker: 主线程栈 ${JSON.stringify(result)}`);
        session.post("Debugger.resume");
    });
    setTimeout(() => session.post("Debugger.pause"), 300);
    setTimeout(() => {
        say(result ? "worker: 已取得栈" : "worker: 1 秒内未拿到主线程栈");
        process.kill(process.pid, "SIGKILL");
    }, 1300);
} catch (error) {
    say(`worker: 无法取主线程栈：${error.message}`);
    process.kill(process.pid, "SIGKILL");
}
