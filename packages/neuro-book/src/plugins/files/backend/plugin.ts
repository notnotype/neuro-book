/**
 * `nbook.files` 的后端定义：项目入口提供 `project://`（根是本项目代次的项目目录，`.nbook/` 是控制目录），服务端入口
 * 提供 `user://`（根是 `<状态根>/user/`）。两个入口都启动即激活，按调用方身份以远程服务交出同一套方法
 * （docs/specs/workspace/resources.md）。服务端与项目实例里的插件直接用这两份合同。
 */

import {mkdir} from "node:fs/promises";
import {join} from "node:path";

import {diagnosticsKey} from "@notnotype/nb-runtime/diagnostics";
import type {DiagnosticsService} from "@notnotype/nb-runtime/diagnostics";
import {defineEntry} from "@notnotype/nb-runtime/plugins";
import type {ActivationContext, PluginDefinition, PluginEntryDefinition} from "@notnotype/nb-runtime/plugins";
import {provideRemote} from "@notnotype/nb-runtime/remote";
import type {RemoteImplementation} from "@notnotype/nb-runtime/remote";
import type {ConsumerIdentity} from "@notnotype/nb-runtime/services";

import {clockKey, stateRootKey} from "nbook/shared/host";
import {currentProjectKey} from "nbook/shared/projects";

import {descriptor} from "../plugin";
import {projectFilesContract, userFilesContract} from "../shared/contracts";
import type {ChangeSource, FilesContract} from "../shared/contracts";
import {createChangeHub} from "./changes";
import type {ChangeHub} from "./changes";
import {createFilesService} from "./files-service";
import type {FilesService} from "./files-service";
import {openRoot} from "./rooted";
import type {RootOptions} from "./rooted";

/** 写入来源按调用方身份：窗口里的插件是写作者，服务端与项目实例里的插件是系统（resources.md 的“写入来源”）。 */
export function sourceOf(consumer: ConsumerIdentity): ChangeSource {
    return consumer.location === "browser" || consumer.location === "tui" ? {kind: "user", plugin: consumer.plugin} : {kind: "system", plugin: consumer.plugin};
}

/** 两份合同的方法与事件相同，实现也相同；`consumer` 是内核填写的调用方身份，写入来源由它确定。 */
function implementation(service: FilesService, changes: ChangeHub, consumer: ConsumerIdentity): RemoteImplementation<typeof userFilesContract> {
    return {
        methods: {
            list: (input) => service.list(input.path),
            read: (input) => service.read(input.path),
            write: async (input) => {
                const saved = await service.write(input.path, input.text, input.baseline, changes.temporaryPath);
                if (!saved.ok) return saved;
                changes.saved({path: input.path, realPath: saved.value.realPath, bytes: saved.value.bytes}, sourceOf(consumer));
                return {ok: true, value: {baseline: saved.value.baseline}};
            },
        },
        events: {
            changes: {
                subscribe: (_filter, sink, {signal}) => changes.subscribe((message) => sink.next(message), signal),
            },
        },
    };
}

/** `locate` 在激活时从宿主能力算出根目录与它的选项。 */
function rootEntry(location: "server" | "project", contract: FilesContract, locate: (context: ActivationContext) => Promise<{readonly path: string; readonly options: Omit<RootOptions, "report">}>): PluginEntryDefinition {
    return defineEntry({
        id: location,
        location,
        // 启动即激活：根不可用（项目目录被删）在启动时就有诊断。
        activationEvents: ["onStartup"],
        dependencies: [{key: diagnosticsKey}, {key: clockKey}, {key: location === "server" ? stateRootKey : currentProjectKey}],
        remoteProvides: [contract],
        activate: async (context) => {
            const diagnostics = context.services.require(diagnosticsKey);
            const record = recordTo(diagnostics);
            const placed = await locate(context);
            const root = await openRoot(placed.path, {...placed.options, report: (event, error) => record("warn", `files.${event}`, "文件保存的收尾出错", {}, error)});
            if ("ok" in root) throw new Error(`${location === "server" ? "user://" : "project://"} 的根不可用：${root.detail}`);
            const service = createFilesService({root, diagnose: (event, detail, cause) => record("warn", event, detail, {cause})});
            const changes = createChangeHub({root, controlDirectory: placed.options.controlDirectory, clock: context.services.require(clockKey), record});
            context.scope.register({kind: "files-changes", label: `${descriptor.id} ${location}`, value: changes, release: (value) => value.close()});
            return {remote: [provideRemote(contract, (consumer) => implementation(service, changes, consumer))]};
        },
    });
}

function recordTo(diagnostics: DiagnosticsService) {
    return (level: "info" | "warn", event: string, message: string, data: unknown, error?: unknown): void => {
        diagnostics.record({level, event, message, data, ...(error === undefined ? {} : {error}), source: {plugin: descriptor.id}});
    };
}

export const filesBackendPlugin: PluginDefinition = {
    id: descriptor.id,
    entries: [
        rootEntry("server", userFilesContract, async (context) => {
            const state = context.services.require(stateRootKey).path;
            const path = join(state, "user");
            await mkdir(path, {recursive: true});
            return {path, options: {controlDirectory: false, lockDirectory: join(state, "locks", "user-files")}};
        }),
        rootEntry("project", projectFilesContract, async (context) => {
            const path = context.services.require(currentProjectKey).root;
            return {path, options: {controlDirectory: true, lockDirectory: join(path, ".nbook", "locks", "files")}};
        }),
    ],
};
