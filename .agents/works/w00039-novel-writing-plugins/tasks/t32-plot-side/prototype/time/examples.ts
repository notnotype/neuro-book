/**
 * w00039 t32 时间原型：用例子验证第一版方案。运行：bun examples.ts
 *
 * 例子：
 * 1. 星瑕：只有粗略的说法（六岁那年、十五岁那年、离家那几年），问第 1 章她多大；补一句“她现在 19 岁”后再问。
 * 2. 说法打架：“大灾难那年第一次变身”与“六岁那年大灾难”“十五岁那年变身”。
 * 3. 自定义历法（示意的艾尔达王国：一天 48 小时，十个月各有名字）：王国的历史、一本书的经手，按时间查。
 * 4. Agent 记账时缩小查找范围：正文写“王历 590 年前后”，从四百多件事里筛出候选。
 * 5. 平行视角：第 5、6 章写同一天的两个人。
 * 6. 回溯：第 8 章星瑕把时间倒回早上。
 */

import {Calendar} from "./calendar";
import {Timeline, type Book, type TimeEvent, type TimeStatement} from "./timeline";

const line = (text = "") => console.log(text);
const title = (text: string) => {
    line();
    line(`## ${text}`);
};

// 星瑕用相对历法：历元是开篇那天（第 1 章），之前的显示成“开篇前 N 年”。年、月按公历的长度。
const modern = new Calendar({
    name: "相对公历",
    relative: true,
    hoursPerDay: 24,
    minutesPerHour: 60,
    months: [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31].map((days, index) => ({name: `${index + 1} 月`, days})),
    leap: {every: 4, month: 2, extra: 1},
    dayParts: [{name: "早上", from: 6, to: 11}, {name: "中午", from: 11, to: 14}, {name: "下午", from: 14, to: 18}, {name: "晚上", from: 18, to: 24}],
});

const xingxiaEvents: TimeEvent[] = [
    {id: "p0", text: "星瑕出生", at: {kind: "prehistory", order: 0}},
    {id: "p1", text: "城市大灾难，父母失踪", at: {kind: "prehistory", order: 1}},
    {id: "p2", text: "第一次变身", at: {kind: "prehistory", order: 2}},
    {id: "p3", text: "被软禁，靠彗的魔偶逃脱", at: {kind: "prehistory", order: 3}},
    {id: "p4", text: "离家", at: {kind: "prehistory", order: 4}, interval: true},
    {id: "c1", text: "回家后的第一顿早餐", at: {kind: "chapter", chapter: "ch1", key: 10}},
    {id: "c2", text: "订草莓蛋糕", at: {kind: "chapter", chapter: "ch2", key: 20}},
];
const xingxiaStatements: TimeStatement[] = [
    {event: "p1", kind: "age", birth: "p0", years: 6, note: "六岁那年"},
    {event: "p2", kind: "age", birth: "p0", years: 15, note: "十五岁那年"},
    {event: "p3", kind: "after", ref: {event: "p2"}, gap: {lo: 0, hi: 2, unit: "year"}, note: "觉醒后不久（两年内）"},
    {event: "p4", kind: "after", ref: {event: "p3"}, gap: {lo: 0, hi: 1, unit: "year"}, note: "逃出来以后一年内离家"},
    {event: "p4", kind: "lasts", duration: "几年", note: "“你走的那几年”"},
    {event: "c1", kind: "after", ref: {event: "p4", side: "end"}, gap: {lo: 0, hi: 30, unit: "day"}, note: "刚回家（一个月内）"},
    {event: "c1", kind: "on", date: {year: 1, month: 1, day: 1, part: "早上"}, note: "开篇那天早上"},
    {event: "c2", kind: "on", date: {year: 1, month: 1, day: 2}, note: "第二天"},
];
// 模糊词表：作品级，所有 Agent 用同一份。
const vague = {几年: {lo: 2, hi: 9, unit: "year"}, 几天: {lo: 2, hi: 9, unit: "day"}, 不久: {lo: 0, hi: 1, unit: "month"}} as const;
const xingxia = (extra: TimeStatement[] = []): Book => ({calendar: modern, vague, chapters: [{id: "ch1", title: "第 1 章"}, {id: "ch2", title: "第 2 章"}], events: xingxiaEvents, statements: [...xingxiaStatements, ...extra]});

