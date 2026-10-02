import {shallowRef, type Component, type ShallowRef} from "vue";
import {createCommandRegistry, type CommandRegistry, type CommandRegistryOptions, type CommandResult, type Release} from "nbook/app/utils/workbench/commands";
import {createWorkbenchRegistry, type DescriptorResult, type ViewDescriptor, type WorkbenchRegistry} from "nbook/app/utils/workbench/descriptors";
import {SHELL_LEFT_CONTAINER, SHELL_PANEL_CONTAINER, SHELL_RIGHT_CONTAINER} from "nbook/app/utils/workbench/containers";
import {SHELL_FILES_VIEW} from "nbook/app/utils/workbench/product-catalog";
import {registerViewTitleCommands, registerWorkbenchShellCommands, SHELL_FILES_REFRESH_COMMAND, type ViewTitleCommandContribution, type WorkbenchShellCommandPort, type WorkbenchViewCommandPort} from "nbook/app/utils/workbench/workbench-shell-commands";
import {WORKBENCH_BROWSER_ENTRY, WORKBENCH_COMMAND_POINT, WORKBENCH_VIEW_POINT} from "nbook/shared/browser-bootstrap";
import {provide as provideService, type ContributionHandle, type ContributionReceiver, type PluginDefinition} from "nbook/runtime/plugins/plugins";
import {defineServiceKey} from "nbook/runtime/services/services";

export type WorkbenchPagePorts = Readonly<{shell: WorkbenchShellCommandPort; views: WorkbenchViewCommandPort}>;
export type WorkbenchCommandContext = Pick<CommandRegistryOptions, "context" | "agentMode" | "report" | "confirm">;
export interface WorkbenchBrowserService {
    readonly commands: CommandRegistry;
    readonly registry: Readonly<ShallowRef<DescriptorResult<WorkbenchRegistry>>>;
    bindCommandContext(context: WorkbenchCommandContext): Release;
    attachPage(ports: WorkbenchPagePorts): CommandResult<Release>;
    readonly viewCommands: WorkbenchViewCommandPort;
    resolveViewFactory(factoryKey: string): DescriptorResult<Component>;
}
export const WORKBENCH_BROWSER_SERVICE = defineServiceKey<WorkbenchBrowserService>("nbook.workbench/browser");
export type BrowserViewImplementation = Readonly<{descriptor: ViewDescriptor; component: Component}>;

export function workbenchBrowserPlugin(development: boolean): PluginDefinition {
    return {
        id: WORKBENCH_BROWSER_ENTRY.plugin,
        contributionPoints: [
            {id: WORKBENCH_VIEW_POINT, implementation: "required",
                validate: ({id, declaration}) => id === SHELL_FILES_VIEW.id && declaration === SHELL_FILES_VIEW
                    ? null : "Files View 声明与产品目录不一致"},
            {id: WORKBENCH_COMMAND_POINT, implementation: "required",
                validate: ({id, declaration}) => id === SHELL_FILES_REFRESH_COMMAND.command.id && declaration === SHELL_FILES_REFRESH_COMMAND
                    ? null : "Files 命令声明与产品目录不一致"},
        ],
        entries: [{
            id: WORKBENCH_BROWSER_ENTRY.entry,
            activationEvents: ["onStartup"],
            location: "browser",
            provides: [WORKBENCH_BROWSER_SERVICE],
            receives: [WORKBENCH_VIEW_POINT, WORKBENCH_COMMAND_POINT],
            activate({scope, signal}) {
                let context: WorkbenchCommandContext | null = null;
                let page: WorkbenchPagePorts | null = null;
                let releasePage: Release | null = null;
                const commands = createCommandRegistry({
                    context: () => context?.context() ?? {},
                    agentMode: () => context?.agentMode() ?? "normal",
                    report: (error) => context ? context.report(error) : console.error("[browser-workbench] 命令失败", error),
                    confirm: async (request) => context?.confirm ? context.confirm(request) : false,
                    development,
                });
                const viewHandles = new Map<string, ContributionHandle<ViewDescriptor, BrowserViewImplementation>>();
                const catalog = () => createWorkbenchRegistry({
                    parts: [], containers: [SHELL_LEFT_CONTAINER, SHELL_PANEL_CONTAINER, SHELL_RIGHT_CONTAINER],
                    views: [...viewHandles.values()].map((handle) => handle.declaration),
                });
                const registry = shallowRef(catalog());
                const views: ContributionReceiver<ViewDescriptor, BrowserViewImplementation, null> = {
                    prepare: () => null,
                    commit(handle) {
                        viewHandles.set(handle.id, handle);
                        const next = catalog();
                        if (!next.ok) throw new Error(next.reason);
                        registry.value = next;
                    },
                    revoke(handle) {
                        viewHandles.delete(handle.id);
                        registry.value = catalog();
                    },
                };
                const viewCommands: WorkbenchViewCommandPort = {
                    runAction: (target, actionId) => page && !signal.aborted
                        ? page.views.runAction(target, actionId)
                        : Promise.resolve({ok: false, code: "unavailable", reason: "工作台页面端口未就绪"}),
                };
                const commandReceiver: ContributionReceiver<ViewTitleCommandContribution, WorkbenchViewCommandPort, {release: Release | null}> = {
                    prepare: () => ({release: null}),
                    commit(handle, prepared) {
                        const result = registerViewTitleCommands(commands, [handle.declaration], {
                            // 贡献的实现只能在已发布状态读取，不能缓存后绕过撤回门禁。
                            runAction: (target, actionId) => handle.implementation().runAction(target, actionId),
                        });
                        if (!result.ok) throw new Error(result.reason);
                        prepared.release = result.value;
                    },
                    revoke(_handle, prepared) {prepared.release?.(); prepared.release = null;},
                };
                const service: WorkbenchBrowserService = {
                    commands, registry, viewCommands,
                    bindCommandContext(next) {
                        if (signal.aborted || context) throw new Error("工作台命令上下文已接入或已停止");
                        context = next;
                        return () => {if (context === next) context = null;};
                    },
                    attachPage(ports) {
                        if (signal.aborted || page) return {ok: false, code: "unavailable", reason: "工作台页面端口已接入或已停止"};
                        const registered = registerWorkbenchShellCommands(commands, ports.shell);
                        if (!registered.ok) return registered;
                        page = ports;
                        const release = () => {
                            if (page !== ports) return;
                            page = null;
                            registered.value();
                            releasePage = null;
                        };
                        releasePage = release;
                        return {ok: true, value: release};
                    },
                    resolveViewFactory(factoryKey) {
                        for (const handle of viewHandles.values()) {
                            if (handle.declaration.factoryKey === factoryKey && handle.published && !signal.aborted) {
                                return {ok: true, value: handle.implementation().component};
                            }
                        }
                        return {ok: false, reason: `View 未就绪：${factoryKey}`};
                    },
                };
                scope.register({kind: "workbench-page-ports", label: "workbench page ports", value: service, release: () => {
                    releasePage?.();
                    context = null;
                    viewHandles.clear();
                    registry.value = catalog();
                }});
                return {services: [provideService(WORKBENCH_BROWSER_SERVICE, service)], receivers: {
                    [WORKBENCH_VIEW_POINT]: views, [WORKBENCH_COMMAND_POINT]: commandReceiver,
                }};
            },
        }],
    };
}
