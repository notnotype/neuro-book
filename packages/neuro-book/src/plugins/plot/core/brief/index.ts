/**
 * 写手的上下文（docs/specs/plot/brief.md）：由程序拼，不由模型生成；同一份读取输入、同一写作指示快照版本、同一细纲、同一目标字数、
 * 同一插件版本，拼出的上下文逐字相同。纯函数：摘要由宿主注入的 `digest` 端口算（核心不导入 Node 的 crypto），写作指示快照由调用方
 * 从项目实例的快照表里取了传进来。
 *
 * 组成与顺序（输出 1）：写作指示、细纲、本章计划、简报、涉及条目的样子、上一章末尾一段正文、目标字数；简报内依次是通则、这一场的
 * 秘密、在场的人、场景条件、称谓、伏笔、决策、读者已知、本章允许新增什么、自陈的格式。没有内容的段写“无”，不省略标题。本章分段讲两条
 * 线的，每段一份（本章计划、简报、涉及条目的样子），写作指示、细纲、通则、称谓、上一章末尾、目标字数这些共同的部分只写一次。
 */

import type {CanonReadView, Decision} from "@notnotype/nb-canon/schema";

import type {InstructionSnapshot} from "../../shared/instructions";
import {involvedDecisions} from "../decisions";
import type {Digest} from "../guards";
import {appearanceItems} from "./appearance";
import {DEFAULT_LIMITS, trim} from "./budget";
import {framesOf, nameOf, participantsOf, planReveals, plansOf, pointsBeforeWriting, type Frame} from "./context";
import * as fixed from "./fixed";
import {addressItems, allowedItems, decisionItems, foreshadowItems, peopleItems, planItems, readerItems, sceneItems} from "./parts";
import {buildSecrets, routeDecisions} from "./secrets";
import type {BriefHint, BriefItem, BriefSection} from "./types";

export type {BriefHint, BriefItem, BriefSection} from "./types";

export interface BriefInput {
    readonly view: CanonReadView;
    readonly chapter: string;
    /** 本章的写作指示快照（项目实例的快照表里取）；没有时“写作指示”段写“无”。 */
    readonly instruction?: InstructionSnapshot;
    readonly outline: string;
    readonly targetWords: number;
    /** 上一章末尾一段正文（宿主给）；上一章不存在时为 null，那一段写“无”。 */
    readonly previousTail: string | null;
    /** 由后端用插件清单的版本注入，不由远程调用方给。 */
    readonly pluginVersion: string;
    readonly digest: Digest;
    /** 各段字数上限的覆盖（缺省见 `budget.ts`）。 */
    readonly limits?: Readonly<Record<string, number>>;
}

/** 上下文记下它的输入（输出 15）：任何一项不同就算上下文已变。 */
export interface BriefRecord {
    readonly inputDigest: string;
    readonly instructionVersion: string | null;
    readonly outlineDigest: string;
    readonly targetWords: number;
    readonly previousDigest: string | null;
    readonly pluginVersion: string;
    readonly omitted: readonly string[];
}

export interface BriefPart {
    /** “回溯前”“回溯后”；只有一份时为 null。 */
    readonly label: string | null;
    readonly sections: readonly BriefSection[];
}

export interface BriefResult {
    readonly text: string;
    readonly common: readonly BriefSection[];
    readonly parts: readonly BriefPart[];
    readonly hints: readonly BriefHint[];
    readonly record: BriefRecord;
}

const lineItems = (text: string): BriefItem[] => text.split("\n").map((line, index) => ({label: `第 ${String(index + 1)} 行`, text: line}));

function instructionLines(frame: Frame, instruction: InstructionSnapshot | undefined): BriefItem[] {
    if (instruction === undefined) return [];
    const lines: string[] = [];
    if (instruction.readerChange !== undefined) lines.push(`读完这一章读者该有什么变化：${instruction.readerChange}`);
    if (instruction.pov !== undefined) lines.push(`视角人物：${nameOf(frame, instruction.pov.id)}`);
    if (instruction.povMode !== undefined) lines.push(`视角方式：${{first: "第一人称", limited: "有限视角", omniscient: "全知"}[instruction.povMode]}`);
    const timeMode = instruction.timeMode;
    if (timeMode !== undefined) lines.push(`时间方式：${timeMode === "follow" ? "承接" : "parallel" in timeMode ? `与第 ${timeMode.parallel} 章同时` : `补叙 ${JSON.stringify(timeMode.flashback)} 处的事`}`);
    if (instruction.tone !== undefined) lines.push(`语气：${instruction.tone}`);
    if (instruction.opening !== undefined) lines.push(`开场：${instruction.opening}`);
    if (instruction.ending !== undefined) lines.push(`结尾：${instruction.ending}`);
    if (instruction.avoid !== undefined && instruction.avoid.length > 0) lines.push(`不写的：${instruction.avoid.join("；")}`);
    if (instruction.other !== undefined) lines.push(`其他：${instruction.other}`);
    return lines.map((line) => ({label: line.slice(0, 8), text: line}));
}

