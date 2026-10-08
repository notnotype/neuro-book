/**
 * `example.greeter` 的服务端入口：依赖 `example.clock` 的报时服务，提供问候服务。
 *
 * 依赖写在 `dependencies` 里：激活前内核先解析它（必要时先激活提供方），解析不到时本入口受阻、不激活，
 * 原因可查询。激活时用 `context.services.require` 直接取。
 */

import {provide} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import type {ServiceKey} from "@notnotype/nb-runtime/services";

import type {ClockService} from "../../clock/shared/contracts";
import {descriptor} from "../plugin";
import {greeterKey} from "../shared/contracts";

/** 依赖的其它插件的服务键，由宿主装配时交进来（键按对象身份比较，插件之间只 `import type`）。 */
export interface GreeterServiceKeys {
    readonly clock: ServiceKey<ClockService>;
}

export function createGreeterServerPlugin(keys: GreeterServiceKeys): PluginDefinition {
    return {
        id: descriptor.id,
        entries: [{
            id: "server",
            location: "server",
            dependencies: [{key: keys.clock}],
            provides: [greeterKey],
            activate: (context) => {
                const clock = context.services.require(keys.clock);
                return {services: [provide(greeterKey, {greet: (name) => `${period(clock.now())}好，${name}`})]};
            },
        }],
    };
}

function period(ms: number): string {
    const hour = new Date(ms).getUTCHours();
    return hour < 12 ? "上午" : hour < 18 ? "下午" : "晚上";
}
