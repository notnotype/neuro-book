/**
 * 宿主能力 `projectsKey` 与 `{project}` 访问规则：真实的服务端实例里的插件经按调用方门面取得租约，经路由与真实的
 * 项目子进程（带探针的项目入口）通信；浏览器窗口是另一个真实内核实例，经进程内链路绑定项目。
 * 行为合同见 docs/specs/runtime/projects.md 输出第 7–9 条与场景 7、8。
 */

import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {rm} from "node:fs/promises";

import {createApplication} from "@notnotype/nb-runtime/application";
import type {ActivationContext, PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {createRemoteNode, leaseHolderOf} from "@notnotype/nb-runtime/remote";
import type {CallerFrame} from "@notnotype/nb-runtime/remote";
import {createLinkPair} from "@notnotype/nb-runtime/remote/testing";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {projectsKey} from "nbook/shared/projects";
import type {ProjectLease, ProjectsService} from "nbook/shared/projects";
import {projectProbeContract, remoteProbeDescriptor} from "nbook/shared/testing/remote-probe-contract";

import {GRACE_MS, killSpawnedProjects, leaseOf, projectHarness, revoked, settle} from "../testing/projects";
import type {ProjectHarness} from "../testing/projects";

const PROBE_ENV = {NBOOK_TEST_PLUGINS: remoteProbeDescriptor.id};

let tmp = "";

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-projects", "projects-capability");
});

afterEach(() => {
    killSpawnedProjects();
});

afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

/** 启动即激活、依赖 `projectsKey` 的服务端插件；`activate` 拿到门面与激活上下文后决定做什么。 */
function serverPlugin(id: string, activate: (projects: ProjectsService, context: ActivationContext) => Promise<void>): PluginDefinition {
    return {
        id,
        entries: [{
            id: "main",
            location: "server",
            activationEvents: ["onStartup"],
            dependencies: [{key: projectsKey}],
            activate: async (context) => {
                await activate(context.services.require(projectsKey), context);
                return {};
            },
        }],
    };
}

function frame(instanceId: string, plugin: string | null, via: CallerFrame["via"] = null): CallerFrame {
    return {instanceId, location: instanceId === "hub" ? "server" : "browser", client: null, plugin, entry: plugin === null ? null : "main", generation: plugin === null ? null : 1, via};
}

/** 浏览器窗口：另一个真实内核实例，按短名绑定项目，经进程内链路连到服务端路由。 */
async function windowBoundTo(h: ProjectHarness, id: string) {
    let remote: ActivationContext["remote"] | null = null;
    const node = createRemoteNode({instance: {id, kind: "browser", role: "client", project: null, client: "profile-1"}, bind: {project: "book"}});
    const app = createApplication(
        {identity: {location: "browser", instanceId: id}, stopSignal: new AbortController().signal, emergency: () => undefined},
        {
            keys: [],
            plugins: [{id: "app.window", entries: [{id: "main", location: "browser", activationEvents: ["onStartup"], activate: (context) => {
                remote = context.remote;
                return {};
            }}]}],
            gates: [],
            remote: node,
        },
    );
    const pair = createLinkPair();
    h.router.accept(pair.right);
    const connected = await node.connect(pair.left);
    expect(await app.startup).toMatchObject({status: "available"});
    return {node, connected, link: pair.left, remote: () => remote!};
}

