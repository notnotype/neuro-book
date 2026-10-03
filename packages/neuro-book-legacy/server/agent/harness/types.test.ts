import {describe, expectTypeOf, it} from "vitest";
import type {AgentRuntimeStreamEventDto} from "nbook/shared/dto/agent-session.dto";
import type {InvokeAgentResult} from "nbook/shared/dto/agent-session.dto";
import type {AgentInvocationResult} from "nbook/server/agent/harness/types";

describe("InvokeAgentResult public contract", () => {
    it("不返回历史 runtime events，事件只走 SSE/onEvent", () => {
        expectTypeOf<InvokeAgentResult>().not.toHaveProperty("events");
    });

    it("HTTP report_result 只公开摘要，内部 invocation 结果保留完整 data", () => {
        type PublicReport = NonNullable<InvokeAgentResult["reportResult"]>;
        type InternalReport = NonNullable<AgentInvocationResult["reportResult"]>;

        expectTypeOf<PublicReport>().not.toHaveProperty("data");
        expectTypeOf<PublicReport>().toHaveProperty("dataOmitted");
        expectTypeOf<InternalReport>().toHaveProperty("data");
    });
});

describe("AgentRuntimeStreamEventDto public contract", () => {
    it("agent_end / turn_end 不包含 PI 的大字段", () => {
        type AgentEnd = Extract<AgentRuntimeStreamEventDto, {type: "agent_end"}>;
        type TurnEnd = Extract<AgentRuntimeStreamEventDto, {type: "turn_end"}>;

        expectTypeOf<AgentEnd>().not.toHaveProperty("messages");
        expectTypeOf<TurnEnd>().not.toHaveProperty("message");
        expectTypeOf<TurnEnd>().not.toHaveProperty("toolResults");
    });
});
