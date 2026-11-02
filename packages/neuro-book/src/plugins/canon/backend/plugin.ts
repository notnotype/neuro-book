/**
 * `nbook.canon` 的项目入口：拥有这部作品的世界（docs/specs/canon/project.md 输出 1），经远程服务给浏览器、TUI 与
 * 服务端用。启动即激活，在后台打开世界；接收 `canon.components` 的登记，变化时换上新登记。
 *
 * 第一版不建服务端入口：Agent 工具与后台任务还不做，没有服务端调用方（w00039 t29 计划）。
 */

import {diagnosticsKey} from "@notnotype/nb-runtime/diagnostics";
import {defineEntry} from "@notnotype/nb-runtime/plugins";
import type {ContributionHandle, ContributionReceiver, PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {provideRemote} from "@notnotype/nb-runtime/remote";
import type {ComponentDeclaration} from "@notnotype/nb-canon";

import {currentProjectKey} from "nbook/shared/projects";

import {descriptor} from "../plugin";
import {componentsPoint} from "../shared/components";
import type {ComponentContribution} from "../shared/components";
import {CANON_COMPONENTS_POINT, canonWorldContract} from "../shared/contracts";
import {remoteWorld} from "./remote";
import {createWorldHost} from "./world-host";

export const canonProjectPlugin: PluginDefinition = {
    id: descriptor.id,
    contributionPoints: [componentsPoint],
    entries: [defineEntry({
        id: "project",
        location: "project",
        activationEvents: ["onStartup"],
        dependencies: [{key: diagnosticsKey}, {key: currentProjectKey}],
        receives: [CANON_COMPONENTS_POINT],
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
            context.scope.register({kind: "canon-world", label: `${descriptor.id} world`, value: host, release: (value) => value.stop()});
            void host.ready();
            const leases = new WeakMap<object, Set<string>>();
            const remote = provideRemote(
                canonWorldContract,
                () => {
                    const tokens = new Set<string>();
                    const implementation = remoteWorld(host, tokens);
                    leases.set(implementation, tokens);
                    return implementation;
                },
                {
                    // 调用方实例失效：结束它申请、还没释放的独占（输出 10）。
                    release: async (implementation) => {
                        const tokens = leases.get(implementation);
                        if (tokens === undefined || tokens.size === 0) return;
                        const service = await host.ready();
                        if ("code" in service) return;
                        for (const token of tokens) service.releaseExclusive(token);
                    },
                },
            );
            return {remote: [remote], receivers: {[CANON_COMPONENTS_POINT]: receiver}};
        },
    })],
};
