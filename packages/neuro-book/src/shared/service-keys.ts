import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import type {ServiceKey} from "@notnotype/nb-runtime/services";

/**
 * 运行实例清单的服务键登记表：插件入口提供与依赖的全部键，外加宿主门禁要解析的键。
 * 前后端宿主都按装配出的插件定义计算，不手写键列表。
 */
export function collectServiceKeys(plugins: ReadonlyArray<PluginDefinition>, extra: ReadonlyArray<ServiceKey<unknown>> = []): ServiceKey<unknown>[] {
    const keys = new Set<ServiceKey<unknown>>(extra);
    for (const plugin of plugins) {
        for (const entry of plugin.entries) {
            for (const key of entry.provides ?? []) keys.add(key);
            for (const dependency of entry.dependencies ?? []) keys.add(dependency.key);
        }
    }
    return [...keys];
}
