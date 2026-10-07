/**
 * `nbook.projects` 服务端入口：把宿主能力 `projectsKey` 的列出与登记包成远程服务 `nbook.projects/projects`。
 * 不管生命周期：打开项目经客户端握手的绑定，不经这里。
 */

import {diagnosticsKey} from "@notnotype/nb-runtime/diagnostics";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {provideRemote} from "@notnotype/nb-runtime/remote";
import type {ServiceKey} from "@notnotype/nb-runtime/services";

import type {ProjectsService} from "nbook/shared/projects";

import {descriptor} from "../plugin";
import {projectsRemoteContract} from "../shared/contracts";

export interface ProjectsServerKeys {
    /** 宿主能力的服务键，由装配者交进来。 */
    readonly projects: ServiceKey<ProjectsService>;
}

export function createProjectsServerPlugin(keys: ProjectsServerKeys): PluginDefinition {
    return {
        id: descriptor.id,
        entries: [{
            id: "server",
            location: "server",
            dependencies: [{key: diagnosticsKey}, {key: keys.projects}],
            remoteProvides: [projectsRemoteContract.id],
            activate: (context) => {
                const projects = context.services.require(keys.projects);
                const remote = provideRemote(projectsRemoteContract, () => ({
                    methods: {
                        list: async () => {
                            const listed = await projects.list();
                            if (!listed.ok) return {ok: false, code: "registry-invalid", detail: {detail: listed.detail}};
                            return {ok: true, value: listed.value.map(({id, name, path, state, generation}) => ({id, name, path, state, generation}))};
                        },
                        register: async ({path}) => {
                            const registered = await projects.register(path);
                            if (!registered.ok) return {ok: false, code: "register-failed", detail: {reason: registered.reason, detail: registered.detail}};
                            return {ok: true, value: registered.project};
                        },
                    },
                }));
                return {remote: [remote]};
            },
        }],
    };
}
