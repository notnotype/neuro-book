/**
 * 项目管理的测试支持：真实的服务端运行实例、路由与项目管理器，项目子进程跑项目宿主的测试入口；
 * 宽限期与截止用注入时钟。等的都是可观察的事（子进程转发来的输出、诊断记录、租约失效信号），不按时长等待。
 * 只由测试引用。
 */

import {mkdir} from "node:fs/promises";
import {join} from "node:path";

import {expect} from "bun:test";

import {createApplication} from "@notnotype/nb-runtime/application";
import type {Application} from "@notnotype/nb-runtime/application";
import type {DiagnosticInput} from "@notnotype/nb-runtime/diagnostics";
import {ManualClock} from "@notnotype/nb-runtime/lifecycle/testing";
import {createRemoteNode, createRemoteRouter} from "@notnotype/nb-runtime/remote";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import type {RemoteNode, RemoteRouter} from "@notnotype/nb-runtime/remote";

import {FIXTURE_READY_LINE} from "nbook/project/testing/fault-plugin";
import type {ProjectFault} from "nbook/project/testing/fault-plugin";
import {stateRootKey} from "nbook/shared/host";
import {projectsKey} from "nbook/shared/projects";
import type {ProjectAcquireResult, ProjectLease, ProjectRecord} from "nbook/shared/projects";

import {createProjectManager} from "../projects/manager";
import type {ProjectManager} from "../projects/manager";
import {createProjectRegistry} from "../projects/registry";

export const PROJECT_FIXTURE_ENTRY = join(import.meta.dir, "..", "..", "project", "testing", "fixture-entry.ts");
export const GRACE_MS = 1000;
export const START_MS = 5000;
export const STOP_MS = 5000;

let counter = 0;
/** 起过的项目子进程；用例失败也要结束它们（`killSpawnedProjects` 在 afterEach 里调用）。 */
const spawned = new Set<number>();

export function killSpawnedProjects(): void {
    for (const pid of spawned) {
        try {
            process.kill(pid, "SIGKILL");
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
        }
    }
    spawned.clear();
}

/** 一组随事件增长的记录；`until` 在已有或之后到达的某一项满足条件时完成。 */
export function observed<T>() {
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

/**
 * 项目子进程输出的去处：转进 `output`，并按就绪行登记子进程的 pid，用例没等它也能在失败后收口
 * （每个子进程激活时打印一行带 pid 的就绪行）。
 */
export function trackedProjectOutput(output: ReturnType<typeof observed<string>>): (text: string) => void {
    return (text) => {
        const pid = text.includes(FIXTURE_READY_LINE) ? /pid=(\d+)/.exec(text)?.[1] : undefined;
        if (pid !== undefined) spawned.add(Number(pid));
        output.push(text);
    };
}

/** 就绪行里的 pid。 */
export function readyPid(line: string): number {
    return Number(/pid=(\d+)/.exec(line)?.[1]);
}

export interface ProjectHarness {
    readonly clock: ManualClock;
    readonly parent: Application;
    readonly node: RemoteNode;
    readonly router: RemoteRouter;
    readonly manager: ProjectManager;
    readonly project: ProjectRecord;
    readonly output: ReturnType<typeof observed<string>>;
    readonly records: ReturnType<typeof observed<DiagnosticInput>>;
    /** 等子进程打印就绪行，返回它的 pid。 */
    ready(generation: number): Promise<number>;
}

/**
 * 在 `root` 下建一个项目目录 `Book`（短名 `book`）与状态根，起服务端实例与项目管理器。`env` 交给项目子进程
 * （故障插件、探针）；`plugins` 装进服务端实例，宿主能力与产品里一样：状态根 `stateRootKey`，以及以按调用方门面
 * 提供的 `projectsKey`。
 */
export async function projectHarness(
    root: string,
    options: {readonly fault?: ProjectFault; readonly env?: Readonly<Record<string, string>>; readonly plugins?: ReadonlyArray<PluginDefinition>} = {},
): Promise<ProjectHarness> {
    counter += 1;
    const caseRoot = join(root, `case-${String(counter)}`);
    const stateRoot = join(caseRoot, "state");
    await mkdir(join(caseRoot, "Book"), {recursive: true});
    const clock = new ManualClock();
    const registry = createProjectRegistry({stateRoot, cwd: caseRoot});
    const registered = await registry.register("Book");
    if (!registered.ok) throw new Error(registered.detail);
    const output = observed<string>();
    const records = observed<DiagnosticInput>();
    const forward = trackedProjectOutput(output);
    // 路由的回调与宿主能力都要等管理器建好，管理器又要服务端实例；内核在建立实例的同步段里就开始启动激活，
    // 所以宿主能力等管理器（与 startServer 相同）。
    let manager: ProjectManager | null = null;
    const managerReady = Promise.withResolvers<ProjectManager>();
    const node = createRemoteNode({instance: {id: "hub", kind: "server", role: "hub", project: null, client: null}, clock});
    const plugins = options.plugins ?? [];
    const parent = createApplication(
        {identity: {location: "server", instanceId: "hub"}, stopSignal: new AbortController().signal, emergency: () => undefined},
        {
            capabilities: [
                {id: "host.state-root", key: stateRootKey, create: () => Object.freeze({path: stateRoot})},
                {id: "host.projects", key: projectsKey, create: async () => (await managerReady.promise).provision()},
            ],
            plugins,
            gates: [],
            remote: node,
        },
    );
    const router = createRemoteRouter(node, {
        bindProject: (request, client) => manager!.bind(request, client),
        projectAccess: (caller, id, generation) => manager!.access(caller, id, generation),
    });
    manager = createProjectManager({
        application: parent,
        serverInstanceId: "hub",
        router,
        registry,
        stateRoot,
        cwd: caseRoot,
        entry: PROJECT_FIXTURE_ENTRY,
        graceMs: GRACE_MS,
        startMs: START_MS,
        stopMs: STOP_MS,
        clock,
        env: {...process.env, NBOOK_TEST_PROJECT_FAULT: options.fault ?? "none", ...options.env},
        record: (record) => records.push(record),
        output: {stdout: forward, stderr: forward},
    });
    managerReady.resolve(manager);
    expect(await parent.startup).toMatchObject({status: "available"});
    const project = registered.project;
    return {
        clock,
        parent,
        node,
        router,
        manager,
        project,
        output,
        records,
        ready: async (generation) => readyPid(await output.until((text) => text.includes(`${FIXTURE_READY_LINE} ${project.id}#${String(generation)} `))),
    };
}

export function leaseOf(result: ProjectAcquireResult): ProjectLease {
    if (result.status !== "acquired") throw new Error(`期望取得租约，得到 ${result.reason}：${result.detail}`);
    return result.lease;
}

export function revoked(lease: ProjectLease): Promise<void> {
    if (lease.revoked.aborted) return Promise.resolve();
    return new Promise((resolve) => lease.revoked.addEventListener("abort", () => resolve(), {once: true}));
}

/** 让排队的 Promise 回调跑完，直到条件成立（不按时长等待）；跑完仍不成立说明期待的转换不会只靠微任务发生。 */
export async function settle(condition: () => boolean): Promise<void> {
    for (let round = 0; round < 1000 && !condition(); round += 1) {
        await Promise.resolve();
    }
    expect(condition()).toBe(true);
}

export function alive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ESRCH") return false;
        throw error;
    }
}
