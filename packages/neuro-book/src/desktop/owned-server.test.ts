/**
 * 壳自己拉起的服务端（docs/specs/runtime/desktop-shell.md 输出 4 到 7、18、19、21）：真实服务端用源码的产品入口
 * `src/server/main.ts`；停止卡住、被抢先这两种情形用经产品认领档案认领的替身入口（与真实服务端对壳可观察的部分相同：认领、
 * 应答、标准输入）。
 */

import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {readFile, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {claimNeuroBook, queryNeuroBook} from "../server/instance";
import {startOwnedServer} from "./owned-server";
import type {OwnedServer} from "./owned-server";
import {rotatingLog} from "./rotating-log";

const ENTRY = join(import.meta.dir, "..", "server", "main.ts");
const INSTANCE = join(import.meta.dir, "..", "server", "instance.ts");
const SCRIPTED = join(import.meta.dir, "testing", "scripted-server.ts");
let tmp = "";
let sequence = 0;
const live = new Set<OwnedServer>();
beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-desktop", "owned-server");
});
afterEach(async () => {
    for (const server of live) await server.stop();
    live.clear();
});
afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});
const nextRoot = () => join(tmp, `state-${String((sequence += 1))}`);
/** 测试里的服务端都用系统分配的端口，免得与开发服务、别的测试撞上。 */
const ENV = {...process.env, NBOOK_PORT: "0", NBOOK_RPC_PORT: "0"};
const start = (options: Partial<Parameters<typeof startOwnedServer>[0]> & {stateRoot: string}) => {
    const server = startOwnedServer({bun: process.execPath, entry: ENTRY, webRoot: null, env: ENV, report: () => undefined, ...options});
    live.add(server);
    return server;
};
function alive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch {
        return false;
    }
}

