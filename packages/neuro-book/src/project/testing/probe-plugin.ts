/**
 * `test.remote-probe` 的项目入口：在项目实例里提供 `test.remote-probe/project`
 * （`src/shared/testing/remote-probe-contract.ts`），供宿主合同测试与 e2e 核对绑定、`{project}` 访问、重连与崩溃，
 * 以及项目入口直用 Storage 的读写。
 * 入口关闭时打印一行，测试据此核对服务端停止时项目子进程先于服务端插件收口。只由测试启动。
 */

import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {provideRemote} from "@notnotype/nb-runtime/remote";

import {storageKey} from "nbook/plugins/storage/shared/contracts";
import {probeStorage} from "nbook/shared/testing/probe-storage";
import {projectProbeContract, remoteProbeDescriptor} from "nbook/shared/testing/remote-probe-contract";

import {currentProjectKey} from "../current-project";

/** 项目入口关闭时打印的一行。 */
export const PROJECT_PROBE_CLOSED_LINE = "remote-probe project entry closed";

export function createRemoteProbeProjectPlugin(): PluginDefinition {
    return {
        id: remoteProbeDescriptor.id,
        entries: [{
            id: "project",
            location: "project",
            activationEvents: ["onStartup"],
            dependencies: [{key: currentProjectKey}, {key: storageKey}],
            remoteProvides: [projectProbeContract.id],
            activate: (context) => {
                const current = context.services.require(currentProjectKey);
                const storage = probeStorage(context.services.require(storageKey));
                const sinks = new Set<(payload: {readonly n: number}) => void>();
                let ticks = 0;
                context.scope.register({kind: "test-resource", label: "remote-probe-project", value: null, release: () => {
                    console.log(PROJECT_PROBE_CLOSED_LINE);
                }});
                const probe = provideRemote(projectProbeContract, (consumer) => ({
                    methods: {
                        echo: () => ({
                            ok: true,
                            value: {
                                project: {id: current.id, name: current.name, generation: current.generation},
                                caller: {instanceId: consumer.instanceId, location: consumer.location, plugin: consumer.plugin, entry: consumer.entry, generation: consumer.generation},
                            },
                        }),
                        tick: () => {
                            ticks += 1;
                            for (const sink of sinks) sink({n: ticks});
                            return {ok: true, value: sinks.size};
                        },
                        crash: ({code}) => process.exit(code),
                        storageRead: async ({name}) => ({ok: true, value: await storage.read(name)}),
                        storageSave: async ({name, text, expect}) => ({ok: true, value: await storage.save(name, text, expect)}),
                    },
                    events: {
                        ticks: {
                            subscribe: (_filter, sink, {signal}) => {
                                const next = (payload: {readonly n: number}): void => sink.next(payload);
                                sinks.add(next);
                                signal.addEventListener("abort", () => sinks.delete(next), {once: true});
                            },
                        },
                    },
                }));
                return {remote: [probe]};
            },
        }],
    };
}
