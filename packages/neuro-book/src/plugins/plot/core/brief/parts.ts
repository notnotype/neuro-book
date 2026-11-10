/**
 * 简报的其余各段（docs/specs/plot/brief.md 输出 2、5 到 11）：本章计划、在场的人、场景条件、称谓、伏笔、决策、读者已知、本章
 * 允许新增什么。每一段返回若干项（裁剪按项从后往前）。条目的名字、值与作者文字都经关卡（`gate.ts`，输出 16）。
 */

import type {Decision, Patch, StoryChange} from "@notnotype/nb-canon/schema";

import {ENTRY_TYPES, MARK_IDS} from "../../shared/declarations";
import type {InstructionSnapshot} from "../../shared/instructions";
import {foreshadowIndex} from "../foreshadowing";
import {goalsOf} from "../goals";
import {bodyOf, knowingIndex, readerKnowing} from "../knowledge";
import {isSecretPlus, planReveals, type Participant} from "./context";
import * as fixed from "./fixed";
import type {Gate} from "./gate";
import {aboutEntries, type SecretsResult} from "./secrets";
import type {BriefHint, BriefItem} from "./types";

const DEGREE_TEXT: Readonly<Record<string, string>> = {knows: "知道", suspects: "怀疑", misbelieves: "误信", unaware: "不知道", forgot: "忘了"};
const degreeText = (row: {readonly 程度: string | null} | null) => (row === null || row.程度 === null ? "没有记录" : (DEGREE_TEXT[row.程度] ?? row.程度));

/** 条目自己的几个地址的写法。 */
const ENTRY_FIELDS: Readonly<Record<string, string>> = {"entry.name": "名字", "entry.summary": "一句话描述", "entry.aliases": "别名"};

/** 字段的显示名（字段声明的 label，不是条目的名字）。 */
const fieldLabel = (gate: Gate, entry: string, namespace: string, field: string): string => {
    const read = gate.frame.view.entry(entry, gate.frame.position, "planned");
    return (read === null || read === "chapter-not-found" ? undefined : read.namespaces[namespace]?.fields[field]?.label) ?? field;
};

const typeOf = (gate: Gate, id: string) => (gate.frame.view.object({kind: "entry", id}) as {type?: string} | undefined)?.type;

/** 一个地址在简报里的写法（输出 2）：“星瑾的状态”“星瑾对哥哥的态度”。字段写显示名，不写命名空间；以条目为键的列表的一行写成“对某某”。 */
function fieldPhrase(gate: Gate, at: Patch["at"]): string {
    const owner = gate.name(at.entry);
    const own = ENTRY_FIELDS[at.path];
    if (own !== undefined) return `${owner}的${own}`;
    const parsed = /^([^.[\]]+)\.([^.[\]]+)(?:\[([^\]]+)\](?:\.(.+))?)?$/u.exec(at.path);
    if (parsed === null) return `${owner}的${at.path}`;
    const [, namespace, field, element, sub] = parsed as unknown as [string, string, string, string | undefined, string | undefined];
    const label = fieldLabel(gate, at.entry, namespace, field);
    if (element === undefined) return `${owner}的${label}`;
    return gate.isEntry(element) ? `${owner}对${gate.name(element)}的${sub ?? label}` : `${owner}的${label}（${gate.rowName(at.entry, at.path, element)}）${sub === undefined ? "" : `的${sub}`}`;
}

/** 增减列表一行的写法。 */
function listLine(gate: Gate, patch: Patch): string {
    const parsed = /^([^.[\]]+)\.([^.[\]]+)$/u.exec(patch.at.path);
    const label = parsed === null ? patch.at.path : fieldLabel(gate, patch.at.entry, parsed[1]!, parsed[2]!);
    const owner = gate.name(patch.at.entry);
    if (patch.op === "listRemove") {
        const element = String(patch.value);
        return `${owner}的${label}：去掉${gate.isEntry(element) ? gate.name(element) : gate.rowName(patch.at.entry, patch.at.path, element)}`;
    }
    return `${owner}的${label}：加上${gate.value(patch.value ?? {})}`;
}

