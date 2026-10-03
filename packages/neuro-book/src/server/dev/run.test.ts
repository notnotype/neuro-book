/**
 * 开发会话的真实子进程验收（runtime.server-host 场景 7、8）：Vite 页面服务、代理、前置门、文件监视与信号处理
 * 一起运行；后端是宿主测试入口，可加载测试插件。每个用例要起 Vite 与真实后端，超出快速层 200 ms 的预算：
 * 要验证的是进程之间的停止顺序与退出码，只有真实进程能给出。
 */

import {afterAll, beforeAll, describe, expect, it} from "bun:test";
import {mkdir, rm, writeFile} from "node:fs/promises";
import {join, resolve} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

const PACKAGE_ROOT = resolve(import.meta.dir, "../../..");
const FIXTURE = join(PACKAGE_ROOT, "src/server/dev/testing/fixture-dev.ts");

let tmp = "";
let sequence = 0;

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-dev", "dev-run");
});

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

interface DevSession {
    readonly watchRoot: string;
    readonly exit: Promise<number | null>;
    /** 监督进程输出中以 `[dev]` 开头的行，按出现顺序。 */
    devLines(): string[];
    waitFor(pattern: RegExp): Promise<RegExpExecArray>;
    signal(name: NodeJS.Signals): void;
}

async function startDev(env: Record<string, string> = {}): Promise<DevSession> {
    sequence += 1;
    const base = join(tmp, `session-${String(sequence)}`);
    const watchRoot = join(base, "watch");
    await mkdir(watchRoot, {recursive: true});
    const child = Bun.spawn([process.execPath, FIXTURE], {
        cwd: PACKAGE_ROOT,
        env: {...process.env, NBOOK_DEV_PORT: "0", NBOOK_DEV_BACKEND_PORT: "0", NBOOK_STATE_ROOT: join(base, "state"), NBOOK_TEST_WATCH_ROOT: watchRoot, NBOOK_TEST_PLUGINS: "", ...env},
        stdout: "pipe",
        stderr: "pipe",
    });
    let output = "";
    for (const stream of [child.stdout, child.stderr]) {
        void (async () => {
            for await (const chunk of stream.pipeThrough(new TextDecoderStream())) output += chunk;
        })();
    }
    return {
        watchRoot,
        exit: child.exited.then(() => child.exitCode),
        devLines: () => output.split("\n").filter((line) => line.startsWith("[dev]")),
        waitFor: (pattern) => waitUntil(`监督进程输出 ${String(pattern)}`, () => pattern.exec(output), {timeoutMs: 15_000}),
        signal: (name) => child.kill(name),
    };
}

/** `[dev]` 行里各事件第一次出现的位置，用于断言先后。 */
function order(lines: string[], ...events: string[]): number[] {
    return events.map((event) => lines.findIndex((line) => line.startsWith(`[dev] ${event}`)));
}

describe("开发会话（真实子进程）", () => {
    it("页面经 Vite 提供、API 经代理；改后端文件有序重启；SIGTERM 时先停后端再关页面，以 0 退出", async () => {
        const dev = await startDev();
        const page = (await dev.waitFor(/page-ready (\S+)/u))[1] as string;
        await dev.waitFor(/backend-ready/u);
        expect(await (await fetch(page)).text()).toContain("/@vite/client");
        expect((await fetch(`${page}api/runtime/health`)).status).toBe(200);

        await writeFile(join(dev.watchRoot, "plugin.ts"), "export {};\n");
        await dev.waitFor(/backend-ready[\s\S]*backend-ready/u);
        expect((await fetch(`${page}api/runtime/health`)).status).toBe(200);

        dev.signal("SIGTERM");
        expect(await dev.exit).toBe(0);
        const lines = dev.devLines();
        const [stopping, exited, stopped, closed] = order(lines.slice(lines.findIndex((line) => line.startsWith("[dev] stopping"))), "stopping", "backend-exited", "backend-stopped", "page-closed");
        expect([stopping, exited, stopped, closed]).toEqual([0, 1, 2, 3]);
        expect(lines.filter((line) => line.startsWith("[dev] backend-exited")).every((line) => line.includes("exit=0"))).toBe(true);
    }, 30_000);

    it("终端 Ctrl+C（监督进程与后端同时收到 SIGINT）：两个停止请求汇合，仍有序结束，以 0 退出", async () => {
        const dev = await startDev();
        const backendPid = Number((await dev.waitFor(/backend-ready pid=(\d+)/u))[1]);
        process.kill(backendPid, "SIGINT");
        dev.signal("SIGINT");
        expect(await dev.exit).toBe(0);
        expect(dev.devLines().some((line) => line.startsWith(`[dev] backend-exited pid=${String(backendPid)} exit=0`))).toBe(true);
    }, 30_000);

    it("第二个停止信号不等排空：在途请求拖住排空时直接结束后端，以 1 退出", async () => {
        const dev = await startDev({NBOOK_TEST_PLUGINS: "test.slow"});
        const page = (await dev.waitFor(/page-ready (\S+)/u))[1] as string;
        await dev.waitFor(/backend-ready/u);
        const held = await fetch(`${page}api/test.slow/hold`);
        expect(held.status).toBe(200);
        const heldBody = held.text().catch(() => "cut");
        dev.signal("SIGTERM");
        await dev.waitFor(/\[dev\] stopping/u);
        dev.signal("SIGTERM");
        expect(await dev.exit).toBe(1);
        expect(dev.devLines().some((line) => line.startsWith("[dev] force"))).toBe(true);
        expect(await heldBody).toBe("cut");
    }, 30_000);

    it("页面端口被占用：以 1 退出，不启动后端", async () => {
        const occupant = Bun.serve({hostname: "127.0.0.1", port: 0, fetch: () => new Response()});
        try {
            const dev = await startDev({NBOOK_DEV_PORT: String(occupant.port)});
            expect(await dev.exit).toBe(1);
            expect(dev.devLines().some((line) => line.startsWith("[dev] page-failed"))).toBe(true);
            expect(dev.devLines().some((line) => line.startsWith("[dev] backend-starting"))).toBe(false);
        } finally {
            await occupant.stop(true);
        }
    }, 30_000);
});
