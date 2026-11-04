/**
 * w00039 t32 时间原型：把时间说法与世界线放进时间约束网络，并回答查询。一次性原型。
 *
 * 第一版的规则（t32 README 的“第一版方案”）：
 * - 时间不决定状态按什么顺序折叠：折叠仍按安放（前史的序号、章序、章内排序键）。
 * - 网络里只放时间说法（和有起止的事“先起后止”、回溯的“回到多久以前”）。安放的先后不进网络：一处安放错了，
 *   不会让整张网矛盾、什么都查不了。
 * - 推不出的一端（没写时间的事两端都推不出），用安放上最近的、写了时间的前后邻居补上，只用于查询。
 * - 安放与时间对不上（按安放 A 在 B 前，时间上 B 一定早于 A）单独报出来，提示挪安放或标平行。
 * - 世界线由分叉定义（产品里分叉是一种剧情变更）：新线继承父线在切口之前的变更，再加上从触发处带过去的地址
 *   （例如她的记忆），之后是本线的变更。
 */

import {Calendar, type CalendarDate, type Duration} from "./calendar";
import {TimeNetwork} from "./network";

export type Placement = {readonly kind: "prehistory"; readonly order: number} | {readonly kind: "chapter"; readonly chapter: string; readonly key: number};
export type Patch = {readonly entry: string; readonly path: string; readonly op: "set" | "add"; readonly value: number};
export type TimeEvent = {
    readonly id: string;
    readonly text: string;
    readonly at: Placement;
    readonly line?: string;
    /** 有起止的事（“离家那几年”）。 */
    readonly interval?: boolean;
    readonly patches?: readonly Patch[];
};
export type Ref = {readonly event: string; readonly side?: "start" | "end"};
export type TimeStatement = (
    | {readonly kind: "on"; readonly date: CalendarDate}
    | {readonly kind: "after"; readonly ref: Ref; readonly gap?: Duration | string}
    | {readonly kind: "before"; readonly ref: Ref; readonly gap?: Duration | string}
    | {readonly kind: "lasts"; readonly duration: Duration | string}
    | {readonly kind: "age"; readonly birth: string; readonly years: number}
) & {readonly event: string; readonly side?: "start" | "end"; readonly note: string};
export type Chapter = {readonly id: string; readonly title: string; readonly parallelTo?: string};
/** 分叉：产品里是一条剧情变更。cutAfter 是父线上切口前的最后一件事（按安放），trigger 是触发分叉的事。 */
export type Fork = {
    readonly line: string;
    readonly label: string;
    readonly mode: "rewind" | "branch" | "dream" | "alt";
    readonly parent: string;
    readonly cutAfter: string;
    readonly trigger: string;
    /** 回溯：从触发处往回多久。 */
    readonly back?: Duration;
    /** 从触发处带过去的地址（条目.字段），取父线在触发处的值。 */
    readonly carry?: readonly string[];
};

export type Book = {
    readonly calendar: Calendar;
    /** 模糊词：“几年”“几天”换成范围，所有 Agent 用同一份，不各自估。 */
    readonly vague?: Readonly<Record<string, Duration>>;
    readonly chapters: readonly Chapter[];
    readonly forks?: readonly Fork[];
    readonly events: readonly TimeEvent[];
    readonly statements: readonly TimeStatement[];
};

const MAIN = "main";
const ANY: Duration = {lo: 0, hi: Number.POSITIVE_INFINITY, unit: "minute"};

export class Timeline {
    readonly network = new TimeNetwork();
    private readonly start = new Map<string, number>();
    private readonly end = new Map<string, number>();
    private readonly byId = new Map<string, TimeEvent>();
    private readonly timed = new Set<string>();
    private cachedWindows: Array<[number, number]> | null = null;

