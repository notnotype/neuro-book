/**
 * eval 内核的看门狗夹具（backend/eval/kernel.test.ts）：起一个内核、让它卡在同步死循环里，把内核的进程号打到标准输出。
 * 测试随后 SIGKILL 本进程，断言内核与它起的子进程都随之结束（docs/specs/agent/eval.md 的“时序与寿命”）。
 */
import {rewriteCell} from "../backend/eval/rewrite";
import {Kernel} from "../backend/eval/kernels";

const [entry, cwd] = process.argv.slice(2) as [string, string];
const started = await Kernel.start({entry, cwd, env: {...process.env} as Record<string, string>});
if (!started.ok) throw new Error(started.reason);
const loop = rewriteCell(`const child = Bun.spawn(["sleep", "300"]); console.log("child " + child.pid); while (true) {}`, new Set());
if (!loop.ok) throw new Error(loop.failure.message);
void started.kernel.run({cell: 1, source: loop.source, tools: [], globals: []}, {
    text: (text) => process.stdout.write(text),
    image: () => undefined,
    call: async () => ({ok: false, tool: "", status: "error", message: "no tools"}),
});
process.stdout.write(`kernel ${String(started.kernel.pid)}\n`);