describe("Spec projects 输出 8：projectsKey 按调用方门面", () => {
    it("每个插件入口各得一个门面；租约记在取得它的那次激活名下；入口停止（激活失败）时它的租约随门面释放", async () => {
        const facades = new Map<string, ProjectsService>();
        let kept: ProjectLease | null = null;
        const h = await projectHarness(tmp, {
            plugins: [
                serverPlugin("demo.keeper", async (projects) => {
                    facades.set("demo.keeper", projects);
                    kept = leaseOf(await projects.acquire("book"));
                }),
                serverPlugin("demo.quitter", async (projects) => {
                    facades.set("demo.quitter", projects);
                    leaseOf(await projects.acquire("book"));
                    throw new Error("取得租约后激活失败");
                }),
            ],
        });
        expect(await h.parent.startup).toMatchObject({failures: [{source: "demo.quitter/main", reason: "activate/activation-threw"}]});
        expect(facades.get("demo.keeper")).not.toBe(facades.get("demo.quitter"));
        expect(kept!.generation).toBe(1);
        expect(h.manager.holds(h.project.id, 1, leaseHolderOf(frame("hub", "demo.keeper")))).toBe(true);
        expect(h.manager.holds(h.project.id, 1, leaseHolderOf(frame("hub", "demo.quitter")))).toBe(false);
        // 经代理转发时帧上带 via：仍按发起它的入口这次激活核对。
        expect(h.manager.holds(h.project.id, 1, leaseHolderOf(frame("hub", "demo.keeper", {plugin: "nbook.proxy", entry: "main", generation: 2})))).toBe(true);
        expect(await facades.get("demo.keeper")!.list()).toMatchObject({ok: true, value: [{name: "book", state: "running", generation: 1}]});

        kept!.release();
        expect(h.manager.running(h.project.id)).toEqual({generation: 1, state: "idle-grace"});
    });
});

describe("Spec projects 输出 7、9：绑定与 {project} 访问", () => {
    it("窗口按短名绑定：握手带回项目代次，project 目标到达项目实例；窗口的插件都用这份绑定，别的窗口不行", async () => {
        const h = await projectHarness(tmp, {env: PROBE_ENV});
        const window = await windowBoundTo(h, "browser-1");
        expect(window.connected).toEqual({ok: true});
        expect(window.node.binding).toEqual({id: h.project.id, name: "book", generation: 1});

        const echoed = await window.remote().use(projectProbeContract).echo({});
        expect(echoed).toEqual({ok: true, value: {project: {id: h.project.id, name: "book", generation: 1}, caller: {instanceId: "browser-1", location: "browser", plugin: "app.window", entry: "main", generation: 1}}});
        expect(await window.remote().use(projectProbeContract).at({project: h.project.id}).echo({})).toMatchObject({ok: true});

        expect(h.manager.access(frame("browser-1", "another.plugin"), h.project.id, 1)).toBe("allowed");
        expect(h.manager.access(frame("browser-2", "app.window"), h.project.id, 1)).toBe("denied");
        expect(h.manager.access(frame(`project:${h.project.id}#1`, "demo.project"), h.project.id, 1)).toBe("denied");
    });

    it("服务端插件不取租约：项目运行中可以访问；宽限期中 denied，访问不唤醒项目，宽限期照常结束", async () => {
        let remote: ActivationContext["remote"] | null = null;
        const h = await projectHarness(tmp, {
            env: PROBE_ENV,
            plugins: [serverPlugin("demo.bystander", async (_projects, context) => {
                remote = context.remote;
            })],
        });
        const notify = () => remote!.use(projectProbeContract).at({project: h.project.id}).echo({});
        const window = await windowBoundTo(h, "browser-1");
        expect(await notify()).toMatchObject({ok: true, value: {caller: {instanceId: "hub", plugin: "demo.bystander"}}});
        expect(h.manager.access(frame("hub", null), h.project.id, 1)).toBe("denied");

        // 留一份马上释放的租约，只为观察这一代何时结束。窗口离开：最后一份租约释放，进入宽限期。
        const lease = leaseOf(await h.manager.acquire(h.project.id, "observer", {generation: 1}));
        lease.release();
        window.link.close();
        await settle(() => h.manager.running(h.project.id)?.state === "idle-grace");

        expect(await notify()).toMatchObject({ok: false, code: "denied"});
        expect(h.manager.running(h.project.id)).toEqual({generation: 1, state: "idle-grace"});
        h.clock.advance(GRACE_MS);
        await revoked(lease);
        expect(h.manager.running(h.project.id)).toBeNull();
        expect(await notify()).toMatchObject({ok: false, code: "target-gone"});
    });
});
