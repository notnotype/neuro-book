/**
 * 简报的其余各段（docs/specs/plot/brief.md 输出 2、5 到 11、13）：本章计划、在场的人、场景条件、称谓、伏笔、决策、读者已知、本章
 * 允许新增什么、涉及条目的样子。每一段返回若干项（裁剪按项从后往前）。
 */

import type {Decision, StoryChange} from "@notnotype/nb-canon/schema";

import {ENTRY_TYPES, MARK_IDS} from "../../shared/declarations";
import type {InstructionSnapshot} from "../../shared/instructions";
import {foreshadowIndex} from "../foreshadowing";
import {goalsOf} from "../goals";
import {bodyOf, knowingIndex, readerKnowing} from "../knowledge";
import {nameOf, planReveals, secrecyAt, isSecretPlus, type Frame, type Participant} from "./context";
import * as fixed from "./fixed";
import type {SecretsResult} from "./secrets";
import type {BriefHint, BriefItem} from "./types";

const json = (value: unknown) => (typeof value === "string" ? value : JSON.stringify(value));

/** 本章计划（输出 2）：每条计划一项，状态的变化写成字段的形式“对象的字段：旧 → 新”，不写自然语言的摘要句；藏着的目标只写“某某的一个隐秘目标”。 */
export function planItems(frame: Frame, plans: readonly StoryChange[], secrets: SecretsResult, chapter: string): BriefItem[] {
    const end = {kind: "chapter", chapter, edge: "end"} as const;
    return plans.map((plan) => {
        const lines = [plan.text];
        for (const patch of plan.patches) {
            const hidden = secrets.hiddenGoals.get(patch.at.entry);
            if (hidden !== undefined) {
                const shown = secrets.items.find((item) => item.point === hidden.point && !item.hidden);
                lines.push(shown === undefined ? fixed.hiddenGoalOf(nameOf(frame, hidden.holder)) : `${fixed.hiddenGoalOf(nameOf(frame, hidden.holder))}，见这一场的秘密`);
                continue;
            }
            // 知情行的变化是谁知道什么，写在这一场的秘密里，不在计划里重复。
            if (patch.at.path.startsWith("know.")) continue;
            const steps = frame.view.origins(patch.at, end, "planned");
            if (steps === "chapter-not-found") continue;
            const values = steps.flatMap((step) => (step.kind === "init" || step.kind === "carried" ? [{value: step.value, change: undefined as string | undefined}] : step.kind === "patch" ? [{value: step.result, change: step.change}] : []));
            const at = values.findIndex((item) => item.change === plan.id);
            if (at === -1) continue;
            lines.push(`${nameOf(frame, patch.at.entry)}的${patch.at.path}：${json(at === 0 ? null : values[at - 1]!.value)} → ${json(values[at]!.value)}`);
        }
        return {label: `计划 ${plan.id}`, text: lines.join("\n")};
    });
}