title("1. 星瑕：粗略的说法能推出什么");
{
    const timeline = new Timeline(xingxia());
    line(`矛盾：${timeline.contradictions() ?? "没有"}；安放与时间对不上：${timeline.placementMismatches().join("；") || "没有"}`);
    for (const event of xingxiaEvents) line(`- ${event.text}：${timeline.describe({event: event.id})}`);
    const [lo, hi] = timeline.age("p0", {event: "c1"});
    line(`第 1 章她多大：${lo} 到 ${hi} 岁`);
    const [awayLo, awayHi] = timeline.elapsed({event: "p1"}, {event: "c1"});
    line(`大灾难到开篇隔了：${(awayLo / timeline.meanYear()).toFixed(1)} 到 ${(awayHi / timeline.meanYear()).toFixed(1)} 年`);
    const found = timeline.between(...modern.interval({year: -9}).map((value, index) => (index === 0 ? value : value + modern.span({lo: 4, hi: 4, unit: "year"})[1])) as [number, number]);
    line(`开篇前 10 年到前 5 年之间可能发生的：${found.possible.map((event) => event.text).join("、") || "无"}；一定在这段里的：${found.certain.map((event) => event.text).join("、") || "无"}`);

    const refined = new Timeline(xingxia([{event: "c1", kind: "age", birth: "p0", years: 19, note: "正文：“她今年十九”"}]));
    const [rlo, rhi] = refined.age("p0", {event: "c1"});
    line(`补一句“她今年十九”以后：第 1 章 ${rlo} 到 ${rhi} 岁；离家的开始收窄到“${refined.describe({event: "p4"})}”，结束在“${refined.describe({event: "p4", side: "end"})}”`);
    const [dlo, dhi] = refined.elapsed({event: "p4"}, {event: "p4", side: "end"});
    line(`“那几年”收窄成：${(dlo / refined.meanYear()).toFixed(1)} 到 ${(dhi / refined.meanYear()).toFixed(1)} 年`);
    const why = refined.explain({event: "p0"});
    line(`出生时间为什么是“${refined.describe({event: "p0"})}”：最早由 ${why.lo.join(" → ")} 定；最晚由 ${why.hi.join(" → ")} 定`);
}

title("2. 说法打架");
{
    const timeline = new Timeline(xingxia([{event: "p2", kind: "after", ref: {event: "p1"}, gap: {lo: 0, hi: 1, unit: "year"}, note: "大灾难那年第一次变身"}]));
    const found = timeline.contradictions();
    line(found === null ? "没有发现矛盾（不对）" : `时间对不上，打架的是：\n${found.map((label) => `  - ${label}`).join("\n")}`);
}

// 示意的艾尔达王国：一天 48 小时，十个月各有名字，每 4 年夜月多一天；纪年“王历”。
const elda = new Calendar({
    name: "艾尔达历",
    era: "王历",
    hoursPerDay: 48,
    minutesPerHour: 60,
    months: ["霜月", "雪月", "冰融月", "花月", "雨月", "炎月", "金月", "收获月", "枯月", "夜月"].map((name, index) => ({name, days: index === 9 ? 37 : 36})),
    leap: {every: 4, month: 10, extra: 1},
    dayParts: [{name: "黎明", from: 0, to: 8}, {name: "上午", from: 8, to: 20}, {name: "午后", from: 20, to: 32}, {name: "黄昏", from: 32, to: 40}, {name: "夜", from: 40, to: 48}],
});

