/**
 * w00039 t32 世界线原型：每条线是一份按线过滤出来的线性世界，交给现有的增量引擎（分支 feat/w00039-t29-canon-kernel
 * 的 nb-canon，引擎内部不改）。一次性原型。运行：bun lines.ts
 *
 * 一条线看到的世界 = 祖先线上安放不晚于切口的变更 + 带过去的地址（取父线在触发处的值，记成一条合成的赋值）+ 本线的变更。
 * 线的归属与分叉记录放在原型自己的表里；产品里它们在剧情变更与分叉记录上（剧情侧提案第 3 节）。
 *
 * 第一部分：星瑕第 8 章回溯，两条线各读第 8 章末尾。第二部分：1000 章的规模，量建一条线、写入时更新常驻的线、内存。
 */

import {buildRegistry, ChapterOrder, createIncrementalEngine} from "../../../../../../../.worktree/w00039-t29-canon-kernel/packages/nb-canon/src/index";
import type {Check, ComponentDeclaration, Entry, EngineInputs, IncrementalEngine, Patch, ReadPosition, StoryChange, WorldData} from "../../../../../../../.worktree/w00039-t29-canon-kernel/packages/nb-canon/src/index";

const line = (text = "") => console.log(text);

// ---------- 线视图 ----------

type Line = {readonly id: string; readonly parent?: string; readonly cutAfter?: string; readonly carry?: ReadonlyArray<{entry: string; path: string}>; readonly trigger?: ReadPosition};
const MAIN = "main";

/** 安放的先后：前史在前，之后按章序、章内排序键、写入版本、id 的数值部分（与内核一致）。 */
const chapterIndexCache = new WeakMap<ChapterOrder, Map<string, number>>();
function rankOf(world: WorldData, order: ChapterOrder, placement: StoryChange["at"], id: string): number[] {
    let index = chapterIndexCache.get(order);
    if (index === undefined) chapterIndexCache.set(order, (index = new Map(order.ids.map((chapter, position) => [chapter, position]))));
    const version = world.createdAt.get(id) ?? 0;
    const numeric = Number(id.replace(/\D+/gu, "")) || 0;
    if (placement.kind === "prehistory") return [0, placement.order, 0, version, numeric];
    if (placement.kind === "chapter") return [1, index.get(placement.chapter) ?? -1, placement.key, version, numeric];
    return [2, 0, 0, version, numeric];
}
const compare = (a: number[], b: number[]) => {
    for (let index = 0; index < a.length; index += 1) if (a[index] !== b[index]) return a[index]! - b[index]!;
    return 0;
};

class LineViews {
    private readonly engines = new Map<string, IncrementalEngine>();
    constructor(private readonly base: EngineInputs, private readonly lines: ReadonlyMap<string, Line>, private readonly lineOf: ReadonlyMap<string, string>) {}

    /** 这条线看得到的变更与核对点。 */
    private visible(lineId: string): {changes: Map<string, StoryChange>; checks: Map<string, Check>; createdAt: Map<string, number>} {
        const {world, order} = this.base;
        const definition = this.lines.get(lineId)!;
        const own = (id: string) => (this.lineOf.get(id) ?? MAIN) === lineId;
        const changes = new Map<string, StoryChange>();
        const checks = new Map<string, Check>();
        const createdAt = new Map(world.createdAt);
        if (definition.parent !== undefined) {
            const parent = this.visible(definition.parent);
            const cut = world.changes.get(definition.cutAfter!)!;
            const cutRank = rankOf(world, order, cut.at, cut.id);
            for (const [id, change] of parent.changes) if (compare(rankOf(world, order, change.at, id), cutRank) <= 0) changes.set(id, change);
            for (const [id, check] of parent.checks) if (compare(rankOf(world, order, check.place, id), cutRank) <= 0) checks.set(id, check);
            // 带过去的地址：取父线在触发处的值，记成切口之后紧接着的一条合成赋值。
            if (definition.carry !== undefined && definition.carry.length > 0) {
                const parentEngine = this.engine(definition.parent);
                const patches: Patch[] = [];
                for (const address of definition.carry) {
                    const view = parentEngine.entry(address.entry, definition.trigger!, "actual");
                    if (view === null || view === "chapter-not-found") continue;
                    const [namespace, field] = address.path.split(".") as [string, string];
                    patches.push({op: "set", at: address, value: structuredClone(view.namespaces[namespace]?.fields[field]?.value ?? null)});
                }
                const id = `carry-${lineId}`;
                changes.set(id, {id, kind: "written", text: `${lineId}：带过去的东西`, at: cut.at.kind === "chapter" ? {kind: "chapter", chapter: cut.at.chapter, key: cut.at.key} : cut.at, told: [], involves: [], lines: [], links: [], patches, status: "active", by: {kind: "author"}});
                createdAt.set(id, (world.createdAt.get(cut.id) ?? 0));
            }
        }
        for (const [id, change] of world.changes) if (own(id)) changes.set(id, change);
        for (const [id, check] of world.checks) if (own(id)) checks.set(id, check);
        return {changes, checks, createdAt};
    }

