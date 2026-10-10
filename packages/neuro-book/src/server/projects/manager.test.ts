/**
 * 项目管理器：真实的项目子进程（项目宿主的测试入口）、真实的服务端运行实例与路由；宽限期与截止用注入时钟
 * （测试支持见 `../testing/projects.ts`）。
 * 行为合同见 docs/specs/runtime/projects.md 输出第 3–6、11、15 条与场景 2、5、6、9、15。
 */

import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {rm} from "node:fs/promises";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {FIXTURE_READY_LINE} from "nbook/project/testing/fault-plugin";
import type {ProjectAcquireResult, ProjectUnregisterResult} from "nbook/shared/projects";

import {alive, GRACE_MS, killSpawnedProjects, leaseOf, projectHarness, revoked, settle, START_MS, STOP_MS} from "../testing/projects";
import type {ProjectHarness} from "../testing/projects";
import {readProjectIdentity} from "./identity";

let tmp = "";

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-projects", "project-manager");
});

afterEach(() => {
    killSpawnedProjects();
});

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

describe("Spec projects 输出 3、4：打开项目", () => {
    it("按短名打开：起子进程、链路进路由、项目实例读到当前项目，输出带前缀转发；同时到达的请求共用一代", async () => {
        const h = await projectHarness(tmp);
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
        const h = await projectHarness(tmp);
        expect(await h.manager.acquire("nope", "window-1")).toMatchObject({status: "rejected", reason: "unknown-project"});
        expect(h.manager.running(h.project.id)).toBeNull();
    });
});

