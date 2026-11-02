/**
 * `projects://` 的跨项目访问（docs/specs/workspace/resources.md 输出“跨项目访问”、验收 9）：服务端实例、路由与项目管理器
 * 是真实的，项目跑在真实子进程里（项目宿主的测试入口，含 `nbook.files` 的项目入口）；测试插件经 `serverFilesKey` 调用。
 */

import {afterAll, afterEach, beforeAll, describe, expect, it} from "bun:test";
import {readFile, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {createDiagnosticsPlugin, createDiagnosticsStore} from "@notnotype/nb-runtime/diagnostics";
import {defineEntry} from "@notnotype/nb-runtime/plugins";
import type {ActivationContext, PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {waitUntil} from "@notnotype/neuro-book-test-support/wait";

import {definitionAt} from "nbook/manifest";
import {createConsoleExporterFactory, createConsoleFallback} from "nbook/plugins/diagnostics/web/console-exporter";
import {killSpawnedProjects, leaseOf, projectHarness} from "nbook/server/testing/projects";
import type {ProjectHarness} from "nbook/server/testing/projects";
import {projectsKey} from "nbook/shared/projects";
import type {ProjectsService} from "nbook/shared/projects";

import {filesBackendPlugin} from "./backend/plugin";
import {descriptor} from "./plugin";
import {projectFilesContract} from "./shared/contracts";
import type {ChangesMessage} from "./shared/contracts";
import {serverFilesKey} from "./shared/schemes";
import type {ServerFiles} from "./shared/schemes";

let tmp = "";
const harnesses: ProjectHarness[] = [];

beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-files", "projects-scheme");
});
afterEach(async () => {
    try {
        for (const harness of harnesses.splice(0)) expect(await harness.parent.stop()).toMatchObject({status: "closed"});
    } finally {
        killSpawnedProjects();
    }
});
afterAll(async () => {
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

interface Held {
    files: ServerFiles | null;
    projects: ProjectsService | null;
    remote: ActivationContext["remote"] | null;
}

/** 测试插件：id 为 `nbook.agent` 的那个可以注明代表哪个会话；另拿项目服务与远程入口，用来持租约、订阅与冒充转发。 */
function consumer(id: string, held: Held): PluginDefinition {
    return {id, entries: [defineEntry({
        id: "server",
        location: "server",
        activationEvents: ["onStartup"],
        dependencies: [{key: serverFilesKey}, {key: projectsKey}],
        activate: (context) => {
            held.files = context.services.require(serverFilesKey);
            held.projects = context.services.require(projectsKey);
            held.remote = context.remote;
            return {};
        },
    })]};
}

async function scene(): Promise<{readonly h: ProjectHarness; readonly agent: Held; readonly other: Held}> {
    const silent = {error: () => undefined};
    const agent: Held = {files: null, projects: null, remote: null};
    const other: Held = {files: null, projects: null, remote: null};
    const h = await projectHarness(tmp, {plugins: [
        createDiagnosticsPlugin({location: "server", store: createDiagnosticsStore({identity: {location: "server", instanceId: "hub"}}), exporter: createConsoleExporterFactory(silent), fallback: createConsoleFallback(silent)}),
        definitionAt("server", descriptor, filesBackendPlugin),
        consumer("nbook.agent", agent),
        consumer("x.other", other),
    ]});
    harnesses.push(h);
    return {h, agent, other};
}

const files = (held: Held): ServerFiles => held.files ?? (() => { throw new Error("测试插件没有激活"); })();
const asAgent = {as: {agent: {session: "s1", profile: "p"}}};

async function stateOf(h: ProjectHarness): Promise<string | undefined> {
    const listed = await h.manager.list();
    return listed.ok ? listed.value.find((project) => project.id === h.project.id)?.state : undefined;
}

describe("projects://", () => {
    it("根列出已登记的项目；读写没在运行的项目，结算后不留租约", async () => {
        const {h, agent} = await scene();
        const root = await files(agent).list("projects://");
        expect(root).toMatchObject({ok: true, value: {kind: "virtual", entries: [{name: "book", address: "projects://book", meta: {id: h.project.id}}]}});
        expect(await stateOf(h)).toBe("stopped");

        expect(await files(agent).create("projects://book/新章.md", "file", asAgent)).toEqual({ok: true, value: {}});
        const read = await files(agent).read(`projects://${h.project.id}/新章.md`, asAgent);
        if (!read.ok) throw new Error(read.code);
        expect(await files(agent).write("projects://book/新章.md", "正文", read.value.baseline, asAgent)).toMatchObject({ok: true});
        expect(await readFile(join(h.root, "Book", "新章.md"), "utf8")).toBe("正文");
        // 调用结算后租约已释放：项目进入宽限期，而不是一直开着。
        expect(await stateOf(h)).toBe("idle-grace");
        expect(await files(agent).read("projects://nobody/x.md")).toMatchObject({ok: false, code: "not-found"});
        expect(await files(agent).realPath("projects://")).toMatchObject({ok: false, code: "unsupported-capability"});
    });

    it("写入来源透传到项目实例；别的服务端插件给项目合同带来源为 permission-denied", async () => {
        const {h, agent, other} = await scene();
        const lease = leaseOf(await other.projects!.acquire("book"));
        const messages: ChangesMessage[] = [];
        const subscribed = await other.remote!.use(projectFilesContract).at({project: h.project.id}).events.changes.subscribe({}, (message) => messages.push(message));
        expect(subscribed.ok).toBe(true);
        await waitUntil("订阅就绪", () => messages.some((message) => message.kind === "ready"));

        expect(await files(agent).create("projects://book/a.md", "file", asAgent)).toMatchObject({ok: true});
        await waitUntil("新建事件带会话来源", () => messages.some((message) => message.kind === "batch" && message.events.some((event) => event.path === "a.md" && event.source.kind === "agent" && event.source.session === "s1")));

        const forged = await other.remote!.use(projectFilesContract).at({project: h.project.id}).create({path: "b.md", kind: "file", as: {kind: "agent", session: "s1"}});
        expect(forged).toMatchObject({ok: false, code: "permission-denied"});
        lease.release();
    });

    it("取得租约前已取消：不发出调用、租约释放", async () => {
        const {h, agent} = await scene();
        const controller = new AbortController();
        const pending = files(agent).create("projects://book/c.md", "file", {...asAgent, signal: controller.signal});
        controller.abort();
        expect(await pending).toMatchObject({ok: false, code: "cancelled"});
        expect(await readFile(join(h.root, "Book", "c.md"), "utf8").catch(() => null)).toBeNull();
        await waitUntil("租约已释放", async () => (await stateOf(h)) !== "running");
    });

    it("登记表损坏为 project-unavailable，修好后照常", async () => {
        const {h, agent} = await scene();
        const registry = join(h.stateRoot, "projects.json");
        const original = await readFile(registry, "utf8");
        await writeFile(registry, "{坏了");
        expect(await files(agent).list("projects://")).toMatchObject({ok: false, code: "project-unavailable"});
        expect(await files(agent).read("projects://book/x.md")).toMatchObject({ok: false, code: "project-unavailable"});
        await writeFile(registry, original);
        expect(await files(agent).list("projects://")).toMatchObject({ok: true});
    });

    it("项目子进程在写请求发出后断开：调用方得到路由层的失败，原样交回", async () => {
        const {h, agent} = await scene();
        expect(await files(agent).create("projects://book/d.md", "file", asAgent)).toMatchObject({ok: true});
        const read = await files(agent).read("projects://book/d.md", asAgent);
        if (!read.ok) throw new Error(read.code);
        const listed = await h.manager.list();
        const pid = listed.ok ? listed.value.find((project) => project.id === h.project.id)?.pid : null;
        if (pid === null || pid === undefined) throw new Error("项目没在运行");
        // 暂停子进程，请求发出后它收不到也答不了；再杀掉它，链路断开。
        process.kill(pid, "SIGSTOP");
        const pending = files(agent).write("projects://book/d.md", "改", read.value.baseline, asAgent);
        // 取得租约之后紧接着发出请求：项目回到运行中说明写请求已经发出。
        await waitUntil("写请求已经发出", async () => (await stateOf(h)) === "running");
        process.kill(pid, "SIGKILL");
        expect(await pending).toMatchObject({ok: false, code: "unknown-outcome", cause: "disconnected"});
    });
});
