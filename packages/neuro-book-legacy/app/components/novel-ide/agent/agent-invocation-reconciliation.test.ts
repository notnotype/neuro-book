import {describe, expect, it} from "vitest";
import {
    reconcileInvocationEvidence,
    reconcileInvocationReceipt,
    reconcileInvocationTransportFailure,
} from "nbook/app/components/novel-ide/agent/agent-invocation-reconciliation";

describe("Agent invocation acceptance reconciliation", () => {
    it("只按 receipt 区分 accepted 与 rejected", () => {
        expect(reconcileInvocationReceipt("message-1", {
            state: "not_accepted",
            clientMessageId: "message-1",
        })).toEqual({state: "rejected", source: "receipt"});
        expect(reconcileInvocationReceipt("message-1", {
            state: "queued",
            clientMessageId: "message-1",
            queueItemId: "queue-1",
        })).toEqual({state: "accepted", source: "receipt"});
        expect(reconcileInvocationReceipt("message-1", {
            state: "persisted",
            clientMessageId: "message-1",
            entryId: "entry-1",
        })).toEqual({state: "accepted", source: "receipt"});
    });

    it("拒绝错误关联 ID 与用户输入的 acceptance:none", () => {
        expect(() => reconcileInvocationReceipt("message-1", {state: "none"})).toThrow("不得返回 acceptance:none");
        expect(() => reconcileInvocationReceipt("message-1", {
            state: "not_accepted",
            clientMessageId: "message-2",
        })).toThrow("clientMessageId 与提交不一致");
    });

    it("durable 证据收敛为 accepted，无 receipt 的 transport failure 保持 unknown", () => {
        expect(reconcileInvocationEvidence()).toEqual({state: "accepted", source: "durable"});
        expect(reconcileInvocationTransportFailure()).toEqual({state: "unknown", source: "transport"});
    });
});
