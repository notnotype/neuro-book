/**
 * `example.clock` 的服务端入口。读这个文件学四件事：
 *
 * 1. **依赖宿主能力**：入口在 `dependencies` 里声明 `hostClockKey`，激活时用 `context.services.require` 取出宿主给的
 *    时钟。插件定义是常量，宿主的东西不经工厂参数交进来（docs/adr/0026-plugin-definitions-as-constants.md）。
 * 2. **提供共享服务**：`provide(clockKey, 服务)` 交出一个对象，所有依赖 `clockKey` 的入口拿到同一个
 *    （docs/specs/runtime/plugins.md 输出第 19 条）。要按调用方区分时用 `providePerConsumer`，见 `notes` 的浏览器入口。
 * 3. **按需激活**：入口不写 `activationEvents`。只有当某个要激活的入口依赖 `clockKey`，或者解析它的可选依赖时，内核
 *    才先激活 clock；没人用就一直停在“已登记”，不占资源（docs/specs/runtime/services.md 输出第 9 条）。
 * 4. **停止时收拾干净**：`context.signal` 在入口开始停止时触发，用来尽早答复还在等的调用方；`context.scope.register`
 *    登记本入口占用的资源，内核在收口时按顺序释放它。两者的分工见 `activate` 里的注释。
 *
 * 对应的场景：`scenarios/01-services.test.ts`。
 */

import {defineEntry, provide} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";

import {hostClockKey} from "../../../shared/host";
import {descriptor} from "../plugin";
import {clockKey} from "../shared/contracts";
import type {ClockService, UntilResult} from "../shared/contracts";

const STOPPED: UntilResult = {ok: false, code: "stopped"};

/** 一个还没到点的 `until`。 */
interface Wait {
    readonly at: number;
    settle(result: UntilResult): void;
}

/**
 * 插件定义是一个常量：`id` 与描述一致，`entries` 列出各运行位置的入口。这份定义只在后端（服务端与项目实例）装配，
 * 所以放在 `backend/`；浏览器的定义放在 `web/`，两边互不引用。
 */
export const clockBackendPlugin: PluginDefinition = {
    id: descriptor.id,
    entries: [
        // `defineEntry` 在编译期核对“声明”与“激活产出”是否一致：`provides` 写了 `clockKey`，`activate` 的返回值
        // 就必须交出这项服务，漏交或多交都编译不过（docs/specs/runtime/plugin-api.md）。
        defineEntry({
            id: "server",
            location: "server",
            // 必需依赖（`required` 缺省为 true）：宿主没给时钟时，这个入口受阻，原因是 `missing-service`，可以从
            // `app.plugins.entryState` 查到；受阻的入口不会被激活，`activate` 不会在缺东西的情况下运行
            // （docs/specs/runtime/plugins.md 输出第 11 条）。
            dependencies: [{key: hostClockKey}],
            provides: [clockKey],
            activate: (context) => {
                // 必需依赖在激活前已经解析好，`require` 直接返回服务本身。只能取 `dependencies` 里声明过的键：
                // 取没声明的键会抛错，那是入口定义写错了，不是运行期的失败。
                const host = context.services.require(hostClockKey);

                // 等待按到点时刻排好；整个入口只占一个宿主计时器，对准最早的那个。
                const waits: Wait[] = [];
                const timer: {cancel: (() => void) | null} = {cancel: null};
                const rearm = (): void => {
                    timer.cancel?.();
                    timer.cancel = null;
                    const next = waits[0];
                    if (next !== undefined) timer.cancel = host.schedule(fire, Math.max(0, next.at - host.now()));
                };
                const fire = (): void => {
                    timer.cancel = null;
                    while (waits[0] !== undefined && waits[0].at <= host.now()) waits.shift()?.settle({ok: true});
                    rearm();
                };

                // 资源：宿主计时器是本入口从宿主那里借来的东西，入口停止时必须还回去，否则停止之后它还会到点、
                // 回调还会运行。登记在 `context.scope` 上，内核在这一代入口收口时调用 `release`：先等依赖 clock 的
                // 入口都停完，再释放 clock 自己的资源（docs/specs/runtime/plugins.md 输出第 13 条），释放失败也会记进
                // 收口结果，可以查到。不登记、改成自己在某处取消，就要自己保证所有停止路径（正常停止、激活失败、
                // 宿主强制停止）都走到那里。
                context.scope.register({
                    kind: "host-timer",
                    label: `${descriptor.id} 的宿主计时器`,
                    value: timer,
                    release: (slot) => {
                        slot.cancel?.();
                        slot.cancel = null;
                    },
                });

                // 停止信号：入口一开始停止，`context.signal` 就触发；整个实例停止时，内核同时向所有入口发出它，早于
                // 任何资源的释放。这里用它立即答复还在等的调用方。为什么不等到上面的 `release` 再答复：依赖 clock
                // 的入口要先停完，clock 的资源才释放；依赖者要是在自己的停止流程里等 `until` 的结果，就会等一个排在
                // 自己之后才发生的答复，停止卡住。计时器仍留给 `release` 取消：到点也只会发现没有等待了。
                context.signal.addEventListener("abort", () => {
                    for (const wait of waits.splice(0)) wait.settle(STOPPED);
                }, {once: true});

                const service: ClockService = {
                    now: async () => host.now(),
                    until: (at) => {
                        // 停止已经开始：不再接新的等待，直接答复，否则这个等待永远不会到点。
                        if (context.signal.aborted) return Promise.resolve(STOPPED);
                        if (at <= host.now()) return Promise.resolve({ok: true});
                        const {promise, resolve} = Promise.withResolvers<UntilResult>();
                        const later = waits.findIndex((wait) => wait.at > at);
                        waits.splice(later === -1 ? waits.length : later, 0, {at, settle: resolve});
                        // 新的等待排在最前时，计时器要对准它。
                        if (waits[0]?.at === at) rearm();
                        return promise;
                    },
                };
                return {services: [provide(clockKey, service)]};
            },
        }),
    ],
};
