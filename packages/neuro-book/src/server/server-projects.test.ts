/**
 * 服务端宿主带项目：真实的 Bun WebSocket（RPC 端口上直接收发帧）、真实的项目子进程（项目宿主的测试入口，带探针的
 * 项目入口）。同进程的服务端用注入时钟推过宽限期；停止顺序与强制结束用真实子进程里的服务端，看它的输出与退出码。
 * 行为合同见 docs/specs/runtime/projects.md 输出第 7、9、11 条与场景 4–7、10，docs/specs/runtime/server-host.md 场景 14、15。
 */

import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {EventEmitter} from "node:events";
import {mkdir, readFile, rm} from "node:fs/promises";
import {join} from "node:path";

import {ManualClock} from "@notnotype/nb-runtime/lifecycle/testing";
import type {Subprocess} from "bun";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {PROJECT_PROBE_CLOSED_LINE} from "nbook/project/testing/probe-plugin";
import type {ProjectFault} from "nbook/project/testing/fault-plugin";
import type {ProjectRecord} from "nbook/shared/projects";
import {remoteProbeDescriptor} from "nbook/shared/testing/remote-probe-contract";

import {manifestServerPlugins} from "./plugins";
import {createProjectRegistry} from "./projects/registry";
import {startServer} from "./start";
import type {RunningServer} from "./start";
import {helloFrame, openRawRpcSocket} from "./testing/rpc-client";
import type {RawRpcSocket} from "./testing/rpc-client";
import {alive, killSpawnedProjects, observed, PROJECT_FIXTURE_ENTRY, readyPid, trackedProjectOutput} from "./testing/projects";
import {createRemoteProbePlugin, SERVER_PROBE_CLOSED_LINE} from "./testing/test-plugins";

const SERVER_FIXTURE = join(import.meta.dir, "testing", "fixture-entry.ts");
const GRACE_MS = 1000;

let tmp = "";
let counter = 0;
const servers = new Set<Subprocess>();
const inProcessServers = new Set<RunningServer>();

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-server-projects", "server-projects");
});

afterEach(async () => {
    for (const server of servers) server.kill("SIGKILL");
    servers.clear();
    for (const server of inProcessServers) {
        server.requestStop("test:cleanup");
        await server.stopped;
    }
    inProcessServers.clear();
    killSpawnedProjects();
});

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

/** 状态根与登记好的项目目录 `Book`（短名 `book`）。 */
async function prepared(): Promise<{readonly stateRoot: string; readonly project: ProjectRecord}> {
    counter += 1;
    const root = join(tmp, `case-${String(counter)}`);
    await mkdir(join(root, "Book"), {recursive: true});
    const stateRoot = join(root, "state");
    const registered = await createProjectRegistry({stateRoot, cwd: root}).register(join(root, "Book"));
    if (!registered.ok) throw new Error(registered.detail);
    return {stateRoot, project: registered.project};
}

const windowInstance = (id: string) => ({id, kind: "browser", role: "client" as const, project: null, client: "profile-1"});

interface InProcess {
    readonly server: RunningServer;
    readonly clock: ManualClock;
    readonly project: ProjectRecord;
    readonly output: ReturnType<typeof observed<string>>;
    connect(id: string, bind: Parameters<typeof helloFrame>[1]): Promise<{readonly socket: RawRpcSocket; readonly reply: Record<string, unknown>}>;
}

async function inProcess(fault: ProjectFault = "none"): Promise<InProcess> {
    const {stateRoot, project} = await prepared();
    const clock = new ManualClock();
    const output = observed<string>();
    const forward = trackedProjectOutput(output);
    const server = startServer({
        config: {host: "127.0.0.1", port: 0, stateRoot, logDirectory: join(stateRoot, "logs"), webRoot: null, stopStdin: false, rpcPort: 0, allowedOrigins: [], projects: {graceMs: GRACE_MS, startMs: 10_000, stopMs: 10_000}},
        process: new EventEmitter(),
        writeFatal: () => undefined,
        plugins: (context) => [...manifestServerPlugins(context), createRemoteProbePlugin()],
        projectEntry: PROJECT_FIXTURE_ENTRY,
        projectEnv: {...process.env, NBOOK_TEST_PLUGINS: remoteProbeDescriptor.id, NBOOK_TEST_PROJECT_FAULT: fault},
        projectOutput: {stdout: forward, stderr: forward},
        projectClock: clock,
    });
    inProcessServers.add(server);
    await server.ready;
    return {
        server,
        clock,
        project,
        output,
        connect: async (id, bind) => {
            const socket = openRawRpcSocket(server.rpcUrl);
            await socket.opened;
            socket.send(helloFrame(windowInstance(id), bind));
            return {socket, reply: await socket.next((frame) => frame.type === "welcome" || frame.type === "reject")};
        },
    };
}

