/**
 * `example.clock` 的服务端入口：依赖宿主能力 `hostClockKey`，把宿主的时钟包成报时服务交给别的插件（`provide`，
 * 所有依赖者拿到同一个对象）。插件定义是常量：宿主的东西经能力取得，不经工厂参数。
 * 不声明激活事件：只有当某个要激活的入口依赖它时，内核才先激活它。
 */

import {provide} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";

import {hostClockKey} from "../../../shared/host";
import {descriptor} from "../plugin";
import {clockKey} from "../shared/contracts";

export const clockBackendPlugin: PluginDefinition = {
    id: descriptor.id,
    entries: [{
        id: "server",
        location: "server",
        dependencies: [{key: hostClockKey}],
        provides: [clockKey],
        activate: (context) => {
            const host = context.services.require(hostClockKey);
            return {services: [provide(clockKey, {now: () => host.now(), hour: () => new Date(host.now()).getUTCHours()})]};
        },
    }],
};