    constructor(readonly book: Book) {
        for (const event of book.events) {
            this.byId.set(event.id, event);
            const start = this.network.node(`${event.id} ${event.text}${event.interval ? "（起）" : ""}`);
            this.start.set(event.id, start);
            if (event.interval) {
                const end = this.network.node(`${event.id} ${event.text}（止）`);
                this.end.set(event.id, end);
                this.network.add({a: start, b: end, lo: 0, hi: Number.POSITIVE_INFINITY, label: `${event.id} 先起后止`});
            } else this.end.set(event.id, start);
        }
        // 被时间说法直接或间接拴住的事都算“写了时间”（出生只被“十五岁那年”引用，也有自己的范围）。
        for (const statement of book.statements) {
            this.timed.add(statement.event);
            if ("ref" in statement) this.timed.add(statement.ref.event);
            if (statement.kind === "age") this.timed.add(statement.birth);
            this.addStatement(statement);
        }
        for (const fork of book.forks ?? []) this.addFork(fork);
    }

    private point(ref: Ref): number {
        const map = ref.side === "end" ? this.end : this.start;
        const node = map.get(ref.event);
        if (node === undefined) throw new Error(`没有这件事：${ref.event}`);
        return node;
    }

    private duration(value: Duration | string | undefined): Duration {
        if (value === undefined) return ANY;
        if (typeof value !== "string") return value;
        const found = this.book.vague?.[value];
        if (found === undefined) throw new Error(`模糊词表里没有“${value}”`);
        return found;
    }

    private addStatement(statement: TimeStatement): void {
        const node = this.point({event: statement.event, side: statement.side});
        const calendar = this.book.calendar;
        const label = `${statement.event}：${statement.note}`;
        switch (statement.kind) {
            case "on": {
                const [from, to] = calendar.interval(statement.date);
                this.network.add({a: 0, b: node, lo: from, hi: to - 1, label});
                return;
            }
            case "after": {
                const [lo, hi] = calendar.span(this.duration(statement.gap));
                this.network.add({a: this.point(statement.ref), b: node, lo, hi, label});
                return;
            }
            case "before": {
                const [lo, hi] = calendar.span(this.duration(statement.gap));
                this.network.add({a: node, b: this.point(statement.ref), lo, hi, label});
                return;
            }
            case "lasts": {
                const [lo, hi] = calendar.span(this.duration(statement.duration));
                this.network.add({a: this.point({event: statement.event, side: "start"}), b: this.point({event: statement.event, side: "end"}), lo, hi, label});
                return;
            }
            case "age": {
                // “十五岁那年”：出生之后满十五年、不满十六年。
                const [lo] = calendar.span({lo: statement.years, hi: statement.years, unit: "year"});
                const [, hi] = calendar.span({lo: statement.years + 1, hi: statement.years + 1, unit: "year"});
                this.network.add({a: this.point({event: statement.birth}), b: node, lo, hi: hi - 1, label});
            }
        }
    }

    /** 回溯：新线上的事不早于“触发处往回 back”的那一刻。 */
    private addFork(fork: Fork): void {
        const first = this.ordered(fork.line)[0];
        if (first === undefined || fork.back === undefined) return;
        const [lo, hi] = this.book.calendar.span(fork.back);
        const moment = this.network.node(`${fork.label}回到的那一刻`);
        this.network.add({a: moment, b: this.point({event: fork.trigger}), lo, hi, label: `${fork.label}：往回 ${fork.back.lo} 到 ${fork.back.hi} ${fork.back.unit}`});
        this.network.add({a: moment, b: this.point({event: first.id}), lo: 0, hi: Number.POSITIVE_INFINITY, label: `${fork.label}：新线从那一刻开始`});
        this.timed.add(first.id);
    }

    private readonly orderedCache = new Map<string, TimeEvent[]>();

    /** 一条线上的事按安放排好：前史按序号，之后按章序与章内排序键。 */
    ordered(line: string): TimeEvent[] {
        const cached = this.orderedCache.get(line);
        if (cached !== undefined) return cached;
        const list = this.sortLine(line);
        this.orderedCache.set(line, list);
        return list;
    }

