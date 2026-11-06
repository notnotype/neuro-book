/**
 * 简报的读取框架（docs/specs/plot/brief.md 输出 2、14）与“本章涉及的知识点”的写之前的集合（knowledge.md 输出 10）。
 *
 * 每份简报读本章开头、本章讲的那条线（按计划模式）；本章分段讲两条线的，每段一份。写作指示的时间方式是补叙某处安放时读那处安放：
 * 读取位置只有初值与章首、章末，所以近似成那处安放所在章的章首（前史读初值），是 Spec 没写清的近似，记待确认。
 */

import type {CanonReadView, Mark, Placement, ReadPosition, StoryChange} from "@notnotype/nb-canon/schema";

import {DEFAULT_SECRECY, ENTRY_TYPES, MARK_IDS, type Secrecy} from "../../shared/declarations";
import type {InstructionSnapshot} from "../../shared/instructions";

/** 一份简报读的框架。 */
export interface Frame {
    /** 标明适用的段落（“回溯前”“回溯后”）；只有一份时没有。 */
    readonly label: string | null;
    readonly line: string;
    readonly view: CanonReadView;
    readonly position: ReadPosition;
}

/** 补叙时读的位置：那处安放所在章的章首；前史里的读初值。 */
function flashbackPosition(placement: Placement): ReadPosition {
    return placement.kind === "chapter" ? {kind: "chapter", chapter: placement.chapter, edge: "start"} : {kind: "initial"};
}

/** 本章要拼几份简报、各读哪条线哪个位置。线读不到（不存在、不可建）时 `line-not-found`。 */
export function framesOf(view: CanonReadView, chapter: string, instruction: InstructionSnapshot | undefined): Frame[] | "chapter-not-found" | "line-not-found" {
    if (!view.chapters.includes(chapter)) return "chapter-not-found";
    const segments = view.chapterLines(chapter);
    const timeMode = instruction?.timeMode;
    const flashback = timeMode !== undefined && typeof timeMode !== "string" && "flashback" in timeMode ? (timeMode.flashback as Placement) : undefined;
    const position = flashback === undefined ? ({kind: "chapter", chapter, edge: "start"} as const) : flashbackPosition(flashback);
    const frames: Frame[] = [];
    for (const [index, segment] of segments.entries()) {
        const on = segment.line === view.line ? view : view.onLine(segment.line, "planned");
        if ("code" in on) return "line-not-found";
        frames.push({label: segments.length === 1 ? null : segments.length === 2 ? (index === 0 ? "回溯前" : "回溯后") : `第 ${String(index + 1)} 段`, line: segment.line, view: on, position});
    }
    return frames;
}

export interface Participant {
    /** 条目（马甲时是本体）；没建条目的临时人物没有。 */
    readonly who?: string;
    readonly label?: string;
    readonly as?: string;
    readonly role: "present" | "mentioned";
}

/** 本章在这个框架里生效的计划（按计划模式的先后）。 */
export function plansOf(frame: Frame, chapter: string): StoryChange[] {
    const plans = frame.view.changes({chapter, kind: "plan"}).filter((change) => change.status === "active" && change.nature !== "fork");
    return plans.sort((a, b) => {
        const [ka, kb] = [frame.view.eventKey(a.id, "planned"), frame.view.eventKey(b.id, "planned")];
        if (ka === null || kb === null) return ka === kb ? 0 : ka === null ? 1 : -1;
        return frame.view.compareKeys(ka, kb);
    });
}

/** 本章计划的参与者（去重，同一个人按出现的先后；`who` 与 `as` 都记下）。 */
export function participantsOf(plans: readonly StoryChange[]): Participant[] {
    const seen = new Set<string>();
    const result: Participant[] = [];
    for (const plan of plans) {
        for (const member of plan.cast ?? []) {
            const key = `${member.who ?? ""}|${member.label ?? ""}|${member.as ?? ""}|${member.role}`;
            if (seen.has(key)) continue;
            seen.add(key);
            result.push({...(member.who === undefined ? {} : {who: member.who}), ...(member.label === undefined ? {} : {label: member.label}), ...(member.as === undefined ? {} : {as: member.as}), role: member.role});
        }
    }
    return result;
}

/** 条目在这个位置的名字；读不到时回到 id。 */
export function nameOf(frame: Frame, id: string): string {
    const read = frame.view.entry(id, frame.position, "planned");
    return read === null || read === "chapter-not-found" ? id : read.name;
}

const secrecyOf = (frame: Frame, id: string): Secrecy | null => {
    const stored = frame.view.object({kind: "entry", id}) as {type?: string; deleted?: boolean} | undefined;
    if (stored === undefined || stored.deleted === true || stored.type !== ENTRY_TYPES.point) return null;
    const read = frame.view.entry(id, frame.position, "planned");
    if (read === null || read === "chapter-not-found") return null;
    const value = read.namespaces.point?.fields.保密?.value;
    return typeof value === "string" ? (value as Secrecy) : DEFAULT_SECRECY;
};

export const isSecretPlus = (secrecy: Secrecy | null): secrecy is "secret" | "topSecret" => secrecy === "secret" || secrecy === "topSecret";
export const secrecyAt = secrecyOf;

