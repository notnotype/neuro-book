import {readonly, ref, shallowRef, type ShallowRef} from "vue";
import {BrowserRuntimeHost, type BrowserHost, type PageLifecycleTarget} from "./browser-host";
import {productBrowserServices, type ProductBrowserRuntime} from "./product-browser-runtime";
import {WORKBENCH_BROWSER_SERVICE, type WorkbenchBrowserService} from "nbook/app/features/workbench/browser-plugin";
import {FILES_BROWSER_SERVICE, type FilesBrowserService} from "nbook/app/features/files/browser-plugin";
import {BROWSER_PROTOCOL_VERSION, BUILTIN_BROWSER_PLUGINS, BrowserBootstrapSchema, FILES_BROWSER_ENTRY, WORKBENCH_BROWSER_ENTRY} from "nbook/shared/browser-bootstrap";
import type {ApplicationManifest, StopResult} from "nbook/runtime/application/application";
import type {PluginDefinition} from "nbook/runtime/plugins/plugins";

export type BrowserWindowState =
    | {status: "idle" | "starting" | "unauthorized" | "closed"}
    | {status: "ready"; runtime: ProductBrowserRuntime}
    | {status: "connection-failed"; reason: string}
    | {status: "incompatible"; protocolVersion: number}
    | {status: "startup-failed"; reason: string};
export interface BrowserWindowHost {
    readonly state: Readonly<ShallowRef<BrowserWindowState>>;
    start(): Promise<void>;
    stop(): Promise<StopResult>;
}
export interface BrowserWindowOptions {
    readonly fetchBootstrap: () => Promise<unknown>;
    readonly plugins: readonly PluginDefinition[];
    readonly page?: PageLifecycleTarget;
    readonly instanceId: string;
    readonly report: (error: unknown) => void;
}
export function routeNeedsBrowserRuntime(route: {path: string; meta: {productHost?: boolean}}): boolean {
    return route.path !== "/login" && route.meta.productHost !== false;
}

export function createBrowserWindowHost(options: BrowserWindowOptions): BrowserWindowHost {
    const state = shallowRef<BrowserWindowState>({status: "idle"});
    const adapter = new BrowserRuntimeHost();
    const available = ref(false);
    let host: BrowserHost | null = null;
    let starting: Promise<void> | null = null;
    let closed = false;
    const reasonOf = (error: unknown): string => error instanceof Error ? error.message : String(error);
    const boot = async (): Promise<void> => {
        state.value = {status: "starting"};
        let response: unknown;
        try {
            response = await options.fetchBootstrap();
        } catch (error) {
            if (closed) return;
            const status = error && typeof error === "object" && "statusCode" in error ? error.statusCode : undefined;
            if (status === 401) state.value = {status: "unauthorized"};
            else {
                options.report(error);
                state.value = {status: "connection-failed", reason: reasonOf(error)};
            }
            return;
        }
        if (closed) return;
        if (response && typeof response === "object" && "protocolVersion" in response
            && typeof response.protocolVersion === "number" && response.protocolVersion !== BROWSER_PROTOCOL_VERSION) {
            state.value = {status: "incompatible", protocolVersion: response.protocolVersion};
            return;
        }
        try {
            const bootstrap = BrowserBootstrapSchema.parse(response);
            const selected: PluginDefinition[] = [];
            for (const plugin of bootstrap.plugins) {
                const builtin = BUILTIN_BROWSER_PLUGINS.find((item) => item.id === plugin.id);
                const definition = options.plugins.find((item) => item.id === plugin.id);
                if (!builtin || !definition || plugin.version !== builtin.version || plugin.browser.entry !== builtin.browser.entry) {
                    throw new Error(`本构建不支持浏览器插件：${plugin.id}@${plugin.version}`);
                }
                if (selected.some((item) => item.id === plugin.id)) throw new Error(`重复的浏览器插件：${plugin.id}`);
                selected.push(definition);
            }
            if (!selected.some((item) => item.id === WORKBENCH_BROWSER_ENTRY.plugin)) throw new Error("引导集合缺少 nbook.workbench");
            let workbench: WorkbenchBrowserService | null = null;
            let files: FilesBrowserService | null = null;
            const hasFiles = selected.some((item) => item.id === FILES_BROWSER_ENTRY.plugin);
            const manifest: ApplicationManifest = {
                keys: [WORKBENCH_BROWSER_SERVICE, FILES_BROWSER_SERVICE],
                plugins: selected,
                requiredPlugins: [WORKBENCH_BROWSER_ENTRY.plugin],
                gates: [
                    ...(hasFiles ? [{id: "files-browser", kind: "activate" as const, entry: FILES_BROWSER_ENTRY}] : []),
                    {id: "browser-services", kind: "check", dependencies: [
                        {key: WORKBENCH_BROWSER_SERVICE}, ...(hasFiles ? [{key: FILES_BROWSER_SERVICE}] : []),
                    ], async check({services}) {
                        const resolved = await services.resolve(WORKBENCH_BROWSER_SERVICE);
                        if (resolved.status !== "resolved") throw new Error(resolved.reason);
                        workbench = resolved.instance;
                        if (hasFiles) {
                            const resolvedFiles = await services.resolve(FILES_BROWSER_SERVICE);
                            if (resolvedFiles.status !== "resolved") throw new Error(resolvedFiles.reason);
                            files = resolvedFiles.instance;
                        }
                    }},
                ],
            };
            host = adapter.start({instanceId: options.instanceId, manifest, page: options.page});
            const application = host.application;
            void application.stopped.then(() => {
                available.value = false;
                if (state.value.status === "ready") state.value = {status: "closed"};
            });
            const result = await application.startup;
            if (closed) return;
            if (result.status !== "available" || !workbench || application.root.stopSignal.aborted) {
                throw new Error(result.failures.map((failure) => `${failure.source}: ${failure.error?.message ?? failure.reason}`).join("; ") || result.status);
            }
            available.value = true;
            state.value = {status: "ready", runtime: productBrowserServices(application, workbench, files, readonly(available))};
        } catch (error) {
            options.report(error);
            if (host) await host.destroy();
            if (!closed) state.value = {status: "startup-failed", reason: reasonOf(error)};
        }
    };
    return {
        state,
        start() {
            if (starting) return starting;
            if (closed || (state.value.status !== "idle" && state.value.status !== "connection-failed")) return Promise.resolve();
            starting = boot().finally(() => {starting = null;});
            return starting;
        },
        async stop() {
            closed = true;
            available.value = false;
            state.value = {status: "closed"};
            return host ? host.destroy() : {status: "closed"};
        },
    };
}
