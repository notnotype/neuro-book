/**
 * 示例宿主给插件的本地能力。产品宿主的能力键在 `src/shared/host.ts`（状态根、时钟、整页导航、窗口连接状态）与
 * `src/shared/projects.ts`（项目），示例插件也照样用；这里另放一个示例自己的时钟键：场景 01 要演示宿主不给某项能力时
 * 依赖它的入口受阻，而产品的时钟 `clockKey` 内置插件也在用，不能拿走。
 *
 * 为什么要有这个文件：插件定义是常量，不接受工厂参数（docs/adr/0026-plugin-definitions-as-constants.md）。插件要宿主
 * 的东西时，在入口的 `dependencies` 里声明能力的键，宿主在应用清单的 `capabilities` 里给出实现。键要放在插件与宿主
 * 都能引用的地方，所以和插件代码一样平台中立：不用 Bun、Node 与 DOM 的接口。
 */

import {defineServiceKey} from "@notnotype/nb-runtime/services";
import type {ServiceKey} from "@notnotype/nb-runtime/services";

/**
 * 宿主的时钟。插件不自己读系统时间、不自己开 `setTimeout`：宿主给什么时钟就用什么时钟。产品里给系统时钟（与内核的
 * `systemClock` 同一个形状），场景测试给可以手动推进的时钟，测试因此不用真的等。
 */
export interface HostClock {
    /** 当前时间，毫秒。 */
    now(): number;
    /** `ms` 毫秒后调用一次 `callback`；返回的函数取消还没触发的调用，重复调用没有副作用。 */
    schedule(callback: () => void, ms: number): () => void;
}

/**
 * 宿主能力不归哪个插件所有，id 用宿主的前缀，不用插件 id 加 `/`（产品宿主用 `nbook/`，示例宿主用 `example/`）。
 * 服务键按 id 识别（docs/adr/0025-service-keys-by-id.md）：同一个 id 只在这里定义一次。
 */
export const hostClockKey: ServiceKey<HostClock> = defineServiceKey<HostClock>("example/clock");
