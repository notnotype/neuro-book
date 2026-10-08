/**
 * `nbook.storage` 的服务端入口与项目入口（同一份代码，两种位置）：打开本入口拥有的分区库，按调用方提供
 * Storage 服务，并以远程服务把分区交给别的实例里的插件（docs/specs/storage/persistence.md）。
 *
 * - 服务端入口拥有 user 分区；服务端插件打开 project 记录为 `no-project`，要碰项目数据经插件自己的项目入口。
 * - 项目入口拥有本项目代次的 project 分区；user 记录以调用方的身份经 `nbook.storage/user` 转给服务端。
 */

import {diagnosticsKey} from "@notnotype/nb-runtime/diagnostics";
import {providePerConsumer} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {provideRemote} from "@notnotype/nb-runtime/remote";

import type {StorageService} from "nbook/shared/storage";

import {descriptor} from "../plugin";
import {projectStorageContract, storageKey, userStorageContract} from "../shared/contracts";
import {createStorageFacade} from "../shared/facade";
import type {StorageFacade} from "../shared/facade";
import {remoteRoute} from "../shared/remote-route";
import {createPartitionOwner} from "./owner";
import {createPartition} from "./partition";

export interface StorageServerOptions {
    readonly location: "server" | "project";
    /** 本入口拥有的分区库：服务端为 `<状态根>/storage/user.sqlite`，项目实例为 `<项目目录>/.nbook/storage.sqlite`。 */
    readonly path: string;
}

export function createStorageServerPlugin(options: StorageServerOptions): PluginDefinition {
    const scope = options.location === "server" ? "user" : "project";
    const owned = scope === "user" ? userStorageContract : projectStorageContract;
    return {
        id: descriptor.id,
        entries: [{
            id: options.location,
            location: options.location,
            dependencies: [{key: diagnosticsKey}],
            provides: [storageKey],
            remoteProvides: [owned.id],
            remoteDelegates: scope === "project" ? [userStorageContract.id] : [],
            activate: (context) => {
                const diagnostics = context.services.require(diagnosticsKey);
                const onListenerError = (error: unknown): void => {
                    diagnostics.record({level: "warn", event: "storage.listener.failed", message: "Storage 订阅的监听出错", error, source: {plugin: descriptor.id}});
                };
                const owner = createPartitionOwner(createPartition({path: options.path, onListenerError}), scope, onListenerError);
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
        }],
    };
}