/** 在场的人（输出 5）：视角人物排第一；进行或受挫、没有隐秘的目标；两人都在本章的态度对子。 */
export function peopleItems(frame: Frame, chapter: string, participants: readonly Participant[], secrets: SecretsResult, pov: string | null): {readonly header: string; readonly items: BriefItem[]} {
    const view = frame.view;
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
        const lines = [nameOf(frame, who)];
        for (const goal of goalsOf(view, who, frame.position, "planned")) {
            if (goal.隐秘 !== null) {
                const mask = [...secrets.hiddenGoals.values()].some((hidden) => hidden.holder === who && hidden.point === goal.隐秘);
                const shown = secrets.items.find((item) => item.point === goal.隐秘 && !item.hidden);
                lines.push(shown !== undefined ? fixed.hiddenGoalSeeSecrets : mask ? fixed.hiddenGoalOf(nameOf(frame, who)) : fixed.hiddenGoalOf(nameOf(frame, who)));
                continue;
            }
            lines.push(`目标：${goal.name}${goal.为什么 === null ? "" : `（${goal.为什么}）`}${goal.状态 === "blocked" ? "，受挫" : ""}`);
        }
        const read = view.entry(who, frame.position, "planned");
        const rows = read === null || read === "chapter-not-found" ? [] : ((read.namespaces.att?.fields.态度?.value as Array<Record<string, unknown>> | undefined) ?? []);
        for (const row of rows) {
            const object = String(row.id);
            if (object === who || !scene.has(object) || typeof row.态度 !== "string") continue;
            const cause = (row.起因 as {ref?: unknown} | null | undefined)?.ref;
            const showCause = typeof cause === "string" && !isSecretPlus(secrecyAt(frame, cause));
            lines.push(`对${nameOf(frame, object)}的态度：${row.态度}${showCause ? `（起因：${nameOf(frame, cause)}）` : ""}`);
        }
        return {label: nameOf(frame, who), text: lines.join("\n"), protect: who === povBody};
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
 * 称谓（输出 7）：视角方式是第一人称或有限视角时生成。本章在场与被提到的每个人 P，叙述用的称呼按顺序取第一个能取到的：视角人物
 * 对 P 的态度行里的 `称呼`；P 这一场用马甲 M 而视角人物对“`揭穿` 指向 M”的知识点没有知道的有效知情时用 M 的名字；视角人物在本章之前
 * 有一条剧情变更与 P 同时在场、那一条里 P 没用马甲时用 P 的名字；只和用着马甲的 P 同时在场过时用最近那一次的马甲名；都没有用泛称。
 */
export function addressItems(frame: Frame, participants: readonly Participant[], pov: string | null, povMode: InstructionSnapshot["povMode"]): BriefItem[] {
    if (pov === null || (povMode !== "first" && povMode !== "limited")) return [];
    const view = frame.view;
    const povBody = bodyOf(view, pov);
    const index = knowingIndex(view, "planned", frame.position);
    const read = view.entry(povBody, frame.position, "planned");
    const attitudes = read === null || read === "chapter-not-found" ? [] : ((read.namespaces.att?.fields.态度?.value as Array<Record<string, unknown>> | undefined) ?? []);
    const startKey = view.positionKey(frame.position);
    const before = view.changes({kind: "written"}).filter((change) => {
        const key = view.eventKey(change.id, "planned");
        return change.status === "active" && key !== null && startKey !== null && view.compareKeys(key, startKey) < 0;
    }).sort((a, b) => view.compareKeys(view.eventKey(a.id, "planned")!, view.eventKey(b.id, "planned")!));
    const unmasking = (mask: string) => view.entries().filter((entry) => entry.deleted !== true && entry.type === ENTRY_TYPES.point).find((entry) => {
        const point = view.entry(entry.id, frame.position, "planned");
        return point !== null && point !== "chapter-not-found" && (point.namespaces.point?.fields.揭穿?.value as {ref?: unknown} | null | undefined)?.ref === mask;
    })?.id;
    const people = new Map<string, Participant | undefined>();
    for (const member of participants) {
        if (member.who === undefined) continue;
        const body = bodyOf(view, member.who);
        if (body !== povBody && (!people.has(body) || member.as !== undefined)) people.set(body, member);
    }
    const items: BriefItem[] = [];
    for (const [person, member] of people) {
        const call = attitudes.find((row) => row.id === person && typeof row.称呼 === "string" && row.称呼 !== "")?.称呼 as string | undefined;
        let name: string;
        if (call !== undefined) name = call;
        else if (member?.as !== undefined && (() => {
            const point = unmasking(member.as);
            return point === undefined || index.effective(povBody, point)?.程度 !== "knows";
        })()) name = nameOf(frame, member.as);
        else {
            const together = before.filter((change) => (change.cast ?? []).some((c) => c.role === "present" && c.who !== undefined && bodyOf(view, c.who) === povBody) && (change.cast ?? []).some((c) => c.role === "present" && c.who !== undefined && bodyOf(view, c.who) === person));
            const plain = together.some((change) => (change.cast ?? []).some((c) => c.role === "present" && c.who === person && c.as === undefined));
            const masked = together.map((change) => (change.cast ?? []).find((c) => c.role === "present" && c.who === person && c.as !== undefined)?.as).filter((as): as is string => as !== undefined).at(-1);
            name = plain ? nameOf(frame, person) : masked !== undefined ? nameOf(frame, masked) : "一个陌生人";
        }
        items.push({label: name, text: `${name} = ${nameOf(frame, person)}`});
    }
    for (const member of participants) if (member.who === undefined && member.label !== undefined) items.push({label: member.label, text: `${member.label} = ${member.label}`});
    if (items.length > 0) items.push({label: "末尾", text: fixed.ADDRESS_FOOTER, protect: true});
    return items;
}

/**
 * 伏笔（输出 8）：只列本章计划里有节点的伏笔，和依赖的物件出现在本章计划里的伏笔。节点是回收的：给主文字（打算怎么回收），但伏笔的
 * `答案` 是保密以上的知识点而本章计划没有对它的揭示时，不给主文字，写“回收方式按细纲写”并给提示；其余只给名字、节点的种类与指示，加“不要点破”。
 */
export function foreshadowItems(frame: Frame, chapter: string, plans: readonly StoryChange[], hints: BriefHint[]): BriefItem[] {
    const index = foreshadowIndex(frame.view, frame.position, "planned");
    const planIds = new Set(plans.map((plan) => plan.id));
    const reveals = planReveals(plans);
    const entries = new Set(frame.view.chapterEntries(chapter, "planned"));
    const items: BriefItem[] = [];
    for (const foreshadow of index.foreshadows) {
        const nodes = index.planned.filter((node) => node.foreshadow === foreshadow.id && planIds.has(node.plan));
        if (nodes.length === 0 && !foreshadow.objects.some((id) => entries.has(id))) continue;
        const lines = [foreshadow.name];
        for (const node of nodes) {
            if (node.role === "payoff" || node.role === "partial") {
                const withheld = foreshadow.answer !== null && isSecretPlus(secrecyAt(frame, foreshadow.answer)) && !reveals.has(foreshadow.answer);
                if (withheld) {
                    lines.push(`${node.role === "payoff" ? "回收" : "部分回收"}：${fixed.PAYOFF_BY_OUTLINE}`);
                    hints.push({code: "nbook.plot.brief.payoffWithheld", objects: [{kind: "entry", id: foreshadow.id}], range: {from: chapter, to: chapter}});
                } else {
                    const read = frame.view.entry(foreshadow.id, frame.position, "planned");
                    const main = read === null || read === "chapter-not-found" || read.summary === "" ? foreshadow.name : read.summary;
                    lines.push(`${node.role === "payoff" ? "回收" : "部分回收"}：${main}${node.note === undefined ? "" : `（指示：${node.note}）`}`);
                }
            } else lines.push(`${node.role === "plant" ? "埋下" : node.role === "mislead" ? "误导" : "呼应"}${node.note === undefined ? "" : `（指示：${node.note}）`}；${fixed.DONT_BREAK}`);
        }
        items.push({label: foreshadow.name, text: lines.join("\n")});
    }
    return items;
}

/** 决策（输出 9）：不挂保密以上知识点的原话、挂在秘密里的指向，加上 `due` 不晚于本章的待定决策。 */
export function decisionItems(lines: readonly string[], pendingDue: readonly Decision[]): BriefItem[] {
    const items = lines.map((text) => ({label: text.slice(0, 12), text}));
    for (const decision of pendingDue) items.push({label: decision.text.slice(0, 12), text: `待定（到期）：${decision.text}`});
    return items;
}

/** 读者已知（输出 10）：本章涉及的知识点里，读者在上一章末尾已经 `knows` 的写“读者已经知道”，`suspects` 的写“读者已经在怀疑”；保密以上的只写这一场的秘密里那一项的名字。 */
export function readerItems(frame: Frame, chapter: string, points: readonly string[], secrets: SecretsResult): BriefItem[] {
    const index = frame.view.chapters.indexOf(chapter);
    if (index <= 0) return [];
    const at = {chapter: frame.view.chapters[index - 1]!, edge: "end"} as const;
    const items: BriefItem[] = [];
    for (const point of points) {
        const degree = readerKnowing(frame.view, point, at);
        if (degree === "unaware") continue;
        const secret = secrets.items.find((item) => item.point === point);
        // 保密以上的只写这一场的秘密里那一项的名字；不在那里的保密以上知识点不写。
        if (secret === undefined && isSecretPlus(secrecyAt(frame, point))) continue;
        const what = secret !== undefined ? `（见这一场的秘密：${secret.name}）` : nameOf(frame, point);
        items.push({label: nameOf(frame, point), text: `${degree === "knows" ? "读者已经知道" : "读者已经在怀疑"}：${what}`});
    }
    return items;
}

/** 本章允许新增什么与自陈（输出 11）：固定句；写作指示有 `ending` 时加一句。 */
export function allowedItems(instruction: InstructionSnapshot | undefined): BriefItem[] {
    const items: BriefItem[] = fixed.ALLOWED.map((text) => ({label: text.slice(0, 12), text, protect: true}));
    if (instruction?.ending !== undefined && instruction.ending !== "") items.push({label: "结尾", text: fixed.ending(instruction.ending), protect: true});
    items.push({label: "自陈", text: fixed.SELF_REPORT, protect: true});
    return items;
}
