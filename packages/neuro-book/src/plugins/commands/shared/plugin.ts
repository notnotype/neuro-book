/**
 * `nbook.commands` 的入口：两个运行位置是同一份代码，各自持有一份命令表。
 *
 * 命令只经贡献点 `commands.definitions` 登记：贡献撤回（入口停止、插件禁用）时命令随之离开命令表，
 * 内核也替命令表保证同一 id 只有一条贡献。命令服务因此不提供命令式登记。
 */

import {diagnosticsKey} from "@notnotype/nb-runtime/diagnostics";
import type {DiagnosticsService} from "@notnotype/nb-runtime/diagnostics";
import type {RuntimeLocation} from "@notnotype/nb-runtime/lifecycle";
import {provide} from "@notnotype/nb-runtime/plugins";
import type {ContributionDescriptor, ContributionHandle, ContributionReceiver, PluginDefinition} from "@notnotype/nb-runtime/plugins";

import {descriptor} from "../plugin";
import type {ContextKeyTable} from "./context-keys";
import {COMMANDS_POINT, commandServiceKey} from "./contracts";
import type {CommandDeclaration, CommandImplementation, CommandResult, CommandService, Release} from "./contracts";
import {commandDeclarationProblems, createCommandRegistry} from "./registry";
import type {CommandRegistry} from "./registry";

/**
 * 产品命令表认识的上下文键。登记上下文键的贡献点随第一个产品消费者（编辑器插件）加入；在那之前产品命令表
 * 不认任何键，声明了 `when` 的命令贡献会被拒绝。
 */
const PRODUCT_CONTEXT_KEYS: ContextKeyTable = {};

function validateCommandContribution(contribution: ContributionDescriptor): string | null {
    const problems = commandDeclarationProblems(contribution.id, contribution.plugin, contribution.declaration, PRODUCT_CONTEXT_KEYS);
    return problems.length === 0 ? null : problems.join("；");
}

/** 只交出查询与执行：登记只能经贡献点，撤回才能由内核记账。 */
function serviceOf(registry: CommandRegistry): CommandService {
    return {
        get: (id) => registry.get(id),
        list: () => registry.list(),
        isEnabled: (id) => registry.isEnabled(id),
        execute: (id, args, invocation) => registry.execute(id, args, invocation),
        onDidChange: (listener) => registry.onDidChange(listener),
        onDidExecute: (listener) => registry.onDidExecute(listener),
    };
}

type CommandHandle = ContributionHandle<CommandDeclaration, CommandImplementation>;

function receiverOf(registry: CommandRegistry, diagnostics: DiagnosticsService): ContributionReceiver<CommandDeclaration, CommandImplementation, {release: Release | null}> {
    // 每次执行都经 implementation() 取实现：贡献撤回后不会再调到旧实现。
    const run = (handle: CommandHandle) => async (args: unknown): Promise<CommandResult<unknown>> => {
        try {
            return await handle.implementation().run(args);
        } catch (error) {
            diagnostics.record({level: "error", event: "commands.run-failed", message: `命令 ${handle.id} 执行时抛出异常`, error, source: {plugin: handle.plugin}});
            throw error;
        }
    };
    return {
        prepare: () => ({release: null}),
        commit(handle, prepared) {
            const registered = registry.register({id: handle.id, source: handle.plugin, declaration: handle.declaration, run: run(handle)});
            // 登记时的校验与贡献点的 validate 是同一份，id 唯一又由内核保证，走到这里说明两者不一致。
            if (!registered.ok) throw new Error(`命令 ${handle.id} 通过了贡献校验却没能登记：${registered.reason}`);
            prepared.release = registered.value;
        },
        revoke(_handle, prepared) {
            prepared.release?.();
            prepared.release = null;
        },
    };
}

export function createCommandsPlugin(location: RuntimeLocation): PluginDefinition {
    return {
        id: descriptor.id,
        contributionPoints: [{id: COMMANDS_POINT, implementation: "required", validate: validateCommandContribution}],
        entries: [{
            id: location,
            location,
            dependencies: [{key: diagnosticsKey}],
            provides: [commandServiceKey],
            receives: [COMMANDS_POINT],
            activate: (context) => {
                const diagnostics = context.services.require(diagnosticsKey);
                const registry = createCommandRegistry({
                    contextKeys: PRODUCT_CONTEXT_KEYS,
                    report: (error) => {
                        diagnostics.record({level: "warn", event: "commands.registry", message: error.message, source: {plugin: descriptor.id}});
                    },
                });
                return {
                    services: [provide(commandServiceKey, serviceOf(registry))],
                    receivers: {[COMMANDS_POINT]: receiverOf(registry, diagnostics)},
                };
            },
        }],
    };
}