    inputs(lineId: string): EngineInputs {
        const {changes, checks, createdAt} = this.visible(lineId);
        return {...this.base, world: {...this.base.world, changes, checks, createdAt}};
    }

    /** 用到才建，建好留着（产品里常驻当前线，其余按最近使用留几份）。 */
    engine(lineId: string): IncrementalEngine {
        let engine = this.engines.get(lineId);
        if (engine === undefined) this.engines.set(lineId, (engine = createIncrementalEngine(this.inputs(lineId))));
        return engine;
    }

    /** 世界变了以后，只更新已经建好、而且看得到这些变化的线；返回重建视图与引擎更新各用了多久。 */
    update(base: EngineInputs, changed: Parameters<IncrementalEngine["update"]>[1], seenBy?: ReadonlySet<string>): {viewMs: number; engineMs: number} {
        (this as {base: EngineInputs}).base = base;
        let viewMs = 0;
        let engineMs = 0;
        for (const [lineId, engine] of this.engines) {
            if (seenBy !== undefined && !seenBy.has(lineId)) continue;
            let started = performance.now();
            const inputs = this.inputs(lineId);
            viewMs += performance.now() - started;
            started = performance.now();
            this.engines.set(lineId, engine.update(inputs, changed));
            engineMs += performance.now() - started;
        }
        return {viewMs, engineMs};
    }

    drop(lineId: string): void {
        this.engines.delete(lineId);
    }
}

// ---------- 第一部分：星瑕第 8 章 ----------

const PANEL: ComponentDeclaration = {id: "canon.panel", label: "面板", namespace: "panel", version: 1, fields: [{id: "存款", label: "存款", kind: "number", min: 0}, {id: "回溯次数", label: "今天还能回溯", kind: "number", min: 0}]};
const BODY: ComponentDeclaration = {id: "canon.body", label: "身体", namespace: "body", version: 1, fields: [{id: "伤", label: "伤", kind: "text"}]};
const MIND: ComponentDeclaration = {id: "know.mind", label: "知情", namespace: "know", version: 1, fields: [{id: "知情", label: "知道的事", kind: "list", item: [{id: "程度", label: "程度", kind: "enum", options: ["知道", "误信", "怀疑", "不知道", "忘了"]}]}]};

