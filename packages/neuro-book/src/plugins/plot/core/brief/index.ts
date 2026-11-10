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
import {framesOf, participantsOf, planReveals, plansOf, pointsBeforeWriting, type Participant} from "./context";
import * as fixed from "./fixed";
import {makeGate, participantGoalPoints, type Gate} from "./gate";
import {addressItems, allowedItems, decisionItems, foreshadowItems, peopleItems, planItems, readerItems, sceneItems, selfReportItems} from "./parts";
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

/**
 * 上一章末尾一段（输出 15）：上一章正文去掉首尾空白以后的最后 `limit` 个码点。这是“取一段”不是裁掉，不进“已省略”。第一章、上一章
 * 是空的或取不到正文时为 null，那一段写“无”。
 */
export function previousTailOf(view: CanonReadView, chapter: string, limit: number): string | null {
    const index = view.chapters.indexOf(chapter);
    if (index <= 0) return null;
    const text = view.chapterText(view.chapters[index - 1]!)?.trim();
    return text === undefined || text === "" ? null : [...text].slice(-limit).join("");
}

const lineItems = (text: string): BriefItem[] => text.split("\n").map((line, index) => ({label: `第 ${String(index + 1)} 行`, text: line}));

/** 共同的段（写作指示、称谓）用合并的关卡写名字：这个人在哪一份里不写本名，就用最早那一份的写法（brief.md 输出 16）。 */
const commonName = (gates: readonly Gate[], id: string) => (gates.find((gate) => gate.kind(id) !== "plain") ?? gates[0]!).name(id);

/** 第几章（按章序）；章不在章序里时为 null。不把章 id 写给写手。 */
const chapterNumber = (view: CanonReadView, chapter: string) => {
    const index = view.chapters.indexOf(chapter);
    return index === -1 ? null : index + 1;
};

function timeModeText(view: CanonReadView, timeMode: NonNullable<InstructionSnapshot["timeMode"]>): string {
    if (timeMode === "follow") return "承接";
    if ("parallel" in timeMode) {
        const number = chapterNumber(view, timeMode.parallel);
        return number === null ? "与另一章同时" : `与第 ${String(number)} 章同时`;
    }
    const placement = timeMode.flashback as {kind?: string; chapter?: string};
    const number = placement.kind === "chapter" && typeof placement.chapter === "string" ? chapterNumber(view, placement.chapter) : null;
    return number === null ? "补叙前史里的事" : `补叙第 ${String(number)} 章的事`;
}