/** 项目当前代次的状态（在同进程服务端上查）。 */
const stateOf = (t: InProcess) => t.server.projects.running(t.project.id)?.state ?? "stopped";

describe("Spec projects 输出 7：客户端绑定", () => {
    it("hello 带 bind：welcome 带项目代次；第二个窗口共用同一代次；未登记的项目为 project-unavailable", async () => {
        const t = await inProcess();
        const first = await t.connect("browser-1", {bind: {project: "book"}});
        expect(first.reply).toMatchObject({type: "welcome", binding: {id: t.project.id, name: "book", generation: 1}});
        const second = await t.connect("browser-2", {bind: {project: t.project.id}});
        expect(second.reply).toMatchObject({type: "welcome", binding: {generation: 1}});
        expect((await t.connect("browser-3", {bind: {project: "missing"}})).reply).toMatchObject({type: "reject", reason: "project-unavailable"});
    });

    it("宽限期内重连恢复原绑定；宽限期满后重连为 project-gone，不改投新代次", async () => {
        const t = await inProcess();
        const first = await t.connect("browser-1", {bind: {project: "book"}});
        const boot = first.reply.boot as string;
        first.socket.socket.close();
        await waitUntil("最后一个窗口离开后进入宽限期", () => stateOf(t) === "idle-grace");

        const again = await t.connect("browser-1", {bind: {project: t.project.id, generation: 1}, boot});
        expect(again.reply).toMatchObject({type: "welcome", binding: {generation: 1}});
        expect(stateOf(t)).toBe("running");
        again.socket.socket.close();
        await waitUntil("再次进入宽限期", () => stateOf(t) === "idle-grace");
        t.clock.advance(GRACE_MS);
        await waitUntil("宽限期满后项目子进程退出", () => stateOf(t) === "stopped");

        expect((await t.connect("browser-1", {bind: {project: t.project.id, generation: 1}, boot})).reply).toMatchObject({type: "reject", reason: "project-gone"});
        expect(stateOf(t)).toBe("stopped");
    });

    it("项目子进程崩溃：路由关闭绑定它的窗口链路；重连为 project-gone", async () => {
        const t = await inProcess();
        const window = await t.connect("browser-1", {bind: {project: "book"}});
        const pid = readyPid(await t.output.until((text) => text.includes("fixture ready")));

        process.kill(pid, "SIGKILL");
        await window.socket.closed;
        const reconnect = await t.connect("browser-1", {bind: {project: t.project.id, generation: 1}, boot: window.reply.boot as string | null});
        expect(reconnect.reply).toMatchObject({type: "reject", reason: "project-gone"});
    });
});

describe("Spec projects 输出 9：宽限期中不唤醒项目", () => {
    it("服务端插件不取租约调用：运行中成功；宽限期中 denied，项目仍按时关闭", async () => {
        const t = await inProcess();
        const notify = async () => (await fetch(`${t.server.url}api/${remoteProbeDescriptor.id}/project/${t.project.id}/echo`, {method: "POST"})).json() as Promise<Record<string, unknown>>;
        const window = await t.connect("browser-1", {bind: {project: "book"}});
        expect(await notify()).toMatchObject({ok: true, value: {project: {generation: 1}, caller: {instanceId: "server", plugin: remoteProbeDescriptor.id}}});

        window.socket.socket.close();
        await waitUntil("进入宽限期", () => stateOf(t) === "idle-grace");
        expect(await notify()).toMatchObject({ok: false, code: "denied"});
        expect(stateOf(t)).toBe("idle-grace");
        t.clock.advance(GRACE_MS);
        await waitUntil("宽限期满后项目子进程退出", () => stateOf(t) === "stopped");
    });
});

describe("Spec projects 输出 11：服务端停止", () => {
    it("停止开始后打开项目被拒；绑定进行中的窗口得到 project-unavailable，已取得的租约随即释放", async () => {
        const t = await inProcess("start-on-signal");
        const socket = openRawRpcSocket(t.server.rpcUrl);
        await socket.opened;
        socket.send(helloFrame(windowInstance("browser-1"), {bind: {project: "book"}}));
        const pid = readyPid(await t.output.until((text) => text.includes("fixture ready")));

        t.server.requestStop("test");
        expect(await t.server.projects.acquire("book", "late")).toMatchObject({status: "rejected", reason: "admission-closed"});
        process.kill(pid, "SIGUSR2");
        expect(await socket.next((frame) => frame.type === "welcome" || frame.type === "reject")).toMatchObject({type: "reject", reason: "project-unavailable", message: "服务端正在停止"});
        expect((await t.server.stopped).exitCode).toBe(0);
        expect(alive(pid)).toBe(false);
    });
});