/** 计划上的指示：讲述上的 `reveal`（挂在讲述上，不在 `change.marks` 里）。每个知识点取最强的一种（明说强于暗示）。 */
export function planReveals(plans: readonly StoryChange[]): Map<string, "hint" | "explicit"> {
    const found = new Map<string, "hint" | "explicit">();
    for (const plan of plans) {
        for (const telling of plan.told) {
            for (const mark of telling.marks ?? []) {
                if (mark.kind !== MARK_IDS.reveal || mark.version !== 1 || typeof mark.point !== "string") continue;
                const mode = mark.mode === "explicit" ? "explicit" : "hint";
                if (found.get(mark.point) !== "explicit") found.set(mark.point, mode);
            }
        }
    }
    return found;
}

/** 补丁、标注里引到的知识点：补丁地址的条目、`know.知情[P]` 路径、值里的 `id` 与 `ref`。 */
function patchPoints(frame: Frame, plan: StoryChange): string[] {
    const found: string[] = [];
    for (const patch of plan.patches) {
        found.push(patch.at.entry);
        for (const match of patch.at.path.matchAll(/\[([^\]]+)\]/gu)) found.push(match[1]!);
        const value = patch.value as {id?: unknown; ref?: unknown} | null;
        if (value !== null && typeof value === "object") {
            if (typeof value.id === "string") found.push(value.id);
            if (typeof value.ref === "string") found.push(value.ref);
        }
    }
    return found.filter((id) => secrecyOf(frame, id) !== null);
}

const marksOf = (marks: readonly Mark[] | undefined, kind: string) => (marks ?? []).filter((mark) => mark.kind === kind && mark.version === 1);

/** 一条变更引用到的知识点：补丁、标注（揭示、在场揭示、伏笔节点所指伏笔的答案）、讲述上的标注（knowledge 输出 10 的“这几样”）。 */
export function pointsReferencedBy(frame: Frame, change: StoryChange): string[] {
    const points = patchPoints(frame, change);
    for (const mark of marksOf(change.marks, MARK_IDS.presentLearns)) if (typeof mark.point === "string") points.push(mark.point);
    for (const telling of change.told) {
        for (const mark of marksOf(telling.marks, MARK_IDS.reveal)) if (typeof mark.point === "string") points.push(mark.point);
        for (const mark of marksOf(telling.marks, MARK_IDS.node)) {
            const foreshadow = frame.view.entry(String(mark.foreshadow), frame.position, "planned");
            const answer = foreshadow === null || foreshadow === "chapter-not-found" ? undefined : (foreshadow.namespaces.fs?.fields.答案?.value as {ref?: unknown} | null | undefined)?.ref;
            if (typeof answer === "string") points.push(answer);
        }
    }
    return points;
}

/**
 * 本章涉及的知识点，写之前的集合（knowledge 输出 10）：计划的补丁与标注（揭示、在场揭示、伏笔节点所指伏笔的答案）、细纲讲述上的
 * 标注引用到的知识点；加上主体是计划的参与者或涉及的条目、保密档为 `secret` 或 `topSecret` 的知识点；加上这些参与者进行或受挫的
 * 目标的 `隐秘` 指向的知识点。阶段 F 的“写完以后的集合”在它上面加。
 */
export function pointsBeforeWriting(frame: Frame, chapter: string, plans: readonly StoryChange[]): string[] {
    const points = new Set<string>();
    const view = frame.view;
    const entries = new Set(view.chapterEntries(chapter, "planned"));
    for (const plan of plans) for (const id of pointsReferencedBy(frame, plan)) points.add(id);
    // 主体（条目树里的父条目）是参与者或涉及的条目、保密以上的知识点。
    for (const entry of view.entries()) {
        if (entry.deleted === true || entry.type !== ENTRY_TYPES.point || entry.parent === null || !entries.has(entry.parent)) continue;
        if (isSecretPlus(secrecyOf(frame, entry.id))) points.add(entry.id);
    }
    // 参与者进行或受挫的目标的隐秘知识点。
    for (const entry of view.entries()) {
        if (entry.deleted === true || entry.type !== ENTRY_TYPES.goal || entry.parent === null || !entries.has(entry.parent)) continue;
        const read = view.entry(entry.id, frame.position, "planned");
        if (read === null || read === "chapter-not-found" || read.deleted || !read.appeared) continue;
        const status = read.namespaces.goal?.fields.状态?.value;
        const secret = (read.namespaces.goal?.fields.隐秘?.value as {ref?: unknown} | null | undefined)?.ref;
        if ((status === "active" || status === "blocked") && typeof secret === "string") points.add(secret);
    }
    return [...points].filter((id) => secrecyOf(frame, id) !== null).sort();
}

/** 指向这个马甲的 `揭穿` 的知识点（称谓表与在场的人用它判断视角人物知不知道、这个马甲背后的名字能不能写）。 */
export function unmaskingPoint(frame: Frame, mask: string): string | undefined {
    return frame.view.entries().find((entry) => {
        if (entry.deleted === true || entry.type !== ENTRY_TYPES.point) return false;
        const read = frame.view.entry(entry.id, frame.position, "planned");
        return read !== null && read !== "chapter-not-found" && (read.namespaces.point?.fields.揭穿?.value as {ref?: unknown} | null | undefined)?.ref === mask;
    })?.id;
}