describe("Spec projects 输出 5、6：关闭与崩溃", () => {
    it("最后一个租约释放后进入宽限期；宽限期满子进程真实退出（退出码 0）；再打开得到新代次", async () => {
        const h = await projectHarness(tmp);
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
        const h = await projectHarness(tmp);
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
        const h = await projectHarness(tmp);
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
        const h = await projectHarness(tmp, {fault: "hang-start"});
        const pending = h.manager.acquire("book", "window-1");
        const pid = await h.ready(1);

        h.clock.advance(START_MS);
        expect(await pending).toMatchObject({status: "rejected", reason: "create-failed", detail: expect.stringContaining("没有报告启动结果")});
        expect(alive(pid)).toBe(false);
        expect(h.manager.running(h.project.id)).toBeNull();
    });

    it("启动中退出：create-failed 带退出码", async () => {
        const h = await projectHarness(tmp, {fault: "exit-during-start"});
        expect(await h.manager.acquire("book", "window-1")).toMatchObject({status: "rejected", reason: "create-failed", detail: expect.stringContaining("退出码 3")});
        expect(alive(await h.ready(1))).toBe(false);
    });

    it("实例启动失败：子进程报告原因并退出，得到 create-failed", async () => {
        const h = await projectHarness(tmp, {fault: "startup-failure"});
        expect(await h.manager.acquire("book", "window-1")).toMatchObject({status: "rejected", reason: "create-failed", detail: expect.stringContaining("test.project-fault/main")});
        expect(alive(await h.ready(1))).toBe(false);
    });

    it("停止时收口出错：子进程以非 0 退出，照常结束这一代并写 project.stop.incomplete", async () => {
        const h = await projectHarness(tmp, {fault: "stop-fails"});
        const lease = leaseOf(await h.manager.acquire("book", "window-1"));
        await h.ready(1);
        lease.release();
        h.clock.advance(GRACE_MS);
        await revoked(lease);

        expect(h.records.items.find((record) => record.event === "project.stop.incomplete")?.data).toMatchObject({generation: 1, exitCode: 1});
        expect(h.manager.shutdownProblems()).toEqual([]);
    });

    it("停止不响应：到停止截止强制结束，记为外部终止", async () => {
        const h = await projectHarness(tmp, {fault: "stop-hangs"});
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
        const h = await projectHarness(tmp);
        const pending = h.manager.acquire("book", "window-1");
        await h.ready(1);
        h.manager.stopAdmission();

        expect(await pending).toMatchObject({status: "rejected", reason: "admission-closed"});
        expect(h.manager.running(h.project.id)).toEqual({generation: 1, state: "idle-grace"});
        expect(await h.manager.acquire("book", "window-2")).toMatchObject({status: "rejected", reason: "admission-closed"});
    });

    it("父实例停止：先停完项目子进程（退出码 0）；停止中被强制结束的记为停止问题", async () => {
        const h = await projectHarness(tmp);
        const lease = leaseOf(await h.manager.acquire("book", "window-1"));
        const pid = await h.ready(1);
        h.manager.stopAdmission();

        expect(await h.parent.stop()).toMatchObject({status: "closed"});
        expect(lease.revoked.aborted).toBe(true);
        expect(alive(pid)).toBe(false);
        expect(h.manager.shutdownProblems()).toEqual([]);

        const stuck = await projectHarness(tmp, {fault: "stop-hangs"});
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

describe("Spec projects 输出 15：移出书架与打开串行", () => {
    it("running、idle-grace、stopping 的项目被拒为 project-running（带状态）；结束后移出成功，登记表少一项、目录不动，再打开为 unknown-project", async () => {
        const h = await projectHarness(tmp, {fault: "stop-hangs"});
        const lease = leaseOf(await h.manager.acquire("book", "window-1"));
        await h.ready(1);
        expect(await h.manager.unregister(h.project.id)).toEqual({ok: false, reason: "project-running", state: "running", detail: expect.any(String)});

        lease.release();
        expect(await h.manager.unregister(h.project.id)).toMatchObject({ok: false, reason: "project-running", state: "idle-grace"});
        h.clock.advance(GRACE_MS);
        await settle(() => h.manager.running(h.project.id)?.state === "stopping");
        expect(await h.manager.unregister(h.project.id)).toMatchObject({ok: false, reason: "project-running", state: "stopping"});
        h.clock.advance(STOP_MS);
        await revoked(lease);

        expect(await h.manager.unregister(h.project.id)).toEqual({ok: true, project: h.project});
        expect(await h.manager.list()).toEqual({ok: true, value: []});
        expect(await readProjectIdentity(h.project.path)).toMatchObject({status: "found", id: h.project.id});
        expect(await h.manager.acquire("book", "window-1")).toMatchObject({status: "rejected", reason: "unknown-project"});
        expect(await h.manager.unregister(h.project.id)).toMatchObject({ok: false, reason: "unknown-project"});
    });

    it("先打开：启动中的项目移出被拒，打开照常完成，登记表还有它", async () => {
        const h = await projectHarness(tmp);
        const opening = h.manager.acquire("book", "window-1");
        await waitUntil("项目进入启动", () => h.manager.running(h.project.id) !== null);

        expect(await h.manager.unregister(h.project.id)).toMatchObject({ok: false, reason: "project-running", state: expect.stringMatching(/^(starting|running)$/)});
        expect(leaseOf(await opening).generation).toBe(1);
        expect(await h.manager.registry.resolve(h.project.id)).toEqual({ok: true, value: h.project});
    });

    /** 两者都结算后：要么先打开（移出被拒、登记还在），要么先移出（打开为 unknown-project、没有起子进程），没有半状态。 */
    async function expectNoHalfState(h: ProjectHarness, opened: ProjectAcquireResult, removed: ProjectUnregisterResult): Promise<void> {
        const registered = await h.manager.registry.resolve(h.project.id);
        if (opened.status === "acquired") {
            expect(removed).toMatchObject({ok: false, reason: "project-running"});
            expect(registered).toEqual({ok: true, value: h.project});
            opened.lease.release();
        } else {
            expect(opened).toMatchObject({status: "rejected", reason: "unknown-project"});
            expect(removed).toEqual({ok: true, project: h.project});
            expect(registered).toEqual({ok: true, value: null});
            expect(h.manager.running(h.project.id)).toBeNull();
        }
    }

    it("移出与打开同时发出（两种先后、按短名与按 id）：没有“写表中被打开”或“打开中被移出”的半状态", async () => {
        for (const [order, reference] of [["unregister-first", "book"], ["acquire-first", "book"], ["unregister-first", "id"], ["acquire-first", "id"]] as const) {
            const h = await projectHarness(tmp);
            const target = reference === "id" ? h.project.id : "book";
            const [opened, removed] = order === "acquire-first"
                ? await Promise.all([h.manager.acquire(target, "window-1"), h.manager.unregister(h.project.id)])
                : await Promise.all([h.manager.unregister(h.project.id), h.manager.acquire(target, "window-1")]).then(([second, first]) => [first, second] as const);
            await expectNoHalfState(h, opened, removed);
        }
    });
});
