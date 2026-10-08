/**
 * 示例 1：一个插件提供服务，另一个插件依赖它。
 *
 * - `example.clock` 提供共享服务 `ClockService`（`provide`，同一实例里所有依赖者拿到同一个对象），
 *   不声明激活事件：没有谁依赖它时不激活。
 * - `example.greeter` 启动即激活（`onStartup`），声明依赖 `ClockService`：内核先激活 clock，
 *   再激活 greeter，`context.services.require` 在激活时直接拿到实例。
 * - 资源登记在入口的作用域上（`context.scope.register`），停止时按依赖的逆序释放：先 greeter，后 clock。
 *
 * 行为合同：docs/specs/runtime/services.md、plugins.md、application.md、lifecycle.md。
 * 运行：`bun packages/nb-runtime/examples/01-services.ts`。
 */

import {createApplication} from "@notnotype/nb-runtime/application";
import {provide} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {defineServiceKey} from "@notnotype/nb-runtime/services";

/** 服务的接口与键。键名以提供它的插件 id 加 `/` 开头。 */
export interface ClockService {
    now(): string;
}

export const clockKey = defineServiceKey<ClockService>("example.clock/clock");

export function clockPlugin(log: string[]): PluginDefinition {
    return {
        id: "example.clock",
        entries: [{
            id: "main",
            location: "server",
            provides: [clockKey],
            activate: () => {
                log.push("clock 激活");
                // 第三个参数是服务实例的释放函数：所有依赖者释放之后才调用。
                return {services: [provide(clockKey, {now: () => "09:00"}, () => void log.push("clock 释放"))]};
            },
        }],
    };
}

export function greeterPlugin(log: string[]): PluginDefinition {
    return {
        id: "example.greeter",
        entries: [{
            id: "main",
            location: "server",
            activationEvents: ["onStartup"],
            dependencies: [{key: clockKey}],
            activate: (context) => {
                const clock = context.services.require(clockKey);
                log.push(`greeter 激活：现在是 ${clock.now()}`);
                // 入口自己持有的资源（连接、定时器、订阅……）登记在作用域上，随这一代入口一起释放。
                context.scope.register({kind: "example", label: "greeter 的资源", value: null, release: () => void log.push("greeter 释放")});
                return {};
            },
        }],
    };
}

/** 起一个运行实例、等启动完成、再停止，返回过程记录。 */
export async function runServicesExample(): Promise<{readonly log: ReadonlyArray<string>; readonly startup: string; readonly stop: string}> {
    const log: string[] = [];
    const app = createApplication(
        // 宿主给出的上下文：实例身份、停止来源、紧急输出。真实宿主见 packages/neuro-book/src/server/host.ts。
        {identity: {location: "server", instanceId: "example"}, stopSignal: new AbortController().signal, emergency: () => undefined},
        // 清单：本实例用到的服务键、插件与启动门禁。
        {keys: [clockKey], plugins: [clockPlugin(log), greeterPlugin(log)], gates: []},
    );
    const startup = await app.startup;
    const stop = await app.stop();
    return {log, startup: startup.status, stop: stop.status};
}

if (import.meta.main) {
    console.log(await runServicesExample());
}
