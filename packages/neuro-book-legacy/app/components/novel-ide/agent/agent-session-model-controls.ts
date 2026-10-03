import type {ThinkingLevelDto} from "nbook/shared/dto/app-settings.dto";

export type AgentSessionModelDraft = {
    modelKey: string | null;
    reasoningEffort: ThinkingLevelDto | null;
};
