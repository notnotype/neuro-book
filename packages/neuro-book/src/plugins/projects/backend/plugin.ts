/**
 * `nbook.projects` 服务端入口：把宿主能力 `projectsKey` 包成远程服务 `nbook.projects/projects`（版本 3）：列出、登记、
 * 书架、新建、修改作品信息、移出书架、作品目录与列目录（docs/specs/runtime/projects.md 输出第 10、13 到 15、17 到 20 条）；
 * 封面经 `http.routes` 的路由（第 21 条）。
 * 不管生命周期：打开项目经客户端握手的绑定，不经这里；书架也不为显示统计打开项目（见 `shelf.ts`）。
 * 作品目录是本插件的设置，宿主不读插件配置，所以新建时 `parent` 省略由这里读设置（或算缺省）再交给宿主。
 */

import {dirname} from "node:path";

import {HTTP_ROUTES_POINT} from "@notnotype/nb-host/http/contracts";
import {diagnosticsKey} from "@notnotype/nb-runtime/diagnostics";
import {defineEntry} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {provideRemote} from "@notnotype/nb-runtime/remote";

import {settingsKey} from "nbook/plugins/settings/shared/contracts";
import {storageKey} from "nbook/plugins/storage/shared/contracts";
import {clockKey, userDirectoriesKey} from "nbook/shared/host";
import {projectsKey} from "nbook/shared/projects";

import {descriptor} from "../plugin";
import {librarySetting, projectStatsRemoteContract, projectsRemoteContract} from "../shared/contracts";
import {browseDirectory} from "./browse";
import {createCoverRoutes} from "./cover-routes";
import {effectiveLibrary} from "./library";
import {buildShelf} from "./shelf";

/**
 * 问运行中项目的统计状态的上限：一个卡住的项目实例不能拖住整张书架（页面同一时间只留一个书架请求），过了就按记录显示。
 * 项目实例里的 `current()` 只读内存里的状态，正常远在这之内返回。
 */
const LIVE_STATS_TIMEOUT_MS = 2000;

export const projectsBackendPlugin: PluginDefinition = {
    id: descriptor.id,
    entries: [defineEntry({
        id: "server",
        location: "server",
        dependencies: [{key: diagnosticsKey}, {key: projectsKey}, {key: settingsKey}, {key: storageKey}, {key: clockKey}, {key: userDirectoriesKey}],
        remoteProvides: [projectsRemoteContract],
        contributions: [{capability: HTTP_ROUTES_POINT, id: descriptor.id, declaration: {}}],
        activate: (context) => {
            const projects = context.services.require(projectsKey);
            const settings = context.services.require(settingsKey);
            const diagnostics = context.services.require(diagnosticsKey);
            const clock = context.services.require(clockKey);
            const directories = context.services.require(userDirectoriesKey);
            const stats = context.remote.use(projectStatsRemoteContract);
            const record = (input: Parameters<typeof diagnostics.record>[0]) => void diagnostics.record({...input, source: {plugin: descriptor.id}});
            const shelfSources = {
                projects,
                storage: context.services.require(storageKey),
                live: (id: string) => stats.at({project: id}).current({}, {timeout: LIVE_STATS_TIMEOUT_MS}),
                now: () => clock.now(),
                record,
            };
            const library = () => effectiveLibrary(settings.get(librarySetting), directories);
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
                    shelf: async () => {
                        const shelf = await buildShelf(shelfSources);
                        if (!shelf.ok) return {ok: false, code: "registry-invalid", detail: {detail: shelf.detail}};
                        return {ok: true, value: shelf.value};
                    },
                    library: async () => ({ok: true, value: library()}),
                    browse: async ({path}) => {
                        const listed = await projects.list();
                        if (!listed.ok) return {ok: false, code: "registry-invalid", detail: {detail: listed.detail}};
                        const options = {cwd: process.cwd(), home: directories.home, registered: listed.value};
                        if (path !== undefined) {
                            const browsed = await browseDirectory(path, options);
                            return browsed.ok ? {ok: true, value: browsed.value} : {ok: false, code: "invalid-parent", detail: {reason: browsed.reason, detail: browsed.detail}};
                        }
                        // 作品目录还没建出来（第一次新建前）时从它的上一级开始，用户在那里能看到它将来会在哪。
                        const current = library().path;
                        const browsed = await browseDirectory(current, options);
                        const chosen = !browsed.ok && browsed.reason === "invalid-path" ? await browseDirectory(dirname(current), options) : browsed;
                        return chosen.ok ? {ok: true, value: chosen.value} : {ok: false, code: "invalid-parent", detail: {reason: chosen.reason, detail: chosen.detail}};
                    },
                    create: async ({title, description, parent}) => {
                        const target = parent ?? library().path;
                        const created = await projects.create({title, parent: target, ...(description === undefined ? {} : {description})});
                        if (created.ok) return {ok: true, value: created.project};
                        switch (created.reason) {
                            case "invalid-metadata":
                                return {ok: false, code: "invalid-metadata", detail: {field: created.field, detail: created.detail}};
                            case "invalid-parent":
                                return {ok: false, code: "invalid-parent", detail: {reason: created.cause, detail: created.detail}};
                            case "exists":
                                return {ok: false, code: "exists", detail: {path: created.path}};
                            case "write-failed":
                                return {ok: false, code: "write-failed", detail: {detail: created.detail}};
                            case "register-failed":
                                return {ok: false, code: "register-failed", detail: {reason: created.cause, detail: created.detail, path: created.path}};
                        }
                    },
                    update: async ({id, ...patch}) => {
                        const updated = await projects.updateMetadata(id, patch);
                        if (updated.ok) return {ok: true, value: {id, ...updated.metadata}};
                        if (updated.reason === "invalid-metadata") return {ok: false, code: "invalid-metadata", detail: {field: updated.field, detail: updated.detail}};
                        return {ok: false, code: updated.reason, detail: {detail: updated.detail}};
                    },
                    unregister: async ({id}) => {
                        const removed = await projects.unregister(id);
                        if (removed.ok) return {ok: true, value: {id: removed.project.id, name: removed.project.name}};
                        if (removed.reason === "project-running") return {ok: false, code: "project-running", detail: {state: removed.state}};
                        return {ok: false, code: removed.reason, detail: {detail: removed.detail}};
                    },
                },
            }));
            return {remote: [remote], contributions: {[HTTP_ROUTES_POINT]: {[descriptor.id]: createCoverRoutes({projects, record})}}};
        },
    })],
};
