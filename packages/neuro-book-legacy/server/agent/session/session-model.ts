import {isDeepStrictEqual} from "node:util";
import type {Api} from "@earendil-works/pi-ai";
import type {Model} from "nbook/server/agent/messages/types";
import type {AgentSessionModelRefDto} from "nbook/shared/dto/agent-session.dto";
import {
    parseDurableSessionModelRef,
    toDurableSessionModelRef,
    type DurableSessionModelRef,
} from "nbook/server/agent/session/session-model-redaction";

export type SessionModelSelection = Model<Api> | DurableSessionModelRef | null;

/** 将外部 Pi Model 硬切为 JSONL 允许持久化的稳定选择身份。 */
export function canonicalSessionModel(model: Model<Api> | null): DurableSessionModelRef | null {
    return toDurableSessionModelRef(model);
}

/** 比较 durable ref 与当前 resolved model 的稳定选择身份。 */
export function sessionModelsEqual(left: SessionModelSelection, right: SessionModelSelection): boolean {
    return isDeepStrictEqual(sessionModelRef(left), sessionModelRef(right));
}

/** 将内部完整模型投影为 SSE/recovery 可公开的稳定选择身份。 */
export function projectSessionModelRef(model: Model<Api> | null): AgentSessionModelRefDto | null {
    return toDurableSessionModelRef(model);
}

/** 将 runtime Model 或 durable ref 收敛为同一比较形态。 */
function sessionModelRef(model: SessionModelSelection): DurableSessionModelRef | null {
    if (model === null) {
        return null;
    }
    if ("modelId" in model) {
        return parseDurableSessionModelRef(model);
    }
    return toDurableSessionModelRef(model);
}
