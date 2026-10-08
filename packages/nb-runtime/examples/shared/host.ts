/**
 * 示例宿主（`scenarios/hosts.ts`）提供给插件的本地能力，对应应用包的 `src/shared/host.ts`。插件要宿主的东西时，
 * 在入口的 `dependencies` 里声明这里的键，不经工厂参数（docs/adr/0026-plugin-definitions-as-constants.md）。
 * 这个文件会被插件引用，所以和插件代码一样平台中立。
 */

import {defineServiceKey} from "@notnotype/nb-runtime/services";
import type {ServiceKey} from "@notnotype/nb-runtime/services";

/** 宿主的时钟：产品用系统时钟，测试注入可手动推进的时钟。插件不自己读系统时间。 */
export interface HostClock {
    /** 当前时间，毫秒。 */
    now(): number;
}

/** 宿主能力不归哪个插件所有，id 用宿主自己的前缀（应用包是 `nbook/`）。 */
export const hostClockKey: ServiceKey<HostClock> = defineServiceKey<HostClock>("example/clock");
