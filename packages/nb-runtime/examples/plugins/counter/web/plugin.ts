/**
 * `example.counter` 的浏览器入口：把服务端的远程服务包成窗口里的本地服务 `CounterService`。
 *
 * `context.remote.use(合同).at("server")` 以本入口的身份调用服务端；订阅登记在本入口这一代上，入口停止时内核
 * 替它结束。不声明启动激活：窗口里有插件依赖 `CounterService` 时才激活。
 */

import {provide} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";

import {descriptor} from "../plugin";
import {counterContract, counterKey} from "../shared/contracts";
import type {CounterService} from "../shared/contracts";

export const counterBrowserPlugin: PluginDefinition = {
    id: descriptor.id,
    entries: [{
        id: "browser",
        location: "browser",
        provides: [counterKey],
        activate: (context) => {
            const server = context.remote.use(counterContract).at("server");
            const counter: CounterService = {
                increment: (by) => server.increment({by}),
                current: () => server.current({}),
                watch: (listener) => server.events.changed.subscribe({}, listener),
            };
            return {services: [provide(counterKey, counter)]};
        },
    }],
};
