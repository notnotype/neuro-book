/**
 * 随机改一部书：依赖摘要的随机序列（`dependencies.test.ts`、`source.test.ts`）共用。每一种操作都是作者能做的真实写入，经发布校验；世界含计划、悬念、物件、隐秘目标、马甲、子线、补叙与
 * 真的套不上的补丁。摘要要守的是“摘要没变时结论一定没变”，操作走不到的读取就守不到，所以新加一种读取，这里要加一种操作。只由测试用。
 */

import type {Mark, TellingDraft} from "@notnotype/nb-canon/schema";

import {MARK_IDS} from "../shared/declarations";
import type {InstructionSnapshot} from "../shared/instructions";
import {addRow, chapter, drafts, learns, PlotWorld, present, setSub} from "./world";

const reveal = (point: string, mode: "hint" | "explicit"): Mark => ({kind: MARK_IDS.reveal, version: 1, point, mode});
const node = (foreshadow: string, role: string): Mark => ({kind: MARK_IDS.node, version: 1, foreshadow, role});

/** 固定种子的随机数：失败时能复现。取高位：线性同余的低位周期很短，取余只会在几种操作之间打转。 */
export function seeded(start: number): (limit: number) => number {
    let seed = start;
    return (limit) => {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        return Math.floor((seed / 2147483648) * limit);
    };
}

export interface RandomBook {
    readonly w: PlotWorld;
    readonly chapters: readonly string[];
    /** 带写作指示的章。 */
    readonly instructions: ReadonlyMap<string, InstructionSnapshot>;
    /** 做一步。返回操作的名字；发布校验拒绝了时 `applied` 为 false。 */
    step(index: number): {readonly op: string; readonly applied: boolean};
    /** 全部操作的名字：调用方核对每一种都真的走到了。 */
    readonly ops: readonly string[];
}

