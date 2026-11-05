/**
 * 内核的时间层（docs/specs/canon/time.md）：从世界的数据取事件与说法，交给 nb-time 组网与求解。
 *
 * 事件集按模式（输出 1）：实际模式是生效、不是叙述的已写变更；按计划模式再加全书当前进展里未兑现的生效计划（含未排章的）。
 * 事件按安放的先后排（对不上与没有锚的分量的原点要用）；未排章的排在最后。
 */

import {assembleNetwork, compileCalendar, DEFAULT_FUZZY, GREGORIAN, lowerStatement, solveNetwork, type AssembledNetwork, type Calendar, type CompiledCalendar, type FuzzyTable, type Lowered, type Statement, type TimeNetwork} from "@notnotype/nb-time";

import {compareIds} from "../core/ids";
import {compareRanks, placementRank, type ChapterOrder} from "../core/position";
import type {Entry, StoryChange} from "../core/schema";
import {canonicalJson} from "../core/stable-json";

/** 时间的设置：生效的历法与词表（宿主从作品设置给，见 WorldOptions.time）。 */
export interface TimeSettings {
    readonly calendar: Calendar;
    readonly fuzzy: FuzzyTable;
}

export const DEFAULT_TIME: TimeSettings = {calendar: GREGORIAN, fuzzy: DEFAULT_FUZZY};

const compiledCalendars = new WeakMap<Calendar, CompiledCalendar>();
/** 编译好的历法，按历法对象缓存（历法换了就是新对象）。 */
export function compiledOf(calendar: Calendar): CompiledCalendar {
    let compiled = compiledCalendars.get(calendar);
    if (compiled === undefined) {
        compiled = compileCalendar(calendar);
        compiledCalendars.set(calendar, compiled);
    }
    return compiled;
}

interface KeyedStatement {
    /** 说法的键（待处理项与依据里用）。 */
    readonly key: string;
    /** 说法的规范 JSON（降约束的缓存键）。 */
    readonly json: string;
    readonly statement: Statement;
}

const keyedCache = new WeakMap<StoryChange, readonly KeyedStatement[]>();
/**
 * 一条变更的全部说法与它们的键：所在的变更与说法的规范 JSON，不按它在列表里的下标（输出 14）。同一变更里写了几条完全相同的说法
 * 时，从第二条起带出现的序号（`#1`、`#2`）：插进别的说法不扰动它们，删掉一条重复的也只少一个键。
 *
 * 按变更对象缓存：世界里的变更写入时就冻结了（world.ts），没改的变更跨版本是同一个对象，每次发布只给改了的变更算规范 JSON
 * （七千条说法每次全算要三十毫秒左右）。
 */
function keyedStatements(change: StoryChange): readonly KeyedStatement[] {
    const cached = keyedCache.get(change);
    if (cached !== undefined) return cached;
    const seen = new Map<string, number>();
    const keyed = ((change.when ?? []) as Statement[]).map((statement) => {
        const json = canonicalJson(statement);
        const occurrence = seen.get(json) ?? 0;
        seen.set(json, occurrence + 1);
        return {key: `${change.id}|${json}${occurrence === 0 ? "" : `#${String(occurrence)}`}`, json, statement};
    });
    keyedCache.set(change, keyed);
    return keyed;
}

const loweredCache = new WeakMap<TimeSettings, Map<string, Lowered>>();
/** 降成约束只看说法、历法与词表：按（设置对象、说法的规范 JSON）缓存，别的变更变了不会用到旧结果。 */
function lowered(settings: TimeSettings, {json, statement}: KeyedStatement): Lowered {
    let cache = loweredCache.get(settings);
    if (cache === undefined) {
        cache = new Map();
        loweredCache.set(settings, cache);
    }
    let result = cache.get(json);
    if (result === undefined) {
        result = lowerStatement(statement, compiledOf(settings.calendar), settings.fuzzy);
        cache.set(json, result);
    }
    return result;
}

export interface TimeInput {
    readonly changes: ReadonlyMap<string, StoryChange>;
    readonly entries: ReadonlyMap<string, Entry>;
    readonly order: ChapterOrder;
    /** 对象第一次写入的版本（同一安放上先后的打破，同 canon.model 输出 2）。 */
    readonly createdAt: ReadonlyMap<string, number>;
}

export interface BuiltNetwork {
    readonly assembled: AssembledNetwork;
    readonly network: TimeNetwork;
}

/** 按事件集组网并求解。`plans` 是按计划模式加进来的计划（实际模式为空）。 */
export function buildNetwork(input: TimeInput, settings: TimeSettings, plans: readonly string[] = []): BuiltNetwork {
    const events: StoryChange[] = [];
    // 安放在章序之外（所在章删了）的已写变更这时不算发生，不进网络（输出 17）；指向它的说法按“不是事件”跳过。
    for (const change of input.changes.values()) if (change.kind === "written" && change.status === "active" && change.nature !== "narration" && placementRank(input.order, change.at) !== null) events.push(change);
    for (const id of plans) {
        const plan = input.changes.get(id);
        if (plan !== undefined && plan.nature !== "narration") events.push(plan);
    }
    const ranked = events.map((change) => ({change, rank: placementRank(input.order, change.at)}));
    // 安放的全序：先比安放，再比写入的版本与 id（canon.model 输出 2）；未排章的排在最后。
    const tie = (a: StoryChange, b: StoryChange) => (input.createdAt.get(a.id) ?? 0) - (input.createdAt.get(b.id) ?? 0) || compareIds(a.id, b.id);
    ranked.sort((a, b) => (a.rank === null || b.rank === null ? (a.rank === b.rank ? tie(a.change, b.change) : a.rank === null ? 1 : -1) : compareRanks(a.rank, b.rank) || tie(a.change, b.change)));
    const assembled = assembleNetwork({
        events: ranked.map(({change}) => ({id: change.id, statements: keyedStatements(change).map((keyed) => ({ref: keyed.key, lowered: lowered(settings, keyed)}))})),
        exists: (id) => input.changes.has(id),
        bodyOf: (id) => input.entries.get(id)?.sameAs ?? id,
    });
    return {assembled, network: solveNetwork(assembled)};
}
