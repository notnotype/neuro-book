/**
 * `nbook.storage` 的浏览器入口：不存数据，按调用方提供 Storage 服务，每个操作以调用方的身份经远程服务转给分区的
 * 拥有者（docs/specs/storage/persistence.md 输出第 9 条）。user 记录到服务端，project 记录到本窗口绑定的项目代次；
 * 没有绑定项目的窗口打开 project 记录为 `no-project`。
 */

import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {providePerConsumer} from "@notnotype/nb-runtime/plugins";
import type {ServiceKey} from "@notnotype/nb-runtime/services";

import type {WindowProject} from "nbook/shared/projects";
import type {StorageService} from "nbook/shared/storage";

import {descriptor} from "../plugin";
import {projectStorageContract, userStorageContract} from "../shared/contracts";
import {createStorageFacade} from "../shared/facade";
import type {StorageFacade} from "../shared/facade";
import {remoteRoute} from "../shared/remote-route";

export interface StorageBrowserKeys {
    /** Storage 服务键与窗口绑定的项目，都由装配者交进来。 */
    readonly storage: ServiceKey<StorageService>;
    readonly windowProject: ServiceKey<WindowProject>;
}

export function createStorageBrowserPlugin(keys: StorageBrowserKeys): PluginDefinition {
    return {
        id: descriptor.id,
        entries: [{
            id: "browser",
            location: "browser",
            dependencies: [{key: keys.windowProject}],
            provides: [keys.storage],
            remoteDelegates: [userStorageContract.id, projectStorageContract.id],
            activate: (context) => {
                const bound = context.services.require(keys.windowProject).project !== null;
                const facades = new WeakMap<StorageService, StorageFacade>();
                const storage = providePerConsumer(
                    keys.storage,
                    (consumer): StorageService => {
                        const facade = createStorageFacade(consumer, {
                            user: () => remoteRoute(context.remote.on(consumer), userStorageContract),
                            project: () => (bound ? remoteRoute(context.remote.on(consumer), projectStorageContract) : {ok: false, code: "no-project", detail: "这个窗口没有绑定项目"}),
                        });
                        facades.set(facade.service, facade);
                        return facade.service;
                    },
                    {release: (service) => facades.get(service)?.release()},
                );
                return {services: [storage]};
            },
        }],
    };
}
