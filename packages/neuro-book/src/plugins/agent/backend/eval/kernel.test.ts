/**
 * eval 内核（docs/specs/agent/eval.md）：真实的内核子进程，经宿主的 `Kernel` 收发；代码经 `rewriteCell` 改写，同工具里的路径。
 * 代码里调的工具在这一层由测试给的 `call` 交回（嵌套调用的审批与日志在内核通道那一层测）。
 */

import {afterEach, describe, expect, test} from "bun:test";
import {mkdir, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import type {CallReply, CallTarget} from "./protocol";
import {rewriteCell} from "./rewrite";
import {Kernel, KernelRegistry, type CellEnd, type KernelOwner} from "./kernels";

const ENTRY = join(import.meta.dir, "kernel-entry.ts");
const RESERVED = new Set(["tool", "display", "console", "require"]);

let root = "";
const kernels: Kernel[] = [];
afterEach(async () => {
    for (const kernel of kernels.splice(0)) await kernel.kill();
    if (root !== "") await rm(root, {recursive: true, force: true});
    root = "";
});

async function startKernel(env: Record<string, string> = {}): Promise<Kernel> {
    root = root === "" ? await createTestTmpRoot("neuro-book-eval-kernel", "eval kernel") : root;
    const started = await Kernel.start({entry: ENTRY, cwd: root, env: {...(process.env as Record<string, string>), ...env}});
    if (!started.ok) throw new Error(started.reason);
    kernels.push(started.kernel);
    return started.kernel;
}

type Calls = (target: CallTarget, args: unknown) => Promise<CallReply>;
const noCalls: Calls = async (target) => ({ok: false, tool: target.kind === "tool" ? target.name : target.method, status: "error", message: "no tools here"});

let nextCell = 0;
async function run(kernel: Kernel, code: string, calls: Calls = noCalls, tools: string[] = []): Promise<{end: CellEnd; text: string; images: number}> {
    const rewritten = rewriteCell(code, RESERVED);
    if (!rewritten.ok) throw new Error(rewritten.failure.message);
    let text = "";
    let images = 0;
    const end = await kernel.run({cell: ++nextCell, source: rewritten.source, tools, globals: []}, {text: (chunk) => (text += chunk), image: () => (images += 1), call: calls});
    return {end, text, images};
}

const value = (end: CellEnd): string | undefined => (end.kind === "done" && end.ok ? end.value : undefined);
const failure = (end: CellEnd): string => (end.kind === "done" && !end.ok ? `${end.error.message}\n${end.error.stack ?? ""}` : `not a failure: ${JSON.stringify(end)}`);

describe("执行与跨调用保留（eval.md 输出 1）", () => {
    test("顶层声明跨单元保留，严格模式下也是；前一个单元的函数读到后来改过的值；同名 const 可以重新声明", async () => {
        const kernel = await startKernel();
        await run(kernel, `"use strict"; const base = 1; let n = 0; function inc() { n += 1; return n + base }`);
        expect(value((await run(kernel, `"use strict"; [inc(), inc()]`)).end)).toBe("[ 2, 3 ]");
        expect(value((await run(kernel, `n = 10; inc()`)).end)).toBe("12");
        expect(value((await run(kernel, `const base = 100; inc()`)).end)).toBe("112");
        // 严格模式确实生效：给没声明的变量赋值抛错。
        expect(failure((await run(kernel, `"use strict"; undeclared = 1`)).end)).toContain("ReferenceError");
    });

    test("解构、块里的 var、for 头里的 var、class、顶层 await 与最后一个值", async () => {
        const kernel = await startKernel();
        await run(kernel, `const {a, b: [c = 3], ...rest} = {a: 1, b: [], d: 4}; if (true) { var q = 5 } for (var i = 0; i < 2; i++) {} class K { v() { return 7 } } await null;`);
        expect(value((await run(kernel, `[a, c, rest, q, i, new K().v()]`)).end)).toBe("[ 1, 3, { d: 4 }, 5, 2, 7 ]");
    });

    test("字符串的值原样显示，不加引号与转义", async () => {
        const kernel = await startKernel();
        expect(value((await run(kernel, `"第一行\\n第二行"`)).end)).toBe("第一行\n第二行");
    });
});

describe("输出（eval.md 输出 2）", () => {
    test("console 的各方法、process.stdout.write 与直接写 fd 的子进程输出都进这个单元", async () => {
        const kernel = await startKernel();
        const {text} = await run(kernel, `console.log("log", {x: 1}); console.warn("w"); console.error("e"); console.table([{k: 1}]); process.stdout.write("raw\\n"); await Bun.$\`echo from-shell\`;`);
        expect(text).toContain("log { x: 1 }");
        expect(text).toContain("[warn] w");
        expect(text).toContain("[error] e");
        expect(text).toContain("│ k │");
        expect(text).toContain("raw");
        // 直接写 fd 的输出走管道，比 IPC 的结果晚到也不丢：单元交出时已经收全。
        expect(text).toContain("from-shell");
    });
});

describe("失败（eval.md 输出 3、5）", () => {
    test("抛错交回错误与单元里的帧，不带内核自己的帧", async () => {
        const kernel = await startKernel();
        const shown = failure((await run(kernel, `function f() {\n  throw new Error("boom")\n}\nf()`)).end);
        expect(shown).toContain("Error: boom");
        expect(shown).toMatch(/cell-\d+\.js:2:/u);
        expect(shown).not.toContain("kernel-entry");
    });

    test("没 await 的调用失败后，挂在它后面的错误让单元失败，内核照常可用", async () => {
        const kernel = await startKernel();
        const calls: Calls = async () => ({ok: true, value: "fine"});
        const end = (await run(kernel, `tool.read({path: "x"}).then(() => { throw new Error("late") }); 1`, calls, ["read"])).end;
        expect(failure(end)).toContain("late");
        expect(failure(end)).toContain("await");
        expect(value((await run(kernel, `2`)).end)).toBe("2");
    });
});

describe("代码里调工具（eval.md 输出 6 到 9）", () => {
    test("tool.<名> 交回成功的值；失败抛 ToolCallError，带 status 与 code", async () => {
        const kernel = await startKernel();
        const seen: unknown[] = [];
        const calls: Calls = async (target, args) => {
            seen.push({target, args});
            return target.kind === "tool" && target.name === "read" ? {ok: true, value: "正文"} : {ok: false, tool: "write", status: "denied", code: "user-denied", message: "拒绝了"};
        };
        const {end} = await run(kernel, `const t = await tool.read({path: "a.md"}); let why; try { await tool.write({path: "b.md"}) } catch (e) { why = [e.name, e.status, e.code] } [t, why]`, calls, ["read", "write"]);
        expect(value(end)).toBe("[ '正文', [ 'ToolCallError', 'denied', 'user-denied' ] ]");
        expect(seen).toEqual([{target: {kind: "tool", name: "read"}, args: {path: "a.md"}}, {target: {kind: "tool", name: "write"}, args: {path: "b.md"}}]);
    });

    test("拼错的名字当场失败并列出能用的，不发给宿主；await tool 不会卡住", async () => {
        const kernel = await startKernel();
        let called = false;
        const calls: Calls = async () => ((called = true), {ok: true, value: null});
        const shown = failure((await run(kernel, `await tool.raed({})`, calls, ["read", "write"])).end);
        expect(shown).toContain("raed");
        expect(shown).toContain("read、write");
        expect(called).toBe(false);
        expect(value((await run(kernel, `(await tool) === tool`, calls, ["read"])).end)).toBe("true");
    });

    test("上一个单元留下的定时器在它结束之后才调，得 parent-finished，不发给宿主", async () => {
        const kernel = await startKernel();
        let called = 0;
        const calls: Calls = async () => ((called += 1), {ok: true, value: null});
        // test-lint-allow fixed-wait: 这个定时器是交给内核的代码、被测的对象（上一个单元留下的），测试等的是 `late` 这个 Promise
        await run(kernel, `globalThis.late = new Promise((done) => setTimeout(() => tool.read({}).then(() => done("ran"), (e) => done(e.code)), 200)); 1`, calls, ["read"]);
        // 下一个单元等那个定时器；它发起的调用属于已经结束的单元。
        expect(value((await run(kernel, `await late`, calls, ["read"])).end)).toBe("parent-finished");
        expect(called).toBe(0);
    });
});

describe("模块与工作目录（eval.md 输入、输出 12）", () => {
    test("顶层 import、相对路径的 import() 与 require 都按工作目录解析；改过的工作目录下一个单元复原", async () => {
        const kernel = await startKernel();
        await mkdir(join(root, "lib"), {recursive: true});
        await writeFile(join(root, "lib", "x.mjs"), "export const answer = 42;");
        await writeFile(join(root, "data.json"), JSON.stringify({ok: true}));
        expect(value((await run(kernel, `import {join} from "node:path"; const m = await import("./lib/x.mjs"); [join("a", "b"), m.answer, require("./data.json").ok]`)).end)).toBe("[ 'a/b', 42, true ]");
        await run(kernel, `process.chdir("lib")`);
        expect(value((await run(kernel, `process.cwd() === ${JSON.stringify(root)}`)).end)).toBe("true");
    });
});

describe("内核的寿命（eval.md 输出 13、15 与时序）", () => {
    test("代码里 process.exit(0) 也算意外退出，带退出码", async () => {
        const kernel = await startKernel();
        const {end} = await run(kernel, `console.log("before"); process.exit(0)`);
        expect(end.kind).toBe("exited");
        if (end.kind === "exited") {
            expect(end.exit.intentional).toBe(false);
            expect(end.exit.code).toBe(0);
        }
    });

    test("结束内核时它起的子进程一起结束", async () => {
        const kernel = await startKernel();
        const pid = Number(value((await run(kernel, `Bun.spawn(["sleep", "300"]).pid`)).end));
        const exit = await kernel.kill();
        expect(exit.intentional).toBe(true);
        await waitUntil("子进程已结束", () => (alive(pid) ? null : true));
    });

    test("服务端被杀、内核正卡在同步死循环里：内核与它的子进程随之结束", async () => {
        root = await createTestTmpRoot("neuro-book-eval-kernel", "eval watchdog");
        const host = Bun.spawn([process.execPath, "--no-env-file", join(import.meta.dir, "..", "..", "testing", "eval-orphan-host.ts"), ENTRY, root], {stdout: "pipe", stderr: "inherit"});
        let printed = "";
        void (async () => {
            for await (const chunk of host.stdout) printed += new TextDecoder().decode(chunk);
        })();
        const pids = await waitUntil("夹具打出了内核与子进程的进程号", () => {
            const kernel = /kernel (\d+)/u.exec(printed)?.[1];
            const child = /child (\d+)/u.exec(printed)?.[1];
            return kernel !== undefined && child !== undefined ? {kernel: Number(kernel), child: Number(child)} : null;
        }, {timeoutMs: 20_000});
        host.kill("SIGKILL");
        await host.exited;
        await waitUntil("内核与子进程都结束了", () => (alive(pids.kernel) || alive(pids.child) ? null : true), {timeoutMs: 10_000});
    }, 40_000);

    test("入口的协议版本不对：起不来，原因写明版本；进程已结束", async () => {
        root = await createTestTmpRoot("neuro-book-eval-kernel", "eval version");
        const started = await Kernel.start({entry: join(import.meta.dir, "..", "..", "testing", "eval-wrong-version-entry.ts"), cwd: root, env: {...(process.env as Record<string, string>)}});
        expect(started.ok).toBe(false);
        if (!started.ok) expect(started.reason).toContain("999");
    });
});

describe("内核总数（eval.md 输出 11）", () => {
    test("超过上限时回收最久没用的那个", () => {
        const registry = new KernelRegistry(2);
        const evicted: string[] = [];
        const owner = (name: string): KernelOwner => ({evict: () => evicted.push(name)});
        const [a, b, c] = [owner("a"), owner("b"), owner("c")];
        registry.touch(a);
        registry.touch(b);
        registry.touch(a);
        registry.touch(c);
        expect(evicted).toEqual(["b"]);
        expect(registry.size).toBe(2);
    });
});

function alive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}
