/**
 * runtime.lifecycle：运行作用域与资源生命周期机制的唯一公开入口。
 *
 * Owner 为 runtime。本模块及同目录实现只允许同目录相对导入：不依赖 Vue、Nuxt、Nitro、
 * 文件或数据库驱动、Project、Agent 等任何产品领域，以便在浏览器、后端进程与受管 Worker
 * 上复用。模块顶层没有 I/O、没有单例、没有计时器：全部状态都在 `createRuntimeInstance`
 * 返回的实例内，截止时间由调用方以 `AbortSignal` 提供。
 *
 * 数据边界：机制只在内存里维护作用域、资源登记、借用、在途工作与失败记录；不引入持久
 * 状态，不删除任何持久数据。资源创建与释放的实际 I/O 由资源提供者执行，机制只保证登记、
 * 顺序、门禁与失败留痕。
 *
 * 行为合同见 docs/specs/runtime/lifecycle.md。
 */

import type {RuntimeInstance, RuntimeInstanceIdentity, RuntimeInstanceOptions} from "./contracts";
import {createInstanceContext, ScopeImpl} from "./scope";

export type * from "./contracts";
export {LifecycleStateError} from "./contracts";
export {summarizeFailure} from "./scope";

/**
 * 创建一个运行实例。两次调用得到的实例互不共享任何状态；根作用域从 creating 开始，
 * 宿主登记必需资源后调用 `root.open()` 才对外可用。
 */
export function createRuntimeInstance(
    identity: RuntimeInstanceIdentity,
    options: RuntimeInstanceOptions = {},
): RuntimeInstance {
    if (identity.instanceId.trim() === "") {
        throw new TypeError("运行实例必须有非空 instanceId");
    }
    const context = createInstanceContext(
        {location: identity.location, instanceId: identity.instanceId},
        options.observer,
    );
    return {
        identity: context.identity,
        root: new ScopeImpl(context, null, "root"),
    };
}
