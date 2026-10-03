import type {AgentInvocationAcceptanceDto} from "nbook/shared/dto/agent-session.dto";

export type AgentInvocationReconciliation =
    | {state: "accepted"; source: "receipt" | "durable"}
    | {state: "rejected"; source: "receipt"}
    | {state: "unknown"; source: "transport"};

/** HTTP receipt 是 admission 真相；模型运行 status 不参与判断。 */
export function reconcileInvocationReceipt(
    clientMessageId: string,
    acceptance: AgentInvocationAcceptanceDto,
): AgentInvocationReconciliation {
    if (acceptance.state === "none") {
        throw new Error("创建用户输入的 invocation 不得返回 acceptance:none");
    }
    if (acceptance.clientMessageId !== clientMessageId) {
        throw new Error("invocation acceptance clientMessageId 与提交不一致");
    }
    return acceptance.state === "not_accepted"
        ? {state: "rejected", source: "receipt"}
        : {state: "accepted", source: "receipt"};
}

/** durable user entry 或 queue item 都是输入已经被接受的确定证据。 */
export function reconcileInvocationEvidence(): AgentInvocationReconciliation {
    return {state: "accepted", source: "durable"};
}

/** 没有 receipt 且没有 durable 证据时，transport failure 只能判为 unknown。 */
export function reconcileInvocationTransportFailure(): AgentInvocationReconciliation {
    return {state: "unknown", source: "transport"};
}
