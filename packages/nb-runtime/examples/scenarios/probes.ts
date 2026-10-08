/**
 * 测试探针：站在“使用这些服务的插件”的位置上。启动即激活，把拿到的本地服务或远程访问交给场景。
 * 产品里没有这样的插件；应用包的同类探针见 `packages/neuro-book/src/server/testing/`。
 */

import {defineEntry} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition, PluginRemoteAccess} from "@notnotype/nb-runtime/plugins";
import type {ServiceKey} from "@notnotype/nb-runtime/services";

export interface ServiceProbe {
    readonly definition: PluginDefinition;
    /** 激活后才有；激活前调用抛错。 */
    get<T>(key: ServiceKey<T>): T;
}

export function serviceProbe(id: string, location: string, keys: ReadonlyArray<ServiceKey<unknown>>): ServiceProbe {
    const services = new Map<ServiceKey<unknown>, unknown>();
    return {
        definition: {
            id,
            entries: [defineEntry({
                id: location,
                location,
                activationEvents: ["onStartup"],
                dependencies: keys.map((key) => ({key})),
                activate: (context) => {
                    for (const key of keys) services.set(key, context.services.require(key));
                    return {};
                },
            })],
        },
        get: <T>(key: ServiceKey<T>): T => {
            if (!services.has(key)) throw new Error(`探针 ${id} 还没拿到 ${key.name}`);
            return services.get(key) as T;
        },
    };
}

export interface RemoteProbe {
    readonly definition: PluginDefinition;
    /** 探针入口的远程访问，以探针插件自己的身份调用；激活后才有，激活前调用抛错。 */
    remote(): PluginRemoteAccess;
}

export function remoteProbe(id: string, location: string): RemoteProbe {
    let remote: PluginRemoteAccess | null = null;
    return {
        definition: {
            id,
            entries: [defineEntry({
                id: location,
                location,
                activationEvents: ["onStartup"],
                activate: (context) => {
                    remote = context.remote;
                    return {};
                },
            })],
        },
        remote: (): PluginRemoteAccess => {
            if (remote === null) throw new Error(`探针 ${id} 还没激活`);
            return remote;
        },
    };
}
