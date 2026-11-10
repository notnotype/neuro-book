/**
 * 简报的关卡（docs/specs/plot/brief.md 输出 16）：简报里每一个条目的名字、每一个值、每一块作者文字、每一条秘密的真相，都只经
 * 这里写出。core/brief/ 下别的文件不读条目的名字、简介与别名，写人、写知识点、写目标都调 `Gate`，“能不能写给写手”只在这里
 * 判断一次（t34 三轮审查各找出新的泄漏路径，根因是十几处各自判断）。
 *
 * 分两步：先算遮挡事实，再按事实给写法。“是不是秘密”的事实都取两处里更严的一边：章首是框架的读取位置（补叙章是补叙处），
 * 章末是要写的这一章在这个框架的线上的章末，计划模式。本章计划自己把知识点升成绝密、把目标设成隐秘时，这一章就要遮。
 */

import type {CanonReadView, ReadPosition, StoryChange} from "@notnotype/nb-canon/schema";

import {DEFAULT_SECRECY, ENTRY_TYPES, SECRECY, type Secrecy} from "../../shared/declarations";
import {conflictsOf} from "../goals";
import {bodyOf, knowingIndex} from "../knowledge";
import {isSecretPlus, type Frame, type Participant} from "./context";
import * as fixed from "./fixed";

/** 名字的种类：plain 照写；rename 改名（身份是秘密、这一场用马甲的本体写马甲）；placeholder 占位。 */
export type NameKind = "plain" | "rename" | "placeholder";
/** 秘密的种类：none 不涉秘密；shown 这一场的秘密里给了内容；withheld 不给内容。决策的去向与伏笔的提示按它判。 */
export type SecretClass = "none" | "shown" | "withheld";
/** 一块作者文字为什么被扣：写不干净、引到占位的条目、读了改名的本体的数据。 */
export type Withheld = "problem" | "placeholder" | "rename";

/** 一个目标藏着保密以上的知识点：给了内容时归到 `first` 那一项。 */
export interface HidingGoal {
    readonly goal: string;
    readonly holder: string;
    readonly state: "shown" | "withheld";
    /** 它藏着的、要算的知识点里排第一的（保密档高的在前，同档按 id）。 */
    readonly first: string;
    readonly points: readonly string[];
}

export interface Gate {
    readonly frame: Frame;
    /** 这一场的秘密里给内容的知识点。 */
    readonly shown: ReadonlySet<string>;
    /** 这一场涉及的知识点：传进来的集合，加上这一场戴着的马甲的整组揭穿（它们都和这一场有关）。 */
    readonly points: readonly string[];
    /** 知识点在章首与章末的保密档里更严的一个；不是知识点、读不到时为 null。 */
    secrecy(point: string): Secrecy | null;
    isEntry(id: string): boolean;
    kind(id: string): NameKind;
    name(id: string): string;
    /** 一句话描述、别名与正文能不能给：名字照写的条目才能；身份不给写手的马甲条目不能（作者最可能在这里写出他是谁）。 */
    describable(id: string): boolean;
    summary(id: string): string;
    aliases(id: string): readonly string[];
    secretClass(id: string): SecretClass;
    /** 目标藏着保密以上的知识点（或已删除、读不到的）时的情况；不藏的为 null。 */
    hiding(goal: string): HidingGoal | null;
    /** 这一场用的马甲（只看参与者的 `as`；身份是不是秘密都算）。 */
    maskOf(body: string): string | undefined;
    /** X 认得用马甲的 P：X 对揭穿这个马甲的某条知识点有知道的有效知情，且这个身份给写手。P 没用马甲时成立。 */
    recognizes(x: string, p: string): boolean;
    /** 这一场用马甲、身份不给写手的本体：他的目标、态度与字段变化都不挂到马甲名下（开发者 2026-11-10 定）。 */
    identityWithheld(body: string): boolean;
    /** 条目是身份不给写手的本体，或是他的目标：它的变化不写。 */
    ownedByWithheld(id: string): boolean;
    /** X 对 Y 的关系（以 Y 为键的那一行）能不能写：Y 这一场用马甲而 X 不认得他时不写（Y 是占位的，名字已经是占位，照写）。 */
    relationVisible(x: string, y: string): boolean;
    value(value: unknown): string;
    blocks(entry: string): readonly {readonly text: string; readonly withheld: Withheld | null}[];
    subject(point: string): string;
    /** 给了内容的知识点的真相：名字，有简介时加简介；不给内容的为 null。 */
    truth(point: string): string | null;
    /** 藏在给了内容的知识点下的目标：名字、为什么、冲突；否则为 null。 */
    hiddenGoal(goal: string): string | null;
    /** 称谓表左栏：叙述用的称呼（输出 7 的顺序）。 */
    narrativeName(pov: string, person: string): string;
    /** 一张列表里某一行的写法（不是条目的行用作者写的 label）。 */
    rowName(entry: string, path: string, element: string): string;
}

