/**
 * `nbook.canon` 的项目入口：拥有这部作品的世界（docs/specs/canon/project.md 输出 1），经远程服务给浏览器、TUI 与
 * 服务端用。启动即激活，在后台打开世界；接收 `canon.components`、`canon.marks`、`canon.diagnostics` 的登记，变化时换上
 * 新登记；给项目里别的插件提供诊断的项目内接口（`canonDiagnosticsKey`，按调用方，登记随调用方的入口停止失效）。
 *
 * 第一版不建服务端入口：Agent 工具与后台任务还不做，没有服务端调用方（w00039 t29 计划）。
 */

import {diagnosticsKey} from "@notnotype/nb-runtime/diagnostics";
import {defineEntry, provideServicePerConsumer} from "@notnotype/nb-runtime/plugins";
import type {ContributionHandle, ContributionReceiver, PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {provideRemote} from "@notnotype/nb-runtime/remote";
import type {ComponentDeclaration, DiagnosticDeclaration, MarkDeclaration, PluginContribution} from "@notnotype/nb-canon";

import {currentProjectKey} from "nbook/shared/projects";

import {descriptor} from "../plugin";
import {componentsPoint} from "../shared/components";
import type {ComponentContribution} from "../shared/components";
import {CANON_COMPONENTS_POINT, canonWorldContract} from "../shared/contracts";
import {canonDiagnosticsKey} from "../shared/diagnostics";
import type {CanonDiagnostics} from "../shared/diagnostics";
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
        dependencies: [{key: diagnosticsKey}, {key: currentProjectKey}],
        receives: [CANON_COMPONENTS_POINT, CANON_MARKS_POINT, CANON_DIAGNOSTICS_POINT],
        provides: [canonDiagnosticsKey],
        remoteProvides: [canonWorldContract],
        activate: (context) => {
            const diagnostics = context.services.require(diagnosticsKey);
            const host = createWorldHost(context.services.require(currentProjectKey).root, (input) => void diagnostics.record(input));
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
            const detaches = new WeakMap<CanonDiagnostics, () => void>();
            const diagnosticsService = provideServicePerConsumer(
                canonDiagnosticsKey,
                (consumer): CanonDiagnostics => {
                    // 登记记在调用方的插件名下：一个插件登记不了别的插件声明的诊断。
                    const plugin = consumer.plugin ?? consumer.instanceId;
                    const facade: CanonDiagnostics = {
                        register: (registration) => {
                            detaches.get(facade)?.();
                            detaches.set(facade, host.registerDiagnostics(plugin, registration));
                        },
                        reportDataVersion: (dataVersion) => host.reportDataVersion(plugin, dataVersion),
                    };
                    return facade;
                },
                {release: (facade) => detaches.get(facade)?.()},
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
            return {remote: [remote], services: [diagnosticsService], receivers: {[CANON_COMPONENTS_POINT]: receiver, [CANON_MARKS_POINT]: marksReceiver, [CANON_DIAGNOSTICS_POINT]: diagnosticsReceiver}};
        },
    })],
};
