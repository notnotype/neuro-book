/**
 * runtime.plugins：插件描述、激活与贡献事务机制的唯一公开入口。
 *
 * Owner 为 runtime。本模块及同目录实现只允许同目录相对导入与 `../lifecycle/lifecycle`、
 * `../services/services`：不依赖 Vue、Nuxt、Nitro、文件或数据库驱动、Project、Agent 等任何
 * 产品领域，也不内置命令、View、设置或 Storage 的领域语义——能力 owner 以贡献接收者接入。
 * 模块顶层没有 I/O、没有单例、没有计时器；只装配受信内置定义，不扫描、不动态加载。
 *
 * 数据边界：目录与激活状态只在内存里；激活创建的资源归激活作用域并由 runtime.lifecycle 收口；
 * 文件、数据库、日志等持久记录由各领域合同拥有，本机制不删除任何持久数据。
 *
 * 行为合同见 docs/specs/runtime/plugins.md。
 */

import type {RuntimeInstance} from "../lifecycle/lifecycle";
import type {ServiceAssembly, ServiceKey} from "../services/services";

import type {PluginHost, PluginHostOptions, ProvidedService} from "./contracts";
import {PluginHostImpl} from "./host";

export type * from "./contracts";
export {PluginStateError} from "./contracts";

/** 创建一个插件宿主：绑定到一个运行实例（即一个运行位置）与其服务装配。两个宿主互不共享状态。 */
export function createPluginHost(instance: RuntimeInstance, assembly: ServiceAssembly, options: PluginHostOptions): PluginHost {
    if (assembly.instanceId !== instance.identity.instanceId) {
        throw new TypeError(`服务装配属于实例 ${assembly.instanceId}，不是 ${instance.identity.instanceId}`);
    }
    return new PluginHostImpl(instance, assembly, options);
}

/** 构造激活产出中的一项提供服务；`release` 在服务代次关闭或激活产出被收口时调用一次。 */
export function provide<T>(key: ServiceKey<T>, instance: T, release?: (instance: T) => void | Promise<void>): ProvidedService {
    return {
        key,
        instance,
        release: release === undefined ? undefined : (value) => release(value as T),
    };
}
