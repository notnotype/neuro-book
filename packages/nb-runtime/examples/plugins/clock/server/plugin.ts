/**
 * `example.clock` 的服务端入口：把宿主给的时钟包成共享服务（`provide`，所有依赖者拿到同一个对象）。
 * 不声明激活事件：只有当某个要激活的入口依赖它时，内核才先激活它。
 */

import type {RuntimeClock} from "@notnotype/nb-runtime/lifecycle";
import {provide} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";

import {descriptor} from "../plugin";
import {clockKey} from "../shared/contracts";

export interface ClockServerOptions {
    /** 宿主的时钟：产品用系统时钟，测试注入可手动推进的时钟。插件不自己读系统时间。 */
    readonly clock: RuntimeClock;
}

export function createClockServerPlugin(options: ClockServerOptions): PluginDefinition {
    return {
        id: descriptor.id,
        entries: [{
            id: "server",
            location: "server",
            provides: [clockKey],
            activate: () => ({services: [provide(clockKey, {now: () => options.clock.now()})]}),
        }],
    };
}