const kingdomEvents: TimeEvent[] = [
    // 前史的序号在写入时按时间取（产品里由写入工具按范围在邻居之间取一个数），之后改了时间不自动重排，由检查报出来。
    {id: "k1", text: "艾尔达建国", at: {kind: "prehistory", order: 10}},
    {id: "k2", text: "第一次北境战争", at: {kind: "prehistory", order: 1200}, interval: true},
    {id: "k3", text: "学者写成《旧城年鉴》", at: {kind: "prehistory", order: 3000}},
    {id: "k4", text: "《旧城年鉴》被教会列为禁书", at: {kind: "prehistory", order: 3200}},
    {id: "k5", text: "大灾难", at: {kind: "prehistory", order: 5900}},
    {id: "k6", text: "王室成立“部门”", at: {kind: "prehistory", order: 5950}},
    {id: "s1", text: "勇者在旧书店买下《旧城年鉴》", at: {kind: "chapter", chapter: "ch1", key: 10}},
    {id: "s2", text: "国王与贤者谈勇者的特征", at: {kind: "chapter", chapter: "ch3", key: 10}},
];
const kingdomStatements: TimeStatement[] = [
    {event: "k1", kind: "on", date: {year: 1}, note: "王历元年"},
    {event: "k2", kind: "on", date: {year: 120, month: 4}, note: "王历 120 年花月开战"},
    {event: "k2", kind: "lasts", duration: {lo: 3, hi: 5, unit: "year"}, note: "打了三到五年"},
    {event: "k3", kind: "before", ref: {event: "s1"}, gap: {lo: 280, hi: 320, unit: "year"}, note: "约三百年前"},
    {event: "k4", kind: "after", ref: {event: "k3"}, gap: {lo: 0, hi: 50, unit: "year"}, note: "写成后几十年内被禁"},
    {event: "k5", kind: "on", date: {year: 590}, note: "王历 590 年"},
    {event: "k6", kind: "after", ref: {event: "k5"}, gap: {lo: 1, hi: 9, unit: "year"}, note: "大灾难之后几年"},
    {event: "s1", kind: "on", date: {year: 612, month: 1, day: 3, part: "午后"}, note: "王历 612 年霜月 3 日午后"},
    {event: "s2", kind: "after", ref: {event: "s1"}, gap: {lo: 3, hi: 3, unit: "day"}, note: "三天后"},
];
// Agent 抽取时的背景：王国历史上另外四百件事，每件只知道在哪一年（年份均匀铺开）。
const fillerYear = (index: number) => 1 + Math.floor((index * 611) / 420);
const filler: TimeEvent[] = Array.from({length: 420}, (_, index) => ({id: `h${index}`, text: `史事 ${index}`, at: {kind: "prehistory", order: fillerYear(index) * 10 + 1}}));
const fillerStatements: TimeStatement[] = filler.map((event, index) => ({event: event.id, kind: "on", date: {year: fillerYear(index)}, note: `王历 ${fillerYear(index)} 年`}));

title("3. 自定义历法：艾尔达王国（示意）");
{
    const timeline = new Timeline({calendar: elda, chapters: [{id: "ch1", title: "第 1 章"}, {id: "ch3", title: "第 3 章"}], events: kingdomEvents, statements: kingdomStatements});
    line(`矛盾：${timeline.contradictions() ?? "没有"}；安放与时间对不上：${timeline.placementMismatches().join("；") || "没有"}`);
    for (const event of kingdomEvents) line(`- ${event.text}：${timeline.describe({event: event.id})}${event.interval ? `，止于 ${timeline.describe({event: event.id, side: "end"})}` : ""}`);
    const [lo, hi] = timeline.elapsed({event: "k1"}, {event: "k3"});
    line(`《旧城年鉴》写成时王国建国：${Math.floor(lo / timeline.meanYear())} 到 ${Math.floor(hi / timeline.meanYear())} 年`);
    const [dlo] = timeline.elapsed({event: "s1"}, {event: "s2"});
    line(`买书到国王与贤者的谈话：${dlo / elda.minutesPerDay} 天（一天 ${elda.def.hoursPerDay} 小时）`);
}

title("4. Agent 记账时缩小查找范围");
{
    const timeline = new Timeline({calendar: elda, chapters: [{id: "ch1", title: "第 1 章"}, {id: "ch3", title: "第 3 章"}], events: [...kingdomEvents, ...filler], statements: [...kingdomStatements, ...fillerStatements]});
    const [from] = elda.interval({year: 589});
    const [, to] = elda.interval({year: 592});
    const found = timeline.between(from, to);
    line(`安放与时间对不上：${timeline.placementMismatches().length} 处`);
    line(`王国历史上共 ${kingdomEvents.length + filler.length} 件事。正文写“王历 590 年前后”，按 589 到 592 年查：可能相关 ${found.possible.length} 件（${found.possible.slice(0, 6).map((event) => event.text).join("、")}……），一定在这段里的 ${found.certain.length} 件`);
}

