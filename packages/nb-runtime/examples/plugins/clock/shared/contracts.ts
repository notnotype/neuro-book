/**
 * `example.clock` 对其它插件公开的合同。别的插件只以 `import type` 引用这里：服务键是对象、按身份比较，
 * 由宿主装配时交给依赖它的插件工厂（见 `greeter/server/plugin.ts`）。
 */

import {defineServiceKey} from "@notnotype/nb-runtime/services";
import type {ServiceKey} from "@notnotype/nb-runtime/services";

export interface ClockService {
    /** 当前时间，毫秒。 */
    now(): number;
}

/** 服务 id 以提供它的插件 id 加 `/` 开头。 */
export const clockKey: ServiceKey<ClockService> = defineServiceKey<ClockService>("example.clock/clock");
