/**
 * w00039 t32 时间原型：规模。一万件事、每件一到两条说法时，一致性检查、算全部时间窗、按时间查各要多久。运行：bun scale.ts [件数]
 * 形状：事件按讲述排成一串，每件“在上一件之后 0 到 10 天”；每 10 件有一件写了哪一年（每 40 件进一年，一年 360 天，排得下）；另有 5% 的事写“在某件更早的事之后几年”。
 */
import {Calendar} from "./calendar";
import {Timeline, type TimeEvent, type TimeStatement} from "./timeline";

const count = Number(process.argv[2] ?? 10000);
const calendar = new Calendar({name: "艾尔达历", era: "王历", hoursPerDay: 48, minutesPerHour: 60, months: Array.from({length: 10}, (_, index) => ({name: `${index + 1} 月`, days: 36})), leap: {every: 4, month: 10, extra: 1}});
let seed = 7;
const random = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
const events: TimeEvent[] = [];
const statements: TimeStatement[] = [];
for (let index = 0; index < count; index += 1) {
    events.push({id: `e${index}`, text: `事 ${index}`, at: {kind: "prehistory", order: index}});
    if (index > 0) statements.push({event: `e${index}`, kind: "after", ref: {event: `e${index - 1}`}, gap: {lo: 0, hi: 10, unit: "day"}, note: "之后几天"});
    if (index % 10 === 0) statements.push({event: `e${index}`, kind: "on", date: {year: 1 + Math.floor(index / 40)}, note: "某年"});
    if (index > 100 && random() < 0.05) statements.push({event: `e${index}`, kind: "after", ref: {event: `e${index - 1 - Math.floor(random() * 100)}`}, gap: {lo: 0, hi: 5, unit: "year"}, note: "几年后"});
}
const time = (label: string, run: () => unknown) => {
    const started = performance.now();
    const result = run();
    console.log(`${label}：${(performance.now() - started).toFixed(1)} ms`);
    return result;
};
console.log(`${count} 件事，${statements.length} 条说法`);
const timeline = time("建网络", () => new Timeline({calendar, chapters: [], events, statements})) as Timeline;
time("一致性检查", () => timeline.contradictions());
time("算全部时间窗", () => timeline.window({event: "e0"}));
const [from] = calendar.interval({year: 100});
const [, to] = calendar.interval({year: 101});
const found = time("按时间查（王历 100 到 101 年）", () => timeline.between(from, to)) as {possible: unknown[]};
console.log(`  查到 ${found.possible.length} 件`);
time("两件事相差多久", () => timeline.elapsed({event: "e10"}, {event: `e${count - 1}`}));
