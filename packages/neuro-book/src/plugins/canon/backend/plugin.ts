/**
 * `nbook.canon` 的项目入口：拥有这部作品的世界（docs/specs/canon/project.md 输出 1），经远程服务给浏览器、TUI 与
 * 服务端用。启动即激活，在后台打开世界；接收 `canon.components`、`canon.marks`、`canon.diagnostics` 的登记，变化时换上
 * 新登记；给项目里别的插件提供项目内接口（`canonProjectKey`，按调用方：诊断的登记、快照、视图；调用方的入口停止时，
 * 它的登记失效、它开的视图关掉）。
 *
 * 第一版不建服务端入口：Agent 工具与后台任务还不做，没有服务端调用方（w00039 t29 计划）。
 */

import {diagnosticsKey} from "@notnotype/nb-runtime/diagnostics";
import {defineEntry, provideServicePerConsumer} from "@notnotype/nb-runtime/plugins";
import type {ContributionHandle, ContributionReceiver, PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {provideRemote} from "@notnotype/nb-runtime/remote";
import type {ComponentDeclaration, DiagnosticDeclaration, MarkDeclaration, PluginContribution} from "@notnotype/nb-canon";

import {settingsKey} from "nbook/plugins/settings/shared/contracts";
import {currentProjectKey} from "nbook/shared/projects";

import {descriptor} from "../plugin";
import {canonSettings} from "../shared/settings";
import {componentsPoint} from "../shared/components";
import type {ComponentContribution} from "../shared/components";
import {CANON_COMPONENTS_POINT, canonWorldContract} from "../shared/contracts";
import {canonProjectKey} from "../shared/contracts";
import type {CanonProject} from "../shared/contracts";
import {CANON_DIAGNOSTICS_POINT, CANON_MARKS_POINT, diagnosticsPoint, marksPoint} from "./points";
import type {DiagnosticContribution, MarkContribution} from "./points";
import {remoteWorld} from "./remote";
import type {CallerHoldings} from "./remote";
import {createWorldHost} from "./world-host";

export const canonProjectPlugin: PluginDefinition = {
    id: descriptor.id,
    contributionPoints: [componentsPoint, marksPoint, diagnosticsPoint],
    entries: [defineEntry({
        id: "project",
        location: "project",
        activationEvents: ["onStartup"],
        dependencies: [{key: diagnosticsKey}, {key: currentProjectKey}, {key: settingsKey, required: false}],
        receives: [CANON_COMPONENTS_POINT, CANON_MARKS_POINT, CANON_DIAGNOSTICS_POINT],
        provides: [canonProjectKey],
        remoteProvides: [canonWorldContract],
        activate: (context) => {
            const diagnostics = context.services.require(diagnosticsKey);
            const host = createWorldHost(context.services.require(currentProjectKey).root, (input) => void diagnostics.record(input));
            // 作品设置里的历法与词表（canon.time）：先交一次当前值，之后变了再交。没有配置服务时用内置的公历与词表。
            // 不在 activate 里等它：内置类型要在 activate 返回前交完（见下）。世界打开前到的设置由宿主先记下。
            // 入口在解析完成之前停了：不再交设置、不订阅（作用域已经关了，登记会抛错，订阅也就没有地方释放）。
            void context.services.resolve(settingsKey, {signal: context.signal}).then((resolved) => {
                if (resolved.status !== "resolved" || context.signal.aborted) return;
                const settings = resolved.instance;
                const keys = new Set([canonSettings.settings.calendar.key, canonSettings.settings.fuzzyWords.key]);
                const sendTime = () => host.setTime({calendar: settings.get(canonSettings.settings.calendar), fuzzy: settings.get(canonSettings.settings.fuzzyWords)});
                sendTime();
                const stop = settings.onDidChange((changed) => {
                    if ([...changed].some((key) => keys.has(key))) sendTime();
                });
                try {
                    context.scope.register({kind: "canon-time-settings", label: `${descriptor.id} time settings`, value: stop, release: (unsubscribe) => unsubscribe()});
                } catch (error) {
                    stop();
                    throw error;
                }
            }).catch((error: unknown) => void diagnostics.record({level: "warn", event: "canon.time.settings", message: "接不上作品设置里的历法与词表，用内置的公历与词表", error, source: {plugin: descriptor.id}}));
            // 补交在 activate 返回前完成，所以内置类型在打开世界之前就在登记里。
            const declared = new Map<ContributionHandle<ComponentContribution>, ComponentDeclaration>();
            const update = () => host.setComponents([...declared.values()]);
            const receiver: ContributionReceiver<ComponentContribution, unknown, null> = {
                published: (handle) => {
                    declared.set(handle, {...handle.declaration, id: handle.id});
                    update();
                },
                revoke: (handle) => {
                    if (declared.delete(handle)) update();
                },
            };
            // 标注种类与诊断：贡献 id 就是声明的 id，带上声明它的插件 id（登记要按它核对前缀）。
            const declaredMarks = new Map<ContributionHandle<MarkContribution>, PluginContribution<MarkDeclaration>>();
            const declaredDiagnostics = new Map<ContributionHandle<DiagnosticContribution>, PluginContribution<DiagnosticDeclaration>>();
            const marksReceiver: ContributionReceiver<MarkContribution, unknown, null> = {
                published: (handle) => {
                    declaredMarks.set(handle, {plugin: handle.plugin, declaration: {...handle.declaration, id: handle.id}});
                    host.setMarks([...declaredMarks.values()]);
                },
                revoke: (handle) => {
                    if (declaredMarks.delete(handle)) host.setMarks([...declaredMarks.values()]);
                },
            };
            const diagnosticsReceiver: ContributionReceiver<DiagnosticContribution, unknown, null> = {
                published: (handle) => {
                    declaredDiagnostics.set(handle, {plugin: handle.plugin, declaration: {...handle.declaration, id: handle.id}});
                    host.setDiagnostics([...declaredDiagnostics.values()]);
                },
                revoke: (handle) => {
                    if (declaredDiagnostics.delete(handle)) host.setDiagnostics([...declaredDiagnostics.values()]);
                },
            };
            const owned = new WeakMap<CanonProject, {detach: (() => void) | null; readonly views: Set<string>}>();
            const projectService = provideServicePerConsumer(
                canonProjectKey,
                (consumer): CanonProject => {
                    // 登记记在调用方的插件名下：一个插件登记不了别的插件声明的诊断。
                    const plugin = consumer.plugin ?? consumer.instanceId;
                    const holdings = {detach: null as (() => void) | null, views: new Set<string>()};
                    const facade: CanonProject = {
                        register: (registration) => {
                            holdings.detach?.();
                            holdings.detach = host.registerDiagnostics(plugin, registration);
                        },
                        reportDataVersion: (dataVersion) => host.reportDataVersion(plugin, dataVersion),
                        snapshot: async () => {
                            const service = await host.ready();
                            return "code" in service ? service : service.snapshot();
                        },
                        openView: async (grant) => {
                            const service = await host.ready();
                            if ("code" in service) return service;
                            const opened = service.openView(grant);
                            if (typeof opened === "string") return {code: opened};
                            if ("token" in opened) holdings.views.add(opened.token);
                            return opened;
                        },
                        closeView: async (token) => {
                            if (!holdings.views.delete(token)) return;
                            const service = await host.ready();
                            if (!("code" in service)) service.closeView(token);
                        },
                        audit: async (token, entry) => {
                            if (!holdings.views.has(token)) return;
                            const service = await host.ready();
                            if (!("code" in service)) service.auditView(token, {...entry, kind: "placeholder"});
                        },
                        deny: async (who, method) => {
                            const service = await host.ready();
                            if (!("code" in service)) service.denyView(who, method);
                        },
                    };
                    owned.set(facade, holdings);
                    return facade;
                },
                {
                    release: async (facade) => {
                        const holdings = owned.get(facade);
                        if (holdings === undefined) return;
                        holdings.detach?.();
                        if (holdings.views.size === 0) return;
                        const service = await host.ready();
                        if (!("code" in service)) for (const token of holdings.views) service.closeView(token);
                    },
                },
            );
            context.scope.register({kind: "canon-world", label: `${descriptor.id} world`, value: host, release: (value) => value.stop()});
            void host.ready();
            const holdingsOf = new WeakMap<object, CallerHoldings>();
            const remote = provideRemote(
                canonWorldContract,
                () => {
                    const holdings: CallerHoldings = {tokens: new Set(), views: new Set()};
                    const implementation = remoteWorld(host, holdings);
                    holdingsOf.set(implementation, holdings);
                    return implementation;
                },
                {
                    // 调用方实例失效：结束它申请、还没释放的独占（输出 10），关掉它打开的视图（输出 24）。
                    release: async (implementation) => {
                        const holdings = holdingsOf.get(implementation);
                        if (holdings === undefined || (holdings.tokens.size === 0 && holdings.views.size === 0)) return;
                        const service = await host.ready();
                        if ("code" in service) return;
                        for (const token of holdings.tokens) service.releaseExclusive(token);
                        for (const token of holdings.views) service.closeView(token);
                    },
                },
            );
            return {remote: [remote], services: [projectService], receivers: {[CANON_COMPONENTS_POINT]: receiver, [CANON_MARKS_POINT]: marksReceiver, [CANON_DIAGNOSTICS_POINT]: diagnosticsReceiver}};
        },
    })],
};
