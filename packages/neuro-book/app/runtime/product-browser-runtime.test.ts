// @vitest-environment jsdom
import {flushPromises, mount, type VueWrapper} from "@vue/test-utils";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {computed, defineComponent, h, nextTick, onBeforeUnmount, onMounted, reactive} from "vue";
import App from "nbook/app/app.vue";
import browserPlugin from "nbook/app/plugins/browser-host.client";
import authMiddleware from "nbook/app/middleware/auth.global";
import productHostMiddleware from "nbook/app/middleware/00.product-host.global";
import {provideWorkbenchCommands, type WorkbenchCommandsHost} from "nbook/app/composables/useWorkbenchCommands";
import {workbenchBrowserPlugin} from "nbook/app/features/workbench/browser-plugin";
import {filesBrowserPlugin} from "nbook/app/features/files/browser-plugin";
import {SHELL_FILES_VIEW} from "nbook/app/utils/workbench/product-catalog";
import {SHELL_PANEL_DEFAULTS} from "nbook/app/utils/workbench/panel-state";
import {SHELL_FILES_REFRESH_COMMAND, SHELL_PANEL_COMMAND_IDS, SHELL_VIEW_COMMAND_IDS, type WorkbenchShellCommandPort} from "nbook/app/utils/workbench/workbench-shell-commands";
import {BROWSER_PLUGIN_SET_REVISION, BROWSER_PROTOCOL_VERSION, BUILTIN_BROWSER_PLUGINS, WORKBENCH_BROWSER_ENTRY, WORKBENCH_COMMAND_POINT, WORKBENCH_VIEW_POINT} from "nbook/shared/browser-bootstrap";
import {createBrowserWindowHost, type BrowserWindowHost} from "./browser-window";
import type {PageLifecycleTarget} from "./browser-host";
import type {ProductBrowserRuntime} from "./product-browser-runtime";

vi.hoisted(() => {
    vi.stubGlobal("defineNuxtPlugin", (plugin: unknown) => plugin);
    vi.stubGlobal("defineNuxtRouteMiddleware", (middleware: unknown) => middleware);
});
vi.mock("nbook/app/stores/novel-ide", () => ({useNovelIdeStore: () => ({})}));
vi.mock("nbook/app/components/common/NotificationViewport.vue", () => ({default: {render: () => null}}));
vi.mock("nbook/app/composables/useDialog", () => ({useDialog: () => ({})}));
vi.mock("nbook/app/composables/useNotification", () => ({useNotification: () => ({})}));
vi.mock("nbook/app/composables/useAuthSessionState", () => ({useAuthSessionState: () => ({setSession: () => undefined})}));

class Page implements PageLifecycleTarget {
    private readonly listeners = new Set<() => void>();
    addEventListener(_name: "pagehide", listener: () => void): void {this.listeners.add(listener);}
    removeEventListener(_name: "pagehide", listener: () => void): void {this.listeners.delete(listener);}
    hide(): void {for (const listener of this.listeners) listener();}
}
const bootstrap = {
    protocolVersion: BROWSER_PROTOCOL_VERSION, revision: BROWSER_PLUGIN_SET_REVISION, plugins: [...BUILTIN_BROWSER_PLUGINS],
};
const hosts: BrowserWindowHost[] = [];
const wrappers: VueWrapper[] = [];
const route = reactive({path: "/", fullPath: "/", meta: {}});
let app: {$browserWindow: BrowserWindowHost};
let routeMounted = false;
const report = vi.fn();

function createWindow(id: string, page: Page = new Page(), fetchBootstrap: () => Promise<unknown> = async () => bootstrap): BrowserWindowHost {
    const host = createBrowserWindowHost({instanceId: id, page, fetchBootstrap,
        plugins: [workbenchBrowserPlugin(false), filesBrowserPlugin()], report});
    hosts.push(host);
    return host;
}
function invalidFilesPlugin(): ReturnType<typeof filesBrowserPlugin> {
    const plugin = filesBrowserPlugin();
    const entry = plugin.entries[0]!;
    return {
        ...plugin,
        entries: [{
            ...entry,
            contributions: (entry.contributions ?? []).map((contribution) => ({
                ...contribution,
                declaration: {invalid: contribution.id},
            })),
        }],
    };
}