/**
 * 本章计划（输出 2）：每条计划一项，状态的变化写成字段的形式“对象的字段：旧 → 新”，不写自然语言的摘要句。知情行的变化（谁在这一章
 * 得知什么）写成“某某对某事：不知道 → 知道”；知识点自己的字段不写（真相只在这一场的秘密里）；藏着秘密的目标只写一句它的占位；
 * 名字占位的别的条目（已删除、之后才出场）不写它的变化；同一个地址在一条计划里改几次只写一行（第一个旧值到最后一个新值）。
 * 项的 label 是计划原话的开头（进“已省略”的就是它），不是计划 id。
 */
export function planItems(gate: Gate, plans: readonly StoryChange[], chapter: string): BriefItem[] {
    const view = gate.frame.view;
    const end = {kind: "chapter", chapter, edge: "end"} as const;
    const index = knowingIndex(view, "planned", end);
    return plans.map((plan) => {
        const lines = [plan.text];
        for (const person of new Set(plan.patches.filter((patch) => patch.at.path.startsWith("know.")).map((patch) => patch.at.entry))) {
            for (const change of index.changedBy(person, plan.id)) lines.push(fixed.changeKnowing(gate.name(person), gate.name(change.point), degreeText(change.before), degreeText(change.after)));
        }
        const seen = new Set<string>();
        for (const patch of plan.patches) {
            if (patch.at.path.startsWith("know.") || typeOf(gate, patch.at.entry) === ENTRY_TYPES.point) continue;
            if (gate.kind(patch.at.entry) === "placeholder") {
                // 藏着秘密的目标写一句占位（名字与状态变化都不写）；别的占位条目不写。
                if (gate.hiding(patch.at.entry) === null || seen.has(`hidden|${patch.at.entry}`)) continue;
                seen.add(`hidden|${patch.at.entry}`);
                lines.push(gate.name(patch.at.entry));
                continue;
            }
            // 增减一张列表的一行写成一件事，不把整张列表写成 JSON。
            if (patch.op === "listAdd" || patch.op === "listRemove") {
                lines.push(listLine(gate, patch));
                continue;
            }
            const key = `${patch.at.entry}|${patch.at.path}`;
            if (seen.has(key)) continue;
            seen.add(key);
            const steps = view.origins(patch.at, end, "planned");
            if (steps === "chapter-not-found") continue;
            const values = steps.flatMap((step) => (step.kind === "init" || step.kind === "carried" ? [{value: step.value, change: undefined as string | undefined}] : step.kind === "patch" ? [{value: step.result, change: step.change}] : []));
            const at = values.findIndex((item) => item.change === plan.id);
            if (at === -1) continue;
            lines.push(`${fieldPhrase(gate, patch.at)}：${gate.value(at === 0 ? null : values[at - 1]!.value)} → ${gate.value(values[at]!.value)}`);
        }
        return {label: [...plan.text].slice(0, 12).join(""), text: lines.join("\n")};
    });
}

/**
 * 在场的人（输出 5）：视角人物排第一；进行或受挫、不藏秘密的目标；两人都在本章的态度对子。X 对一个这一场用马甲的人 P 的态度：
 * X 认得他（`gate.recognizes`）时列 X 对 P 本体的那一行，否则列 X 对马甲条目的那一行（有的话）：不认得他，对本体的态度不适用；
 * 身份不给写手时，对本体的关系同样是这条秘密的内容。
 */
