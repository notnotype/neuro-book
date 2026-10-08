/**
 * `example.counter` 的后端定义：一份定义，两个入口。服务端（`server`）与项目子进程（`project`）都是后端，共用这份
 * 代码；内核只激活与本实例运行位置相同的入口，另一个入口在这个实例里是“别处的入口”，不激活也不受阻。
 *
 * 服务端入口演示：
 * 1. **插件状态 store**：`defineStore` 在一处声明计数（持久化进 `nbook.storage`）与派生的公开键，只经 action 写
 *    （docs/specs/state/store.md）。
 * 2. **公开状态与命令**：公开键 `example.counter/nonzero` 绑定到 store 的派生值；命令 `example.counter.reset` 的
 *    `when` 引用它，计数为 0 时命令不可用（docs/specs/state/public-state.md、docs/specs/workbench/commands.md）。
 * 3. **远程服务**：合同、订阅、提供方看到的调用方（docs/specs/runtime/plugin-channel.md）。
 *
 * 项目入口演示：每个项目实例一份的远程服务，第一次有调用到达时才激活（docs/specs/runtime/projects.md）。
 *
 * 对应的场景：`scenarios/04-remote-service.test.ts`。
 */

import {computed, watch} from "@vue/reactivity";
import {Type} from "typebox";

import {diagnosticsKey} from "@notnotype/nb-runtime/diagnostics";
import {defineEntry} from "@notnotype/nb-runtime/plugins";
import type {PluginDefinition} from "@notnotype/nb-runtime/plugins";
import {provideRemote} from "@notnotype/nb-runtime/remote";
import type {RemoteSink} from "@notnotype/nb-runtime/remote";

import {COMMANDS_POINT} from "nbook/plugins/commands/shared/contracts";
import type {CommandDeclaration, CommandImplementation} from "nbook/plugins/commands/shared/contracts";
import {storageKey} from "nbook/plugins/storage/shared/contracts";
import {defineRecord} from "nbook/shared/storage";
import {defineStore} from "nbook/shared/store/store";

import {descriptor} from "../plugin";
import {counterContract, counterState, projectCounterContract, RESET_COMMAND} from "../shared/contracts";

/**
 * 计数在 `nbook.storage` 里的记录：user 分区、不分客户端（服务端没有客户端身份，`local` 记录在这里打不开）。记录的
 * 拥有者是 counter 自己，别的插件读不到。
 */
const countRecord = defineRecord({key: "count", scope: "user", locality: "shared", version: 1, schema: Type.Object({value: Type.Integer()}, {additionalProperties: false})});

/**
 * store 的定义是常量，和插件定义一样；`create` 在入口的 `activate` 里调用，每次激活一份，随这一代入口释放。
 *
 * setup 里能做的只有两件外部的事：`persist` 一条记录、`publish` 公开键（docs/specs/state/store.md 输出第 1–4 条）。
 * 状态都交出去，写只经 `actions`：读取方拿到的 `state` 是只读视图，字段的写方法留在这个闭包里。
 */
const counterStore = defineStore("counter", ({persist, publish}) => {
    // 持久化字段：`display` 是当前显示的值（还没收到首个快照时是 `initial`），`commit` 把修改排进队列并保存。保存
    // 用条件写，别处先写了会读最新值重放一次（同文输出第 9–11 条），所以 `change` 拿当前值算新值，不要捕获旧值。
    const count = persist(countRecord, {initial: {value: 0}});
    // 派生值：`computed` 随 `display` 变化。公开键直接绑定它，命令表求 `when` 时同步读到最新的值，不用另外通知。
    const nonzero = computed(() => count.display.value !== 0);
    publish(counterState, {nonzero});
    return {
        state: {count},
        actions: {
            increment: (by: number) => count.commit((current) => ({value: current.value + by})),
            reset: () => count.commit(() => ({value: 0})),
        },
    };
});

/** reset 命令的声明：随插件定义登记，入口还没激活时命令面板就能列出它（docs/specs/workbench/commands.md）。 */
const resetDeclaration: CommandDeclaration = {
    title: {"zh-CN": "计数器：归零", "en-US": "Counter: Reset"},
    description: "Reset the server-side example counter to zero",
    args: Type.Object({}, {additionalProperties: false}),
    effect: "write",
    // `when` 只引用本运行位置声明的布尔公开键。键为 false 或还没绑定时命令不可用，原因取键声明里的 `reason`。
    when: {requires: [counterState.key("nonzero")]},
};

/**
 * 等持久化字段第一次就绪：拿到了首个快照，或者打开失败（失败也算“结果已定”，`failure` 里有原因）。在 `@vue/reactivity`
 * 的 `watch` 里读 `ready`，它变化时回调运行。
 */
function untilReady(field: {readonly ready: boolean}): Promise<void> {
    if (field.ready) return Promise.resolve();
    return new Promise((resolve) => {
        const handle = watch(() => field.ready, (ready) => {
            if (!ready) return;
            handle.stop();
            resolve();
        });
    });
}