type Stored = {readonly type?: string; readonly parent?: string | null; readonly deleted?: boolean};

const rank = (secrecy: Secrecy | null) => (secrecy === null ? -1 : SECRECY.indexOf(secrecy));
const refOf = (value: unknown) => {
    const ref = (value as {ref?: unknown} | null | undefined)?.ref;
    return typeof ref === "string" ? ref : null;
};

export interface GateInput {
    readonly frame: Frame;
    /** 要写的这一章。 */
    readonly chapter: string;
    readonly plans: readonly StoryChange[];
    readonly participants: readonly Participant[];
    /** 本章计划的揭示（明说强于暗示）。 */
    readonly reveals: ReadonlyMap<string, "hint" | "explicit">;
    /** 这一场涉及的知识点（简报一侧的集合）。 */
    readonly points: readonly string[];
}

/** 章末：要写的这一章在这个框架的线上的章末（框架的视图已经在那条线上）。 */
export const chapterEnd = (chapter: string): ReadPosition => ({kind: "chapter", chapter, edge: "end"});

function readAt(view: CanonReadView, id: string, position: ReadPosition) {
    const read = view.entry(id, position, "planned");
    return read === null || read === "chapter-not-found" ? null : read;
}

/** 目标在章首与章末的 `隐秘` 的并集（本章计划把隐秘改指另一个知识点时两个都算）。 */
export function hidesOf(frame: Frame, chapter: string, goal: string): string[] {
    const found = new Set<string>();
    for (const position of [frame.position, chapterEnd(chapter)]) {
        const ref = refOf(readAt(frame.view, goal, position)?.namespaces.goal?.fields.隐秘?.value);
        if (ref !== null) found.add(ref);
    }
    return [...found].sort();
}

/**
 * 简报一侧在本章涉及的集合上补的知识点：参与者在章首或章末进行或受挫的目标藏着的知识点，不按出场筛（到章末出场就算）。
 * 本章涉及的集合本身（knowledge 输出 10）也给写完以后的检查用，不在那里改。
 */
export function participantGoalPoints(frame: Frame, chapter: string, participants: readonly Participant[]): string[] {
    const view = frame.view;
    const holders = new Set(participants.flatMap((member) => (member.who === undefined ? [] : [bodyOf(view, member.who)])));
    const found = new Set<string>();
    for (const entry of view.entries()) {
        if (entry.deleted === true || entry.type !== ENTRY_TYPES.goal || entry.parent === null || !holders.has(entry.parent)) continue;
        if (readAt(view, entry.id, chapterEnd(chapter))?.appeared !== true) continue;
        const active = [frame.position, chapterEnd(chapter)].some((position) => {
            const status = readAt(view, entry.id, position)?.namespaces.goal?.fields.状态?.value;
            return status === "active" || status === "blocked";
        });
        if (active) for (const point of hidesOf(frame, chapter, entry.id)) found.add(point);
    }
    return [...found];
}

