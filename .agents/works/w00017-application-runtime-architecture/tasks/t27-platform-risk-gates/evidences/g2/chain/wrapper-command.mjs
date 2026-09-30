// 摘自 packages/neuro-book/server/runtime/product-command.ts 的 run() 与 main() 末段：转发 stdio 与退出码。
import {spawn} from "node:child_process";
async function run(entry, args, cwd, env, stdio) {
    return await new Promise((resolvePromise, rejectPromise) => {
        const child = spawn(process.execPath, [entry, ...args], {cwd, env, stdio, windowsHide: true});
        const forward = (signal) => {
            if (child.exitCode === null && child.signalCode === null) child.kill(signal);
        };
        const onSigint = () => forward("SIGINT");
        const onSigterm = () => forward("SIGTERM");
        const cleanup = () => {
            process.off("SIGINT", onSigint);
            process.off("SIGTERM", onSigterm);
        };
        process.once("SIGINT", onSigint);
        process.once("SIGTERM", onSigterm);
        child.once("error", (error) => {
            cleanup();
            rejectPromise(error);
        });
        child.once("exit", (code, signal) => {
            cleanup();
            if (signal) rejectPromise(new Error(`Product Runtime command 被信号中断：${signal}`));
            else resolvePromise(code ?? 1);
        });
    });
}
const code = await run(new URL("./wrapper-start.mjs", import.meta.url).pathname, process.argv.slice(2), process.cwd(), process.env, "ignore");
process.exitCode = code;
