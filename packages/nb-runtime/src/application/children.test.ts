import {describe, expect, it} from "bun:test";

import {Type} from "typebox";

import {ManualClock} from "../lifecycle/testing/manual-clock";
import type {ActivationContext, PluginDefinition} from "../plugins/plugins";
import {createRemoteNode, createRemoteRouter, defineRemoteService, provideRemote} from "../remote/remote";
import type {InstanceDescriptor, RemoteNode} from "../remote/remote";
import {createLinkPair} from "../remote/testing/in-process";
import type {RemoteLink} from "../remote/transport";
import {defineServiceKey} from "../services/services";

import {createApplication, createChildInstances} from "./application";
import type {AcquireChildResult, Application, ApplicationManifest, ChildInstancesOptions, ChildLease} from "./application";

const GRACE_MS = 1000;
const STOP_DEADLINE_MS = 5000;

async function parentApplication(manifest: Partial<ApplicationManifest> = {}): Promise<Application> {
    const app = createApplication(
        {identity: {location: "server", instanceId: "hub"}, stopSignal: new AbortController().signal, emergency: () => undefined},
        {keys: [], plugins: [], gates: [], ...manifest},
    );
    expect(await app.startup).toMatchObject({status: "available"});
    return app;
}

/**
 * 受控宿主：创建与停止的结果由测试决定；`manual` 为 false 时立即成功。`events` 记录宿主观察到的调用。
 * 句柄是 `键#代次` 字符串。
 */
function controlledHost(clock: ManualClock, manual: {readonly create?: boolean; readonly stop?: boolean} = {}) {
    const events: string[] = [];
    const creations: Array<PromiseWithResolvers<string>> = [];
    const stops: Array<{readonly handle: string; readonly signal: AbortSignal; readonly settle: PromiseWithResolvers<"closed" | "forced">}> = [];
    const options: ChildInstancesOptions<string> = {
        create: (key, generation) => {
            events.push(`create:${key}#${generation}`);
            const settle = Promise.withResolvers<string>();
            creations.push(settle);
            if (manual.create !== true) {
                settle.resolve(`${key}#${generation}`);
            }
            return settle.promise;
        },
        stop: (handle, {signal}) => {
            events.push(`stop:${handle}`);
            const settle = Promise.withResolvers<"closed" | "forced">();
            stops.push({handle, signal, settle});
            if (manual.stop !== true) {
                settle.resolve("closed");
            }
            return settle.promise;
        },
        graceMs: GRACE_MS,
        stopDeadlineMs: STOP_DEADLINE_MS,
        clock,
    };
    return {events, creations, stops, options};
}

function leaseOf(result: AcquireChildResult): ChildLease {
    if (result.status !== "acquired") {
        throw new Error(`期望取得租约，得到 ${result.reason}`);
    }
    return result.lease;
}

/** 让已排队的 Promise 回调跑完（不按时间等待）。 */
async function drain(rounds = 20): Promise<void> {
    for (let index = 0; index < rounds; index += 1) {
        await Promise.resolve();
    }
}