export function makeGate(input: GateInput): Gate {
    const {frame, chapter} = input;
    const view = frame.view;
    const end = chapterEnd(chapter);
    // 关卡只活一份简报：同一个条目在同一处的读取只做一次（一章的简报要写几百次名字）。
    const reads = new Map<string, ReturnType<typeof readAt>>();
    const read = (id: string, position: ReadPosition) => {
        const key = `${id}|${position === end ? "end" : "start"}`;
        if (!reads.has(key)) reads.set(key, readAt(view, id, position));
        return reads.get(key)!;
    };
    const stored = (id: string) => view.object({kind: "entry", id}) as Stored | undefined;
    const gone = (id: string) => {
        const found = stored(id);
        return found === undefined || found.deleted === true;
    };

    const secrecyCache = new Map<string, Secrecy | null>();
    const secrecy = (point: string): Secrecy | null => {
        if (!secrecyCache.has(point)) {
            let strictest: Secrecy | null = null;
            const found = stored(point);
            if (found !== undefined && found.deleted !== true && found.type === ENTRY_TYPES.point) {
                for (const position of [frame.position, end]) {
                    const found = read(point, position);
                    if (found === null) continue;
                    const value = found.namespaces.point?.fields.保密?.value;
                    const level = typeof value === "string" && (SECRECY as readonly string[]).includes(value) ? (value as Secrecy) : DEFAULT_SECRECY;
                    if (rank(level) > rank(strictest)) strictest = level;
                }
            }
            secrecyCache.set(point, strictest);
        }
        return secrecyCache.get(point)!;
    };
    const byRank = (a: string, b: string) => rank(secrecy(b)) - rank(secrecy(a)) || (a < b ? -1 : a > b ? 1 : 0);

    // 这一场用的马甲：只从参与者的 `as` 取（内核写入时已把 `who` 为马甲的归一成本体加 `as`）；同一段几个马甲取按计划先后最早的。
    const worn = new Map<string, string>();
    /** 这一场他戴过的全部马甲（同一段几条计划可能各戴一个）：身份给不给写手看全部。 */
    const wornAll = new Map<string, Set<string>>();
    const participantIds = new Set<string>();
    for (const member of input.participants) {
        if (member.who !== undefined) participantIds.add(member.who);
        if (member.as !== undefined) participantIds.add(member.as);
        if (member.who === undefined || member.as === undefined) continue;
        const body = bodyOf(view, member.who);
        if (!worn.has(body)) worn.set(body, member.as);
        wornAll.set(body, new Set([...(wornAll.get(body) ?? []), member.as]));
    }

    // 揭穿同一个马甲的知识点作为一组（章首或章末的 `揭穿` 指向它）。称谓表还要看以前戴过的马甲，所以按需对全部马甲扫一次。
    let built: Map<string, string[]> | null = null;
    const allGroups = (): Map<string, string[]> => {
        if (built === null) {
            const groups = new Map<string, string[]>();
            for (const entry of view.entries()) {
                if (entry.deleted === true || entry.type !== ENTRY_TYPES.point) continue;
                for (const position of [frame.position, end]) {
                    const target = refOf(read(entry.id, position)?.namespaces.point?.fields.揭穿?.value);
                    if (target === null) continue;
                    const group = groups.get(target) ?? [];
                    if (!group.includes(entry.id)) group.push(entry.id);
                    groups.set(target, group);
                }
            }
            built = groups;
        }
        return built;
    };
    const unmasks = (mask: string): readonly string[] => allGroups().get(mask) ?? [];

    const lateCache = new Map<string, boolean>();
    const late = (id: string) => {
        if (!lateCache.has(id)) lateCache.set(id, !participantIds.has(id) && read(id, end)?.appeared === false);
        return lateCache.get(id)!;
    };

    // 这一场戴着的马甲的整组揭穿并进这一场涉及的知识点：组里的保密档本来写手就该知道，漏选会把整组连同作者的揭示一起扣掉。
    const points = [...new Set([...input.points, ...[...wornAll.values()].flatMap((masks) => [...masks]).flatMap((mask) => unmasks(mask))])].sort();
    // 到章末还没出场的知识点不给内容（名字也是占位，见 kind）。
    const shown = new Set(points.filter((point) => !late(point) && (secrecy(point) === "secret" || (secrecy(point) === "topSecret" && input.reveals.has(point)))));
    // 身份按马甲判，不看这一场戴没戴它：揭穿它的那组里有保密以上的，身份就是秘密；其中有一条不给内容，身份就不给写手，整组都按
    // 不给内容写（没戴的马甲，组里的知识点多半不在这一场，自然不给）。作者最可能在马甲条目里写出他是谁，与戴不戴无关。
    const secretMask = (mask: string) => unmasks(mask).some((point) => isSecretPlus(secrecy(point)));
    const withheldMasks = new Set<string>();
    const withheldPoints = new Set<string>();
    for (const [mask, group] of allGroups()) {
        if (!group.some((point) => isSecretPlus(secrecy(point)) && !shown.has(point))) continue;
        withheldMasks.add(mask);
        for (const point of group) withheldPoints.add(point);
    }
    for (const point of withheldPoints) shown.delete(point);
    const renamed = new Set([...wornAll].filter(([, masks]) => [...masks].some(secretMask)).map(([body]) => body));
    /** 这一场他戴的马甲里有身份不给写手的：他的名字写马甲，他的目标、别人对他的那一行、挂在他身上的决策都不写（开发者 2026-11-10 定）。 */
    const identityWithheld = (body: string) => [...(wornAll.get(body) ?? [])].some((mask) => withheldMasks.has(mask));
    const holders = new Set(input.participants.flatMap((member) => (member.who === undefined ? [] : [bodyOf(view, member.who)])));

    const hidingCache = new Map<string, HidingGoal | null>();
    const hiding = (goal: string): HidingGoal | null => {
        if (!hidingCache.has(goal)) {
            const found = stored(goal);
            let result: HidingGoal | null = null;
            // 到章末还没出场的目标整个是占位（名字也不写），不算“藏着秘密的目标”，不进这一场的秘密。
            if (found !== undefined && found.type === ENTRY_TYPES.goal && typeof found.parent === "string" && !late(goal)) {
                const points = hidesOf(frame, chapter, goal).filter((point) => gone(point) || isSecretPlus(secrecy(point)) || withheldPoints.has(point)).sort(byRank);
                if (points.length > 0) result = {goal, holder: found.parent, state: points.every((point) => shown.has(point)) ? "shown" : "withheld", first: points[0]!, points};
            }
            hidingCache.set(goal, result);
        }
        return hidingCache.get(goal)!;
    };

    const kind = (id: string): NameKind => {
        const found = stored(id);
        if (found === undefined || found.deleted === true || late(id)) return "placeholder";
        if (found.type === ENTRY_TYPES.point) return withheldPoints.has(id) || (isSecretPlus(secrecy(id)) && !shown.has(id)) ? "placeholder" : "plain";
        if (found.type === ENTRY_TYPES.goal && hiding(id) !== null) return "placeholder";
        return renamed.has(id) ? "rename" : "plain";
    };

    const realName = (id: string) => read(id, frame.position)?.name ?? fixed.DELETED_ENTRY;
    const name = (id: string): string => {
        const found = stored(id);
        if (found === undefined || found.deleted === true) return fixed.DELETED_ENTRY;
        if (late(id)) return fixed.LATER_ENTRY;
        switch (kind(id)) {
            case "rename":
                return name(worn.get(id)!);
            case "plain":
                return realName(id);
            case "placeholder": {
                const hidden = found.type === ENTRY_TYPES.goal ? hiding(id) : null;
                if (hidden === null) return fixed.aPrivateMatter;
                // 只有参与者的目标列在这一场的秘密里（输出 4），别人的目标不加指向，免得指向一个不存在的项。
                return hidden.state === "shown" && holders.has(hidden.holder) ? `${fixed.hiddenGoalOf(name(hidden.holder))}，见这一场的秘密` : fixed.hiddenGoalOf(name(hidden.holder));
            }
        }
    };

    const secretClass = (id: string): SecretClass => {
        const found = stored(id);
        if (found === undefined) return "none";
        if (found.deleted === true) return found.type === ENTRY_TYPES.point || found.type === ENTRY_TYPES.goal ? "withheld" : "none";
        if (late(id)) return "withheld";
        if (found.type === ENTRY_TYPES.point) {
            if (withheldPoints.has(id)) return "withheld";
            return isSecretPlus(secrecy(id)) ? (shown.has(id) ? "shown" : "withheld") : "none";
        }
        if (found.type === ENTRY_TYPES.goal) return hiding(id)?.state ?? "none";
        // 身份不给写手的本体：挂在他身上的决策原话里多半有本名，按不给内容守。
        return identityWithheld(id) ? "withheld" : "none";
    };

    const isEntry = (id: string) => stored(id) !== undefined;
    // 本体这一场身份不给写手时，他名下别的马甲（哪怕揭穿它只是普通档）的简介也会写出本名，同样不给。
    const describable = (id: string) => kind(id) === "plain" && !withheldMasks.has(id) && !identityWithheld(bodyOf(view, id));
    const summary = (id: string) => (describable(id) ? (read(id, frame.position)?.summary ?? "") : "");
    const aliases = (id: string) => (describable(id) ? (read(id, frame.position)?.aliases ?? []) : []);

    /** 值的写法：不出现条目 id 与 JSON（输出 2、16）。 */
    const value = (input: unknown): string => {
        if (input === null || input === undefined) return fixed.NONE;
        if (typeof input === "string") return input;
        if (typeof input !== "object") return String(input);
        if (Array.isArray(input)) {
            if (input.length === 0) return fixed.NONE;
            // 以身份不给写手的本体为键的行整行不写：对他的态度、称呼说的是对本体的关系（不论这张表是谁的）。
            const items = input.filter((item) => !(item !== null && typeof item === "object" && typeof (item as {id?: unknown}).id === "string" && identityWithheld((item as {id: string}).id)));
            if (items.length === 0) return fixed.NONE;
            return items.map((item) => (typeof item === "string" ? item : item !== null && typeof item === "object" ? row(item as Record<string, unknown>) : String(item))).join("、");
        }
        const ref = refOf(input);
        if (ref !== null) return name(ref);
        if ("图片" in input) return String((input as {说明?: unknown}).说明 ?? "");
        if (typeof (input as {id?: unknown}).id === "string") return identityWithheld((input as {id: string}).id) ? fixed.OPAQUE_VALUE : row(input as Record<string, unknown>);
        return fixed.OPAQUE_VALUE;
    };
    /** 一行：行的 id 是条目时写 name，不用读取时内核补的 label（那是本名）；作者写的行用 label。再加各列。 */
    const row = (record: Record<string, unknown>): string => {
        const id = typeof record.id === "string" ? record.id : null;
        const head = id !== null && isEntry(id) ? name(id) : typeof record.label === "string" ? record.label : fixed.AN_ITEM;
        const cells = Object.entries(record).flatMap(([key, cell]) => (key === "id" || key === "label" || cell === null || cell === undefined ? [] : [`${key}：${value(cell)}`]));
        return `${head}${cells.length === 0 ? "" : `（${cells.join("；")}）`}`;
    };

    const blocks = (entry: string) => {
        const rendered = view.renderPlain(entry, frame.position, "planned", {entryName: name});
        if (rendered === null || typeof rendered === "string") return [];
        return rendered.blocks.map((block) => {
            let withheld: Withheld | null = null;
            if (block.problems.length > 0) withheld = "problem";
            else if ([...block.mentions, ...block.reads].some((id) => kind(id) === "placeholder")) withheld = "placeholder";
            // 读改名的本体的任何数据都扣：`entry.name` 不经名字回调，按条目选出的态度行说的是对本体的关系。
            // 读身份不给写手的马甲条目的数据（它的简介、别名）同样扣：那里最可能写着他是谁。
            else if (block.reads.some((id) => kind(id) === "rename" || withheldMasks.has(id))) withheld = "rename";
            return {text: block.text, withheld};
        });
    };

    const subject = (point: string) => {
        const seen = new Set<string>([point]);
        let current = stored(point)?.parent ?? null;
        while (typeof current === "string" && !seen.has(current)) {
            if (kind(current) !== "placeholder") return name(current);
            seen.add(current);
            current = stored(current)?.parent ?? null;
        }
        return fixed.NO_SUBJECT;
    };

    const truth = (point: string) => {
        if (!shown.has(point)) return null;
        const summary = read(point, frame.position)?.summary ?? "";
        return summary === "" ? realName(point) : `${realName(point)}（${summary}）`;
    };

    const hiddenGoal = (goal: string) => {
        const hidden = hiding(goal);
        if (hidden === null || hidden.state !== "shown") return null;
        const fields = read(goal, frame.position)?.namespaces.goal?.fields ?? {};
        const why = typeof fields.为什么?.value === "string" ? `；为什么：${fields.为什么.value}` : "";
        // 这一项在这一场的秘密里：冲突对象也是给了内容的隐秘目标时写它的名字（它在这一段也给了内容）；别的照关卡写。
        const conflicts = (conflictsOf(view, goal, frame.position, "planned") ?? []).map((conflict) => (hiding(conflict.id)?.state === "shown" ? realName(conflict.id) : name(conflict.id)));
        return `${name(hidden.holder)}的隐秘目标：${realName(goal)}${why}${conflicts.length === 0 ? "" : `；冲突：${conflicts.join("、")}`}`;
    };

    const index = knowingIndex(view, "planned", frame.position);
    const recognizes = (x: string, p: string) => {
        const masks = wornAll.get(p);
        if (masks === undefined) return true;
        if (identityWithheld(p)) return false;
        return [...masks].some((mask) => unmasks(mask).some((point) => index.effective(x, point)?.程度 === "knows"));
    };

    // 称谓表要的“之前一起在场过”：视角人物在本章之前的已写变更，按先后。只在生成称谓表时算一次。
    let earlier: readonly StoryChange[] | null = null;
    const earlierChanges = () => {
        if (earlier === null) {
            const startKey = view.positionKey(frame.position);
            earlier = view.changes({kind: "written"}).filter((change) => {
                const key = view.eventKey(change.id, "planned");
                return change.status === "active" && key !== null && startKey !== null && view.compareKeys(key, startKey) < 0;
            }).sort((a, b) => view.compareKeys(view.eventKey(a.id, "planned")!, view.eventKey(b.id, "planned")!));
        }
        return earlier;
    };
    const narrativeName = (pov: string, person: string) => {
        const povBody = bodyOf(view, pov);
        const rows = (read(povBody, frame.position)?.namespaces.att?.fields.态度?.value as Array<Record<string, unknown>> | undefined) ?? [];
        const callOf = (target: string) => rows.find((row) => row.id === target && typeof row.称呼 === "string" && row.称呼 !== "")?.称呼 as string | undefined;
        const mask = worn.get(person);
        if (mask !== undefined && !recognizes(povBody, person)) return callOf(mask) ?? realName(mask);
        const call = callOf(person);
        if (call !== undefined) return call;
        const together = earlierChanges().filter((change) => (change.cast ?? []).some((c) => c.role === "present" && c.who !== undefined && bodyOf(view, c.who) === povBody) && (change.cast ?? []).some((c) => c.role === "present" && c.who !== undefined && bodyOf(view, c.who) === person));
        if (together.some((change) => (change.cast ?? []).some((c) => c.role === "present" && c.who === person && c.as === undefined))) return realName(person);
        const masked = together.map((change) => (change.cast ?? []).find((c) => c.role === "present" && c.who === person && c.as !== undefined)?.as).filter((as): as is string => as !== undefined).at(-1);
        // 以前只见过他戴马甲：揭穿那个马甲的知识点里有保密以上的，叫出马甲名会和右栏的本名对上（写出那条揭穿），用泛称。
        return masked !== undefined && !secretMask(masked) ? realName(masked) : fixed.A_STRANGER;
    };

    const rowName = (entry: string, path: string, element: string) => {
        if (isEntry(element)) return name(element);
        const parsed = /^([^.[\]]+)\.([^.[\]]+)/u.exec(path);
        if (parsed === null) return fixed.AN_ITEM;
        for (const position of [frame.position, end]) {
            const list = read(entry, position)?.namespaces[parsed[1]!]?.fields[parsed[2]!]?.value;
            const found = Array.isArray(list) ? (list as Array<{id?: unknown; label?: unknown}>).find((item) => item.id === element) : undefined;
            if (typeof found?.label === "string") return found.label;
        }
        return fixed.AN_ITEM;
    };

    // 对马甲条目本身的那一行照写（X 见到的就是这个马甲）；对本体的那一行要 X 认得他（身份不给写手时谁都不算认得）。
    const relationVisible = (x: string, y: string) => bodyOf(view, y) !== y || recognizes(bodyOf(view, x), y);

    const ownedByWithheld = (id: string) => {
        if (identityWithheld(id)) return true;
        const found = stored(id);
        return found?.type === ENTRY_TYPES.goal && typeof found.parent === "string" && identityWithheld(found.parent);
    };

    return {frame, shown, points, secrecy, isEntry, kind, name, describable, summary, aliases, identityWithheld, ownedByWithheld, relationVisible, secretClass, hiding, maskOf: (body) => worn.get(body), recognizes, value, blocks, subject, truth, hiddenGoal, narrativeName, rowName};
}
