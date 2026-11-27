/**
 * 简报保密的随机网（`core/brief/secrecy.test.ts`）用的小书：按种子随机造人、马甲与揭穿、各档知识点、隐秘目标、带正文的物件与伏笔、
 * 决策、删除与之后才出场的人，第 6 章一条（或分两段讲两条线的两条）计划。生成器**自己记下真值**（谁是什么档、每段揭示什么、谁用
 * 马甲），判据只用这份真值，不调简报的代码（否则是同义反复）。会被遮的东西都用独特的名字（“点3号”），作者写的文字（细纲、计划
 * 原话、场景条件、态度与表现）里不出现这些名字。只由测试用，不含断言。
 */

import type {ComponentDeclaration, Entry, Mark, Patch} from "@notnotype/nb-canon";

import {COMPONENT_IDS, MARK_IDS} from "../shared/declarations";
import type {InstructionSnapshot} from "../shared/instructions";
import {seeded} from "./random-edits";
import {addRow, chapter, drafts, PlotWorld} from "./world";

/** 测试用的 Component：一个引用字段、一张作者写的带 id 列表、一个图片字段、一张以引用为键的列表。 */
export const EXTRA: ComponentDeclaration = {
    id: "test.extra",
    label: "杂项",
    namespace: "ext",
    version: 1,
    fields: [
        {id: "指向", label: "指向", kind: "ref"},
        {id: "清单", label: "清单", kind: "list", item: [{id: "数量", label: "数量", kind: "number"}]},
        {id: "图", label: "图", kind: "image"},
        {id: "关系", label: "关系", kind: "list", keyedBy: "ref", item: [{id: "说法", label: "说法", kind: "text"}]},
    ],
};

export const CHAPTERS = Array.from({length: 10}, (_, index) => `ch${String(index + 1)}`);
/** 要拼简报的那一章。 */
export const TARGET = "ch6";

type Level = "common" | "secret" | "topSecret";

/** 一份（一段）的真值。 */
export interface PartTruth {
    /** 名字 → 它出现在这一份时，这一份的这一场的秘密里必须有“真相：<名字>”的那些知识点（全部）。没有条件的不在这里。 */
    readonly requires: ReadonlyMap<string, readonly string[]>;
    /** 这一份里根本不能出现的名字（不给内容又没有出口的）。 */
    readonly hidden: ReadonlySet<string>;
    /** 马甲名 → 本名与“把两者写在一起”要求的真相（null 表示这一份里永远不能写在一起）：称谓表一行“马甲 = 本名”就是那条揭穿。 */
    readonly pairs: ReadonlyMap<string, {readonly body: string; readonly needed: readonly string[] | null}>;
}

export interface SecrecyBook {
    readonly w: PlotWorld;
    readonly instruction: InstructionSnapshot;
    readonly parts: readonly PartTruth[];
    /** 整份上下文里都不能出现的名字：已删除的条目、之后才出场的人。 */
    readonly never: readonly string[];
    /** 世界里的全部 id（条目、变更、决策、线、章）：上下文里一个都不能出现。 */
    readonly ids: readonly string[];
}

interface Plan {
    readonly cast: {who: string; as?: string; role: "present"}[];
    readonly reveals: Map<string, "hint" | "explicit">;
    readonly raised: Set<string>;
    readonly hidesSet: Map<string, string>;
}