/** 订阅者的登记：每个订阅调用一次 `subscribe`，订阅结束时 `signal` 触发，在那里把它移出去。 */
function subscribers() {
    const sinks = new Set<RemoteSink<number>>();
    return {
        next: (value: number) => {
            for (const sink of sinks) sink.next(value);
        },
        subscribe: (_filter: unknown, sink: RemoteSink<number>, {signal}: {readonly signal: AbortSignal}) => {
            sinks.add(sink);
            signal.addEventListener("abort", () => sinks.delete(sink), {once: true});
        },
    };
}

export const counterBackendPlugin: PluginDefinition = {
    id: descriptor.id,
    entries: [
        defineEntry({
            id: "server",
            location: "server",
            // 启动即激活：命令要等贡献方入口激活、交出实现才进命令表，现在还没有按命令触发的激活事件，贡献命令的入口
            // 只能随启动激活（packages/neuro-book/AGENTS.md 的“命令”）。按需激活见下面的项目入口与 `notes`。
            activationEvents: ["onStartup"],
            dependencies: [{key: storageKey}, {key: diagnosticsKey}],
            remoteProvides: [counterContract],
            // 两种贡献写在一起：公开键的声明来自 `definePublicState`，命令的声明写在上面。声明在激活前就进目录，
            // 由各自的贡献点（`state.public`、`commands.definitions`）逐条校验。
            contributions: [...counterState.contributions, {capability: COMMANDS_POINT, id: RESET_COMMAND, declaration: resetDeclaration}],
            activate: async (context) => {
                const store = counterStore.create(context, {storage: context.services.require(storageKey), diagnostics: context.services.require(diagnosticsKey)});
                // 字段打开、读出首个快照是异步的（docs/specs/state/store.md 输出第 5 条）。等它就绪再完成激活：否则刚
                // 启动时 `current` 读到的是 `initial`（0），不是存着的计数，公开键也是 false。服务端的分区就在本进程里，
                // 首个快照通常转眼就到；在窗口或项目里用远程分区时，这段时间长得多。入口在 `activate` 完成之前不接受调用。
                await untilReady(store.state.count);
                const changed = subscribers();
                // 已确认的计数：store 的 `base` 只随 Storage 的订阅更新。服务端的 Storage 先通知订阅者、再返回保存
                // 结果，所以提交结算为 `saved` 时，`base` 已经是刚写下的值。
                const confirmed = (): number => {
                    const base = store.state.count.base;
                    return base?.status === "ok" ? base.value.value : 0;
                };
                // 每次写入成功就推送一次。推送早于返回结果：调用方拿到结果时，同一条链路上的事件已经先到了。
                const write = async (action: () => Promise<string>): Promise<string> => {
                    const result = await action();
                    if (result === "saved") changed.next(confirmed());
                    return result;
                };
                const reset: CommandImplementation = {
                    run: async () => {
                        const result = await write(() => store.actions.reset());
                        return result === "saved" ? {ok: true, value: null} : {ok: false, code: "execution-error", reason: `计数没有保存：${result}`};
                    },
                };
                return {
                    // `store.contributions` 是公开键的绑定（`state.public` 那一项），再加上命令的实现。
                    contributions: {...store.contributions, [COMMANDS_POINT]: {[RESET_COMMAND]: reset}},
                    remote: [
                        // 工厂收到调用方身份（插件、入口、所在实例），与按调用方门面是同一个机制。计数是全局一份，身份
                        // 只经 `caller` 演示提供方看得到谁在调。
                        provideRemote(counterContract, (consumer) => ({
                            methods: {
                                increment: async ({by}) => {
                                    const result = await write(() => store.actions.increment(by));
                                    if (result !== "saved") return {ok: false, code: "not-saved", detail: {result}} as const;
                                    return {ok: true, value: confirmed()};
                                },
                                current: async () => ({ok: true, value: confirmed()}),
                                caller: async () => ({ok: true, value: {plugin: consumer.plugin, instance: consumer.instanceId}}),
                            },
                            events: {changed: {subscribe: changed.subscribe}},
                        })),
                    ],
                };
            },
        }),
        defineEntry({
            id: "project",
            location: "project",
            // 不写激活事件：有 `remoteProvides`，第一次有调用到达这个项目实例时内核按 `onRemote` 激活它
            // （docs/specs/runtime/plugin-channel.md 输出第 5 条）。没人用的项目不为它付出任何东西。
            remoteProvides: [projectCounterContract],
            activate: () => {
                // 计数放在内存里：只活在这个项目实例里，项目关掉就没了。要留到下次打开，就用 `nbook.storage` 的
                // project 记录（`scope: "project"`，库在项目目录的 `.nbook/storage.sqlite`）。
                let count = 0;
                const changed = subscribers();
                return {
                    remote: [
                        provideRemote(projectCounterContract, () => ({
                            methods: {
                                increment: ({by}) => {
                                    count += by;
                                    changed.next(count);
                                    return {ok: true, value: count};
                                },
                                current: () => ({ok: true, value: count}),
                            },
                            events: {changed: {subscribe: changed.subscribe}},
                        })),
                    ],
                };
            },
        }),
    ],
};