export function randomBook(random: (limit: number) => number): RandomBook {
    const chapters = Array.from({length: 14}, (_, index) => `ch${String(index + 1)}`);
    const w = new PlotWorld(chapters);
    const addText = (id: string, text: string) => w.texts.set(id, `${w.texts.get(id) ?? ""}${text}。\n`);
    const inText = (id: string, quote: string, marks: Mark[] = []): TellingDraft => {
        addText(id, quote);
        return {source: "chapter", chapter: id, quote, ...(marks.length === 0 ? {} : {marks})};
    };
    const hero = w.person("勇者");
    const guard = w.person("卫兵");
    const stranger = w.person("黑衣人");
    const alias = w.person("灰袍客", {sameAs: hero});
    const people = [hero, guard, stranger, w.person("老周"), w.person("小梅")];
    const thing = w.thing("铜钥匙");
    const spare = w.thing("旧地图");
    const scar = w.point("勇者左手有星形的疤", hero, {保密: "secret", 读者问题: "勇者有什么特征"});
    const debt = w.point("卫兵欠了赌债", guard, {保密: "secret", 读者问题: "卫兵为什么缺钱"});
    const points = [scar, debt, w.point("老周的来历", people[3]!, {保密: "topSecret"})];
    const mystery = w.foreshadow("星形的疤", {种类: "mystery", 答案: {ref: scar}, 物件: [{id: thing}]});
    const goal = w.goal("瞒住身份", hero, {状态: "active", 隐秘: null});
    // 真的套不上：路人有一行，`touch` 改这一行；`breaker` 在它之前把这一行去掉。整条变更一起不套。
    const bystander = w.person("路人");
    const trifle = w.point("无关的事", null, {保密: "common"});
    w.change(chapter("ch1"), {patches: [addRow(bystander, trifle, {程度: "knows"})]});
    const touch = setSub(bystander, trifle, "程度", "suspects");
    const place = () => chapters[random(chapters.length)]!;
    // 带 `touch` 的已写变更写入时要套得上：放在把这一行去掉的变更之前。之后再写 `breaker` 或撤销它，才翻转这些变更。
    const breakers: string[] = [];
    const beforeBreak = () => {
        const active = breakers.filter((id) => w.world.data.changes.get(id)!.status === "active").map((id) => chapters.indexOf((w.world.data.changes.get(id)!.at as {chapter: string}).chapter));
        const limit = active.length === 0 ? chapters.length : Math.min(...active);
        return chapter(chapters[1 + random(Math.max(limit - 1, 1))]!, 100 + random(50));
    };
    const person = () => people[random(people.length)]!;
    const point = () => points[random(points.length)]!;

    // 子线：第 6 章讲它，第 10 章分两段。
    for (const id of chapters) addText(id, `第 ${id} 章开头，勇者走进客栈`);
    addText("ch10", "回溯以后的第二段，卫兵还在门口");
    const cut = w.change(chapter("ch1"), {told: [{source: "chapter", chapter: "ch1", quote: "勇者走进客栈"}]});
    const forked = w.publish([{ref: {kind: "change", id: "tmp:fork"}, after: {...drafts.change("tmp:fork", chapter("ch5")), nature: "fork", fork: {line: "tmp:r", name: "支线", parent: "main", cut, type: "branch"}}}]);
    const line = forked["tmp:r"]!;
    const forkId = forked["tmp:fork"]!;
    // 第二条线是回溯：有触发处，带过去的知情走另一条路。第 7 章讲它。
    const rollbackCut = w.change(chapter("ch1", 2), {told: [{source: "chapter", chapter: "ch1", quote: "勇者走进客栈"}]});
    const rollbackTrigger = w.change(chapter("ch3", 2), {told: [{source: "chapter", chapter: "ch3", quote: "勇者走进客栈"}]});
    const rollback = w.publish([{ref: {kind: "change", id: "tmp:rollback"}, after: {...drafts.change("tmp:rollback", chapter("ch4")), nature: "fork", fork: {line: "tmp:r2", name: "回溯", parent: "main", cut: rollbackCut, trigger: rollbackTrigger, type: "rollback", who: hero}}}])["tmp:r2"]!;
    w.world = w.world.withOptions({...w.world.options, chapterLines: new Map([["ch6", [{line, from: 1}]], ["ch10", [{line: "main", from: 1}, {line, from: 2}]], ["ch7", [{line: rollback, from: 1}]]])});

    const written: string[] = [cut];
    const plans: string[] = [];
    const fulfillers: {plan: string; by: string}[] = [];
    const change = (at: Parameters<PlotWorld["change"]>[0], options: Parameters<PlotWorld["change"]>[1] = {}) => {
        const id = w.change(at, options);
        (options.kind === "plan" ? plans : written).push(id);
        return id;
    };
    const stored = (id: string) => w.world.data.changes.get(id)!;
    const entryOf = (id: string) => w.world.data.entries.get(id)!;
    const pickFrom = (list: readonly string[]) => list[random(list.length)];
    const editEntry = (id: string, edit: (entry: ReturnType<typeof entryOf>) => ReturnType<typeof entryOf>) => w.publish([{ref: {kind: "entry", id}, after: edit(entryOf(id))}]);
    const editInit = (id: string, fields: Partial<ReturnType<typeof entryOf>["init"]>) => editEntry(id, (entry) => ({...entry, init: {...entry.init, ...fields}}));

    const operations: Record<string, (index: number) => void> = {
        cast: () => change(chapter(place()), {cast: [present(person())]}),
        nodeOnLine: (index) => { const ch = ["ch6","ch10","ch3","ch12"][random(4)]!; change({kind: "chapter", chapter: ch, key: 200 + random(50), line}, {told: [inText(ch, `线上第 ${String(index)} 处线索`, [node(mystery, ["plant", "echo", "payoff"][random(3)]!)])]}); },
        nodeOnRollback: (index) => { const ch = ["ch7","ch9","ch5"][random(3)]!; change({kind: "chapter", chapter: ch, key: 200 + random(50), line: rollback}, {told: [inText(ch, `回溯上第 ${String(index)} 处线索`, [node(mystery, ["plant", "echo", "payoff"][random(3)]!)])]}); },
        fulfillOnLine: (index) => { const ch = ["ch6","ch10"][random(2)]!; const plan = w.change({kind: "chapter", chapter: ch, key: 300 + random(50), line}, {kind: "plan", told: [{source: "outline", chapter: ch, anchor: "细纲", marks: [node(mystery, ["plant", "echo"][random(2)]!)]}]}); const later = ["ch6","ch10","ch13"][random(3)]!; change({kind: "chapter", chapter: ch, key: 400 + random(50), line}, {links: [{kind: "fulfills", plan}], told: [inText(later, `兑现线上第 ${String(index)} 处`)]}); },
        rebindMore: () => {
            const opts: [string, {line: string; from: number}[]][][] = [
              [["ch6", [{line, from: 1}]], ["ch10", [{line: "main", from: 1}, {line, from: 2}]], ["ch7", [{line: rollback, from: 1}]]],
              [["ch3", [{line, from: 1}]], ["ch6", [{line, from: 1}]], ["ch7", [{line: rollback, from: 1}]]],
              [["ch6", [{line: "main", from: 1}]], ["ch12", [{line, from: 1}]], ["ch5", [{line: rollback, from: 1}]]],
              [["ch13", [{line, from: 1}]]],
              [["ch9", [{line: rollback, from: 1}]], ["ch10", [{line, from: 1}]]],
            ];
            w.world = w.world.withOptions({...w.world.options, chapterLines: new Map(opts[random(opts.length)]!)});
        },
        castOnLine: () => change({kind: "chapter", chapter: "ch6", key: random(50), line}, {cast: [present(person())]}),
        mentioned: () => change(chapter(place()), {cast: [{who: person(), role: "mentioned"}]}),
        masked: () => change(chapter(place()), {cast: [{who: hero, as: alias, role: "present"}]}),
        appendText: (index) => addText(place(), `第 ${String(index)} 句话`),
        prependParagraph: (index) => {
            const id = place();
            w.texts.set(id, `插在最前面的第 ${String(index)} 段。\n${w.texts.get(id) ?? ""}`);
        },
        dropLine: () => {
            const id = place();
            const lines = (w.texts.get(id) ?? "").split("\n").filter((text) => text !== "");
            if (lines.length > 1) lines.splice(random(lines.length), 1);
            w.texts.set(id, `${lines.join("\n")}\n`);
        },
        nameInText: () => addText(place(), `${entryOf(person()).init.name}与${entryOf(thing).init.name}出现了`),
        nodeTelling: (index) => change(chapter(place()), {told: [inText(place(), `第 ${String(index)} 处线索`, [node(mystery, ["plant", "echo", "payoff"][random(3)]!)])]}),
        revealElsewhere: (index) => change(chapter(place()), {cast: [present(person())], told: [inText(place(), `第 ${String(index)} 处想起`, [reveal(point(), random(2) === 0 ? "hint" : "explicit")])]}),
        revealPlan: () => plans.push(w.change(chapter(place()), {kind: "plan", told: [{source: "outline", chapter: place(), anchor: "细纲", marks: [reveal(point(), "explicit")]}]})),
        nodePlan: () => change(chapter(place()), {kind: "plan", told: [{source: "outline", chapter: place(), anchor: "细纲", marks: [node(mystery, "payoff")]}]}),
        linkedPlan: () => change(chapter(place()), {kind: "plan", patches: [{op: "set", at: {entry: point(), path: "point.保密"}, value: random(2) === 0 ? "secret" : "common"}, touch]}),
        linkedWritten: (index) => change(beforeBreak(), {patches: [{op: "set", at: {entry: person(), path: "entry.name"}, value: `改名${String(index)}`}, touch]}),
        linkedWrittenSecrecy: () => change(beforeBreak(), {patches: [{op: "set", at: {entry: point(), path: "point.保密"}, value: random(2) === 0 ? "secret" : "common"}, touch]}),
        planBreaker: () => change(chapter(place()), {kind: "plan", patches: [{op: "listRemove", at: {entry: bystander, path: "know.知情"}, value: trifle}]}),
        linkedPlanEarlyTold: () => change(chapter(chapters[6 + random(8)]!), {kind: "plan", told: [{source: "outline", chapter: chapters[random(4)]!, anchor: "细纲"}], patches: [{op: "set", at: {entry: point(), path: "point.保密"}, value: random(2) === 0 ? "secret" : "common"}, touch]}),
        replaceLinked: () => {
            const plan = pickFrom(plans);
            if (plan !== undefined) change(chapter(chapters[6 + random(8)]!), {kind: "plan", links: [{kind: "replaces", plan}], patches: [{op: "set", at: {entry: point(), path: "point.保密"}, value: "secret"}, touch]});
        },
        sameChapterPlans: () => {
            const [at, target] = [place(), point()];
            change(chapter(at, 10), {kind: "plan", patches: [{op: "set", at: {entry: target, path: "point.保密"}, value: "common"}]});
            change(chapter(at, 5), {kind: "plan", patches: [{op: "set", at: {entry: target, path: "point.保密"}, value: "secret"}]});
        },
        plain: (index) => change(chapter(place(), 200 + random(50)), {text: `第 ${String(index)} 处补一句`}),
        plainPlan: (index) => change(chapter(place(), 300 + random(50)), {kind: "plan", text: `第 ${String(index)} 条打算`}),
        togglePatchEnabled: () => change(chapter(place()), {patches: [{op: "set", at: {entry: point(), path: "point.启用"}, value: random(2) === 0}]}),
        toggleInitEnabled: () => {
            const id = point();
            const data = entryOf(id).init.data;
            editInit(id, {data: {...data, point: {...data.point!, enabled: data.point!.enabled !== true}}});
        },
        aliasPatch: (index) => change(chapter(place()), {patches: [{op: "aliasAdd", at: {entry: person(), path: "entry.aliases"}, value: `别名${String(index)}`}]}),
        deleteEntry: () => {
            const id = people[3 + random(people.length - 3)]!;
            w.publish([{ref: {kind: "entry", id}, after: {...entryOf(id), deleted: true}}]);
        },
        swapChapters: () => {
            const order = [...w.world.options.order.ids];
            const at = random(order.length - 1);
            [order[at], order[at + 1]] = [order[at + 1]!, order[at]!];
            w.world = w.world.withOptions({...w.world.options, order: new (w.world.options.order.constructor as new (ids: readonly string[]) => typeof w.world.options.order)(order)});
        },
        rebind: () => {
            const lines = [["ch6", [{line, from: 1}]], ["ch10", [{line: "main", from: 1}, {line, from: 2}]], ["ch7", [{line: rollback, from: 1}]]] as [string, {line: string; from: number}[]][];
            w.world = w.world.withOptions({...w.world.options, chapterLines: new Map(lines.slice(random(2)))});
        },
        decisionOnChange: (index) => {
            const on = pickFrom(written);
            if (on !== undefined) w.decision(`第 ${String(index)} 个挂在变更上的决策`, {about: [{kind: "change", id: on}]});
        },
        decisionOnAddress: (index) => w.decision(`第 ${String(index)} 个挂在地址上的决策`, {about: [{kind: "address", at: {entry: point(), path: "entry.name"}}]}),
        decisionScoped: (index) => w.decision(`第 ${String(index)} 个有范围的决策`, {about: [], scope: {from: "ch2", to: place()}}),
        rowOnRollback: () => change({kind: "chapter", chapter: "ch7", key: 100 + random(50), line: rollback}, {patches: [addRow(person(), point(), {程度: "knows"})]}),
        breaker: () => breakers.push(change(chapter(chapters[2 + random(chapters.length - 2)]!), {patches: [{op: "listRemove", at: {entry: bystander, path: "know.知情"}, value: trifle}]})),
        fulfill: (index) => {
            const plan = pickFrom(plans);
            if (plan !== undefined) fulfillers.push({plan, by: change(stored(plan).at, {links: [{kind: "fulfills", plan}], told: [inText(place(), `第 ${String(index)} 处兑现`)]})});
        },
        replace: () => {
            const plan = pickFrom(plans);
            if (plan !== undefined) change(chapter(place()), {kind: "plan", links: [{kind: "replaces", plan}], told: [{source: "outline", chapter: place(), anchor: "细纲", marks: [reveal(point(), "hint")]}]});
        },
        split: () => {
            const pair = fulfillers[random(fulfillers.length)];
            if (pair !== undefined) change(chapter(place()), {kind: "plan", links: [{kind: "splitFrom", ...pair}], told: [{source: "outline", chapter: place(), anchor: "细纲", marks: [reveal(point(), "hint")]}]});
        },
        undo: () => {
            const id = pickFrom([...written, ...plans]);
            if (id !== undefined) w.publish([{ref: {kind: "change", id}, after: {...stored(id), status: "undone", undoneReason: "不要了"}}]);
        },
        move: () => {
            const id = pickFrom([...written, ...plans]);
            if (id !== undefined) w.publish([{ref: {kind: "change", id}, after: {...stored(id), at: chapter(place(), random(50))}}]);
        },
        moveLineEdge: () => {
            const id = [cut, rollbackCut, rollbackTrigger][random(3)]!;
            w.publish([{ref: {kind: "change", id}, after: {...stored(id), at: chapter(chapters[random(4)]!, random(50))}}]);
        },
        renameLine: (index) => {
            const fork = stored(forkId);
            w.publish([{ref: {kind: "change", id: forkId}, after: {...fork, fork: {...fork.fork!, name: `第 ${String(index)} 个名字`}}}]);
        },
        rowOnLine: () => change({kind: "chapter", chapter: "ch6", key: 100 + random(50), line}, {patches: [addRow(person(), point(), {程度: "knows"})]}),
        labelOnly: (index) => change(chapter(place()), {cast: [{label: `路人${String(index)}`, role: "present"}]}),
        reparentGoal: () => editEntry(goal, (entry) => ({...entry, parent: person()})),
        row: () => change(chapter(place()), {patches: [addRow(person(), point(), {程度: ["knows", "suspects", "misbelieves"][random(3)], 他以为的: "疤在右手", 谁告诉的: {ref: person()}})]}),
        learn: () => change(chapter(place()), {cast: [present(person())], marks: [learns(point(), random(2) === 0 ? "knows" : "suspects")]}),
        learnLinked: () => change(beforeBreak(), {cast: [present(person())], marks: [learns(point())], patches: [touch]}),
        check: (index) => {
            const id = `tmp:check${String(index)}`;
            w.publish([{ref: {kind: "check", id}, after: {id, at: {entry: thing, path: "character.状态"}, value: index, told: inText(place(), `第 ${String(index)} 处核对`, random(2) === 0 ? [reveal(point(), "explicit")] : []), place: chapter(place())}}]);
        },
        anchoredCheck: (index) => {
            const [id, anchor] = [`tmp:anchored${String(index)}`, pickFrom(written)];
            if (anchor !== undefined) w.publish([{ref: {kind: "check", id}, after: {id, at: {entry: thing, path: "character.状态"}, value: index, told: inText(place(), `第 ${String(index)} 处账目`), place: chapter(place()), anchor: {change: anchor, side: "after"}}}]);
        },
        retold: (index) => w.publish([{ref: {kind: "entry", id: spare}, after: {...entryOf(spare), retold: {"character.状态": [inText(place(), `第 ${String(index)} 处重述`, [reveal(point(), "explicit")])]}}}]),
        renameInit: (index) => editInit(person(), {name: `新名${String(index)}`}),
        renamePatch: (index) => change(chapter(place()), {patches: [{op: "set", at: {entry: random(2) === 0 ? thing : person(), path: "entry.name"}, value: `改名${String(index)}`}]}),
        summary: (index) => editInit(point(), {summary: `第 ${String(index)} 种说法`}),
        reparent: () => editEntry(point(), (entry) => ({...entry, parent: person()})),
        mask: () => change(chapter(place()), {patches: [{op: "set", at: {entry: point(), path: "point.揭穿"}, value: {ref: stranger}}]}),
        goalSecret: () => change(chapter(place()), {patches: [{op: "set", at: {entry: goal, path: "goal.隐秘"}, value: random(2) === 0 ? {ref: point()} : null}]}),
        goalStatus: () => change(chapter(place()), {kind: "plan", patches: [{op: "set", at: {entry: goal, path: "goal.状态"}, value: random(2) === 0 ? "achieved" : "active"}]}),
        newGoal: (index) => w.goal(`第 ${String(index)} 个目标`, person(), {状态: "active", 隐秘: {ref: point()}}),
        fsObject: () => change(chapter(place()), {patches: [{op: "listAdd", at: {entry: mystery, path: "fs.物件"}, value: {id: spare}}]}),
        fsAnswer: () => change(chapter(place()), {patches: [{op: "set", at: {entry: mystery, path: "fs.答案"}, value: {ref: point()}}]}),
        newForeshadow: (index) => w.foreshadow(`第 ${String(index)} 个悬念`, {种类: "mystery", 答案: {ref: point()}, 物件: [{id: thing}]}),
        toggleSecrecy: () => {
            const id = point();
            const data = entryOf(id).init.data;
            const fields = data.point!.fields as {保密?: string};
            editInit(id, {data: {...data, point: {...data.point!, fields: {...fields, 保密: fields.保密 === "common" ? "secret" : "common"}}}});
        },
        newPoint: (index) => points.push(w.point(`第 ${String(index)} 个秘密`, person(), {保密: "secret", 读者问题: `第 ${String(index)} 个问题`})),
        latePoint: (index) => {
            const id = `tmp:late${String(index)}`;
            points.push(w.publish([{ref: {kind: "entry", id}, after: {...drafts.point(id, `后来才有的第 ${String(index)} 件事`, person(), {保密: "secret"}), appears: chapter(place())}}])[id]!);
        },
        appears: () => editEntry(point(), (entry) => ({...entry, appears: chapter(place())})),
        newPerson: (index) => people.push(w.person(`第 ${String(index)} 个人`)),
        folder: (index) => editEntry(random(2) === 0 ? person() : mystery, (entry) => ({...entry, folder: `第 ${String(index)} 夹`, order: index})),
        decision: (index) => w.decision(`第 ${String(index)} 个决策`, {about: [random(2) === 0 ? {kind: "chapter", id: place()} : {kind: "entry", id: person()}]}),
    };
    const names = Object.keys(operations);
    // 一副牌：每一轮把全部操作洗一遍轮着出。纯随机时 240 步里总有几种一次也轮不到。
    let deck: string[] = [];
    const draw = () => {
        if (deck.length === 0) {
            deck = [...names];
            for (let index = deck.length - 1; index > 0; index -= 1) {
                const other = random(index + 1);
                [deck[index], deck[other]] = [deck[other]!, deck[index]!];
            }
        }
        return deck.pop()!;
    };
    return {
        w,
        chapters,
        instructions: new Map<string, InstructionSnapshot>([
            ["ch9", {chapter: "ch9", version: "v1", pov: {kind: "entry", id: hero}, povMode: "limited"}],
            ["ch12", {chapter: "ch12", version: "v1", timeMode: {flashback: {kind: "chapter", chapter: "ch4", key: 0}}}],
        ]),
        ops: names,
        step: (index) => {
            const op = draw();
            try {
                operations[op]!(index);
                return {op, applied: true};
            } catch (error) {
                if (process.env.PLOT_RANDOM_DEBUG !== undefined) console.log(op, String(error).slice(0, 300));
                // 发布校验拒绝了（例如计划已被撤销）：世界没变，这一步算空转。调用方核对每种操作都真的成功过。
                return {op, applied: false};
            }
        },
    };
}
