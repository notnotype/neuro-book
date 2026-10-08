/**
 * `example.greeter` 的服务端入口：依赖 `example.clock` 的报时服务，提供问候服务。
 *
 * 依赖写在 `dependencies` 里，服务键从 clock 的合同模块引用：激活前内核先解析它（必要时先激活提供方），解析不到时
 * 本入口受阻、不激活，原因可查询。激活时用 `context.services.require` 直接取。工厂没有参数：它不需要宿主给的配置。
 */

import {provide} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {clockKey} from "../../clock/shared/contracts";
import {descriptor} from "../plugin";
import {greeterKey} from "../shared/contracts";

export function createGreeterServerPlugin(): PluginDefinition {
    return {
        id: descriptor.id,
        entries: [{
            id: "server",
            location: "server",
            dependencies: [{key: clockKey}],
            provides: [greeterKey],
            activate: (context) => {
                const clock = context.services.require(clockKey);
                return {services: [provide(greeterKey, {greet: (name) => `${period(clock.now())}好，${name}`})]};
            },
        }],
    };
}

function period(ms: number): string {
    const hour = new Date(ms).getUTCHours();
    return hour < 12 ? "上午" : hour < 18 ? "下午" : "晚上";
}