    private sortLine(line: string): TimeEvent[] {
        const chapterIndex = new Map(this.book.chapters.map((chapter, index) => [chapter.id, index]));
        const rank = (event: TimeEvent): [number, number] => (event.at.kind === "prehistory" ? [-1, event.at.order] : [chapterIndex.get(event.at.chapter)!, event.at.key]);
        return this.book.events.filter((event) => (event.line ?? MAIN) === line).sort((a, b) => {
            const [ca, ka] = rank(a);
            const [cb, kb] = rank(b);
            return ca - cb || ka - kb;
        });
    }

    private lines(): string[] {
        return [MAIN, ...(this.book.forks ?? []).map((fork) => fork.line)];
    }

    /** 两件事按安放是否有先后：同一条线上，且不在互相平行的两章里。 */
    private comparable(a: TimeEvent, b: TimeEvent): boolean {
        if (a.at.kind !== "chapter" || b.at.kind !== "chapter") return true;
        const parallel = (x: string, y: string) => this.book.chapters.some((chapter) => (chapter.id === x && chapter.parallelTo === y) || (chapter.id === y && chapter.parallelTo === x));
        return !parallel(a.at.chapter, b.at.chapter);
    }

    contradictions(): string[] | null {
        return this.network.contradictions();
    }

    /** 安放与时间对不上：按安放 A 在 B 前，时间上 B 一定早于 A。每条线上只和前面最近一件写了时间、可比的事比。 */
    placementMismatches(): string[] {
        const found: string[] = [];
        for (const line of this.lines()) {
            const timed = this.ordered(line).filter((event) => this.timed.has(event.id));
            for (let index = 1; index < timed.length; index += 1) {
                const after = timed[index]!;
                const before = [...timed.slice(0, index)].reverse().find((event) => this.comparable(event, after));
                if (before === undefined) continue;
                if (this.rawWindow({event: after.id, side: "end"})[1] < this.rawWindow({event: before.id})[0]) {
                    const where = before.at.kind === "prehistory" ? "前史的序号" : "安放";
                    found.push(`按${where}“${before.text}”在“${after.text}”之前，但时间上后者一定更早`);
                }
            }
        }
        return found;
    }

    private rawWindow(ref: Ref): [number, number] {
        this.cachedWindows ??= this.network.windows();
        return this.cachedWindows[this.point(ref)]!;
    }

    /** 时间窗：网络算出的范围；推不出的一端用安放上最近的、写了时间的前后邻居补上（只用于查询，补了的标出来）。 */
    window(ref: Ref): [number, number] {
        const event = this.byId.get(ref.event)!;
        const own = this.rawWindow(ref);
        if (Number.isFinite(own[0]) && Number.isFinite(own[1])) return own;
        const list = this.ordered(event.line ?? MAIN);
        const index = list.findIndex((item) => item.id === event.id);
        const previous = list.slice(0, index).reverse().find((item) => this.timed.has(item.id) && this.comparable(item, event));
        const next = list.slice(index + 1).find((item) => this.timed.has(item.id) && this.comparable(item, event));
        // 只补推不出的那一端：两端都推得出的不再用邻居夹（前史的序号本来就是按时间取的，再拿它夹时间是循环论证）。
        const lo = Number.isFinite(own[0]) || previous === undefined ? own[0] : this.rawWindow({event: previous.id})[0];
        const hi = Number.isFinite(own[1]) || next === undefined ? own[1] : this.rawWindow({event: next.id, side: "end"})[1];
        return [lo, hi];
    }

    describe(ref: Ref): string {
        const [lo, hi] = this.window(ref);
        const [rawLo, rawHi] = this.rawWindow(ref);
        return this.book.calendar.formatRange(lo, hi) + (lo > rawLo || hi < rawHi ? "（有一端是按前后邻居补的）" : "");
    }