function instructionLines(gates: readonly Gate[], instruction: InstructionSnapshot | undefined): BriefItem[] {
    if (instruction === undefined) return [];
    const lines: string[] = [];
    if (instruction.readerChange !== undefined) lines.push(`读完这一章读者该有什么变化：${instruction.readerChange}`);
    if (instruction.pov !== undefined) lines.push(`视角人物：${commonName(gates, instruction.pov.id)}`);
    if (instruction.povMode !== undefined) lines.push(`视角方式：${{first: "第一人称", limited: "有限视角", omniscient: "全知"}[instruction.povMode]}`);
    if (instruction.timeMode !== undefined) lines.push(`时间方式：${timeModeText(gates[0]!.frame.view, instruction.timeMode)}`);
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
    // 先给每一份框架算出关卡：共同的段（写作指示、称谓）要看所有份。
    const framed = frames.map((frame) => {
        const plans = plansOf(frame, chapter);
        const participants: readonly Participant[] = participantsOf(plans);
        const reveals = planReveals(plans);
        const points = [...new Set([...pointsBeforeWriting(frame, chapter, plans, "planned"), ...participantGoalPoints(frame, chapter, participants)])].sort();
        const gate = makeGate({frame, chapter, plans, participants, reveals, points});
        return {frame, plans, participants, reveals, points, gate};
    });
    const gates = framed.map((item) => item.gate);
    const common: BriefSection[] = [
        section("instruction", fixed.TITLES.instruction, instructionLines(gates, instruction)),
        section("outline", fixed.TITLES.outline, lineItems(input.outline)),
    ];
    const povId = instruction?.pov?.id ?? null;
    const parts: BriefPart[] = framed.map(({frame, plans, participants, reveals, points, gate}, frameIndex) => {
        const secrets = buildSecrets(gate, points, participants, reveals, povId);
        const decided = involvedDecisions(frame.view, chapter, "planned", points);
        const decidedFull = decided.filter((decision) => decision.status === "decided").map((decision) => frame.view.object({kind: "decision", id: decision.id}) as Decision);
        const pendingDue = decided.filter((decision) => decision.status === "pending" && decision.due !== null && frame.view.chapters.indexOf(decision.due) !== -1 && frame.view.chapters.indexOf(decision.due) <= frame.view.chapters.indexOf(chapter)).map((decision) => frame.view.object({kind: "decision", id: decision.id}) as Decision);
        const routing = routeDecisions(gate, decidedFull, secrets);
        const frameHints: BriefHint[] = [...secrets.hints];
        const people = peopleItems(gate, chapter, participants, povId);
        // 不给内容的那一项，名字就是真相，不写出来。
        const secretItems: BriefItem[] = secrets.items.map((item) => ({label: item.hidden ? fixed.HIDDEN_NAME : item.name, text: [...(item.hidden ? [] : [item.name]), ...item.lines, ...(routing.inSecrets.get(item.point) ?? [])].join("\n"), protect: true}));
        const sections: BriefSection[] = [
            section("plan", fixed.TITLES.plan, planItems(gate, plans, chapter)),
            ...(frameIndex === 0 ? [section("rules", fixed.BRIEF_PARTS.rules, fixed.RULES.map((text) => ({label: text.slice(0, 8), text, protect: true})))] : []),
            section("secrets", fixed.BRIEF_PARTS.secrets, secretItems),
            {...section("people", fixed.BRIEF_PARTS.people, people.items), items: [{label: "说明", text: people.header, protect: true}, ...trim(people.items, limits.people ?? Infinity).kept]},
            section("scene", fixed.BRIEF_PARTS.scene, sceneItems(plans, chapter, frameHints)),
            ...(frameIndex === 0 ? [section("address", fixed.BRIEF_PARTS.address, addressItems(gates, framed.map((item) => item.participants), povId, instruction?.povMode))] : []),
            section("foreshadow", fixed.BRIEF_PARTS.foreshadow, foreshadowItems(gate, chapter, plans, frameHints)),
            section("decisions", fixed.BRIEF_PARTS.decisions, decisionItems(gate, routing.inDecisions, pendingDue)),
            section("reader", fixed.BRIEF_PARTS.reader, readerItems(gate, chapter, points, secrets)),
            ...(frameIndex === frames.length - 1 ? [section("allowed", fixed.BRIEF_PARTS.allowed, allowedItems(instruction)), section("selfReport", fixed.BRIEF_PARTS.selfReport, selfReportItems())] : []),
            section("appearance", fixed.TITLES.appearance, appearanceItems(gate, chapter)),
        ];
        hints.push(...frameHints);
        return {label: frame.label, sections};
    });
    const previousTail = previousTailOf(view, chapter, limits.previous ?? Infinity);
    const tail = previousTail === null ? [] : [{label: "上一章末尾", text: previousTail}];
    const closing: BriefSection[] = [{key: "previous", title: fixed.TITLES.previous, items: tail}, {key: "target", title: fixed.TITLES.target, items: [{label: "目标字数", text: String(input.targetWords), protect: true}]}];
    const text = render(common, parts, closing, omitted);
    const record: BriefRecord = {
        inputDigest: view.stamp.inputDigest,
        instructionVersion: instruction?.version ?? null,
        outlineDigest: input.digest(input.outline),
        targetWords: input.targetWords,
        previousDigest: previousTail === null ? null : input.digest(previousTail),
        pluginVersion: input.pluginVersion,
        omitted,
    };
    return {text, common: [...common, ...closing], parts, hints, record};
}

const BRIEF_KEYS = new Set(["rules", "secrets", "people", "scene", "address", "foreshadow", "decisions", "reader", "allowed", "selfReport"]);

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
