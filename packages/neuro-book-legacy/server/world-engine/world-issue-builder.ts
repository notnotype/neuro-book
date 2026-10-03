import type {
    WorldIssue,
    WorldIssueCode,
    WorldPatchOp,
} from "nbook/server/world-engine/types";
import {WORLD_ISSUE_CATALOG} from "nbook/server/world-engine/world-issue-catalog";

export type BuildWorldIssueInput = {
    code: WorldIssueCode;
    subjectId: string;
    attr: string;
    message: string;
    sliceId?: string;
    patchId?: string;
    path?: string;
    op?: WorldPatchOp;
};

/** 用 catalog 生成稳定 WorldIssue，避免各生成点手写 label/title/explanation。 */
export function buildWorldIssue(input: BuildWorldIssueInput): WorldIssue {
    const item = WORLD_ISSUE_CATALOG[input.code];
    return {
        code: item.code,
        label: item.label,
        severity: item.severity,
        subjectId: input.subjectId,
        attr: input.attr,
        title: item.title,
        message: input.message,
        explanation: item.explanation,
        ...(input.sliceId ? {sliceId: input.sliceId} : {}),
        ...(input.patchId ? {patchId: input.patchId} : {}),
        ...(input.path ? {path: input.path} : {}),
        ...(input.op ? {op: input.op} : {}),
    };
}

/** 生成 issue 去重身份；patchId 存在时以具体 patch 行为定位核心。 */
export function worldIssueIdentity(issue: WorldIssue): string {
    const pathOrAttr = issue.path ?? issue.attr;
    if (issue.patchId) {
        return [
            issue.code,
            issue.patchId,
            pathOrAttr,
            issue.op ?? "",
        ].join("\u0000");
    }
    return [
        issue.code,
        issue.sliceId ?? "",
        issue.subjectId,
        pathOrAttr,
        issue.op ?? "",
        issue.message,
    ].join("\u0000");
}

/** 按稳定身份去重 issues，保留首次出现顺序和 sliceId/patchId 定位信息。 */
export function dedupeWorldIssues(issues: WorldIssue[]): WorldIssue[] {
    const seen = new Set<string>();
    const result: WorldIssue[] = [];
    for (const issue of issues) {
        const key = worldIssueIdentity(issue);
        if (seen.has(key)) {
            continue;
        }
        seen.add(key);
        result.push(issue);
    }
    return result;
}