    /** 范围是哪几条说法定的。 */
    explain(ref: Ref): {lo: string[]; hi: string[]} {
        return this.network.explain(this.point(ref));
    }

    /** 时间窗与 [from, to] 相交的事（可能在这段时间里），以及完全落在里面的（一定在）。 */
    between(from: number, to: number): {possible: TimeEvent[]; certain: TimeEvent[]} {
        const possible: TimeEvent[] = [];
        const certain: TimeEvent[] = [];
        for (const event of this.book.events) {
            const [lo] = this.window({event: event.id});
            const [, hi] = this.window({event: event.id, side: "end"});
            if (hi < from || lo > to) continue;
            possible.push(event);
            if (lo >= from && hi <= to) certain.push(event);
        }
        return {possible, certain};
    }

    /** 两件事相差多久（分钟）。 */
    elapsed(a: Ref, b: Ref): [number, number] {
        return this.network.elapsed(this.point(a), this.point(b));
    }

    /**
     * 某件事发生时某人几岁（按满几年算）。原型里“N 年”的下界按最短的年、上界按最长的年换成分钟，所以这里也按同样的
     * 长度折回去；产品里按历法逐年算。
     */
    age(birth: string, at: Ref): [number, number] {
        const [lo, hi] = this.elapsed({event: birth}, at);
        const [shortest, longest] = this.book.calendar.span({lo: 1, hi: 1, unit: "year"});
        return [Math.floor(lo / shortest), Number.isFinite(hi) ? Math.floor(hi / longest) : Number.POSITIVE_INFINITY];
    }

    meanYear(): number {
        const calendar = this.book.calendar;
        const leap = calendar.def.leap;
        return (calendar.baseYearDays + (leap === undefined ? 0 : leap.extra / leap.every)) * calendar.minutesPerDay;
    }

    /** 某章在某条线上写到的故事时间：这一章在这条线上最后一件事的时间窗。 */
    chapterReach(chapter: string, line = MAIN): string {
        const last = this.ordered(line).filter((event) => event.at.kind === "chapter" && event.at.chapter === chapter).at(-1);
        return last === undefined ? "这一章在这条线上没有事" : this.describe({event: last.id, side: "end"});
    }

    /** 读取位置（某章末尾、某条线）上的状态：父线到切口为止，加上带过去的地址，再加本线。 */
    state(chapter: string, line = MAIN): Record<string, number> {
        const chapterIndex = new Map(this.book.chapters.map((item, index) => [item.id, index]));
        const limit = chapterIndex.get(chapter)!;
        const fold = (events: readonly TimeEvent[], into: Record<string, number>) => {
            for (const event of events) for (const patch of event.patches ?? []) {
                const key = `${patch.entry}.${patch.path}`;
                into[key] = patch.op === "set" ? patch.value : (into[key] ?? 0) + patch.value;
            }
            return into;
        };
        const upTo = (id: string, until: string) => {
            const list = this.lineage(id, limit);
            return list.slice(0, list.findIndex((event) => event.id === until) + 1);
        };
        const fork = (this.book.forks ?? []).find((item) => item.line === line);
        if (fork === undefined) return fold(this.lineage(line, limit), {});
        const state = fold(upTo(fork.parent, fork.cutAfter), {});
        const atTrigger = fold(upTo(fork.parent, fork.trigger), {});
        for (const address of fork.carry ?? []) if (address in atTrigger) state[address] = atTrigger[address]!;
        return fold(this.ordered(line).filter((event) => event.at.kind !== "chapter" || chapterIndex.get(event.at.chapter)! <= limit), state);
    }

    private lineage(line: string, limit: number): TimeEvent[] {
        const chapterIndex = new Map(this.book.chapters.map((item, index) => [item.id, index]));
        return this.ordered(line).filter((event) => event.at.kind !== "chapter" || chapterIndex.get(event.at.chapter)! <= limit);
    }
}