export function composeBrief(input: BriefInput): BriefResult | "chapter-not-found" | "line-not-found" {
    const {view, chapter, instruction} = input;
    const frames = framesOf(view, chapter, instruction);
    if (typeof frames === "string") return frames;
    const limits = {...DEFAULT_LIMITS, ...input.limits};
    const omitted: string[] = [];
    const hints: BriefHint[] = [];
    /** 裁一段并记下被裁掉的项。 */
    const section = (key: string, title: string, items: readonly BriefItem[], extra: readonly BriefItem[] = []): BriefSection => {
        const { kept, omitted: dropped } = trim(items, limits[key] ?? Infinity);
        for (const label of dropped) omitted.push(`${title}：${label}`);
        return {key, title, items: [...kept, ...extra]};
    };
    const first = frames[0]!;
    const common: BriefSection[] = [
        section("instruction", fixed.TITLES.instruction, instructionLines(first, instruction)),
        section("outline", fixed.TITLES.outline, lineItems(input.outline)),
    ];
    const povId = instruction?.pov?.id ?? null;
    const parts: BriefPart[] = frames.map((frame, frameIndex) => {
        const plans = plansOf(frame, chapter);
        const participants = participantsOf(plans);
        const reveals = planReveals(plans);
        const points = pointsBeforeWriting(frame, chapter, plans);
        const secrets = buildSecrets(frame, points, participants, reveals, povId, instruction?.povMode);
        const decided = involvedDecisions(frame.view, chapter, "planned", points);
        const decidedFull = decided.filter((decision) => decision.status === "decided").map((decision) => frame.view.object({kind: "decision", id: decision.id}) as Decision);
        const pendingDue = decided.filter((decision) => decision.status === "pending" && decision.due !== null && frame.view.chapters.indexOf(decision.due) <= frame.view.chapters.indexOf(chapter)).map((decision) => frame.view.object({kind: "decision", id: decision.id}) as Decision);
        const routing = routeDecisions(frame, decidedFull, secrets);
        const frameHints: BriefHint[] = [...secrets.hints];
        const people = peopleItems(frame, chapter, participants, secrets, povId);
        // 绝密而本章不暗示也不揭示的，名字就是真相，不写出来。
        const secretItems: BriefItem[] = secrets.items.map((item) => ({label: item.hidden ? "绝密设定" : item.name, text: [...(item.hidden ? [] : [item.name]), ...item.lines, ...(routing.inSecrets.get(item.point) ?? [])].join("\n"), protect: true}));
        const sections: BriefSection[] = [
            section("plan", fixed.TITLES.plan, planItems(frame, plans, secrets, chapter)),
            ...(frameIndex === 0 ? [section("rules", fixed.BRIEF_PARTS.rules, fixed.RULES.map((text) => ({label: text.slice(0, 8), text, protect: true})))] : []),
            section("secrets", fixed.BRIEF_PARTS.secrets, secretItems),
            {...section("people", fixed.BRIEF_PARTS.people, people.items), items: [{label: "说明", text: people.header, protect: true}, ...trim(people.items, limits.people ?? Infinity).kept]},
            section("scene", fixed.BRIEF_PARTS.scene, sceneItems(plans, chapter, frameHints)),
            ...(frameIndex === 0 ? [section("address", fixed.BRIEF_PARTS.address, addressItems(frame, participants, povId, instruction?.povMode))] : []),
            section("foreshadow", fixed.BRIEF_PARTS.foreshadow, foreshadowItems(frame, chapter, plans, frameHints)),
            section("decisions", fixed.BRIEF_PARTS.decisions, decisionItems(routing.inDecisions, pendingDue)),
            section("reader", fixed.BRIEF_PARTS.reader, readerItems(frame, chapter, points, secrets)),
            ...(frameIndex === frames.length - 1 ? [section("allowed", fixed.BRIEF_PARTS.allowed, allowedItems(instruction))] : []),
            section("appearance", fixed.TITLES.appearance, appearanceItems(frame, chapter)),
        ];
        hints.push(...frameHints);
        return {label: frame.label, sections};
    });
    const tail = input.previousTail === null ? [] : [{label: "上一章末尾", text: [...input.previousTail].slice(-(limits.previous ?? Infinity)).join("")}];
    const closing: BriefSection[] = [{key: "previous", title: fixed.TITLES.previous, items: tail}, {key: "target", title: fixed.TITLES.target, items: [{label: "目标字数", text: String(input.targetWords), protect: true}]}];
    const text = render(common, parts, closing, omitted);
    const record: BriefRecord = {
        inputDigest: view.stamp.inputDigest,
        instructionVersion: instruction?.version ?? null,
        outlineDigest: input.digest(input.outline),
        targetWords: input.targetWords,
        previousDigest: input.previousTail === null ? null : input.digest(input.previousTail),
        pluginVersion: input.pluginVersion,
        omitted,
    };
    return {text, common: [...common, ...closing], parts, hints, record};
}

const BRIEF_KEYS = new Set(["rules", "secrets", "people", "scene", "address", "foreshadow", "decisions", "reader", "allowed"]);

/** 整份上下文的文字：段标题写在前；没有内容的段写“无”；简报里的各段降一级标题；裁掉的在末尾写一句。 */
function render(common: readonly BriefSection[], parts: readonly BriefPart[], closing: readonly BriefSection[], omitted: readonly string[]): string {
    const block = (title: string, items: readonly BriefItem[], level = "##") => `${level} ${title}\n${items.length === 0 ? fixed.NONE : items.map((item) => item.text).join("\n")}`;
    const out: string[] = common.map((s) => block(s.title, s.items));
    for (const part of parts) {
        if (part.label !== null) out.push(`# ${part.label}`);
        let briefOpened = false;
        for (const s of part.sections) {
            if (BRIEF_KEYS.has(s.key)) {
                if (!briefOpened) {
                    out.push(`## ${fixed.TITLES.brief}`);
                    briefOpened = true;
                }
                out.push(block(s.title, s.items, "###"));
            } else out.push(block(s.title, s.items));
        }
    }
    for (const s of closing) out.push(block(s.title, s.items));
    if (omitted.length > 0) out.push(fixed.omitted(omitted));
    return out.join("\n\n");
}
