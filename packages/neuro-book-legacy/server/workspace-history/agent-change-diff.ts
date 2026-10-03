import {structuredPatch} from "diff";
import type {ProjectHistoryHandle} from "nbook/server/workspace-history/project-history";
import {readWorkspaceHistoryDiff} from "nbook/server/workspace-history/history-diff";
import type {UnseenGroup} from "@notnotype/nb-history";
import type {WorkspaceHistoryDiffDto} from "nbook/shared/dto/workspace-history.dto";
import {
    agentDiffLineLimit,
    agentDiffTotalLimit,
    DEFAULT_AGENT_DIFF_MAX_CHARS,
    MAX_AGENT_CHANGE_DETAIL_FILES,
    MAX_AGENT_DIFF_MAX_CHARS,
} from "nbook/shared/agent/file-change-policy";

export {agentDiffLineLimit, agentDiffTotalLimit, DEFAULT_AGENT_DIFF_MAX_CHARS, MAX_AGENT_DIFF_MAX_CHARS};

type AgentChangeDiffMetrics = {
    locations: string[];
    charCount: number;
    changedLineCount: number;
    lineLimit: number;
};

export type AgentChangeDiffDetail =
    | ({kind: "inline"; diff: string} & AgentChangeDiffMetrics)
    | ({kind: "reference"} & AgentChangeDiffMetrics)
    | {kind: "unchanged"}
    | {kind: "blocked"}
    | {kind: "unavailable"; reason: Extract<WorkspaceHistoryDiffDto, {status: "unavailable"}>["reason"] | "history_error"};

/**
 * 将安全文本 diff 转成 Agent notice 使用的紧凑 unified diff 与 hunk 位置。
 */
export function toAgentChangeDiffDetail(input: {
    path: string;
    diff: Extract<WorkspaceHistoryDiffDto, {status: "available"}>;
    maxChars: number;
}): AgentChangeDiffDetail {
    const patch = structuredPatch(input.path, input.path, input.diff.original, input.diff.modified, undefined, undefined, {context: 2});
    if (patch.hunks.length === 0) {
        return {kind: "unchanged"};
    }
    const diff = patch.hunks.flatMap((hunk) => [
        `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`,
        ...hunk.lines,
    ]).join("\n");
    const locations = patch.hunks.map((hunk) => `新 ${formatLineRange(hunk.newStart, hunk.newLines)} / 旧 ${formatLineRange(hunk.oldStart, hunk.oldLines)}`);
    const charCount = Array.from(diff).length;
    const lineLimit = agentDiffLineLimit(input.maxChars);
    const metrics: AgentChangeDiffMetrics = {
        locations,
        charCount,
        changedLineCount: input.diff.changedLineCount,
        lineLimit,
    };
    if (input.maxChars > 0 && charCount <= input.maxChars && input.diff.changedLineCount <= lineLimit) {
        return {kind: "inline", diff, ...metrics};
    }
    return {kind: "reference", ...metrics};
}

/**
 * 为本轮 unseen 文件读取安全 diff。单文件失败只降级该文件，不阻断 Agent turn。
 */
export async function readAgentChangeDiffDetails(input: {
    history: ProjectHistoryHandle;
    groups: UnseenGroup[];
    maxChars: number;
}): Promise<Map<string, AgentChangeDiffDetail>> {
    const details = new Map<string, AgentChangeDiffDetail>();
    const totalInlineLimit = agentDiffTotalLimit(input.maxChars);
    let inlineChars = 0;
    const history = await input.history.waitForWarmup()
        .then(() => input.history.history)
        .catch(() => null);
    if (!history) {
        return details;
    }
    for (const group of input.groups.slice(0, MAX_AGENT_CHANGE_DETAIL_FILES)) {
        try {
            const diff = await readWorkspaceHistoryDiff({history, group, mode: "full"});
            if (diff.status === "blocked") {
                details.set(group.path, {kind: "blocked"});
                continue;
            }
            if (diff.status === "unavailable") {
                details.set(group.path, {kind: "unavailable", reason: diff.reason});
                continue;
            }
            if (diff.status === "too_large") {
                throw new Error("full diff 不应返回 too_large");
            }
            const detail = toAgentChangeDiffDetail({path: group.path, diff, maxChars: input.maxChars});
            if (detail.kind === "inline" && inlineChars + detail.charCount > totalInlineLimit) {
                const {diff: _discardedDiff, ...reference} = detail;
                details.set(group.path, {...reference, kind: "reference"});
                continue;
            }
            if (detail.kind === "inline") {
                inlineChars += detail.charCount;
            }
            details.set(group.path, detail);
        } catch {
            details.set(group.path, {kind: "unavailable", reason: "history_error"});
        }
    }
    return details;
}

/** 将 hunk 行号转成人可读范围；0 行表示该侧不存在内容。 */
function formatLineRange(start: number, count: number): string {
    if (count === 0) {
        return "∅";
    }
    if (count === 1) {
        return `L${start}`;
    }
    return `L${start}-L${start + count - 1}`;
}
