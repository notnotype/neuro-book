import type {InjectionKey, Ref} from "vue";
import type {AgentPendingUserInputSession} from "nbook/app/components/novel-ide/agent/agent-message";

/** 历史气泡只读消费权威 pending 列表；唯一交互入口在底部待处理面板。 */
export type AgentRequestUserInputContext = {
    pendingSessions: Readonly<Ref<readonly AgentPendingUserInputSession[]>>;
};

export const AGENT_REQUEST_USER_INPUT_CONTEXT_KEY: InjectionKey<AgentRequestUserInputContext> = Symbol("agent-request-user-input-context");
