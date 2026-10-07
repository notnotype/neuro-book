/**
 * 项目管理器：真实的项目子进程（项目宿主的测试入口）、真实的服务端运行实例与路由；宽限期与截止用注入时钟。
 * 等的都是可观察的事：子进程转发来的输出、诊断记录、租约失效信号，不按时长等待。
 * 行为合同见 docs/specs/runtime/projects.md 输出第 3–6、11 条与场景 2、5、6、9。
 */

import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {mkdir, rm} from "node:fs/promises";
import {join} from "node:path";

import {createApplication} from "@notnotype/nb-runtime/application";
import type {Application} from "@notnotype/nb-runtime/application";
import type {DiagnosticInput} from "@notnotype/nb-runtime/diagnostics";
import {ManualClock} from "@notnotype/nb-runtime/lifecycle/testing";
import {createRemoteNode, createRemoteRouter} from "@notnotype/nb-runtime/remote";
import type {RemoteRouter} from "@notnotype/nb-runtime/remote";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {FIXTURE_READY_LINE} from "nbook/project/testing/fault-plugin";
import type {ProjectFault} from "nbook/project/testing/fault-plugin";
import type {ProjectRecord} from "nbook/shared/projects";

import {createProjectManager} from "./manager";
import type {ProjectAcquireResult, ProjectLease, ProjectManager} from "./manager";
import {createProjectRegistry} from "./registry";

const FIXTURE_ENTRY = join(import.meta.dir, "..", "..", "project", "testing", "fixture-entry.ts");
const GRACE_MS = 1000;
const START_MS = 5000;
const STOP_MS = 5000;

let tmp = "";
let counter = 0;
/** 本文件起过的子进程；用例失败也要结束它们。 */
const spawned = new Set<number>();

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-projects", "project-manager");
});

afterEach(() => {
    for (const pid of spawned) {
        try {
            process.kill(pid, "SIGKILL");
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
        }
    }
    spawned.clear();
});

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

/** 一组随事件增长的记录；`until` 在已有或之后到达的某一项满足条件时完成。 */
function observed<T>() {
    const items: T[] = [];
    const waiters = new Set<{readonly match: (item: T) => boolean; readonly resolve: (item: T) => void}>();
    return {
        items,
        push(item: T): void {
            items.push(item);
            for (const waiter of [...waiters]) {
                if (waiter.match(item)) {
                    waiters.delete(waiter);
                    waiter.resolve(item);
                }
            }
        },
        until(match: (item: T) => boolean): Promise<T> {
            const found = items.find(match);
            if (found !== undefined) return Promise.resolve(found);
            const {promise, resolve} = Promise.withResolvers<T>();
            waiters.add({match, resolve});
            return promise;
        },
    };
}

interface Harness {
    readonly clock: ManualClock;
    readonly parent: Application;
    readonly router: RemoteRouter;
    readonly manager: ProjectManager;
    readonly project: ProjectRecord;
    readonly output: ReturnType<typeof observed<string>>;
    readonly records: ReturnType<typeof observed<DiagnosticInput>>;
    /** 等子进程打印就绪行，返回它的 pid。 */
    ready(generation: number): Promise<number>;
}

async function harness(fault: ProjectFault = "none"): Promise<Harness> {
    counter += 1;
    const root = join(tmp, `case-${String(counter)}`);
    const stateRoot = join(root, "state");
    await mkdir(join(root, "Book"), {recursive: true});
    const clock = new ManualClock();
    const node = createRemoteNode({instance: {id: "hub", kind: "server", role: "hub", project: null, client: null}});
    const parent = createApplication(
        {identity: {location: "server", instanceId: "hub"}, stopSignal: new AbortController().signal, emergency: () => undefined},
        {keys: [], plugins: [], gates: [], remote: node},
    );
    expect(await parent.startup).toMatchObject({status: "available"});
    const router = createRemoteRouter(node);
    const registry = createProjectRegistry({stateRoot, cwd: root});
    const registered = await registry.register("Book");
    if (!registered.ok) throw new Error(registered.detail);
    const output = observed<string>();
    const records = observed<DiagnosticInput>();
    const manager = createProjectManager({
        application: parent,
        router,
        registry,
        stateRoot,
        cwd: root,
        entry: FIXTURE_ENTRY,
        graceMs: GRACE_MS,
        startMs: START_MS,
        stopMs: STOP_MS,
        clock,
        env: {...process.env, NBOOK_TEST_PROJECT_FAULT: fault},
        record: (record) => records.push(record),
        output: {stdout: (text) => output.push(text), stderr: (text) => output.push(text)},
    });
    const project = registered.project;
    return {
        clock,
        parent,
        router,
        manager,
        project,
        output,
        records,
        ready: async (generation) => {
            const line = await output.until((text) => text.includes(`${FIXTURE_READY_LINE} ${project.id}#${String(generation)} `));
            const pid = Number(/pid=(\d+)/.exec(line)?.[1]);
            spawned.add(pid);
            return pid;
        },
    };
}

