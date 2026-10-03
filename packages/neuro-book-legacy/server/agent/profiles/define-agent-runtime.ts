import type {
    AgentRuntimeBuiltin,
    AgentRuntimeDefinition,
    AgentRuntimeHook,
    AgentRuntimeHookContext,
    AgentRuntimeHookResult,
    AgentRuntimeHookStage,
    AgentRuntimeItem,
    NormalizedAgentRuntimeDefinition,
    ProfileJsonValue,
    RuntimeAgentDialogueContentInput,
    RuntimeSessionFacade,
    RuntimeSessionReadResult,
} from "nbook/profile-sdk/contracts";
export type {
    AgentRuntimeBuiltin,
    AgentRuntimeDefinition,
    AgentRuntimeHook,
    AgentRuntimeHookContext,
    AgentRuntimeHookResult,
    AgentRuntimeHookStage,
    AgentRuntimeItem,
    NormalizedAgentRuntimeDefinition,
    RuntimeAgentDialogueContentInput,
    RuntimeSessionFacade,
    RuntimeSessionReadResult,
} from "nbook/profile-sdk/contracts";

/**
 * 定义 profile runtime hook bundle。
 *
 * 这个 helper 只规范化 hook 声明，不创建 session，也不执行副作用。
 */
export function defineAgentRuntime<TInitial = ProfileJsonValue>(runtime: AgentRuntimeDefinition<TInitial>): NormalizedAgentRuntimeDefinition<TInitial> {
    const hooks = expandRuntimeHooks(runtime.hooks);
    const seen = new Set<string>();
    for (const hook of hooks) {
        if (!hook.name.trim()) {
            throw new Error("runtime hook name 不能为空");
        }
        const key = `${hook.stage}:${hook.name}`;
        if (seen.has(key)) {
            throw new Error(`runtime hook 重复：${key}`);
        }
        seen.add(key);
    }
    return {hooks};
}

export const agentRuntimeBuiltins = {
    defaultSessionRuntime<TInitial = ProfileJsonValue>(): NormalizedAgentRuntimeDefinition<TInitial> {
        return defineAgentRuntime({
            hooks: [
                this.sessionRuntime<TInitial>(),
            ],
        });
    },
    sessionRuntime<TInitial = ProfileJsonValue>(): AgentRuntimeBuiltin<TInitial> {
        return {
            kind: "builtin",
            name: "sessionRuntime",
            hooks: [
                this.profilePrompt<TInitial>(),
                this.sessionContext<TInitial>(),
                this.transcriptPersistence<TInitial>(),
                this.reportResult<TInitial>(),
            ],
        };
    },
    profilePrompt<TInitial = ProfileJsonValue>(): AgentRuntimeHook<TInitial> {
        return builtinHook("profilePrompt", "prepareRun", {
            builtinBehavior: {
                profilePrompt: true,
            },
        });
    },
    sessionContext<TInitial = ProfileJsonValue>(): AgentRuntimeHook<TInitial> {
        return builtinHook("sessionContext", "prepareRun", {
            builtinBehavior: {
                sessionContext: true,
            },
        });
    },
    transcriptPersistence<TInitial = ProfileJsonValue>(): AgentRuntimeHook<TInitial> {
        return builtinHook("transcriptPersistence", "ingestTurn", {
            transcript: "persist",
        });
    },
    runtimeOnlyTranscript<TInitial = ProfileJsonValue>(): AgentRuntimeHook<TInitial> {
        return builtinHook("runtimeOnlyTranscript", "ingestTurn", {
            transcript: "runtime_only",
        });
    },
    reportResult<TInitial = ProfileJsonValue>(): AgentRuntimeHook<TInitial> {
        return {
            name: "builtin.reportResult",
            stage: "prepareRun",
            builtin: true,
            run(ctx) {
                return {
                    builtinBehavior: {
                        reportResultReminder: ctx.invocation.caller.kind !== "user",
                    },
                };
            },
        };
    },
};

function expandRuntimeHooks<TInitial>(items: readonly AgentRuntimeItem<TInitial>[]): AgentRuntimeHook<TInitial>[] {
    return items.flatMap((item) => isRuntimeBuiltin(item) ? item.hooks : [item]);
}

function isRuntimeBuiltin<TInitial>(item: AgentRuntimeItem<TInitial>): item is AgentRuntimeBuiltin<TInitial> {
    return "kind" in item && item.kind === "builtin";
}

function builtinHook<TInitial = ProfileJsonValue>(name: string, stage: AgentRuntimeHookStage, result: AgentRuntimeHookResult = {}): AgentRuntimeHook<TInitial> {
    return {
        name: `builtin.${name}`,
        stage,
        builtin: true,
        run() {
            return result;
        },
    };
}
