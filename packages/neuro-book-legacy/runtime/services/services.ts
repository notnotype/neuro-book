/**
 * runtime.services：服务装配与依赖解析机制的唯一公开入口。
 *
 * Owner 为 runtime。本模块及同目录实现只允许同目录相对导入与 `../lifecycle/lifecycle`：
 * 不依赖 Vue、Nuxt、Nitro、文件或数据库驱动、Project、Agent 等任何产品领域。模块顶层没有 I/O、
 * 没有单例、没有计时器；服务键以对象身份比较，不做字符串万能定位，也不自动扫描。
 *
 * 数据边界：装配只在内存里维护声明、每次初始化尝试与诊断；服务实例是 runtime.lifecycle 里
 * 服务作用域的资源，创建与释放的实际 I/O 由提供者执行。
 *
 * 行为合同见 docs/specs/runtime/services.md。
 */

import type {RuntimeInstance} from "../lifecycle/lifecycle";

import {ServiceAssemblyImpl} from "./composition";
import type {ServiceAssembly, ServiceAssemblyOptions, ServiceKey} from "./contracts";

export type * from "./contracts";

/** 定义一个类型化服务键；每次调用得到不同身份，同名不等价。 */
export function defineServiceKey<T>(name: string): ServiceKey<T> {
    if (name.trim() === "") {
        throw new TypeError("服务键必须有非空名称");
    }
    return Object.freeze({name}) as ServiceKey<T>;
}

/**
 * 为一个运行实例创建服务装配。两个装配互不共享声明与初始化结果；声明只能引用 `options.keys`
 * 里的受信服务键。
 */
export function createServiceAssembly(instance: RuntimeInstance, options: ServiceAssemblyOptions): ServiceAssembly {
    return new ServiceAssemblyImpl(instance, options);
}