function leaseOf(result: ProjectAcquireResult): ProjectLease {
    if (result.status !== "acquired") throw new Error(`期望取得租约，得到 ${result.reason}：${result.detail}`);
    return result.lease;
}

function revoked(lease: ProjectLease): Promise<void> {
    if (lease.revoked.aborted) return Promise.resolve();
    return new Promise((resolve) => lease.revoked.addEventListener("abort", () => resolve(), {once: true}));
}

/** 让排队的 Promise 回调跑完，直到条件成立（不按时长等待）；跑完仍不成立说明期待的转换不会只靠微任务发生。 */
async function settle(condition: () => boolean): Promise<void> {
    for (let round = 0; round < 1000 && !condition(); round += 1) {
        await Promise.resolve();
    }
    expect(condition()).toBe(true);
}

function alive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
        throw error;
    }
}

describe("Spec projects 输出 3、4：打开项目", () => {
    it("按短名打开：起子进程、链路进路由、项目实例读到当前项目，输出带前缀转发；同时到达的请求共用一代", async () => {
        const h = await harness();
        const [first, second] = await Promise.all([h.manager.acquire("book", "window-1"), h.manager.acquire(h.project.id, "window-2")]);
        const lease = leaseOf(first);
        expect(lease).toMatchObject({id: h.project.id, name: "book", generation: 1});
        expect(leaseOf(second).generation).toBe(1);

        const pid = await h.ready(1);
        expect(alive(pid)).toBe(true);
        const line = h.output.items.find((text) => text.includes(FIXTURE_READY_LINE))!;
        expect(line.startsWith("[project book#1] ")).toBe(true);
        expect(line).toContain(h.project.path);
        expect(h.router.instances().map((instance) => instance.id)).toContain(`project:${h.project.id}#1`);
        expect(await h.manager.list()).toEqual({ok: true, value: [{...h.project, state: "running", generation: 1, pid}]});
    });

    it("未登记的引用为 unknown-project，不起子进程", async () => {
        const h = await harness();
        expect(await h.manager.acquire("nope", "window-1")).toMatchObject({status: "rejected", reason: "unknown-project"});
        expect(h.manager.running(h.project.id)).toBeNull();
    });
});

describe("Spec projects 输出 5、6：关闭与崩溃", () => {
    it("最后一个租约释放后进入宽限期；宽限期满子进程真实退出（退出码 0）；再打开得到新代次", async () => {
        const h = await harness();
        const lease = leaseOf(await h.manager.acquire("book", "window-1"));
        const pid = await h.ready(1);

        lease.release();
        expect(h.manager.running(h.project.id)).toEqual({generation: 1, state: "idle-grace"});
        h.clock.advance(GRACE_MS);
        await revoked(lease);
        expect(alive(pid)).toBe(false);
        expect(h.manager.running(h.project.id)).toBeNull();
        expect(h.records.items.map((record) => record.event)).not.toContain("project.stop.incomplete");

        expect(leaseOf(await h.manager.acquire("book", "window-1")).generation).toBe(2);
        expect(await h.ready(2)).not.toBe(pid);
    });

    it("宽限期中按代次取得：取消关闭；这一代结束后按代次取得为 generation-gone，不起新子进程", async () => {
        const h = await harness();
        const lease = leaseOf(await h.manager.acquire("book", "window-1"));
        await h.ready(1);
        lease.release();

        const resumed = leaseOf(await h.manager.acquire(h.project.id, "window-1", {generation: 1}));
        h.clock.advance(GRACE_MS);
        expect(h.manager.running(h.project.id)).toEqual({generation: 1, state: "running"});

        resumed.release();
        h.clock.advance(GRACE_MS);
        await revoked(resumed);
        expect(await h.manager.acquire(h.project.id, "window-1", {generation: 1})).toMatchObject({status: "rejected", reason: "generation-gone"});
        expect(h.manager.running(h.project.id)).toBeNull();
    });

    it("子进程意外退出：这一代立即结束、租约失效、链路离开路由；退出信号写进诊断；不自动重启", async () => {
        const h = await harness();
        const lease = leaseOf(await h.manager.acquire("book", "window-1"));
        const pid = await h.ready(1);

        process.kill(pid, "SIGKILL");
        await revoked(lease);
        const exited = await h.records.until((record) => record.event === "project.exited");
        expect(exited.data).toMatchObject({project: h.project.id, generation: 1, signal: "SIGKILL"});
        expect(h.manager.running(h.project.id)).toBeNull();
        expect(h.router.instances().map((instance) => instance.id)).not.toContain(`project:${h.project.id}#1`);
    });
});