{
    line("## 第一部分：星瑕第 8 章回溯");
    const entry = (id: string, name: string, data: Entry["init"]["data"]): Entry => ({id, type: "人物", parent: null, folder: "", order: 0, init: {name, aliases: [], summary: "", text: [], data}});
    const entries = new Map<string, Entry>([
        ["e1", entry("e1", "星瑕", {panel: {type: PANEL.id, version: 1, enabled: true, fields: {存款: 20000, 回溯次数: 1}}, know: {type: MIND.id, version: 1, enabled: true, fields: {知情: []}}})],
        ["e2", entry("e2", "星瑾", {body: {type: BODY.id, version: 1, enabled: true, fields: {伤: "没有"}}, know: {type: MIND.id, version: 1, enabled: true, fields: {知情: []}}})],
        ["e3", {id: "e3", type: "知识点", parent: null, folder: "", order: 0, init: {name: "下午那个路口会出车祸", aliases: [], summary: "", text: [], data: {}}}],
    ]);
    const change = (id: string, key: number, text: string, patches: Patch[]): StoryChange => ({id, kind: "written", text, at: {kind: "chapter", chapter: "ch8", key}, told: [], involves: [], lines: [], links: [], patches, status: "active", by: {kind: "author"}});
    const changes = new Map<string, StoryChange>([
        ["c1", change("c1", 10, "早上出门、取钱", [])],
        ["c2", change("c2", 20, "中午买包", [{op: "add", at: {entry: "e1", path: "panel.存款"}, value: -5000}])],
        ["c3", change("c3", 30, "下午星瑾被货车撞伤；星瑕决定回溯，用掉今天的回溯", [
            {op: "set", at: {entry: "e2", path: "body.伤"}, value: "右腿骨折"},
            {op: "listAdd", at: {entry: "e1", path: "know.知情"}, value: {id: "e3", label: "下午那个路口会出车祸", 程度: "知道"}},
            {op: "set", at: {entry: "e1", path: "panel.回溯次数"}, value: 0},
        ])],
        ["c4", change("c4", 40, "（回溯后）没买包，中午去学校门口接星瑾绕开那条路", [])],
    ]);
    const createdAt = new Map([...entries.keys(), ...changes.keys()].map((id, index) => [id, index + 1]));
    const base: EngineInputs = {world: {version: 10, entries, changes, checks: new Map(), questions: new Map(), suggestions: new Map(), createdAt}, order: new ChapterOrder(["ch7", "ch8", "ch9"]), registry: buildRegistry([PANEL, BODY, MIND]), reductions: () => undefined};
    const lines = new Map<string, Line>([
        [MAIN, {id: MAIN}],
        // 带过去：她的知情、用掉的回溯次数（“用掉的不回来”）。
        ["r1", {id: "r1", parent: MAIN, cutAfter: "c1", carry: [{entry: "e1", path: "know.知情"}, {entry: "e1", path: "panel.回溯次数"}], trigger: {kind: "chapter", chapter: "ch8", edge: "end"}}],
    ]);
    const views = new LineViews(base, lines, new Map([["c4", "r1"]]));
    const show = (lineId: string) => {
        const end: ReadPosition = {kind: "chapter", chapter: "ch8", edge: "end"};
        const engine = views.engine(lineId);
        const xia = engine.entry("e1", end, "actual");
        const jin = engine.entry("e2", end, "actual");
        if (xia === null || xia === "chapter-not-found" || jin === null || jin === "chapter-not-found") throw new Error("读不到");
        const know = (xia.namespaces.know?.fields.知情?.value as Array<{label: string}>).map((row) => row.label);
        line(`- ${lineId === MAIN ? "原来那条线" : "回溯后的线"}，第 8 章末尾：星瑕存款 ${String(xia.namespaces.panel?.fields.存款?.value)}、今天还能回溯 ${String(xia.namespaces.panel?.fields.回溯次数?.value)} 次、知道 ${JSON.stringify(know)}；星瑾的伤：${String(jin.namespaces.body?.fields.伤?.value)}`);
    };
    show(MAIN);
    show("r1");
    const r1 = views.engine("r1");
    const withOrigins = r1.entry("e1", {kind: "chapter", chapter: "ch8", edge: "end"}, "actual") as {origins?: unknown};
    void withOrigins;
}

// ---------- 第二部分：1000 章的规模 ----------

