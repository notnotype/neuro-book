/**
 * `nbook.storage` 的后端定义：服务端入口与项目入口代码相同，只差拥有的分区与库文件位置。入口打开本入口拥有的
 * 分区库，按调用方提供 Storage 服务，并以远程服务把分区交给别的实例里的插件（docs/specs/storage/persistence.md）。
 *
 * - 服务端入口拥有 user 分区，库在宿主状态根下；服务端插件打开 project 记录为 `no-project`，要碰项目数据经插件自己的项目入口。
 * - 项目入口拥有本项目代次的 project 分区，库在项目目录下；user 记录以调用方的身份经 `nbook.storage/user` 转给服务端。
 */

import {join} from "node:path";

import {diagnosticsKey} from "@notnotype/nb-runtime/diagnostics";
import {defineEntry, providePerConsumer} from "@notnotype/nb-runtime/plugins";
import type {ActivationContext, PluginDefinition, PluginEntryDefinition} from "@notnotype/nb-runtime/plugins";
import {provideRemote} from "@notnotype/nb-runtime/remote";
import type {ServiceKey} from "@notnotype/nb-runtime/services";

import {stateRootKey} from "nbook/shared/host";
import {currentProjectKey} from "nbook/shared/projects";
import type {StorageService} from "nbook/shared/storage";

import {descriptor} from "../plugin";
import {projectStorageContract, storageKey, userStorageContract} from "../shared/contracts";
import {createStorageFacade} from "../shared/facade";
import type {StorageFacade} from "../shared/facade";
import {remoteRoute} from "../shared/remote-route";
import {createPartitionOwner} from "./owner";
import {createPartition} from "./partition";

/**
 * 一个分区入口。`placement` 是给出库文件位置的宿主能力，`locate` 在激活时从它算出库文件路径
 * （docs/adr/0026-plugin-definitions-as-constants.md）。
 */
function partitionEntry(location: "server" | "project", placement: ServiceKey<unknown>, locate: (context: ActivationContext) => string): PluginEntryDefinition {
    const scope = location === "server" ? "user" : "project";
    const owned = scope === "user" ? userStorageContract : projectStorageContract;
    return defineEntry({
        id: location,
        location,
        dependencies: [{key: diagnosticsKey}, {key: placement}],
        provides: [storageKey],
        remoteProvides: [owned],
        remoteDelegates: scope === "project" ? [userStorageContract] : [],
        activate: (context) => {
            const diagnostics = context.services.require(diagnosticsKey);
            const onListenerError = (error: unknown): void => {
                diagnostics.record({level: "warn", event: "storage.listener.failed", message: "Storage 订阅的监听出错", error, source: {plugin: descriptor.id}});
            };
            const owner = createPartitionOwner(createPartition({path: locate(context), onListenerError}), scope, onListenerError);
            // 入口停止时关库：先结束本地订阅；别的实例的订阅随远程提供项撤回由内核结束。
            context.scope.register({kind: "storage-partition", label: `${descriptor.id} ${scope}`, value: owner, release: (value) => value.close()});
            const facades = new WeakMap<StorageService, StorageFacade>();
            const storage = providePerConsumer(
                storageKey,
                (consumer): StorageService => {
                    const facade = createStorageFacade(consumer, {
                        user: () => (scope === "user" ? owner.route(consumer) : remoteRoute(context.remote.on(consumer), userStorageContract)),
                        project: () =>
                            scope === "project"
                                ? owner.route(consumer)
                                : {ok: false, code: "no-project", detail: "服务端插件不能直接打开 project 记录；经插件自己的项目入口访问"},
                    });
                    facades.set(facade.service, facade);
                    return facade.service;
                },
                {release: (service) => facades.get(service)?.release()},
            );
            return {services: [storage], remote: [provideRemote(owned, (consumer) => owner.remote(consumer))]};
        },
    });
}

export const storageBackendPlugin: PluginDefinition = {
    id: descriptor.id,
    entries: [
        partitionEntry("server", stateRootKey, (context) => join(context.services.require(stateRootKey).path, "storage", "user.sqlite")),
        partitionEntry("project", currentProjectKey, (context) => join(context.services.require(currentProjectKey).root, ".nbook", "storage.sqlite")),
    ],
};