export function secrecyBook(seed: number): SecrecyBook {
    const random = seeded(seed);
    const pick = <T>(items: readonly T[]): T => items[random(items.length)]!;
    const chance = (percent: number) => random(100) < percent;
    const w = new PlotWorld(CHAPTERS, [EXTRA]);
    const put = (draft: Entry) => w.publish([{ref: {kind: "entry", id: draft.id}, after: draft}])[draft.id]!;
    const names = new Map<string, string>();
    const level = new Map<string, Level>();
    let counter = 0;
    const next = () => ++counter;

    // 人：带知情与态度两个命名空间。
    const persons: string[] = [];
    for (let index = 0; index < 4 + random(2); index++) {
        const name = `人${String(next())}号`;
        const draft = drafts.person(`tmp:p${name}`, name);
        const id = put({...draft, init: {...draft.init, data: {...draft.init.data, att: {type: COMPONENT_IDS.attitude, version: 1, enabled: true, fields: {态度: []}}}}});
        persons.push(id);
        names.set(id, name);
    }
    // 之后才出场的人：不进任何一份的参与者。
    const lateName = `后来者${String(next())}号`;
    const late = put(drafts.person(`tmp:late`, lateName, {appears: chapter("ch9")}));
    names.set(late, lateName);

    // 马甲与揭穿：揭穿的档位随机，可以两条；一半的揭穿名字里含本名。
    const masks = new Map<string, string>();
    /** 不戴的第二个马甲 → 本体。 */
    const spare = new Map<string, string>();
    const unmasks = new Map<string, string[]>();
    for (const body of persons.slice(0, 1 + random(2))) {
        const name = `马甲${String(next())}号`;
        const maskDraft = drafts.person(`tmp:m${name}`, name, {sameAs: body});
        // 一半的马甲在简介里写着他是谁：身份不给写手时这一句不能出去。
        const mask = put(chance(50) ? {...maskDraft, init: {...maskDraft.init, summary: `${name}其实是${names.get(body)!}`}} : maskDraft);
        names.set(mask, name);
        masks.set(body, mask);
        const group: string[] = [];
        for (let index = 0; index < random(3); index++) {
            const pointName = chance(50) ? `${name}就是${names.get(body)!}${String(next())}` : `揭穿${String(next())}号`;
            const lv = pick<Level>(["common", "secret", "topSecret"]);
            const id = put(drafts.point(`tmp:u${pointName}`, pointName, body, {保密: lv, 揭穿: {ref: mask}, 表现: "神色如常"}));
            names.set(id, pointName);
            level.set(id, lv);
            group.push(id);
        }
        unmasks.set(mask, group);
        // 三成的人另有一个这一场多半不戴的马甲，简介同样写着他是谁，揭穿它的知识点档位随机。
        if (chance(30)) {
            const otherName = `马甲${String(next())}号`;
            const otherDraft = drafts.person(`tmp:m${otherName}`, otherName, {sameAs: body});
            const other = put({...otherDraft, init: {...otherDraft.init, summary: `${otherName}其实是${names.get(body)!}`}});
            names.set(other, otherName);
            spare.set(other, body);
            const lv = pick<Level>(["common", "secret", "topSecret"]);
            const pointName = `揭穿${String(next())}号`;
            const id = put(drafts.point(`tmp:u${pointName}`, pointName, body, {保密: lv, 揭穿: {ref: other}}));
            names.set(id, pointName);
            level.set(id, lv);
            unmasks.set(other, [id]);
        }
    }

    // 知识点：档位随机，主体挂在人、别的知识点或没有。
    const points: string[] = [];
    for (let index = 0; index < 4 + random(4); index++) {
        const name = `点${String(next())}号`;
        const lv = pick<Level>(["common", "secret", "topSecret"]);
        const subject = chance(20) || points.length === 0 ? pick(persons) : chance(50) ? pick(points) : pick(persons);
        const id = put(drafts.point(`tmp:k${name}`, name, subject, {保密: lv, 表现: chance(70) ? "神色如常" : null}));
        names.set(id, name);
        level.set(id, lv);
        points.push(id);
    }
    // 目标：隐秘随机，出场在本章之前、本章、之后。
    const goals: string[] = [];
    const lateGoals: string[] = [];
    const hides = new Map<string, string>();
    for (let index = 0; index < 2 + random(3); index++) {
        const name = `目标${String(next())}号`;
        const hidden = chance(60) ? pick(points) : null;
        const appears = pick([null, "ch6", "ch8"]);
        const id = put(drafts.goal(`tmp:g${name}`, name, pick(persons), hidden === null ? {} : {隐秘: {ref: hidden}}, appears === null ? {} : {appears: chapter(appears, 1)}));
        names.set(id, name);
        goals.push(id);
        if (appears === "ch8") lateGoals.push(name);
        if (hidden !== null) hides.set(id, hidden);
    }

    // 带正文的物件：正文随机引人、知识点、目标、之后才出场的人，用各种写法。
    const targets = () => pick([...persons, ...points, ...goals, late, ...[...masks.values()]]);
    const things: string[] = [];
    const blockOf = (self: string | null): string => {
        const target = targets();
        switch (random(9)) {
            case 0: return `<Ref id="${target}" />出现过。`;
            case 1: return `它和<V entry="${target}" of="entry.name" />有关。`;
            case 2: return "指向<V of=\"ext.指向\" />。";
            case 3: return "清单：<V of=\"ext.清单\" />。";
            case 4: return "图：<V of=\"ext.图\" />。";
            case 5: return '<Image src="a.png" alt="一张旧图" />。';
            case 6: return `态度：<V entry="${pick(persons)}" of="att.态度[${pick(persons)}].态度" />。`;
            case 7: return self === null ? "表盖有划痕。" : `<V entry="${self}" of="text[b1]" />`;
            default: return "表盖有划痕。";
        }
    };
    for (let index = 0; index < 2; index++) {
        const name = `物${String(next())}号`;
        const draft = drafts.thing(`tmp:t${name}`, name);
        const ext = {type: EXTRA.id, version: 1, enabled: true, fields: {指向: {ref: targets()}, 清单: [{id: "x1", label: "短剑", 数量: 1}], 图: {图片: "assets/a.png", 说明: "一张图"}, 关系: [{id: pick(persons), 说法: "见过"}]}};
        const blocks = Array.from({length: 3}, () => blockOf(things[0] ?? null));
        const id = put({...draft, init: {...draft.init, text: blocks.map((source, i) => ({id: `b${String(i + 1)}`, source})), data: {...draft.init.data, ext}}});
        names.set(id, name);
        things.push(id);
    }
    // 伏笔：答案随机，主文字随机引东西。
    const fsDraft = drafts.foreshadow("tmp:fs", "脚印的伏笔", {答案: {ref: pick(points)}});
    const fs = put({...fsDraft, init: {...fsDraft.init, text: [{id: "b1", source: `回收时写明${blockOf(null)}`}]}});

    // 知情与态度：第 2 章的已写变更。
    const patches: Patch[] = [];
    // 已有的知情行：同一个人对同一个知识点再加一行会让整条变更套不上，计划里不再加。
    const knowing = new Set<string>();
    for (const person of persons) {
        for (const point of [...points, ...[...unmasks.values()].flat()]) {
            if (!chance(25)) continue;
            patches.push(addRow(person, point, {程度: "knows"}));
            knowing.add(`${person}|${point}`);
        }
        // 称呼里带着被称呼的人的本名：这一行要是不该写却写了，本名就会被判据抓到。
        for (const other of persons) if (other !== person && chance(30)) patches.push({op: "listAdd", at: {entry: person, path: "att.态度"}, value: {id: other, 态度: "崇敬", 称呼: `${names.get(other)!}大人`}});
    }
    // 第 2 章还让一个用马甲的人戴着马甲与别人同场：之后的称谓表会遇到“以前只见过他戴马甲”。
    const wornBefore = [...masks].map(([body, mask]) => ({who: body, as: mask, role: "present" as const}));
    w.change(chapter("ch2"), {patches, cast: [...wornBefore.slice(0, 1), ...persons.filter((id) => !masks.has(id)).slice(0, 2).map((who) => ({who, role: "present" as const}))]});

    // 决策：已定的挂在随机条目上，到期待定的挂在知识点的地址上；原话里放记号。
    const decisions: {token: string; about: string[]}[] = [];
    for (let index = 0; index < 1 + random(2); index++) {
        const token = `决${String(next())}号`;
        const about = [pick([...points, ...goals, ...persons])];
        w.decision(`${token}的事`, {about: about.map((id) => ({kind: "entry", id})), conclusion: `${token}定了`, reason: "留悬念"});
        decisions.push({token, about});
    }
    const dueToken = `决${String(next())}号`;
    const duePoint = pick(points);
    w.decision(`${dueToken}的事`, {about: [{kind: "address", at: {entry: duePoint, path: "point.表现"}}], due: TARGET});
    decisions.push({token: dueToken, about: [duePoint]});

    // 删除：一个知识点（可能被目标藏着）与一个目标。
    const deletedNames: string[] = [];
    for (const id of [pick(points), pick(goals)]) {
        const stored = w.world.data.entries.get(id)!;
        if (stored.deleted === true) continue;
        w.publish([{ref: {kind: "entry", id}, after: {...structuredClone(stored), deleted: true}}]);
        deletedNames.push(names.get(id)!);
    }
    const deleted = new Set([...w.world.data.entries.values()].filter((entry) => entry.deleted === true).map((entry) => entry.id));

    // 第 6 章的计划：一段或两段（回溯）。
    const twoParts = chance(40);
    const lines: string[] = ["main"];
    if (twoParts) {
        const cut = w.change(chapter("ch5", 10));
        const trigger = w.change(chapter("ch5", 50));
        const ids = w.publish([{ref: {kind: "change", id: "tmp:fork"}, after: {...drafts.change("tmp:fork", chapter("ch5", 90)), nature: "fork", fork: {line: "tmp:r1", name: "回溯", parent: "main", cut, trigger, type: "rollback", who: persons[0]!, carry: []}}}]);
        lines.push(ids["tmp:r1"]!);
    }
    const plans: Plan[] = [];
    for (const [index, line] of lines.entries()) {
        const cast = persons.filter(() => chance(55)).slice(0, 3).map((who) => ({who, role: "present" as const, ...(masks.has(who) && chance(70) ? {as: masks.get(who)!} : {})}));
        if (cast.length === 0) cast.push({who: persons[0]!, role: "present"});
        const reveals = new Map<string, "hint" | "explicit">();
        for (const point of [...points, ...[...unmasks.values()].flat()]) if (!deleted.has(point) && chance(15)) reveals.set(point, pick(["hint", "explicit"] as const));
        const raised = new Set<string>();
        const hidesSet = new Map<string, string>();
        const planPatches: Patch[] = [];
        for (const member of cast) for (const point of points) if (!deleted.has(point) && !knowing.has(`${member.who}|${point}`) && chance(10)) planPatches.push(addRow(member.who, point, {程度: "knows"}));
        // 升档与设隐秘只放在一段的书里：两段时各段的线不同，真值要按线折叠，这里不造。
        if (!twoParts) {
            for (const point of points) if (!deleted.has(point) && chance(15)) {
                raised.add(point);
                planPatches.push({op: "set", at: {entry: point, path: "point.保密"}, value: "topSecret"});
            }
            const goal = pick(goals);
            if (!deleted.has(goal) && chance(40)) {
                const point = pick(points.filter((id) => !deleted.has(id)).concat(points[0]!));
                if (!deleted.has(point)) {
                    hidesSet.set(goal, point);
                    planPatches.push({op: "set", at: {entry: goal, path: "goal.隐秘"}, value: {ref: point}});
                }
            }
        }
        for (const thing of things) planPatches.push({op: "set", at: {entry: thing, path: "character.状态"}, value: "被拿起"});
        // 改条目自己的地址：名字、一句话描述（新值里带着本名，写出来就会被判据抓到）与主文字的一块。
        const renamed = pick(cast).who;
        if (chance(40)) planPatches.push({op: "set", at: {entry: renamed, path: "entry.summary"}, value: `${names.get(renamed)!}的底细`});
        if (chance(30)) planPatches.push({op: "set", at: {entry: renamed, path: "entry.name"}, value: `${names.get(renamed)!}改`});
        if (chance(40)) planPatches.push({op: "set", at: {entry: things[0]!, path: "text[b1]"}, value: `改过的一块：<Ref id="${targets()}" />。`});
        // 整张换掉一个人的态度表（行里也有用马甲的人）；改一个不戴的马甲的简介。
        if (chance(30)) {
            const owner = pick(cast).who;
            const other = pick(persons.filter((id) => id !== owner));
            planPatches.push({op: "set", at: {entry: owner, path: "att.态度"}, value: [{id: other, 态度: "敬畏", 称呼: `${names.get(other)!}主公`}]});
        }
        const spareMask = [...spare.keys()][0];
        if (spareMask !== undefined && chance(40)) planPatches.push({op: "set", at: {entry: spareMask, path: "entry.summary"}, value: `${names.get(spareMask)!}其实是${names.get(spare.get(spareMask)!)!}，已经洗手`});
        const marks: Mark[] = [...reveals].map(([point, mode]) => ({kind: MARK_IDS.reveal, version: 1, point, mode}));
        if (chance(60)) marks.push({kind: MARK_IDS.node, version: 1, foreshadow: fs, role: "payoff"});
        w.change({...chapter(TARGET, 5 + index), ...(line === "main" ? {} : {line})}, {kind: "plan", text: `第六章第 ${String(index + 1)} 段的计划`, cast, patches: planPatches, told: [{source: "outline", chapter: TARGET, anchor: "细纲", marks}]});
        // 真值假定计划套上了：用内核核对一遍（内核不是被测对象），套不上是生成器的错，不能让真值与世界对不上。
        const view = w.view();
        const end = {kind: "chapter", chapter: TARGET, edge: "end"} as const;
        const field = (id: string, namespace: string, name: string) => (view.entry(id, end, "planned") as {namespaces?: Record<string, {fields: Record<string, {value: unknown}>}>} | null)?.namespaces?.[namespace]?.fields[name]?.value;
        // 主线上的计划：每条都改了物件的状态，读到它就说明整条套上了；分支线上的计划不升档、不设隐秘，不用核对。
        if (line === "main" && things.some((thing) => field(thing, "character", "状态") !== "被拿起")) throw new Error(`seed ${String(seed)}: plan did not apply`);
        for (const point of raised) if (field(point, "point", "保密") !== "topSecret") throw new Error(`seed ${String(seed)}: plan did not raise ${point}`);
        plans.push({cast, reveals, raised, hidesSet});
    }
    if (twoParts) w.world = w.world.withOptions({...w.world.options, chapterLines: new Map([[TARGET, [{line: "main", from: 1}, {line: lines[1]!, from: 30}]]])});

    const pov = plans[0]!.cast[0]!.who;
    const timeMode = pick<InstructionSnapshot["timeMode"]>(["follow", {parallel: "ch3"}, ...(twoParts ? [] : [{flashback: {kind: "chapter" as const, chapter: "ch3", key: 0}}])]);
    const instruction: InstructionSnapshot = {chapter: TARGET, version: "v1", pov: {kind: "entry", id: pov}, povMode: "limited", ...(timeMode === undefined ? {} : {timeMode})};

    // 真值：每一份按 Spec 直接写（不调简报的代码）。
    const parts: PartTruth[] = plans.map((plan) => {
        const requires = new Map<string, string[]>();
        const hidden = new Set<string>();
        const lv = (point: string): Level => (plan.raised.has(point) ? "topSecret" : level.get(point)!);
        const secretPlus = (point: string) => lv(point) !== "common";
        /** 知识点给内容的前提：这一份的秘密里有它的真相。绝密而这一份不揭示的，永远不给。 */
        const need = (point: string): string[] | null => {
            if (deleted.has(point)) return null;
            if (lv(point) === "topSecret" && !plan.reveals.has(point)) return null;
            return [names.get(point)!];
        };
        const restrict = (name: string, needed: (string[] | null)[]) => {
            if (needed.some((item) => item === null)) hidden.add(name);
            else requires.set(name, [...new Set([...(requires.get(name) ?? []), ...(needed as string[][]).flat()])]);
        };
        const worn = new Map(plan.cast.filter((member) => member.as !== undefined).map((member) => [member.who, member.as!]));
        const wornGroups = new Map([...worn.values()].map((mask) => [mask, unmasks.get(mask) ?? []]));
        for (const point of [...points, ...[...unmasks.values()].flat()]) {
            if (deleted.has(point)) continue;
            const group = [...wornGroups.values()].find((members) => members.includes(point));
            // 身份是秘密的那一组揭穿：组里的每一条都要整组保密以上的都给了内容才写得出名字。
            const secretMembers = group?.filter(secretPlus) ?? [];
            if (secretMembers.length > 0) restrict(names.get(point)!, [...secretMembers.map(need), ...(secretPlus(point) ? [need(point)] : [])]);
            else if (secretPlus(point)) restrict(names.get(point)!, [need(point)]);
        }
        for (const goal of goals) {
            if (deleted.has(goal)) continue;
            for (const point of new Set([hides.get(goal), plan.hidesSet.get(goal)].filter((id): id is string => id !== undefined))) {
                if (deleted.has(point)) hidden.add(names.get(goal)!);
                else if (secretPlus(point)) restrict(names.get(goal)!, [need(point)]);
            }
        }
        for (const [body, mask] of worn) {
            const secretMembers = (unmasks.get(mask) ?? []).filter(secretPlus);
            if (secretMembers.length > 0) restrict(names.get(body)!, secretMembers.map(need));
        }
        for (const decision of decisions) {
            const needed: (string[] | null)[] = [];
            for (const id of decision.about) {
                if (deleted.has(id)) needed.push(null);
                else if (level.has(id) && secretPlus(id)) needed.push(need(id));
                else if (goals.includes(id)) for (const point of [hides.get(id), plan.hidesSet.get(id)]) if (point !== undefined) needed.push(deleted.has(point) ? null : secretPlus(point) ? need(point) : []);
            }
            if (needed.length > 0) restrict(decision.token, needed);
        }
        // 马甲的简介写着“某某其实是本名”：按马甲判，不看这一场戴没戴它，组里保密以上的都给了内容才写得出来。
        for (const mask of [...masks.values(), ...spare.keys()]) {
            const secretMembers = (unmasks.get(mask) ?? []).filter(secretPlus);
            if (secretMembers.length > 0) restrict(`${names.get(mask)!}其实是`, secretMembers.map(need));
        }
        const pairs = new Map<string, {body: string; needed: string[] | null}>();
        for (const [body, mask] of [...masks, ...[...spare].map(([mask, owner]) => [owner, mask] as const)]) {
            const needed = (unmasks.get(mask) ?? []).filter(secretPlus).map(need);
            pairs.set(names.get(mask)!, {body: names.get(body)!, needed: needed.some((item) => item === null) ? null : (needed as string[][]).flat()});
        }
        return {requires, hidden, pairs};
    });

    const ids = [...w.world.data.entries.keys(), ...w.world.data.changes.keys(), ...w.world.data.decisions.keys(), ...lines.filter((line) => line !== "main"), ...CHAPTERS];
    return {w, instruction, parts, never: [...deletedNames, lateName, ...lateGoals], ids};
}