line();
line("## 第二部分：1000 章的规模（形状同 t29 的 scripts/scale.ts：每章 5 个计划、15 条已写变更、2 个核对点，约 520 个条目）");
{
    const chapters = 1000;
    const PERSON: ComponentDeclaration = {id: "canon.person", label: "人物", namespace: "character", version: 1, fields: [{id: "样子", label: "样子", kind: "text"}, {id: "态度", label: "态度", kind: "text", precision: "semantic"}]};
    const SCALE_PANEL: ComponentDeclaration = {id: "canon.panel", label: "面板", namespace: "panel", version: 1, fields: [{id: "存款", label: "存款", kind: "number", min: 0}, {id: "魔力", label: "魔力", kind: "number"}]};
    const entries = new Map<string, Entry>();
    const changes = new Map<string, StoryChange>();
    const checks = new Map<string, Check>();
    const createdAt = new Map<string, number>();
    let version = 0;
    let entrySeq = 0;
    let changeSeq = 0;
    let checkSeq = 0;
    const newEntry = (chapter?: string) => {
        const id = `e${String(++entrySeq)}`;
        entries.set(id, {id, type: "人物", parent: null, folder: "人物", order: entrySeq, ...(chapter === undefined ? {} : {appears: {kind: "chapter" as const, chapter, key: 0}}), init: {name: `人物${String(entrySeq)}`, aliases: [], summary: "", text: [{id: "b1", source: "存款还剩 {panel.存款}。"}], data: {panel: {type: SCALE_PANEL.id, version: 1, enabled: true, fields: {存款: 1_000_000, 魔力: 3200}}, character: {type: PERSON.id, version: 1, enabled: true, fields: {样子: "哥哥", 态度: "冷淡"}}}}});
        createdAt.set(id, ++version);
        return id;
    };
    const hot = Array.from({length: 20}, () => newEntry()).slice(0, 5);
    const chapterIds = Array.from({length: chapters}, (_, index) => `ch${String(index + 1)}`);
    const lineOf = new Map<string, string>();
    const forkChapter = 500;
    let cutChange = "";
    for (let n = 1; n <= chapters; n += 1) {
        const chapter = `ch${String(n)}`;
        version += 1;
        if (n % 2 === 0) newEntry(chapter);
        const plans: string[] = [];
        for (let i = 0; i < 5; i += 1) {
            const id = `c${String(++changeSeq)}`;
            changes.set(id, {id, kind: "plan", text: "计划", at: {kind: "chapter", chapter, key: i * 10}, told: [], involves: [hot[i % 5]!], lines: [], links: [], patches: [{op: "add", at: {entry: hot[i % 5]!, path: "panel.魔力"}, value: -10}], status: "active", by: {kind: "author"}});
            createdAt.set(id, version);
            plans.push(id);
            if (n > forkChapter) lineOf.set(id, "r1");
        }
        version += 1;
        for (let i = 0; i < 15; i += 1) {
            const id = `c${String(++changeSeq)}`;
            const amount = 100 + i;
            changes.set(id, {id, kind: "written", text: "情节", at: {kind: "chapter", chapter, key: i * 10}, told: [], involves: [hot[i % 5]!, hot[(i + 1) % 5]!], lines: [], links: i < 4 ? [{kind: "fulfills" as const, plan: plans[i]!}] : [],
                patches: [{op: "add", at: {entry: hot[i % 5]!, path: "panel.存款"}, value: -amount}, {op: "add", at: {entry: hot[(i + 1) % 5]!, path: "panel.存款"}, value: amount}, ...(i % 3 === 0 ? [{op: "note" as const, at: {entry: hot[i % 5]!, path: "character.态度"}, value: `第 ${String(n)} 章：软了一点`}] : [])],
                status: "active", by: {kind: "agent", session: "记账"}});
            createdAt.set(id, version);
            // 第 500 章：前 7 条是切口之前，之后 8 条是被抹掉的那段（留在主线）；第 501 章起都在回溯后的线上。
            if (n === forkChapter && i === 6) cutChange = id;
            if (n > forkChapter) lineOf.set(id, "r1");
        }
        for (let i = 0; i < 2; i += 1) {
            const id = `k${String(++checkSeq)}`;
            checks.set(id, {id, at: {entry: hot[0]!, path: "panel.存款"}, value: 1_000_000, told: {source: "chapter", chapter, quote: "原句"}, place: {kind: "chapter", chapter, key: 55 + i * 100}});
            createdAt.set(id, version);
            if (n > forkChapter) lineOf.set(id, "r1");
        }
    }
    const world: WorldData = {version, entries, changes, checks, questions: new Map(), suggestions: new Map(), createdAt};
    const base: EngineInputs = {world, order: new ChapterOrder(chapterIds), registry: buildRegistry([SCALE_PANEL, PERSON]), reductions: () => undefined};
    const heap = () => {
        Bun.gc(true);
        return process.memoryUsage().heapUsed / 1024 / 1024;
    };
    const time = <T,>(run: () => T): [T, number] => {
        const started = performance.now();
        const result = run();
        return [result, performance.now() - started];
    };

    const heap0 = heap();
    const [single, singleMs] = time(() => createIncrementalEngine(base));
    const heap1 = heap();
    line(`- 对照：不分线、整本一条线建引擎 ${singleMs.toFixed(0)} ms，堆多 ${(heap1 - heap0).toFixed(0)} MB`);
    void single;

    const lines = new Map<string, Line>([[MAIN, {id: MAIN}], ["r1", {id: "r1", parent: MAIN, cutAfter: cutChange}]]);
    const views = new LineViews(base, lines, lineOf);
    const heap2 = heap();
    const [, r1Ms] = time(() => views.engine("r1"));
    const heap3 = heap();
    line(`- 第 500 章分叉。回溯后的线（第 1 到 500 章切口前 + 第 501 到 1000 章，当前线、常驻）：建 ${r1Ms.toFixed(0)} ms，堆多 ${(heap3 - heap2).toFixed(0)} MB`);
    const [, mainMs] = time(() => views.engine(MAIN));
    const heap4 = heap();
    line(`- 原来那条线（第 1 到 500 章，含被抹掉的那段；用到才建）：建 ${mainMs.toFixed(0)} ms，堆多 ${(heap4 - heap3).toFixed(0)} MB`);

    const end: ReadPosition = {kind: "chapter", chapter: "ch1000", edge: "end"};
    const mid: ReadPosition = {kind: "chapter", chapter: "ch500", edge: "end"};
    const read = (lineId: string, position: ReadPosition) => {
        const view = views.engine(lineId).entry(hot[0]!, position, "actual");
        return view === null || view === "chapter-not-found" ? String(view) : String(view.namespaces.panel?.fields.存款?.value);
    };
    const singleView = single.entry(hot[0]!, mid, "actual");
    line(`- 第 500 章末尾 hot[0] 的存款：原来那条线 ${read(MAIN, mid)}，回溯后的线 ${read("r1", mid)}，不分线 ${singleView === null || singleView === "chapter-not-found" ? "" : String(singleView.namespaces.panel?.fields.存款?.value)}；第 1000 章末尾回溯后的线 ${read("r1", end)}`);

    // 写入：在最新一章补记 15 条（只在回溯后的线上），两条线都常驻时更新它们。
    const publishLatest: Array<{viewMs: number; engineMs: number}> = [];
    let current = base;
    for (let round = 0; round < 5; round += 1) {
        const nextChanges = new Map(current.world.changes);
        const nextCreated = new Map(current.world.createdAt);
        const added: string[] = [];
        const v = current.world.version + 1;
        for (let i = 0; i < 15; i += 1) {
            const id = `c${String(++changeSeq)}`;
            nextChanges.set(id, {id, kind: "written", text: "补记", at: {kind: "chapter", chapter: "ch1000", key: 200 + round * 20 + i}, told: [], involves: [hot[i % 5]!], lines: [], links: [], patches: [{op: "add", at: {entry: hot[i % 5]!, path: "panel.存款"}, value: -1}, {op: "add", at: {entry: hot[(i + 1) % 5]!, path: "panel.存款"}, value: 1}], status: "active", by: {kind: "agent", session: "记账"}});
            nextCreated.set(id, v);
            lineOf.set(id, "r1");
            added.push(id);
        }
        current = {...current, world: {...current.world, version: v, changes: nextChanges, createdAt: nextCreated}};
        publishLatest.push(views.update(current, {changes: added}, new Set(["r1"])));
    }
    const medianOf = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
    line(`- 两条线都建好时，在最新一章补记 15 条（只在回溯后的线上，5 次）：只更新看得到的那条线；引擎更新中位 ${medianOf(publishLatest.map((item) => item.engineMs)).toFixed(0)} ms，原型重建线视图（每次从头过滤两万条）中位 ${medianOf(publishLatest.map((item) => item.viewMs)).toFixed(0)} ms`);

    // 改一个常出场条目的初值：两条线都受影响。
    const nextEntries = new Map(current.world.entries);
    const hotEntry = nextEntries.get(hot[0]!)!;
    nextEntries.set(hot[0]!, {...hotEntry, init: {...hotEntry.init, data: {...hotEntry.init.data, panel: {...hotEntry.init.data.panel!, fields: {...hotEntry.init.data.panel!.fields, 存款: 2_000_000}}}}});
    current = {...current, world: {...current.world, version: current.world.version + 1, entries: nextEntries}};
    const initCost = views.update(current, {entries: [hot[0]!]});
    line(`- 改常出场条目的初值（两条线都要重算）：引擎更新合计 ${initCost.engineMs.toFixed(0)} ms，重建线视图 ${initCost.viewMs.toFixed(0)} ms`);

    // 很晚分叉：第 990 章分叉，原来那条线几乎是整本。
    views.drop(MAIN);
    views.drop("r1");
    const late = [...changes.values()].find((item) => item.at.kind === "chapter" && item.at.chapter === "ch990" && item.kind === "written")!;
    const lateLines = new Map<string, Line>([[MAIN, {id: MAIN}], ["r2", {id: "r2", parent: MAIN, cutAfter: late.id}]]);
    const lateViews = new LineViews(current, lateLines, new Map());
    const [, lateMs] = time(() => lateViews.engine("r2"));
    line(`- 第 990 章分叉、建一条几乎是整本的线：${lateMs.toFixed(0)} ms`);
}
