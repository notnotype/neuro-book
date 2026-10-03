import type {AgentSessionSummarizerStateDto, AgentSessionSummaryDto} from "nbook/shared/dto/agent-session.dto";
import {PUBLIC_SESSION_ISSUE_BYTES, PUBLIC_SESSION_SUMMARY_BYTES, PUBLIC_SESSION_TITLE_BYTES, PUBLIC_SUMMARIZER_ERROR_BYTES} from "nbook/server/agent/events/public-event-policy";
import {textPreview} from "nbook/server/agent/events/public-tool-projection";

/**
 * 把 durable session summary 投影为有界公开摘要。
 *
 * JSONL 中的 title / summary 保留完整真相；列表、recovery 与 SSE 只消费展示预览。
 */
export function projectPublicSessionSummary(summary: AgentSessionSummaryDto): AgentSessionSummaryDto {
    return {
        ...summary,
        ...(summary.title === undefined ? {} : {title: textPreview(summary.title, PUBLIC_SESSION_TITLE_BYTES).preview}),
        ...(summary.summary === undefined ? {} : {summary: textPreview(summary.summary, PUBLIC_SESSION_SUMMARY_BYTES).preview}),
        ...(summary.profileIssueMessage === undefined ? {} : {profileIssueMessage: textPreview(summary.profileIssueMessage, PUBLIC_SESSION_ISSUE_BYTES).preview}),
    };
}

/** 把内部 summarizer 状态投影为有界公开状态。 */
export function projectPublicSessionSummarizerState(state: AgentSessionSummarizerStateDto): AgentSessionSummarizerStateDto {
    return {
        ...state,
        ...(state.lastError === undefined ? {} : {lastError: textPreview(state.lastError, PUBLIC_SUMMARIZER_ERROR_BYTES).preview}),
    };
}
