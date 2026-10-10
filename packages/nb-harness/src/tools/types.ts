/** 工具模块的公开类型，逐字对应 docs/specs/harness/tools.md。 */

import type {AgentTool, StreamFn} from "@oh-my-pi/pi-agent-core";
import type {ImageContent, Message, TextContent} from "@oh-my-pi/pi-ai";
import type {Model} from "@oh-my-pi/pi-catalog";
import type {Static, TSchema} from "typebox";
import type {ApprovalMode} from "../config/config";

export type JsonValue = null | boolean | number | string | JsonValue[] | {[key: string]: JsonValue};

export type ToolTier = "read" | "write" | "exec";
export type RiskDecision = {tier: ToolTier; policy?: "deny" | "ask"; reason?: string};
export type Risk = ToolTier | RiskDecision | ((args: unknown) => ToolTier | RiskDecision);
export type ToolContext = {signal: AbortSignal; session: {id: string}; toolCallId: string; report(progress: JsonValue): void};
export type ToolOutcome =
    | {ok: true; content: string | (TextContent | ImageContent)[]; details?: JsonValue}
    | {ok: false; code: string; message: string; details?: JsonValue};

export type ToolDefinition<P extends TSchema = TSchema> = {
    id: string;
    description: string;
    parameters: P;
    risk?: Risk;
    scope?: "session" | "project";
    execute(args: Static<P>, context: ToolContext): Promise<ToolOutcome>;
};

export type ToolDescriptor = {id: string; description: string; parameters: TSchema; risk: ToolTier | "dynamic"; scope: "session" | "project"};
export interface ToolSource {
    list(): ToolDescriptor[];
    get(id: string): ToolDefinition | undefined;
}

export type ToolsFailure = "invalid-tool" | "tool-conflict";
export type ToolsResult<T> = {ok: true; value: T} | {ok: false; code: ToolsFailure; detail: string};

export type Decision = {outcome: "allow" | "deny" | "ask" | "model"; tier: ToolTier; step: 1 | 2 | 3 | 4 | 5 | 6; reason: string};
export type ApprovalGrant = {toolName: string; tier?: string};

export type JudgeRequest = {tool: {id: string; description: string}; args: JsonValue; tier: ToolTier; reason?: string; profile: {id: string; name: string}; recent: readonly Message[]};
export type Judgement = {decision: "allow" | "deny" | "escalate"; reason: string};

export type ToolCall = {toolCallId: string; toolId: string; args: unknown};
export type ApprovalOutcome = {approved: true} | {approved: false; reason: string} | {aborted: true};
export type ToolInterceptor = {
    beforeExecute?(call: ToolCall): Promise<{args: unknown} | {deny: string}>;
    afterExecute?(call: ToolCall, outcome: ToolOutcome): Promise<ToolOutcome>;
};
export type AdapterHooks = {
    source: ToolSource;
    session: {id: string};
    approve(call: ToolCall): Promise<ApprovalOutcome>;
    interceptor?: ToolInterceptor;
    report?(call: ToolCall, progress: JsonValue): void;
};

export type {AgentTool, ApprovalMode, Model, StreamFn};
