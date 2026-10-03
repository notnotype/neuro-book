import type {
    AgentSessionInteractionDto,
    AgentSessionProfileAvailability,
    AgentSessionStatus,
} from "nbook/shared/dto/agent-session.dto";

export type AgentSessionInteractionInput = {
    archived: boolean;
    status: AgentSessionStatus;
    profileAvailability: AgentSessionProfileAvailability;
};

/**
 * 计算用户界面的 Session 交互能力。
 *
 * 后端 mutation gate 和前端控件必须消费同一结果；Project open 等需要 I/O 的
 * admission 条件仍由对应服务在执行时追加校验。
 */
export function sessionInteraction(input: AgentSessionInteractionInput): AgentSessionInteractionDto {
    if (input.archived || input.status === "archived") {
        return interaction({canRestore: true});
    }

    if (input.status === "waiting") {
        return interaction({
            canResolveUserInput: input.profileAvailability === "loaded",
            canAbort: true,
        });
    }

    if (input.status === "running") {
        if (input.profileAvailability !== "loaded") {
            return interaction({canAbort: true});
        }
        return interaction({
            canInvoke: true,
            canRegisterAttachment: true,
            canInsertAttachment: true,
            canAbort: true,
        });
    }

    if (input.profileAvailability !== "loaded") {
        return interaction({canArchive: true});
    }

    return interaction({
        canInvoke: true,
        canRegisterAttachment: true,
        canInsertAttachment: true,
        canMutateHistory: true,
        canChangeRuntime: true,
        canArchive: true,
    });
}

/** 以全 false 为基线生成能力，避免各状态漏填字段。 */
function interaction(overrides: Partial<AgentSessionInteractionDto>): AgentSessionInteractionDto {
    return {
        canInvoke: false,
        canResolveUserInput: false,
        canRegisterAttachment: false,
        canInsertAttachment: false,
        canMutateHistory: false,
        canChangeRuntime: false,
        canArchive: false,
        canRestore: false,
        canAbort: false,
        ...overrides,
    };
}