function browserManifestOf(plugin: ReturnType<typeof workbenchBrowserPlugin>) {
    const entry = plugin.entries.find((candidate) => candidate.location === "browser");
    if (entry === undefined) throw new Error(`插件 ${plugin.id} 没有 browser 入口`);
    return {
        entry: entry.id,
        activationEvents: [...(entry.activationEvents ?? [])],
        provides: (entry.provides ?? []).map((key) => key.name),
        dependencies: (entry.dependencies ?? []).map(({key}) => key.name),
        contributionPoints: (plugin.contributionPoints ?? []).map(({id, implementation}) => ({id, implementation})),
        receives: [...(entry.receives ?? [])],
        contributions: (entry.contributions ?? []).map(({capability, id}) => ({capability, id})),
    };
}

function ready(host: BrowserWindowHost): ProductBrowserRuntime {
    const state = host.state.value;
    if (state.status !== "ready") throw new Error(`窗口未就绪：${state.status}`);
    return state.runtime;
}
function mountRoot(host: BrowserWindowHost) {
    app = {$browserWindow: host};
    const wrapper = mount(App, {global: {stubs: {
        NuxtPage: defineComponent({setup() {
            onMounted(() => {routeMounted = true;});
            return () => h("div", {"data-workbench-shell": ""}, "workbench");
        }}),
    }}});
    wrappers.push(wrapper);
    return wrapper;
}
function shellPort(): WorkbenchShellCommandPort {
    let maximized = false;
    const saved = {status: "saved" as const, diagnosis: ""};
    return {
        state: () => ({panel: {...SHELL_PANEL_DEFAULTS, maximized}, mode: "split", ready: true}),
        setMaximized: (value) => {maximized = value;},
        setPanelState: async () => saved, moveView: async () => saved, moveContainer: async () => saved,
        mergeContainer: async () => saved, reopenContainer: async () => saved, selectContainer: async () => saved,
        restoreContainerPlacement: async () => saved, restoreViewPlacement: async () => saved,
        setPartVisibility: async () => saved, revealView: async () => saved,
    };
}
beforeEach(() => {
    routeMounted = false;
    route.path = route.fullPath = "/";
    report.mockClear();
    vi.stubGlobal("computed", computed);
    vi.stubGlobal("useNuxtApp", () => app);
    vi.stubGlobal("useRoute", () => route);
    vi.stubGlobal("useRouter", () => ({currentRoute: {value: route}, resolve: (to: {fullPath: string}) => ({href: to.fullPath})}));
    vi.stubGlobal("useI18n", () => ({t: (key: string) => key}));
});
afterEach(async () => {
    for (const wrapper of wrappers.splice(0)) wrapper.unmount();
    await Promise.all(hosts.splice(0).map((host) => host.stop()));
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe("浏览器宿主挂载合同", () => {
    it("场景 1：引导成功时根组件挂载前窗口运行实例已建立，nbook.workbench 已激活", async () => {
        const response = Promise.withResolvers<unknown>();
        vi.stubGlobal("$fetch", () => response.promise);
        // Nuxt 的测试转换不包装插件；这里取静态插件对象的真实 setup 入口。
        const clientPlugin = browserPlugin as unknown as {setup(): Promise<{provide: {browserWindow: BrowserWindowHost}}>};
        const starting = clientPlugin.setup();
        expect(routeMounted).toBe(false);
        response.resolve(bootstrap);
        const host = (await starting).provide.browserWindow;
        hosts.push(host);
        const runtime = ready(host);
        expect(runtime.application.plugins.entryState(WORKBENCH_BROWSER_ENTRY)?.status).toBe("available");
        expect(runtime.workbench.commands.getCommand(SHELL_VIEW_COMMAND_IDS.refreshFiles).ok).toBe(true);
        expect(routeMounted).toBe(false);
        const wrapper = mountRoot(host);
        expect(routeMounted).toBe(true);
        expect(wrapper.find("[data-workbench-shell]").exists()).toBe(true);
    });

    it("场景 2：引导失败显示带重试的连接失败页且没有工作台，真实重试成功后继续启动并挂载工作台", async () => {
        let failing = true;
        const host = createWindow("failure-retry", new Page(), async () => {
            if (failing) throw Object.assign(new Error("service unavailable"), {statusCode: 500});
            return bootstrap;
        });
        await host.start();
        const wrapper = mountRoot(host);
        expect(wrapper.find("[data-browser-connection-failure][role=alert]").exists()).toBe(true);
        expect(wrapper.find("[data-workbench-shell]").exists()).toBe(false);
        expect(routeMounted).toBe(false);
        failing = false;
        await wrapper.get("[data-browser-connection-failure] button").trigger("click");
        await flushPromises();
        expect(wrapper.find("[data-browser-connection-failure]").exists()).toBe(false);
        expect(wrapper.find("[data-workbench-shell]").exists()).toBe(true);
        expect(routeMounted).toBe(true);
    });

    it("场景 3：引导返回 401 不显示连接失败页，交给鉴权跳转到登录页", async () => {
        const host = createWindow("unauthorized", new Page(), async () => {throw Object.assign(new Error("unauthorized"), {statusCode: 401});});
        await host.start();
        const wrapper = mountRoot(host);
        expect(wrapper.find("[data-browser-host-failure]").exists()).toBe(false);
        expect(routeMounted).toBe(false);
        const navigate = vi.fn();
        vi.stubGlobal("navigateTo", navigate);
        await productHostMiddleware(route as never, route as never);
        expect(navigate).not.toHaveBeenCalled();
        await authMiddleware(route as never, route as never);
        expect(navigate).toHaveBeenCalledWith({path: "/login", query: {redirect: "/"}});
        expect(report).not.toHaveBeenCalled();
        navigate.mockClear();
        await productHostMiddleware(route as never, {path: "/login"} as never);
        expect(navigate).toHaveBeenCalledWith("/", {external: true});
    });

    it("场景 4：协议版本不兼容提示刷新或更新，不挂载工作台", async () => {
        const host = createWindow("incompatible", new Page(), async () => ({...bootstrap, protocolVersion: 2}));
        await host.start();
        const wrapper = mountRoot(host);
        expect(wrapper.get("[data-browser-host-failure=incompatible]").text()).toContain("browserHost.incompatibleDescription");
        expect(wrapper.get("button").text()).toBe("browserHost.reload");
        expect(wrapper.find("[data-workbench-shell]").exists()).toBe(false);
        expect(routeMounted).toBe(false);
    });

    it("场景 5：nbook.workbench 在本窗口激活失败显示启动失败页并附原因，不挂载工作台", async () => {
        const plugin = workbenchBrowserPlugin(false);
        const host = createBrowserWindowHost({instanceId: "activation-failed", page: new Page(), fetchBootstrap: async () => bootstrap,
            plugins: [{...plugin, entries: plugin.entries.map((entry) => ({...entry, activate: () => {throw new Error("workbench activation denied");}}))}, filesBrowserPlugin()], report});
        hosts.push(host);
        await host.start();
        const wrapper = mountRoot(host);
        expect(wrapper.get("[data-browser-host-failure=startup-failed]").text()).toContain("workbench activation denied");
        expect(wrapper.find("[data-workbench-shell]").exists()).toBe(false);
        expect(routeMounted).toBe(false);
    });

    it("场景 6：两个窗口各有独立实例，一个 pagehide 不影响另一个且不向服务端发全局停止", async () => {
        const page = new Page();
        const first = createWindow("window-a", page);
        const second = createWindow("window-b");
        await Promise.all([first.start(), second.start()]);
        const a = ready(first);
        const b = ready(second);
        const commandsA = a.workbench.commands;
        const commandsB = b.workbench.commands;
        const shell = shellPort();
        a.workbench.attachPage({shell, views: {runAction: async () => ({ok: true, value: "first"})}});
        b.workbench.attachPage({shell: shellPort(), views: {runAction: async () => ({ok: true, value: "second"})}});
        expect(a.application).not.toBe(b.application);
        expect(commandsA).not.toBe(commandsB);
        expect(a.registry.ok && a.registry.value.resolveView(SHELL_FILES_VIEW.id).ok).toBe(true);
        expect(a.resolveViewFactory(SHELL_FILES_VIEW.factoryKey).ok).toBe(true);
        expect(await commandsA.executeCommand(SHELL_VIEW_COMMAND_IDS.refreshFiles, {viewId: SHELL_FILES_VIEW.id, generation: 1})).toMatchObject({ok: true, value: "first"});
        const fetch = vi.spyOn(globalThis, "fetch");
        page.hide();
        await a.application.stopped;
        expect(commandsA.getCommand(SHELL_VIEW_COMMAND_IDS.refreshFiles).ok).toBe(false);
        expect(a.registry.ok && a.registry.value.resolveView(SHELL_FILES_VIEW.id).ok).toBe(false);
        expect(a.resolveViewFactory(SHELL_FILES_VIEW.factoryKey).ok).toBe(false);
        expect(b.available.value).toBe(true);
        expect(await commandsB.executeCommand(SHELL_VIEW_COMMAND_IDS.refreshFiles, {viewId: SHELL_FILES_VIEW.id, generation: 2})).toMatchObject({ok: true, value: "second"});
        expect(fetch).not.toHaveBeenCalled();
    });

    it("场景 7：页面端口接入前返回未就绪，挂载后外壳命令可执行，卸载后被注销", async () => {
        const windowHost = createWindow("page-ports");
        await windowHost.start();
        const runtime = ready(windowHost);
        const commands = runtime.workbench.commands;
        expect(await commands.executeCommand(SHELL_VIEW_COMMAND_IDS.refreshFiles, {viewId: SHELL_FILES_VIEW.id, generation: 1})).toMatchObject({ok: false, code: "unavailable", reason: "工作台页面端口未就绪"});
        const shell = shellPort();
        let commandHost!: WorkbenchCommandsHost;
        const wrapper = mount(defineComponent({setup() {
            commandHost = provideWorkbenchCommands({workbench: runtime.workbench, development: false, report});
            let release: (() => void) | undefined;
            onMounted(() => {
                const result = runtime.workbench.attachPage({shell, views: {runAction: async () => ({ok: true, value: "refreshed"})}});
                if (!result.ok) throw new Error(result.reason);
                release = result.value;
            });
            onBeforeUnmount(() => release?.());
            return () => h("div");
        }}));
        wrappers.push(wrapper);
        expect(commandHost.registry).toBe(commands);
        expect((await commands.executeCommand(SHELL_PANEL_COMMAND_IDS.toggleMaximized, {})).ok).toBe(true);
        expect(shell.state().panel.maximized).toBe(true);
        expect(await commands.executeCommand(SHELL_VIEW_COMMAND_IDS.refreshFiles, {viewId: SHELL_FILES_VIEW.id, generation: 1})).toMatchObject({ok: true, value: "refreshed"});
        wrapper.unmount();
        wrappers.splice(wrappers.indexOf(wrapper), 1);
        expect(commands.getCommand(SHELL_PANEL_COMMAND_IDS.toggleMaximized).ok).toBe(false);
        expect(await commands.executeCommand(SHELL_VIEW_COMMAND_IDS.refreshFiles, {viewId: SHELL_FILES_VIEW.id, generation: 1})).toMatchObject({ok: false, code: "unavailable"});
        expect(runtime.available.value).toBe(true);
    });

    it("内置浏览器插件定义与共享清单逐字段一致", () => {
        for (const definition of [workbenchBrowserPlugin(false), filesBrowserPlugin()]) {
            const manifest = BUILTIN_BROWSER_PLUGINS.find((candidate) => candidate.id === definition.id);
            if (manifest === undefined) throw new Error(`共享清单缺少插件 ${definition.id}`);
            expect(browserManifestOf(definition)).toEqual(manifest.browser);
        }
    });

    it("不合格的 View 与命令声明被拒绝并保留原因，不进入交付", async () => {
        const host = createBrowserWindowHost({instanceId: "invalid-contributions", page: new Page(), fetchBootstrap: async () => bootstrap,
            plugins: [workbenchBrowserPlugin(false), invalidFilesPlugin()], report});
        hosts.push(host);
        await host.start();
        const runtime = ready(host);
        const view = runtime.application.plugins.contribution(WORKBENCH_VIEW_POINT, SHELL_FILES_VIEW.id)[0]!;
        const command = runtime.application.plugins.contribution(WORKBENCH_COMMAND_POINT, SHELL_FILES_REFRESH_COMMAND.command.id)[0]!;
        expect(view.validation).toEqual({status: "rejected", reason: "invalid-declaration", detail: "Files View 声明与产品目录不一致"});
        expect(command.validation).toEqual({status: "rejected", reason: "invalid-declaration", detail: "Files 命令声明与产品目录不一致"});
        expect(view).toMatchObject({status: "declared", delivery: {status: "waiting-receiver"}});
        expect(command).toMatchObject({status: "declared", delivery: {status: "waiting-receiver"}});
        expect("implementation" in view).toBe(false);
        expect("implementation" in command).toBe(false);
        expect(runtime.registry.ok && runtime.registry.value.resolveView(SHELL_FILES_VIEW.id).ok).toBe(false);
        expect(runtime.workbench.commands.getCommand(SHELL_FILES_REFRESH_COMMAND.command.id).ok).toBe(false);
    });

    it("只登记引导集合出现的插件，不自行补回 Files", async () => {
        const host = createWindow("workbench-only", new Page(), async () => ({...bootstrap, plugins: [bootstrap.plugins[0]]}));
        await host.start();
        const runtime = ready(host);
        expect(runtime.application.plugins.catalog().plugins.map((plugin) => plugin.id)).toEqual(["nbook.workbench"]);
        expect(runtime.workbench.commands.getCommand(SHELL_VIEW_COMMAND_IDS.refreshFiles).ok).toBe(false);
        expect(runtime.registry.ok && runtime.registry.value.resolveView(SHELL_FILES_VIEW.id).ok).toBe(false);
    });

    it("Files 订阅在 pagehide 取消精确窗口的流，不取消另一个窗口", async () => {
        const page = new Page();
        const first = createWindow("stream-a", page);
        const second = createWindow("stream-b");
        await Promise.all([first.start(), second.start()]);
        const a = ready(first);
        const b = ready(second);
        const fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (_input, init) => {
            await new Promise<void>((resolve) => init?.signal?.addEventListener("abort", () => resolve(), {once: true}));
            throw new DOMException("aborted", "AbortError");
        });
        const binding = {projectRoot: "project-a", publicId: "ready-a"};
        const streamA = a.subscribeFiles(binding, () => undefined).catch((error: unknown) => error);
        const streamB = b.subscribeFiles(binding, () => undefined).catch((error: unknown) => error);
        await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
        expect(String(fetch.mock.calls[0]?.[0])).toContain("projectRoot=project-a&publicId=ready-a");
        page.hide();
        await streamA;
        expect(fetch.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
        expect(fetch.mock.calls[1]?.[1]?.signal?.aborted).toBe(false);
        expect(b.available.value).toBe(true);
        await second.stop();
        await streamB;
        await nextTick();
    });
});