export function peopleItems(gate: Gate, chapter: string, participants: readonly Participant[], pov: string | null): {readonly header: string; readonly items: BriefItem[]} {
    const view = gate.frame.view;
    const bodies: string[] = [];
    const labels: string[] = [];
    for (const member of participants) {
        if (member.role !== "present") continue;
        if (member.who !== undefined) {
            const body = bodyOf(view, member.who);
            if (!bodies.includes(body)) bodies.push(body);
        } else if (member.label !== undefined && !labels.includes(member.label)) labels.push(member.label);
    }
    const povBody = pov === null ? null : bodyOf(view, pov);
    bodies.sort((a, b) => Number(b === povBody) - Number(a === povBody));
    const scene = new Set([...bodies, ...view.chapterEntries(chapter, "planned")]);
    const items: BriefItem[] = bodies.map((who) => {
        const lines = [gate.name(who)];
        // 目标按写出来的名字再按 id 排：条目在内部表里的先后（发布的批次）不能改变简报的文字。藏着秘密的目标写出来都一样，谁先无所谓。
        const goals = goalsOf(view, who, gate.frame.position, "planned").map((goal) => ({goal, shown: gate.name(goal.id)}));
        for (const {goal} of goals.sort((a, b) => (a.shown < b.shown ? -1 : a.shown > b.shown ? 1 : a.goal.id < b.goal.id ? -1 : 1))) {
            if (gate.hiding(goal.id) !== null) {
                lines.push(gate.secretClass(goal.id) === "shown" ? fixed.hiddenGoalSeeSecrets : fixed.hiddenGoalOf(gate.name(who)));
                continue;
            }
            lines.push(`目标：${gate.name(goal.id)}${goal.为什么 === null ? "" : `（${goal.为什么}）`}${goal.状态 === "blocked" ? "，受挫" : ""}`);
        }
        const read = view.entry(who, gate.frame.position, "planned");
        const rows = read === null || read === "chapter-not-found" ? [] : ((read.namespaces.att?.fields.态度?.value as Array<Record<string, unknown>> | undefined) ?? []);
        for (const row of rows) {
            const object = String(row.id);
            if (object === who || !scene.has(object) || typeof row.态度 !== "string") continue;
            const body = bodyOf(view, object);
            const mask = gate.maskOf(body);
            // 对本体的一行：这一场他用马甲、X 不认得时不列；对马甲条目的一行：X 认得他时不列（用对本体的那一行）。
            if (body === object && mask !== undefined && !gate.recognizes(who, body)) continue;
            if (body !== object && gate.maskOf(body) === object && gate.recognizes(who, body)) continue;
            const cause = (row.起因 as {ref?: unknown} | null | undefined)?.ref;
            const showCause = typeof cause === "string" && gate.kind(cause) === "plain";
            lines.push(`对${gate.name(object)}的态度：${row.态度}${showCause ? `（起因：${gate.name(cause)}）` : ""}`);
        }
        return {label: gate.name(who), text: lines.join("\n"), protect: who === povBody};
    });
    for (const label of labels) items.push({label, text: label});
    if (bodies.length + labels.length > 1) items.push({label: "其他人", text: fixed.OTHERS_NO_ATTITUDE});
    return {header: fixed.PEOPLE_HEADER, items};
}

/** 场景条件（输出 6）：照抄本章计划上 `nbook.plot.scene` 的各行，按计划的先后；都没有写“细纲与计划没写场景条件”并给提示。 */
export function sceneItems(plans: readonly StoryChange[], chapter: string, hints: BriefHint[]): BriefItem[] {
    const lines = plans.flatMap((plan) => (plan.marks ?? []).filter((mark) => mark.kind === MARK_IDS.scene && mark.version === 1 && Array.isArray(mark.lines)).flatMap((mark) => (mark.lines as unknown[]).filter((line): line is string => typeof line === "string")));
    if (lines.length === 0) {
        hints.push({code: "nbook.plot.brief.noSceneConditions", range: {from: chapter, to: chapter}});
        return [{label: "场景条件", text: fixed.SCENE_MISSING}];
    }
    return lines.map((line) => ({label: line.slice(0, 12), text: line}));
}