interface SpawnedServer {
    readonly stdout: () => string;
    readonly stderr: () => string;
    readonly rpcUrl: Promise<string>;
    readonly exit: Promise<number | null>;
    kill(signal: NodeJS.Signals): void;
}

/** 真实子进程里的服务端（服务端的测试入口，项目子进程用项目宿主的测试入口）。 */
function spawnServer(stateRoot: string, env: Readonly<Record<string, string>>): SpawnedServer {
    const child = Bun.spawn(["bun", SERVER_FIXTURE], {
        env: {...process.env, NBOOK_STATE_ROOT: stateRoot, NBOOK_PORT: "0", NBOOK_RPC_PORT: "0", NBOOK_TEST_PLUGINS: remoteProbeDescriptor.id, ...env},
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
    });
    servers.add(child);
    let stdout = "";
    let stderr = "";
    const rpcUrl = Promise.withResolvers<string>();
    // 项目子进程的输出经服务端转发到这里：按整行交给 pid 登记，用例失败也能结束它们。
    const track = trackedProjectOutput(observed<string>());
    void (async () => {
        let pending = "";
        for await (const chunk of child.stdout.pipeThrough(new TextDecoderStream())) {
            stdout += chunk;
            const url = /RPC listening on (\S+)/u.exec(stdout);
            if (url) rpcUrl.resolve(url[1] as string);
            const lines = (pending + chunk).split("\n");
            pending = lines.pop() ?? "";
            for (const line of lines) track(line);
        }
        rpcUrl.reject(new Error(`服务端没有监听 RPC 端口；stderr：${stderr}`));
    })();
    void (async () => {
        for await (const chunk of child.stderr.pipeThrough(new TextDecoderStream())) stderr += chunk;
    })();
    return {stdout: () => stdout, stderr: () => stderr, rpcUrl: rpcUrl.promise, exit: child.exited.then(() => child.exitCode), kill: (signal) => child.kill(signal)};
}

describe("Spec server-host 场景 14、15：停止时的项目子进程", () => {
    it("SIGTERM：项目子进程先于服务端插件收口并退出，服务端以 0 退出", async () => {
        const {stateRoot} = await prepared();
        const server = spawnServer(stateRoot, {});
        const socket = openRawRpcSocket(await server.rpcUrl);
        await socket.opened;
        socket.send(helloFrame(windowInstance("browser-1"), {bind: {project: "book"}}));
        expect(await socket.next((frame) => frame.type === "welcome" || frame.type === "reject")).toMatchObject({type: "welcome", binding: {name: "book"}});

        server.kill("SIGTERM");
        expect(await server.exit).toBe(0);
        const stdout = server.stdout();
        const projectClosed = stdout.indexOf(`[project book#1] ${PROJECT_PROBE_CLOSED_LINE}`);
        expect(projectClosed).toBeGreaterThanOrEqual(0);
        expect(stdout.indexOf(SERVER_PROBE_CLOSED_LINE)).toBeGreaterThan(projectClosed);
    });

    it("项目子进程不响应停止：到 NBOOK_PROJECT_STOP_MS 强制结束，记为停止问题，服务端以 1 退出", async () => {
        const {stateRoot} = await prepared();
        const server = spawnServer(stateRoot, {NBOOK_TEST_PROJECT_FAULT: "stop-hangs", NBOOK_PROJECT_STOP_MS: "300"});
        const socket = openRawRpcSocket(await server.rpcUrl);
        await socket.opened;
        socket.send(helloFrame(windowInstance("browser-1"), {bind: {project: "book"}}));
        expect(await socket.next((frame) => frame.type === "welcome" || frame.type === "reject")).toMatchObject({type: "welcome"});

        server.kill("SIGTERM");
        expect(await server.exit).toBe(1);
        const log = (await readFile(join(stateRoot, "logs", "server-current.jsonl"), "utf8")).split("\n").filter(Boolean).map((line) => JSON.parse(line) as {event: string});
        expect(log.map((record) => record.event)).toContain("project.stop.forced");
        expect(server.stderr()).toContain("runtime.stop.incomplete");
    });
});
