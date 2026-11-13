/**
 * 压缩之后放回最近用过的 Skill（docs/specs/agent/skills.md 输出 16、17）：接在套件放回的文件与计划之后，用剩下的预算。
 * 正文现读；一个 Skill 读不到只跳过它，不让整次放回作废（内核在放回抛错时什么都不放）。
 */

import {readFile} from "node:fs/promises";
import {join} from "node:path";

import {estimateTokens} from "@notnotype/nb-harness/kernel";
import type {CompactionRestoreArgs, CompactionRestored} from "@notnotype/nb-harness/kernel/contracts";

import type {SkillCatalog} from "./catalog";
import {renderSkill, SKILLS_EXTENSION, truncateTokens} from "./extension";
import type {SkillEventData} from "./extension";
import {SKILL_FILE, splitSkillFile} from "./package";

export const RESTORE_SKILL_TOKENS = 5_000;
export const RESTORE_SKILLS_TOTAL = 25_000;
/** 放回的全部内容（文件、计划、Skill）合计不超过窗口的这一份（compaction.md 的口径）。 */
const WINDOW_SHARE = 0.25;
/** 截断后正文不到这么多就不放：只剩一两行的 Skill 帮不上忙（同套件放回文件的下限）。 */
const MIN_SKILL_TOKENS = 400;
const SKILL_EVENT = `${SKILLS_EXTENSION}/skill`;

export interface SkillRestoreOptions {
    readonly catalog: Pick<SkillCatalog, "item">;
    readonly report: (code: string, message: string, data?: Readonly<Record<string, unknown>>) => void;
}

/** 在 `previous`（文件与计划的放回）之后接上 Skill。没有换掉对话时原样交回。 */
export async function restoreSkills(options: SkillRestoreOptions, args: CompactionRestoreArgs, previous: CompactionRestored): Promise<CompactionRestored> {
    if (args.replacement === null) return previous;
    const restoredBefore = Array.isArray(previous.restored) ? (previous.restored as ReadonlyArray<{readonly tokens?: unknown}>) : [];
    const used = restoredBefore.reduce((sum, item) => sum + (typeof item.tokens === "number" ? item.tokens : 0), 0);
    const windowLeft = args.contextWindow > 0 ? Math.floor(args.contextWindow * WINDOW_SHARE) - used : Number.POSITIVE_INFINITY;
    let budget = Math.min(RESTORE_SKILLS_TOTAL, windowLeft);

    // 最近用过的在前、按 id 去重（“见前文”也算用过）。带正文的那条压缩之后仍在上下文里（这一轮刚附上的）就不放第二份；
    // 只有“见前文”留下来不算，它指的正文已经被切掉了。
    const recent: string[] = [];
    const inContext = new Set<string>();
    for (let index = args.path.length - 1; index >= 0; index -= 1) {
        const event = args.path[index]!;
        if (event.type !== SKILL_EVENT) continue;
        const data = event.data as SkillEventData;
        if (!recent.includes(data.id)) recent.push(data.id);
        if (data.body !== undefined && args.kept(event.id)) inContext.add(data.id);
    }
    const ids = recent.filter((id) => !inContext.has(id));

    const notices: string[] = [];
    const restored: Array<{kind: "skill"; target: string; tokens: number; truncated: boolean}> = [];
    for (const id of ids) {
        if (budget <= 0 || args.signal.aborted) break;
        const item = options.catalog.item(id);
        if (item === undefined) {
            options.report("restore-skipped", `Skill ${id} was not restored after compaction: it is no longer in the catalog`, {id});
            continue;
        }
        let body: string;
        try {
            body = splitSkillFile(await readFile(join(item.directory, SKILL_FILE), {encoding: "utf8", signal: args.signal})).body;
        } catch (error) {
            if (args.signal.aborted) break;
            options.report("restore-skipped", `Skill ${id} was not restored after compaction`, {id, message: error instanceof Error ? error.message : String(error)});
            continue;
        }
        // 预算算的是包好之后的整段：先扣掉包装（标签与说明行，按截断时的样子算），剩下的给正文。
        const data = {id, name: item.entry.name, location: item.entry.location};
        const bodyBudget = Math.min(RESTORE_SKILL_TOKENS, budget) - estimateTokens(renderSkill({...data, body: "", truncated: true}));
        const shown = truncateTokens(body, Math.max(0, bodyBudget));
        if (shown.truncated && bodyBudget < MIN_SKILL_TOKENS) continue;
        const text = renderSkill({...data, body: shown.text, truncated: shown.truncated});
        const tokens = estimateTokens(text);
        notices.push(text);
        restored.push({kind: "skill", target: id, tokens, truncated: shown.truncated});
        budget -= tokens;
    }
    if (restored.length === 0) return previous;
    return {notices: [...previous.notices, ...notices], restored: [...restoredBefore, ...restored] as CompactionRestored["restored"]};
}