describe("Spec projects 场景 9：启动与停止的收口", () => {
    it("启动截止到达：强制结束子进程，得到 create-failed", async () => {
        const h = await harness("hang-start");
        const pending = h.manager.acquire("book", "window-1");
        const pid = await h.ready(1);

        h.clock.advance(START_MS);
        expect(await pending).toMatchObject({status: "rejected", reason: "create-failed", detail: expect.stringContaining("没有报告启动结果")});
        expect(alive(pid)).toBe(false);
        expect(h.manager.running(h.project.id)).toBeNull();
    });

    it("启动中退出：create-failed 带退出码", async () => {
        const h = await harness("exit-during-start");
        expect(await h.manager.acquire("book", "window-1")).toMatchObject({status: "rejected", reason: "create-failed", detail: expect.stringContaining("退出码 3")});
        expect(alive(await h.ready(1))).toBe(false);
    });

    it("实例启动失败：子进程报告原因并退出，得到 create-failed", async () => {
        const h = await harness("startup-failure");
        expect(await h.manager.acquire("book", "window-1")).toMatchObject({status: "rejected", reason: "create-failed", detail: expect.stringContaining("test.project-fault/main")});
        expect(alive(await h.ready(1))).toBe(false);
    });

    it("停止时收口出错：子进程以非 0 退出，照常结束这一代并写 project.stop.incomplete", async () => {
        const h = await harness("stop-fails");
        const lease = leaseOf(await h.manager.acquire("book", "window-1"));
        await h.ready(1);
        lease.release();
        h.clock.advance(GRACE_MS);
        await revoked(lease);

        expect(h.records.items.find((record) => record.event === "project.stop.incomplete")?.data).toMatchObject({generation: 1, exitCode: 1});
        expect(h.manager.shutdownProblems()).toEqual([]);
    });

    it("停止不响应：到停止截止强制结束，记为外部终止", async () => {
        const h = await harness("stop-hangs");
        const lease = leaseOf(await h.manager.acquire("book", "window-1"));
        const pid = await h.ready(1);
        lease.release();
        h.clock.advance(GRACE_MS);
        h.clock.advance(STOP_MS);
        await revoked(lease);

        expect(alive(pid)).toBe(false);
        expect(h.records.items.map((record) => record.event)).toContain("project.stop.forced");
    });
});

describe("Spec projects 输出 11：服务端停止", () => {
    it("关闭接纳后打开被拒；取得期间关闭的，租约立即释放、得到 admission-closed", async () => {
        const h = await harness();
        const pending = h.manager.acquire("book", "window-1");
        await h.ready(1);
        h.manager.stopAdmission();

        expect(await pending).toMatchObject({status: "rejected", reason: "admission-closed"});
        expect(h.manager.running(h.project.id)).toEqual({generation: 1, state: "idle-grace"});
        expect(await h.manager.acquire("book", "window-2")).toMatchObject({status: "rejected", reason: "admission-closed"});
    });

    it("父实例停止：先停完项目子进程（退出码 0）；停止中被强制结束的记为停止问题", async () => {
        const h = await harness();
        const lease = leaseOf(await h.manager.acquire("book", "window-1"));
        const pid = await h.ready(1);
        h.manager.stopAdmission();

        expect(await h.parent.stop()).toMatchObject({status: "closed"});
        expect(lease.revoked.aborted).toBe(true);
        expect(alive(pid)).toBe(false);
        expect(h.manager.shutdownProblems()).toEqual([]);

        const stuck = await harness("stop-hangs");
        leaseOf(await stuck.manager.acquire("book", "window-1"));
        await stuck.ready(1);
        stuck.manager.stopAdmission();
        const stopping = stuck.parent.stop();
        // 停止截止在这一代进入 stopping 时才开始计时。
        await settle(() => stuck.manager.running(stuck.project.id)?.state === "stopping");
        stuck.clock.advance(STOP_MS);
        await stopping;
        expect(stuck.manager.shutdownProblems()).toEqual([expect.stringContaining("book#1 被强制结束")]);
    });
});
