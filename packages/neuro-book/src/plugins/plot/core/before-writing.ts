/**
 * 开写前的视图（docs/specs/plot/decisions.md 输出 6）：写第 N 章之前要作者看的：`due` 不晚于本章的待定决策、涉及本章的“前提变了”、
 * 本章计划按计划模式会触发的地址守卫违反。拦不拦、作者选“照写”怎么记，由写作任务定，不在这里。
 *
 * 只在本章讲的线上算（分段讲几条线的章取各段的线）：别的线上的违反与本章无关。
 */

import type {CanonReadView, Finding, ObjectRef} from "@notnotype/nb-canon/schema";

import {DECISION_DIAGNOSTIC_IDS, GOAL_DIAGNOSTIC_IDS} from "../shared/declarations";
import {goalDiagnostics} from "./goal-checks";
import {guardDiagnostics, type Digest} from "./guards";

export interface BeforeWritingLine {
    readonly line: string;
    /** `due` 不晚于本章的待定决策。 */
    readonly overdue: readonly string[];
    /** 涉及本章的“前提变了”：目标的持有者在本章计划里在场或被提到，或目标在本章涉及的条目里。 */
    readonly premiseChanged: readonly Finding[];
    /** 本章计划会触发的地址守卫违反（发现的对象里含本章计划的变更）。 */
    readonly guards: readonly Finding[];
}

export interface BeforeWriting {
    readonly chapter: string;
    readonly lines: readonly BeforeWritingLine[];
}

export function beforeWriting(view: CanonReadView, chapter: string, digest: Digest): BeforeWriting | "chapter-not-found" | "line-not-found" {
    const index = view.chapters.indexOf(chapter);
    if (index === -1) return "chapter-not-found";
    const told = [...new Set(view.chapterLines(chapter).map((segment) => segment.line))];
    const lines: BeforeWritingLine[] = [];
    for (const line of told) {
        const on = line === view.line ? view : view.onLine(line, "planned");
        if ("code" in on) return "line-not-found";
        const start = {kind: "chapter", chapter, edge: "start"} as const;
        const plans = new Set(on.changes({chapter, kind: "plan"}).filter((change) => change.status === "active").map((change) => change.id));
        const entries = new Set(on.chapterEntries(chapter, "planned"));
        const overdue = on.decisions({status: "pending"}).filter((decision) => decision.due !== undefined && on.chapters.indexOf(decision.due) !== -1 && on.chapters.indexOf(decision.due) <= index).map((decision) => decision.id);
        const premiseChanged = goalDiagnostics()[GOAL_DIAGNOSTIC_IDS.premiseChanged]!(on, start, "planned").filter((finding) => {
            const [goal] = finding.objects.filter((ref: ObjectRef) => ref.kind === "entry");
            const holder = finding.objects.filter((ref: ObjectRef) => ref.kind === "entry").at(-1);
            return (goal !== undefined && entries.has(goal.id)) || (holder !== undefined && entries.has(holder.id));
        });
        // 本章计划的影响在章末才看得见：守卫按读到本章末尾算。
        const end = {kind: "chapter", chapter, edge: "end"} as const;
        const guards = guardDiagnostics(digest)[DECISION_DIAGNOSTIC_IDS.addressGuardViolated]!(on, end, "planned").filter((finding) => finding.objects.some((ref: ObjectRef) => ref.kind === "change" && plans.has(ref.id)));
        lines.push({line, overdue, premiseChanged, guards});
    }
    return {chapter, lines};
}
