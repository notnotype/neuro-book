/**
 * runtime.application：运行实例启动、接纳、停止与结果查询的唯一公开入口。
 *
 * Owner 为 runtime。本目录只允许同目录相对导入与 lifecycle / services / plugins 三个机制入口：
 * 不依赖 Vue、Nuxt、Nitro、进程信号、DOM、文件或数据库驱动。宿主事件由环境适配器
 * （server/runtime/foundation、app/runtime）翻译为 `HostContext` 后交给这里；适配器用
 * `createInstanceTable` 持有自己的实例，同一身份的共享与退役规则只在这里实现。
 *
 * 数据边界：内核只在内存里维护清单登记、门禁结果与停止结果；本能力不定义用户持久格式，
 * 正常停止不删除任何配置、Project、数据库或 Storage 记录。
 *
 * 行为合同见 docs/specs/runtime/application.md。
 */

import {ApplicationImpl} from "./bootstrap";
import type {Application, ApplicationManifest, HostContext} from "./contracts";

export {createInstanceTable} from "./instances";
export type {InstanceTable} from "./instances";

export type * from "./contracts";

/** 创建并启动一个运行实例；启动结果在 `application.startup` 上共享。 */
export function createApplication(host: HostContext, manifest: ApplicationManifest): Application {
    return new ApplicationImpl(host, manifest);
}

/** 定时器可表示的最大延迟（有符号 32 位）；更大的值会被运行时缩成 1ms 并立即触发。 */
const MAX_TIMER_DELAY_MS = 2 ** 31 - 1;

/**
 * 宿主有界停止的常用形态：首次停止开始后 `ms` 毫秒截止。`AbortSignal.timeout` 在 Node 与浏览器
 * 都可用，且不阻止进程退出；停止先结算时无需清理。只接受 1..2^31-1 的整数毫秒。
 */
export function stopTimeout(ms: number): NonNullable<HostContext["stopDeadline"]> {
    if (!Number.isInteger(ms) || ms <= 0 || ms > MAX_TIMER_DELAY_MS) {
        throw new TypeError(`stopTimeoutMs 必须是 1..${MAX_TIMER_DELAY_MS} 的整数毫秒，收到 ${String(ms)}`);
    }
    return () => AbortSignal.timeout(ms);
}