describe("Spec application 子实例与租约：状态表", () => {
    it("首个 acquire 创建新代次；创建中到达的 acquire 随创建结果一起取得同一代次的租约", async () => {
        const clock = new ManualClock();
        const host = controlledHost(clock, {create: true});
        const children = createChildInstances(await parentApplication(), host.options);

        const first = children.acquire("P", "a");
        const second = children.acquire("P", "b");
        await drain();
        expect(children.state("P")).toMatchObject({generation: 1, state: "creating"});
        expect(host.events).toEqual(["create:P#1"]);

        host.creations[0]!.resolve("P#1");
        expect(leaseOf(await first)).toMatchObject({key: "P", generation: 1, holder: "a"});
        expect(leaseOf(await second)).toMatchObject({key: "P", generation: 1, holder: "b"});
        expect(children.state("P")).toEqual({key: "P", generation: 1, state: "available", leases: 2, abnormal: null});
    });

    it("创建失败：这一代 terminated，等待者都得到 create-failed 与原因；再次 acquire 以新代次创建", async () => {
        const clock = new ManualClock();
        const host = controlledHost(clock, {create: true});
        const children = createChildInstances(await parentApplication(), host.options);

        const waiting = [children.acquire("P", "a"), children.acquire("P", "b")];
        await drain();
        host.creations[0]!.reject(new Error("目录不可读"));

        for (const result of await Promise.all(waiting)) {
            expect(result).toEqual({status: "rejected", reason: "create-failed", detail: "目录不可读"});
        }
        expect(children.state("P")).toMatchObject({generation: 1, state: "terminated"});
        expect(children.diagnostics()).toMatchObject([{key: "P", generation: 1, reason: "create-failed", detail: "目录不可读"}]);

        const retry = children.acquire("P", "a");
        await drain();
        host.creations[1]!.resolve("P#2");
        expect(leaseOf(await retry).generation).toBe(2);
    });

    it("最后一个租约释放进入 idle-grace；宽限期满进入 stopping 并调用宿主停止；退出后 terminated、租约失效", async () => {
        const clock = new ManualClock();
        const host = controlledHost(clock, {stop: true});
        const children = createChildInstances(await parentApplication(), host.options);
        const a = leaseOf(await children.acquire("P", "a"));
        const b = leaseOf(await children.acquire("P", "b"));

        a.release();
        expect(children.state("P")).toMatchObject({state: "available", leases: 1});
        b.release();
        b.release();
        expect(children.state("P")).toMatchObject({state: "idle-grace", leases: 0});

        clock.advance(GRACE_MS - 1);
        expect(children.state("P")?.state).toBe("idle-grace");
        clock.advance(1);
        expect(children.state("P")?.state).toBe("stopping");
        expect(host.events).toEqual(["create:P#1", "stop:P#1"]);

        host.stops[0]!.settle.resolve("closed");
        await drain();
        expect(children.state("P")).toEqual({key: "P", generation: 1, state: "terminated", leases: 0, abnormal: null});
        expect(a.revoked.aborted).toBe(true);
        expect(children.diagnostics()).toEqual([]);
    });

    it("宽限期内新 acquire 取消关闭：回到 available、沿用同一代次；再次释放时宽限期重新计满", async () => {
        const clock = new ManualClock();
        const host = controlledHost(clock);
        const children = createChildInstances(await parentApplication(), host.options);
        leaseOf(await children.acquire("P", "a")).release();
        clock.advance(GRACE_MS - 1);

        const again = leaseOf(await children.acquire("P", "b"));
        expect(again.generation).toBe(1);
        expect(children.state("P")).toMatchObject({generation: 1, state: "available", leases: 1});

        again.release();
        // 第一次宽限期本该到期的时刻：已取消，不停止。
        clock.advance(1);
        expect(children.state("P")?.state).toBe("idle-grace");
        clock.advance(GRACE_MS - 1);
        await drain();
        expect(children.state("P")).toMatchObject({generation: 1, state: "terminated"});
        expect(host.events).toEqual(["create:P#1", "stop:P#1"]);
    });

    it("stopping 中的新 acquire 不复活这一代：等它结束后以新代次创建，代次不复用", async () => {
        const clock = new ManualClock();
        const host = controlledHost(clock, {stop: true});
        const children = createChildInstances(await parentApplication(), host.options);
        leaseOf(await children.acquire("P", "a")).release();
        clock.advance(GRACE_MS);

        const pending = children.acquire("P", "b");
        await drain();
        expect(children.state("P")).toMatchObject({generation: 1, state: "stopping"});

        host.stops[0]!.settle.resolve("closed");
        const lease = leaseOf(await pending);
        expect(lease.generation).toBe(2);
        expect(host.events).toEqual(["create:P#1", "stop:P#1", "create:P#2"]);
    });

    it("停止到截止：宿主强制结束，这一代 terminated 并标记 forced、写诊断，不报为正常关闭", async () => {
        const clock = new ManualClock();
        const host = controlledHost(clock, {stop: true});
        const children = createChildInstances(await parentApplication(), host.options);
        leaseOf(await children.acquire("P", "a")).release();
        clock.advance(GRACE_MS);
        const stop = host.stops[0]!;
        // 宿主按截止信号强制结束子进程。
        stop.signal.addEventListener("abort", () => stop.settle.resolve("forced"), {once: true});

        clock.advance(STOP_DEADLINE_MS - 1);
        expect(stop.signal.aborted).toBe(false);
        clock.advance(1);
        await drain();

        expect(children.state("P")).toMatchObject({state: "terminated", abnormal: "forced"});
        expect(children.diagnostics()).toMatchObject([{key: "P", generation: 1, reason: "forced"}]);
    });

    it("子实例意外退出：available 与 idle-grace 下都立即 terminated、租约失效；过期代次的退出报告被忽略", async () => {
        const clock = new ManualClock();
        const host = controlledHost(clock);
        const children = createChildInstances(await parentApplication(), host.options);
        const first = leaseOf(await children.acquire("P", "a"));

        children.exited("P", 1);
        expect(children.state("P")).toMatchObject({generation: 1, state: "terminated", abnormal: "exited"});
        expect(first.revoked.aborted).toBe(true);
        expect(children.holds("P", 1, "a")).toBe(false);

        leaseOf(await children.acquire("P", "a")).release();
        expect(children.state("P")).toMatchObject({generation: 2, state: "idle-grace"});
        children.exited("P", 1);
        expect(children.state("P")?.state).toBe("idle-grace");
        children.exited("P", 2);
        clock.advance(GRACE_MS);

        expect(children.state("P")).toMatchObject({generation: 2, state: "terminated", abnormal: "exited"});
        expect(host.events).toEqual(["create:P#1", "create:P#2"]);
        expect(children.diagnostics().map((diagnostic) => `${diagnostic.reason}:${diagnostic.generation}`)).toEqual(["exited:1", "exited:2"]);
    });
});

