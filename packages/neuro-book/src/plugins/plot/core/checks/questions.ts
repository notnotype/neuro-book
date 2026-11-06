/**
 * 窄问题与固定的一次调用的题面（docs/specs/plot/checks.md 输出 2、3）。措辞是领域提示词，随实现改；Spec 定的是问题的结构与给模型的
 * 材料。`user` 里材料在前、题面在后，服务商的前缀缓存能吃到同一段正文。
 */

import type {CanonReadView, ReadPosition} from "@notnotype/nb-canon/schema";

import type {CheckRequest} from "../../shared/checks";
import type {KnowingRow} from "../knowledge";
import type {Candidate} from "./candidates";
import {readAppeared} from "./segments";

const LEDGER_SYSTEM = [
    "你是一本小说的校对助手。下面给你一段正文和一个问题。只依据这段正文回答，不要推测正文之外的事。",
    "回答“有”（yes）时必须引用正文里一字不差的原句（完整的句子，放进 quotes）；答“没有”（no）时 quotes 给空数组；正文看不出来就答 unclear，不要猜。",
    "用 answer 工具交回结构化的答案。",
].join("\n");

const FIXED_SYSTEM = [
    "你是一本小说的校对助手。下面给你写手当时拿到的上下文、写手的自陈、写作指示和整章正文。",
    "逐条回答规则项：每条问的都是“有没有违反”，yes 是违反了，no 是没有，unclear 是看不出；答 yes 时必须引用正文里一字不差的原句。",
    "另外列出新事实：knowing 是有人按上下文里没有记录的事行动，invention 是不在自陈、也不在上下文里的新名字、数值、设定（带上 name）。每条都引原句。场景里的小细节不算。",
    "用 answer 工具交回结构化的答案。",
].join("\n");

const DEGREE_TEXT: Readonly<Record<string, string>> = {unaware: "不知道这件事", suspects: "只是怀疑这件事，并不确定", forgot: "已经忘了这件事", misbelieves: "对这件事有错误的认识"};
const HOW_TEXT: Readonly<Record<string, string>> = {witnessed: "亲眼所见", told: "听人说的", read: "读到的", inferred: "自己推断的", other: "别的途径"};
const STAGE_TEXT: Readonly<Record<string, string>> = {planted: "已埋下", echoing: "呼应过", partial: "已部分回收"};

export const NARROW_MAX_TOKENS = 2000;
export const FIXED_MAX_TOKENS = 16000;

/** 一个人对这件事的状态。 */
function stateOf(view: CanonReadView, row: KnowingRow | null, end: ReadPosition): string {
    if (row === null || row.程度 === null) return "没有记录说他知道这件事";
    if (row.程度 !== "misbelieves") return DEGREE_TEXT[row.程度] ?? "不知道这件事";
    const source = [row.怎么知道 === null || row.怎么知道 === undefined ? null : HOW_TEXT[row.怎么知道], typeof row.谁告诉的 === "string" ? `告诉他的人是${readAppeared(view, row.谁告诉的, end)?.name ?? row.谁告诉的}` : null].filter((part) => part !== null && part !== undefined).join("，");
    return `误以为“${row.他以为的 ?? "（没写）"}”${source === "" ? "" : `（${source}）`}`;
}

/** 窄问题的题面。 */
export function stemOf(view: CanonReadView, candidate: Candidate, end: ReadPosition): string {
    switch (candidate.layer) {
        case "presence":
            if (candidate.contradicts) return `这件事的真相是：${candidate.truth}。\n${candidate.personName}${stateOf(view, candidate.row, end)}。\n问：${candidate.personName}在这段里有没有与他的这个误信矛盾的言行？`;
            return `这件事是：${candidate.truth}。\n${candidate.personName}在这段里在场，他${stateOf(view, candidate.row, end)}。\n问：${candidate.personName}有没有说出或做出把这件事当真的言行（包括试探、质问、回避、施压）？`;
        case "narration":
            return `这段的视角人物是${candidate.personName}，他${stateOf(view, candidate.row, end)}。这件事是：${candidate.truth}。\n问：叙述有没有写出视角人物不知道、看不到的这件事？`;
        case "object":
            return `物件“${candidate.objectName}”是这些伏笔依赖的：${candidate.stages.map((stage) => `“${stage.name}”（本章开头${STAGE_TEXT[stage.stage] ?? stage.stage}）`).join("、")}。读者在本章之前${candidate.seenBefore ? "见过" : "没见过"}这个物件。\n问：这段里这个物件有没有被动过？答 moved；动过的话引原句，写出动之前与之后是什么样（正文没写清就写“没写清”）、谁动的（before、after、who）。只问事实，不要判断伏笔还成不成立。`;
        case "time":
            return "问：这段里时间有没有倒回或跳回（回到更早的时刻，同样的事重新发生）？正常的回忆、闪念不算。";
    }
}

/** 窄问题的请求：材料是这一段的正文，题面在后。 */
export function narrowRequest(paragraphs: readonly string[], stem: string, kind: "yesNo" | "object"): CheckRequest {
    return {
        system: LEDGER_SYSTEM,
        user: `这段正文：\n${paragraphs.join("\n")}\n\n${stem}`,
        answer: kind,
        maxTokens: NARROW_MAX_TOKENS,
    };
}

/** 固定调用的一条规则项。 */
export interface RuleItem {
    /** 规则项的稳定 id：`pov:<段>`、`ending`、`avoid:<摘要>`、`constraint:<决策>:<下标>`、`pending:<决策>`。 */
    readonly item: string;
    /** 问的是“有没有违反”。 */
    readonly text: string;
    readonly segment?: string;
    readonly decision?: string;
}

export interface FixedInput {
    readonly brief: string | null;
    readonly report: {readonly names: readonly string[]; readonly unsure: readonly string[]; readonly deviations: readonly string[]} | null;
    readonly instructionLines: readonly string[];
    readonly segments: readonly {readonly id: string; readonly from: number; readonly to: number; readonly paragraphs: readonly string[]}[];
    readonly rules: readonly RuleItem[];
}

export function fixedRequest(input: FixedInput): CheckRequest {
    const report = input.report === null ? "没有" : [`新出现的名字与事实：${input.report.names.join("；") || "无"}`, `拿不准的：${input.report.unsure.join("；") || "无"}`, `偏离细纲的：${input.report.deviations.join("；") || "无"}`].join("\n");
    const chapterText = input.segments.map((segment) => `【${segment.id}，第 ${String(segment.from)} 到第 ${String(segment.to)} 段】\n${segment.paragraphs.join("\n")}`).join("\n\n");
    const rules = input.rules.length === 0 ? "（没有规则项）" : input.rules.map((rule) => `- ${rule.item}：${rule.text}`).join("\n");
    return {
        system: FIXED_SYSTEM,
        user: `写手的上下文：\n${input.brief ?? "没有"}\n\n写手的自陈：\n${report}\n\n写作指示：\n${input.instructionLines.join("\n") || "没有"}\n\n整章正文：\n${chapterText}\n\n规则项（items 里 item 写这里的 id，每条都要答）：\n${rules}`,
        answer: "fixed",
        maxTokens: FIXED_MAX_TOKENS,
    };
}
