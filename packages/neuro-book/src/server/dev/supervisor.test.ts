/**
 * 开发监督进程的后端状态机（runtime.server-host 场景 7）：真实后端子进程（宿主测试入口与测试插件）在固定端口上
 * 重启，去抖时钟由测试驱动。每个用例要启动两三个真实后端，超出快速层 200 ms 的预算：要验证的正是进程的先后
 * 与端口的交接，换成替身就验证不到。
 */

import {afterAll, beforeAll, beforeEach, describe, expect, it} from "bun:test";
import {rm} from "node:fs/promises";
import {join, resolve} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {spawnBackend} from "./backend-process";
import {createDevSupervisor} from "./supervisor";
import type {DevEvent, DevSupervisor} from "./supervisor";

const PACKAGE_ROOT = resolve(import.meta.dir, "../../..");
const FIXTURE = join(PACKAGE_ROOT, "src/server/testing/fixture-entry.ts");

let tmp = "";
let port = 0;
/** 下一次启动的后端加载哪些测试插件：模拟“改了后端文件，新代码启动失败或会崩溃”。 */
let plugins = "";
let events: DevEvent[] = [];
const backendOutput: string[] = [];

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-dev", "dev-supervisor");
});

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

beforeEach(async () => {
    plugins = "";
    events = [];
    const probe = Bun.serve({hostname: "127.0.0.1", port: 0, fetch: () => new Response()});
    port = probe.port as number;
    await probe.stop(true);
});

/** 测试驱动的去抖时钟：只保留最近一次安排的任务，`fire()` 立即执行它。 */
function manualClock() {
    let pending: (() => void) | null = null;
    return {
        get pending() {
            return pending;
        },
        schedule(task: () => void) {
            pending = task;
            return () => {
                if (pending === task) pending = null;
            };
        },
        fire() {
            const task = pending;
            pending = null;
            task?.();
        },
    };
}

function supervisorWith(clock: ReturnType<typeof manualClock>): DevSupervisor {
    return createDevSupervisor({
        clock,
        onEvent: (event) => events.push(event),
        launch: () => spawnBackend({
            command: [process.execPath, FIXTURE, "--stop-stdin"],
            cwd: PACKAGE_ROOT,
            env: {...process.env, NBOOK_STATE_ROOT: join(tmp, "state"), NBOOK_PORT: String(port), NBOOK_WEB_ROOT: "", NBOOK_TEST_PLUGINS: plugins},
            output: (line) => backendOutput.push(line),
        }),
    });
}

const types = (): string[] => events.map((event) => event.type);
const count = (type: DevEvent["type"]): number => events.filter((event) => event.type === type).length;
const untilCount = (type: DevEvent["type"], expected: number) => waitUntil(`${type} 出现 ${String(expected)} 次`, () => count(type) >= expected, {timeoutMs: 15_000});

describe("开发监督进程：后端重启", () => {
    it("改动去抖后有序重启：旧进程经标准输入停止并以 0 退出之后，新进程才在同一端口启动", async () => {
        const clock = manualClock();
        const supervisor = supervisorWith(clock);
        supervisor.start();
        await untilCount("backend-ready", 1);
        supervisor.notifyChange("server/a.ts");
        supervisor.notifyChange("server/b.ts");
        clock.fire();
        await untilCount("backend-ready", 2);
        expect(types()).toEqual(["backend-starting", "backend-ready", "change", "change", "backend-exited", "backend-starting", "backend-ready"]);
        expect(events[4]).toMatchObject({type: "backend-exited", exitCode: 0, expected: true});
        expect(await supervisor.admit()).toBe("open");
        expect(await supervisor.stop()).toBe(0);
    }, 30_000);

    it("重启中的请求等新进程就绪；重启中的新改动不追加重启", async () => {
        const clock = manualClock();
        const supervisor = supervisorWith(clock);
        supervisor.start();
        await untilCount("backend-ready", 1);
        supervisor.notifyChange("server/a.ts");
        clock.fire();
        expect(supervisor.phase).toBe("restarting");
        const gate = supervisor.admit().then((decision) => ({decision, readyCount: count("backend-ready")}));
        supervisor.notifyChange("server/b.ts");
        clock.fire();
        expect(await gate).toEqual({decision: "open", readyCount: 2});
        expect(count("backend-starting")).toBe(2);
        expect(clock.pending).toBeNull();
        expect(await supervisor.stop()).toBe(0);
    }, 30_000);

    it("新进程启动失败：报告后等待改动，不循环重启，门直接给不可用；再次改动后恢复", async () => {
        const clock = manualClock();
        const supervisor = supervisorWith(clock);
        supervisor.start();
        await untilCount("backend-ready", 1);
        plugins = "test.fail-activate";
        supervisor.notifyChange("server/a.ts");
        clock.fire();
        await untilCount("backend-start-failed", 1);
        expect(events.find((event) => event.type === "backend-start-failed")).toMatchObject({exitCode: 1});
        expect(supervisor.phase).toBe("waiting");
        expect(clock.pending).toBeNull();
        expect(count("backend-starting")).toBe(2);
        expect(await supervisor.admit()).toBe("unavailable");

        plugins = "";
        supervisor.notifyChange("server/a.ts");
        clock.fire();
        await untilCount("backend-ready", 2);
        expect(await supervisor.admit()).toBe("open");
        expect(await supervisor.stop()).toBe(0);
    }, 30_000);

    it("后端在运行中自行退出：只报告并等待改动，不自动重启；此时结束会话，结果为 1", async () => {
        plugins = "test.throw-later";
        const supervisor = supervisorWith(manualClock());
        supervisor.start();
        await untilCount("backend-ready", 1);
        const ready = events.find((event) => event.type === "backend-ready");
        await fetch(`${ready?.type === "backend-ready" ? ready.url : ""}api/test.throw-later/throw`);
        await untilCount("backend-exited", 1);
        expect(events.at(-1)).toMatchObject({type: "backend-exited", exitCode: 1, expected: false});
        expect(supervisor.phase).toBe("waiting");
        expect(await supervisor.admit()).toBe("unavailable");
        expect(await supervisor.stop()).toBe(1);
    }, 30_000);

    it("结束会话：后端有序停止，结果为 0；之后的改动不再触发重启，门给出正在关闭", async () => {
        const clock = manualClock();
        const supervisor = supervisorWith(clock);
        supervisor.start();
        await untilCount("backend-ready", 1);
        expect(await supervisor.stop()).toBe(0);
        expect(events.at(-1)).toMatchObject({type: "backend-exited", exitCode: 0, expected: true});
        supervisor.notifyChange("server/a.ts");
        expect(clock.pending).toBeNull();
        expect(await supervisor.admit()).toBe("stopping");
        expect(supervisor.phase).toBe("stopped");
    }, 30_000);
});