describe("Spec application 子实例与租约：父实例停止", () => {
    it("父实例 stop() 的同步段里关闭接纳；存活子实例在父实例插件与本地能力收口之前停完", async () => {
        const clock = new ManualClock();
        const host = controlledHost(clock);
        const order: string[] = [];
        const capabilityKey = defineServiceKey<string>("demo.capability/value");
        const plugin: PluginDefinition = {
            id: "demo.parent",
            entries: [{id: "main", location: "server", activationEvents: ["onStartup"], activate: (context) => {
                context.scope.register({kind: "demo", label: "plugin-resource", value: null, release: () => void order.push("父实例插件收口")});
                return {};
            }}],
        };
        const parent = await parentApplication({
            keys: [capabilityKey],
            capabilities: [{id: "demo.capability", key: capabilityKey, create: () => "value", release: () => void order.push("父实例本地能力收口")}],
            plugins: [plugin],
            gates: [{id: "capability", kind: "resolve", key: capabilityKey}],
        });
        const children = createChildInstances(parent, {
            ...host.options,
            stop: async (handle, context) => {
                // 子实例停止期间父实例仍可用：插件作用域还没开始收口。
                order.push(`停止 ${handle}（父实例 ${parent.root.phase}）`);
                return host.options.stop(handle, context);
            },
        });
        leaseOf(await children.acquire("P", "a"));
        leaseOf(await children.acquire("Q", "b")).release();

        const stopping = parent.stop();
        const late = children.acquire("R", "c");

        expect(await late).toEqual({status: "rejected", reason: "admission-closed", detail: null});
        expect(await stopping).toEqual({status: "closed"});
        expect(order.slice(0, 2).sort()).toEqual(["停止 P#1（父实例 available）", "停止 Q#1（父实例 available）"]);
        expect(order.slice(2).sort()).toEqual(["父实例插件收口", "父实例本地能力收口"]);
        expect(children.list().map((status) => `${status.key}:${status.state}`)).toEqual(["P:terminated", "Q:terminated"]);
        expect(host.events).not.toContain("create:R#1");
    });

    it("父实例停止后才建立的子实例管理一开始就关闭接纳", async () => {
        const parent = await parentApplication();
        await parent.stop();
        const children = createChildInstances(parent, controlledHost(new ManualClock()).options);

        expect(await children.acquire("P", "a")).toEqual({status: "rejected", reason: "admission-closed", detail: null});
    });

    it("子实例停止不响应时，父实例停止受自己的截止约束而结算为 incomplete(deadline)，不报 closed", async () => {
        const clock = new ManualClock();
        const host = controlledHost(clock, {stop: true});
        const parent = await parentApplication();
        const children = createChildInstances(parent, host.options);
        leaseOf(await children.acquire("P", "a"));
        const deadline = new AbortController();

        const stopping = parent.stop({deadline: deadline.signal});
        await drain();
        expect(parent.status()).toMatchObject({phase: "stopping", admission: "closed"});
        deadline.abort();

        expect(await stopping).toMatchObject({status: "incomplete", reason: "deadline"});
        expect(children.state("P")?.state).toBe("stopping");
    });
});

