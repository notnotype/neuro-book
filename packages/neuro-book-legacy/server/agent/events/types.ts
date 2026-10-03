import type {AgentEvent} from "@earendil-works/pi-agent-core";
import type {JsonValue} from "nbook/server/agent/messages/types";

export type NeuroAgentEvent = AgentEvent | {
    type: "session_entry";
    sessionId: number;
    entryId: string;
    entryType: string;
} | {
    type: "custom";
    name: string;
    payload: JsonValue;
};