/**
 * 称谓（输出 7）：视角方式是第一人称或有限视角时生成，整章只写一次（回溯章的几份合在一起）。每个人取一份框架的关卡给左右两栏：
 * 有一份里他用马甲而视角人物不认得他，取最早那一份（左栏写本名的例外要每一份都允许）；否则有一份里他改名，取最早那一份；
 * 否则取他出现的第一份。左右两栏出自同一份，两段各用一个马甲时不会把两个马甲对上。
 */
export function addressItems(gates: readonly Gate[], participantsByFrame: readonly (readonly Participant[])[], pov: string | null, povMode: InstructionSnapshot["povMode"]): BriefItem[] {
    if (pov === null || (povMode !== "first" && povMode !== "limited") || gates.length === 0) return [];
    const view = gates[0]!.frame.view;
    const povBody = bodyOf(view, pov);
    const people: string[] = [];
    const labels: string[] = [];
    for (const participants of participantsByFrame) {
        for (const member of participants) {
            if (member.who === undefined) {
                if (member.label !== undefined && !labels.includes(member.label)) labels.push(member.label);
                continue;
            }
            const body = bodyOf(view, member.who);
            if (body !== povBody && !people.includes(body)) people.push(body);
        }
    }
    const items: BriefItem[] = [];
    for (const person of people) {
        const appears = gates.filter((_gate, index) => participantsByFrame[index]!.some((member) => member.who !== undefined && bodyOf(view, member.who) === person));
        const gate = appears.find((candidate) => candidate.maskOf(person) !== undefined && !candidate.recognizes(povBody, person)) ?? appears.find((candidate) => candidate.kind(person) !== "plain") ?? appears[0] ?? gates[0]!;
        const name = gate.narrativeName(pov, person);
        items.push({label: name, text: `${name} = ${gate.name(person)}`});
    }
    for (const label of labels) items.push({label, text: `${label} = ${label}`});
    if (items.length > 0) items.push({label: "末尾", text: fixed.ADDRESS_FOOTER, protect: true});
    return items;
}

/**
 * 伏笔（输出 8）：只列本章计划里有节点的伏笔，和依赖的物件出现在本章计划里的伏笔。节点是回收的：给主文字的纯文字（打算怎么回收）；
 * 答案是保密以上而本章计划没有揭示它，或主文字有一块经关卡扣下时，不给主文字，写“回收方式按细纲写”并给带原因的提示；其余只给名字、
 * 节点的种类与指示，加“不要点破”。
 */
export function foreshadowItems(gate: Gate, chapter: string, plans: readonly StoryChange[], hints: BriefHint[]): BriefItem[] {
    const view = gate.frame.view;
    const index = foreshadowIndex(view, gate.frame.position, "planned");
    const planIds = new Set(plans.map((plan) => plan.id));
    const reveals = planReveals(plans);
    const entries = new Set(view.chapterEntries(chapter, "planned"));
    const items: BriefItem[] = [];
    for (const foreshadow of index.foreshadows) {
        const nodes = index.planned.filter((node) => node.foreshadow === foreshadow.id && planIds.has(node.plan));
        if (nodes.length === 0 && !foreshadow.objects.some((id) => entries.has(id))) continue;
        const title = gate.name(foreshadow.id);
        const lines = [title];
        for (const node of nodes) {
            if (node.role === "payoff" || node.role === "partial") {
                const blocks = gate.blocks(foreshadow.id);
                const secretAnswer = foreshadow.answer !== null && isSecretPlus(gate.secrecy(foreshadow.answer)) && !reveals.has(foreshadow.answer);
                const reason = secretAnswer ? "answer" : (blocks.find((block) => block.withheld !== null)?.withheld ?? null);
                const role = node.role === "payoff" ? "回收" : "部分回收";
                if (reason !== null) {
                    lines.push(`${role}：${fixed.PAYOFF_BY_OUTLINE}`);
                    hints.push({code: "nbook.plot.brief.payoffWithheld", objects: [{kind: "entry", id: foreshadow.id}], range: {from: chapter, to: chapter}, reason});
                } else {
                    // 主文字写打算怎么回收（术语）；还没写时退回一句话描述与名字。
                    const text = blocks.map((block) => block.text).join("\n");
                    const main = text !== "" ? text : gate.summary(foreshadow.id) || title;
                    lines.push(`${role}：${main}${node.note === undefined ? "" : `（指示：${node.note}）`}`);
                }
            } else lines.push(`${node.role === "plant" ? "埋下" : node.role === "mislead" ? "误导" : "呼应"}${node.note === undefined ? "" : `（指示：${node.note}）`}；${fixed.DONT_BREAK}`);
        }
        items.push({label: title, text: lines.join("\n")});
    }
    return items;
}