describe("Spec plugin-channel 输出 9：{project} 目标核对租约", () => {
    const echo = defineRemoteService({id: "demo.project/echo", version: 1, callers: ["server"], methods: {where: {input: Type.Object({}, {additionalProperties: false}), output: Type.String(), effect: "read"}}});

    interface Running {
        readonly app: Application;
        readonly link: RemoteLink;
    }

    async function hubWithProjects() {
        const clock = new ManualClock();
        let caller: ActivationContext | null = null;
        const callerPlugin: PluginDefinition = {
            id: "demo.caller",
            entries: [{id: "main", location: "server", activationEvents: ["onStartup"], activate: (context) => {
                caller = context;
                return {};
            }}],
        };
        const hubNode = createRemoteNode({instance: {id: "hub", kind: "server", role: "hub", project: null}, clock});
        const hub = createApplication(
            {identity: {location: "server", instanceId: "hub"}, stopSignal: new AbortController().signal, emergency: () => undefined},
            {keys: [], plugins: [callerPlugin], gates: [], remote: hubNode},
        );
        expect(await hub.startup).toMatchObject({status: "available"});
        const router = createRemoteRouter(hubNode, {holdsProjectLease: (frame, project, generation) => frame.plugin !== null && children.holds(project, generation, frame.plugin)});
        const children = createChildInstances<Running>(hub, {
            create: async (key, generation) => {
                const descriptor: InstanceDescriptor = {id: `project-${key}-${generation}`, kind: "project", role: "project", project: {id: key, generation}};
                const node: RemoteNode = createRemoteNode({instance: descriptor, clock});
                const plugin: PluginDefinition = {
                    id: "demo.project",
                    entries: [{id: "main", location: "project", remoteProvides: [echo.id], activate: () => ({remote: [provideRemote(echo, () => ({methods: {where: () => ({ok: true, value: `${key}#${generation}`})}}))]})}],
                };
                const app = createApplication(
                    {identity: {location: "project", instanceId: descriptor.id}, stopSignal: new AbortController().signal, emergency: () => undefined},
                    {keys: [], plugins: [plugin], gates: [], remote: node},
                );
                expect(await app.startup).toMatchObject({status: "available"});
                const pair = createLinkPair();
                router.accept(pair.right);
                expect(await node.connect(pair.left)).toEqual({ok: true});
                return {app, link: pair.left};
            },
            stop: async ({app, link}) => {
                const result = await app.stop();
                link.close();
                return result.status === "closed" ? "closed" : "forced";
            },
            graceMs: GRACE_MS,
            stopDeadlineMs: STOP_DEADLINE_MS,
            clock,
        });
        const where = () => (caller as unknown as ActivationContext).remote.use(echo).at({project: "P"}).where({});
        return {clock, children, router, where};
    }

    it("调用方未持有项目代次的租约为 denied；持有后可调用；租约释放后再调用为 denied", async () => {
        const t = await hubWithProjects();
        const window = leaseOf(await t.children.acquire("P", "window-1"));

        expect(await t.where()).toMatchObject({ok: false, code: "denied"});

        const own = leaseOf(await t.children.acquire("P", "demo.caller"));
        expect(await t.where()).toEqual({ok: true, value: "P#1"});

        own.release();
        expect(await t.where()).toMatchObject({ok: false, code: "denied"});
        expect(window.revoked.aborted).toBe(false);
    });

    it("项目代次结束后：旧代次的租约不授权新代次，项目不在运行时为 target-gone", async () => {
        const t = await hubWithProjects();
        const old = leaseOf(await t.children.acquire("P", "demo.caller"));
        old.release();
        t.clock.advance(GRACE_MS);
        await drain(60);

        expect(t.children.state("P")).toMatchObject({generation: 1, state: "terminated"});
        expect(old.revoked.aborted).toBe(true);
        expect(await t.where()).toMatchObject({ok: false, code: "target-gone"});

        leaseOf(await t.children.acquire("P", "window-1"));
        expect(t.router.instances().map((instance) => instance.id)).toContain("project-P-2");
        expect(await t.where()).toMatchObject({ok: false, code: "denied"});
    });
});