describe("自有服务端", () => {
    it("拉起后从认领应答取地址（只认自己的 pid）；输出写进日志文件；写 stop 后有序停止、以 0 退出", async () => {
        const root = nextRoot();
        const server = start({stateRoot: root});
        const started = await server.started;
        if (started.kind !== "ready") throw new Error(JSON.stringify(started));
        expect((await fetch(new URL("/api/runtime/health", started.url))).status).toBe(200);
        const found = await queryNeuroBook(root);
        expect(found).toMatchObject({state: "running", instance: {pid: started.pid, status: "ready"}});
        expect(await server.stop()).toEqual({exitCode: 0, forced: false});
        expect((await queryNeuroBook(root)).state).toBe("none");
        expect(await readFile(join(root, "logs", "desktop", "server-output.log"), "utf8")).toContain("Listening on");
    }, 60_000);

    it("给了上一次的端口时用它们（重新启动服务）", async () => {
        const root = nextRoot();
        const first = start({stateRoot: root});
        const ready = await first.started;
        if (ready.kind !== "ready") throw new Error(JSON.stringify(ready));
        await first.stop();
        const again = start({stateRoot: root, ports: ready.ports});
        const reStarted = await again.started;
        expect(reStarted).toMatchObject({kind: "ready", ports: ready.ports});
    }, 60_000);

    it("自己的服务端被抢先认领（nbook start 先认领了）：交回 taken 与那个实例，不当作崩溃", async () => {
        const root = nextRoot();
        const other = await claimNeuroBook({stateRoot: root, kind: "product", report: () => undefined});
        if (!other.ok) throw new Error(other.reason);
        other.claim.publish({url: "http://127.0.0.1:1/", rpcUrl: "ws://127.0.0.1:2/rpc", extra: {plugins: {safeMode: false, items: []}}});
        const server = start({stateRoot: root});
        let crashed = false;
        server.onUnexpectedExit(() => (crashed = true));
        expect(await server.started).toMatchObject({kind: "taken", instance: {pid: process.pid}});
        await server.ended;
        expect(crashed).toBe(false);
        await other.claim.release();
    }, 60_000);

    it("运行中被结束：报告意外退出与退出码", async () => {
        const root = nextRoot();
        const server = start({stateRoot: root});
        const ready = await server.started;
        if (ready.kind !== "ready") throw new Error(JSON.stringify(ready));
        const exits: Array<number | null> = [];
        server.onUnexpectedExit((code) => exits.push(code));
        process.kill(ready.pid, "SIGKILL");
        await server.ended;
        await waitUntil("意外退出的回调", () => exits.length === 1);
    }, 60_000);

    it("停止卡住（不理 stop，还起了孙进程）：到截止结束整棵树，树结束后才交回，记为强制", async () => {
        const root = nextRoot();
        const entry = join(tmp, `stuck-${String(sequence)}.ts`);
        const grandchildFile = join(tmp, `grandchild-${String(sequence)}.txt`);
        await writeFile(entry, `
import {claimNeuroBook} from ${JSON.stringify(INSTANCE)};
const claimed = await claimNeuroBook({stateRoot: process.env.NBOOK_STATE_ROOT, kind: "product", report: () => {}});
if (!claimed.ok) process.exit(9);
const grandchild = Bun.spawn([process.execPath, "-e", "setInterval(() => {}, 1000)"], {stdin: "ignore", stdout: "ignore", stderr: "ignore"});
await Bun.write(${JSON.stringify(grandchildFile)}, String(grandchild.pid));
claimed.claim.publish({url: "http://127.0.0.1:1/", rpcUrl: "ws://127.0.0.1:2/rpc", extra: {plugins: {safeMode: false, items: []}}});
process.stdin.on("data", () => {});
setInterval(() => {}, 1000);
`);
        const server = start({stateRoot: root, entry, stopDeadlineMs: 1_000});
        const ready = await server.started;
        if (ready.kind !== "ready") throw new Error(JSON.stringify(ready));
        const grandchild = Number(await readFile(grandchildFile, "utf8"));
        expect(alive(grandchild)).toBe(true);
        const stopped = await server.stop();
        expect(stopped.forced).toBe(true);
        expect(alive(ready.pid)).toBe(false);
        expect(alive(grandchild)).toBe(false);
        expect((await queryNeuroBook(root)).state).toBe("none");
    }, 60_000);

    it.skipIf(process.platform === "win32")("监督进程停住、owned-process 确认不了收口：stop 不交回，强制结束 10 秒后写诊断、继续等；监督进程恢复、树真实结束后才交回", async () => {
        const root = nextRoot();
        const events: string[] = [];
        const server = start({stateRoot: root, entry: SCRIPTED, env: {...ENV, NBOOK_TEST_TARGET_STOP: "ignore"}, stopDeadlineMs: 100, report: (event) => void events.push(event)});
        const ready = await server.started;
        if (ready.kind !== "ready") throw new Error(JSON.stringify(ready));
        const {supervisor} = JSON.parse((await readFile(join(root, "targets.jsonl"), "utf8")).trim()) as {supervisor: number};
        let returned = false;
        try {
            process.kill(supervisor, "SIGSTOP");
            const stopping = server.stop().then((outcome) => {
                returned = true;
                return outcome;
            });
            await waitUntil("owned-process 报告确认不了收口", () => events.includes("desktop.server.completion-failed"), {timeoutMs: 20_000, intervalMs: 50});
            await waitUntil("强制结束 10 秒后的诊断", () => events.includes("desktop.server.forced-stop-slow"), {timeoutMs: 20_000, intervalMs: 50});
            expect(returned).toBe(false);
            expect(alive(ready.pid)).toBe(true);
            expect((await queryNeuroBook(root)).state).toBe("running");
            // 监督进程恢复后看到宿主已断开，按 host-disconnect 结束整个进程组。
            process.kill(supervisor, "SIGCONT");
            expect(await stopping).toEqual({exitCode: null, forced: true});
            expect(alive(ready.pid)).toBe(false);
            expect((await queryNeuroBook(root)).state).toBe("none");
        } finally {
            if (alive(supervisor)) process.kill(supervisor, "SIGCONT");
            if (alive(ready.pid)) process.kill(-ready.pid, "SIGKILL");
        }
    }, 60_000);
});

describe("服务端输出的日志", () => {
    it("超过上限时改名为 .1.log（覆盖旧的）后重新开始", async () => {
        const path = join(tmp, "out", "server-output.log");
        const log = rotatingLog(path, 10, () => undefined);
        log.write(Buffer.from("123456"));
        log.write(Buffer.from("7890"));
        log.write(Buffer.from("abc"));
        expect(await readFile(path, "utf8")).toBe("abc");
        expect(await readFile(join(tmp, "out", "server-output.1.log"), "utf8")).toBe("1234567890");
        // 3 + 8 超过 10：先轮转（旧的 .1.log 被覆盖），再写；之后 8 + 2 正好 10，不轮转。
        log.write(Buffer.from("defghijk"));
        log.write(Buffer.from("XY"));
        expect(await readFile(join(tmp, "out", "server-output.1.log"), "utf8")).toBe("abc");
        expect(await readFile(path, "utf8")).toBe("defghijkXY");
    });
});
