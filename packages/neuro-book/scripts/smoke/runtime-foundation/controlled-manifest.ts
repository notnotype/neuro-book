/**
 * 受控装配：第一切片验收用的清单。只证明公共机制，没有产品含义；能力全部是内存实现，
 * 不初始化数据库、不调用 Provider、不读写用户数据。同一份清单在后端进程与浏览器页面装配，
 * 能力来源（进程时钟 / 页面时钟、远端在场代理）由宿主注入。
 */

import type {ApplicationManifest, CapabilityProvider} from "../../../runtime/application/application";
import type {RuntimeLocation} from "../../../runtime/lifecycle/lifecycle";
import type {ContributionHandle, ContributionPointDefinition, ContributionReceiver, PluginDefinition, RevokeReason} from "../../../runtime/plugins/plugins";
import {provide} from "../../../runtime/plugins/plugins";
import {defineServiceKey} from "../../../runtime/services/services";

export interface Clock {
    now(): number;
}

/** 远端在场关系：本实例向共享后端登记/释放自己的在场；释放不是全局关闭。 */
export interface Presence {
    readonly id: string;
}

export interface Greeter {
    greet(name: string): string;
}

export type Command = (argument: string) => string;

export const clockKey = defineServiceKey<Clock>("clock");
export const presenceKey = defineServiceKey<Presence>("presence");
export const greeterKey = defineServiceKey<Greeter>("greeter/greeter");

export interface CommandTable {
    readonly receiver: ContributionReceiver<{readonly title: string}, Command, string>;
    /** 经句柄取实现执行；未发布或已撤回时返回 null。 */
    run(id: string, argument: string): string | null;
    readonly revocations: ReadonlyArray<{readonly id: string; readonly reason: RevokeReason}>;
}

export function createCommandTable(): CommandTable {
    const handles = new Map<string, ContributionHandle<{readonly title: string}, Command>>();
    const revocations: Array<{readonly id: string; readonly reason: RevokeReason}> = [];
    return {
        receiver: {
            prepare: (handle) => `${handle.id}#${handle.generation}`,
            commit: (handle) => {
                handles.set(handle.id, handle);
            },
            revoke: (handle, _prepared, reason) => {
                handles.delete(handle.id);
                revocations.push({id: handle.id, reason});
            },
        },
        run(id, argument) {
            const handle = handles.get(id);
            if (handle === undefined || !handle.published) {
                return null;
            }
            return handle.implementation()(argument);
        },
        revocations,
    };
}

export interface ControlledManifestInput {
    readonly location: RuntimeLocation;
    readonly clock: CapabilityProvider<Clock>;
    readonly presence: CapabilityProvider<Presence>;
    readonly commands: CommandTable;
    /** 注入一个必需门禁失败（门禁故障场景）。 */
    readonly failRequired?: boolean;
    /** 加入一个激活必失败的可选插件与可选门禁（无关消费者继续可用场景）。 */
    readonly failOptional?: boolean;
}

/** greeter 插件依赖 clock，提供 greeter 服务与一条命令；flaky 插件只在注入可选失败时加入。 */
export function createControlledManifest(input: ControlledManifestInput): ApplicationManifest {
    const commandsPoint: ContributionPointDefinition<{readonly title: string}> = {
        id: "commands",
        implementation: "required",
        validate: ({declaration}) => declaration.title.trim() === "" ? "title 不能为空" : null,
    };
    const commandOwner: PluginDefinition = {
        id: "command-owner",
        contributionPoints: [commandsPoint],
        entries: [{
            id: "main",
            location: input.location,
            receives: ["commands"],
            activate: () => ({receivers: {commands: input.commands.receiver}}),
        }],
    };

    const greeter: PluginDefinition = {
        id: "greeter",
        entries: [
            {
                id: "main",
                location: input.location,
                dependencies: [{key: clockKey}],
                provides: [greeterKey],
                contributions: [{capability: "commands", id: "greeter.greet", declaration: {title: "greet"}}],
                activate: (context) => {
                    const clock = context.services.require(clockKey);
                    const instance: Greeter = {greet: (name) => `hello ${name} @${clock.now()}`};
                    return {
                        services: [provide(greeterKey, instance)],
                        contributions: {commands: {"greeter.greet": (argument: string) => instance.greet(argument)}},
                    };
                },
            },
        ],
    };
    const flaky: PluginDefinition = {
        id: "flaky",
        entries: [
            {
                id: "main",
                location: input.location,
                contributions: [{capability: "commands", id: "flaky.run", declaration: {title: "flaky"}}],
                activate: () => {
                    throw new Error("flaky 激活失败 token=should-not-leak");
                },
            },
        ],
    };
    const gates: Array<ApplicationManifest["gates"][number]> = [
        {id: "presence", kind: "resolve", key: presenceKey},
        {id: "greeter", kind: "activate", entry: {plugin: "greeter", entry: "main"}},
    ];
    if (input.failOptional) {
        gates.push({id: "flaky", kind: "activate", required: false, entry: {plugin: "flaky", entry: "main"}});
    }
    if (input.failRequired) {
        gates.push({
            id: "injected-failure",
            kind: "check",
            check: () => {
                throw new Error("注入的必需门禁失败 secret=should-not-leak");
            },
        });
    }
    return {
        keys: [clockKey, presenceKey, greeterKey],
        capabilities: [input.clock, input.presence],
        plugins: input.failOptional ? [commandOwner, greeter, flaky] : [commandOwner, greeter],
        requiredPlugins: [commandOwner.id],
        gates,
    };
}