title("5. 平行视角：第 5、6 章写同一天的两个人");
{
    const events: TimeEvent[] = [
        {id: "c51", text: "她早上出门", at: {kind: "chapter", chapter: "ch5", key: 10}},
        {id: "c52", text: "她中午在银行取钱", at: {kind: "chapter", chapter: "ch5", key: 20}},
        {id: "c61", text: "他早上在公司接到电话", at: {kind: "chapter", chapter: "ch6", key: 10}},
        {id: "c71", text: "两人晚上见面", at: {kind: "chapter", chapter: "ch7", key: 10}},
    ];
    const statements: TimeStatement[] = [
        {event: "c51", kind: "on", date: {year: 1, month: 1, day: 10, part: "早上"}, note: "第 10 天早上"},
        {event: "c52", kind: "on", date: {year: 1, month: 1, day: 10, part: "中午"}, note: "当天中午"},
        {event: "c61", kind: "on", date: {year: 1, month: 1, day: 10, part: "早上"}, note: "同一天早上"},
        {event: "c71", kind: "on", date: {year: 1, month: 1, day: 10, part: "晚上"}, note: "当天晚上"},
    ];
    const chapters = (parallel: boolean) => [{id: "ch5", title: "第 5 章"}, {id: "ch6", title: "第 6 章", ...(parallel ? {parallelTo: "ch5"} : {})}, {id: "ch7", title: "第 7 章"}];
    const plain = new Timeline({calendar: modern, chapters: chapters(false), events, statements});
    line(`不标平行：说法之间${plain.contradictions() === null ? "没有矛盾" : "有矛盾"}；安放与时间对不上：${plain.placementMismatches().join("；") || "没有"}`);
    const marked = new Timeline({calendar: modern, chapters: chapters(true), events, statements});
    line(`第 6 章标成与第 5 章平行：安放与时间对不上：${marked.placementMismatches().join("；") || "没有"}；第 5 章写到 ${marked.chapterReach("ch5")}，第 6 章写到 ${marked.chapterReach("ch6")}`);
}

title("6. 回溯：第 8 章星瑕把时间倒回约 6 小时以前");
{
    const events: TimeEvent[] = [
        {id: "c81", text: "早上出门", at: {kind: "chapter", chapter: "ch8", key: 10}, patches: [{entry: "星瑕", path: "存款", op: "set", value: 20000}, {entry: "星瑕", path: "回溯次数", op: "set", value: 1}]},
        {id: "c82", text: "中午买了包", at: {kind: "chapter", chapter: "ch8", key: 20}, patches: [{entry: "星瑕", path: "存款", op: "add", value: -5000}]},
        {id: "c83", text: "下午出了事，她决定回溯", at: {kind: "chapter", chapter: "ch8", key: 30}, patches: [{entry: "星瑕", path: "知道下午会出事", op: "set", value: 1}]},
        {id: "c84", text: "回到早上，回溯次数用掉一次", at: {kind: "chapter", chapter: "ch8", key: 40}, line: "r1", patches: [{entry: "星瑕", path: "回溯次数", op: "add", value: -1}]},
        {id: "c85", text: "这次没买包，中午去找妹妹", at: {kind: "chapter", chapter: "ch8", key: 50}, line: "r1"},
    ];
    const statements: TimeStatement[] = [
        {event: "c81", kind: "on", date: {year: 1, month: 1, day: 30, part: "早上"}, note: "第 30 天早上"},
        {event: "c82", kind: "on", date: {year: 1, month: 1, day: 30, part: "中午"}, note: "中午"},
        {event: "c83", kind: "on", date: {year: 1, month: 1, day: 30, part: "下午"}, note: "下午"},
        {event: "c85", kind: "on", date: {year: 1, month: 1, day: 30, part: "中午"}, note: "（这条线上的）中午"},
    ];
    const fork = {line: "r1", label: "第一次回溯", mode: "rewind", parent: "main", cutAfter: "c81", trigger: "c83", back: {lo: 5, hi: 7, unit: "hour"}, carry: ["星瑕.知道下午会出事"]} as const;
    const book: Book = {calendar: modern, chapters: [{id: "ch8", title: "第 8 章"}], forks: [fork], events, statements};
    const timeline = new Timeline(book);
    line(`矛盾：${timeline.contradictions() ?? "没有"}；安放与时间对不上：${timeline.placementMismatches().join("；") || "没有"}（回溯后的中午早于原来的下午，但不在同一条线上）`);
    line(`- 回到的那一刻：${timeline.describe({event: "c84"})}`);
    line(`第 8 章末尾，原来那条线：${JSON.stringify(timeline.state("ch8", "main"))}，写到 ${timeline.chapterReach("ch8", "main")}`);
    line(`第 8 章末尾，回溯后的线：${JSON.stringify(timeline.state("ch8", "r1"))}，写到 ${timeline.chapterReach("ch8", "r1")}`);
    const oneLine = new Timeline({...book, forks: undefined, events: events.map((event) => ({...event, line: undefined}))});
    line(`如果不分线、全放在一条线上：安放与时间对不上：${oneLine.placementMismatches().join("；") || "没有"}`);
}