/**
 * 决策（输出 9）：不涉秘密的原话、挂在秘密里的指向，加上 `due` 不晚于本章的待定决策；待定决策挂着秘密（给不给内容都算）时文字
 * 天然带秘密，只写“有一条涉及保密设定的待定决定到期了”。
 */
export function decisionItems(gate: Gate, lines: readonly string[], pendingDue: readonly Decision[]): BriefItem[] {
    const items = lines.map((text) => ({label: text.slice(0, 12), text}));
    for (const decision of pendingDue) {
        const secret = aboutEntries(decision).some((id) => gate.secretClass(id) !== "none");
        items.push(secret ? {label: "待定决定", text: fixed.DECISION_DUE_ABOUT_SECRET} : {label: decision.text.slice(0, 12), text: `待定（到期）：${decision.text}`});
    }
    return items;
}

/** 读者已知（输出 10）：本章涉及的知识点里，读者在上一章末尾已经 `knows` 的写“读者已经知道”，`suspects` 的写“读者已经在怀疑”；保密以上的只写这一场的秘密里那一项的名字。 */
export function readerItems(gate: Gate, chapter: string, points: readonly string[], secrets: SecretsResult): BriefItem[] {
    const view = gate.frame.view;
    const index = view.chapters.indexOf(chapter);
    if (index <= 0) return [];
    const at = {chapter: view.chapters[index - 1]!, edge: "end"} as const;
    const items: BriefItem[] = [];
    for (const point of new Set(points)) {
        const degree = readerKnowing(view, point, at);
        if (degree === "unaware") continue;
        const secret = secrets.items.find((item) => item.point === point);
        // 不在这一场的秘密里、又涉及秘密的（保密以上、不给写手的揭穿、已删除）不写；不给内容的那一项名字就是真相，用称呼代替。
        if (secret === undefined && gate.secretClass(point) !== "none") continue;
        const what = secret === undefined ? gate.name(point) : secret.hidden ? fixed.READER_SEES_HIDDEN : `（见这一场的秘密：${secret.name}）`;
        items.push({label: secret?.hidden === true ? fixed.HIDDEN_NAME : gate.name(point), text: `${degree === "knows" ? "读者已经知道" : "读者已经在怀疑"}：${what}`});
    }
    return items;
}

/** 本章允许新增什么（输出 11）：固定句；写作指示有 `ending` 时加一句。自陈的格式另成一段。 */
export function allowedItems(instruction: InstructionSnapshot | undefined): BriefItem[] {
    const items: BriefItem[] = fixed.ALLOWED.map((text) => ({label: text.slice(0, 12), text, protect: true}));
    if (instruction?.ending !== undefined && instruction.ending !== "") items.push({label: "结尾", text: fixed.ending(instruction.ending), protect: true});
    return items;
}

/** 自陈的格式（输出 1、11）：固定三栏。 */
export function selfReportItems(): BriefItem[] {
    return [{label: "自陈", text: fixed.SELF_REPORT, protect: true}];
}
