/**
 * w00039 t09：量“修订日志是一个 JSONL 文件”在百万字规模下的大小与打开耗时。
 *
 * 不是实现：按 t16 原型（r3/model.ts）的对象形状造一份模拟日志，每章三次修订（细纲提计划、记账、作者改一处），
 * 量文件大小、读入并逐行解析、重放成当前对象、对一个常出场的条目做一次朴素折叠、追加一行并 fsync 的耗时。
 * 每章的条数取偏多的估计（记账 15 条情节、2 个核对点、半个新条目、3 处重述链接），比 t16 原型第 2 章多一倍左右。
 *
 * 用法：bun log-scale.ts <章数> [<章数> …]；日志写在系统临时目录，跑完删除。
 */
import {appendFileSync, closeSync, fsyncSync, mkdtempSync, openSync, readFileSync, rmSync, statSync, writeSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";

const QUOTE = "她订了一个草莓蛋糕，店员问要不要写字，她想了半天，写了“给星瑾”。";
const TEXT = "订了星瑾小时候最喜欢的那家店的草莓蛋糕，写了“给星瑾”";
const BLOCK = "星瑕平时戴着滤镜，看起来是个普通的高中男生。".repeat(5);
const ACTOR = {kind: "agent", session: "写作助手 · 星瑕"};

// 量 Git 与压缩时文字不能全是同一句（压缩率高得不真实）：设了 TEXT_POOL（一行一段的原文）就轮流取句子填文字字段。
const POOL = process.env.TEXT_POOL === undefined ? null : readFileSync(process.env.TEXT_POOL, "utf8").split("\n").filter((l) => l.trim().length >= 8);
let poolAt = 0;
function say(fallback: string, max = 60): string {
    return POOL === null ? fallback : POOL[poolAt++ % POOL.length]!.slice(0, max);
}

let entrySeq = 0;
let changeSeq = 0;
let checkSeq = 0;

function entry(chapter: string) {
    const id = `e${++entrySeq}`;
    return {
        id, type: "人物", parent: null, folder: "人物", order: entrySeq, appears: {kind: "chapter", chapter, key: 10},
        init: {
            name: `人物${entrySeq}`, aliases: ["别名甲", "别名乙"], summary: say("一句话描述，二三十个字左右的样子。", 30),
            text: [{id: "b1", source: say(BLOCK, 120)}, {id: "b2", source: say(BLOCK, 120)}, {id: "b3", source: say(BLOCK, 120)}],
            data: {character: {enabled: true, fields: {外观: "银白长发及腰，浅灰蓝的眼睛，个子娇小", 性格: "嘴硬心软"}}, panel: {enabled: true, fields: {存款: 40000, 魔力: 3200}}},
        },
        initBasis: {"panel.存款": {kind: "quote", quote: "卡里还有四万"}},
    };
}

function change(kind: "written" | "plan", chapter: string, key: number, entries: string[], plan?: string) {
    const id = `c${++changeSeq}`;
    return {
        id, kind, text: say(TEXT, 40), at: kind === "plan" ? {kind: "chapter", chapter, key} : {kind: "chapter", chapter, key},
        told: kind === "plan" ? [{source: "outline", chapter, quote: say(TEXT, 40)}] : [{source: "chapter", chapter, quote: say(QUOTE)}],
        involves: entries, lines: ["line-brother"], links: plan === undefined ? [] : [{kind: "fulfills", plan}],
        patches: [
            {op: "add", at: {entry: entries[0], path: "panel.存款"}, value: -300, basis: {kind: "quote", quote: say("存进两万联邦币", 20)}},
            {op: "set", at: {entry: entries[0], path: "character.样子"}, value: "哥哥", basis: {kind: "quote", quote: say("哥哥的样子回来了", 20)}},
        ],
        status: "active", by: ACTOR,
    };
}

function impact(chapter: string) {
    return {where: `${chapter} 末尾`, resolved: [], added: ["待处理：核对点不符"], values: [{label: "星瑕 存款", before: "41800", after: "21500"}]};
}

/** 一章的三次修订。`hot` 是常出场的条目，每章都涉及。 */
function chapterRevisions(n: number, version: number, hot: string[]) {
    const chapter = `ch${n}`;
    const revisions: unknown[] = [];
    const plans = Array.from({length: 5}, (_, i) => change("plan", chapter, i * 10, [hot[i % hot.length]!]));
    revisions.push({
        id: `r${version}`, version, by: ACTOR, what: "plan", title: `第 ${n} 章细纲：提了 5 个计划`, chapter,
        ops: plans.map((p) => ({ref: {kind: "change", id: p.id}, kind: "create", after: p})), impact: impact(chapter),
    });
    const ops: unknown[] = [];
    if (n % 2 === 0) {
        const e = entry(chapter);
        ops.push({ref: {kind: "entry", id: e.id}, kind: "create", after: e});
    }
    for (let i = 0; i < 15; i++) {
        const c = change("written", chapter, i * 10, [hot[i % hot.length]!, hot[(i + 1) % hot.length]!], i < 4 ? plans[i]!.id : undefined);
        ops.push({ref: {kind: "change", id: c.id}, kind: "create", after: c});
    }
    for (let i = 0; i < 2; i++) {
        const id = `k${++checkSeq}`;
        ops.push({ref: {kind: "check", id}, kind: "create", after: {id, at: {entry: hot[0], path: "panel.存款"}, value: 21500, told: {source: "chapter", chapter, quote: QUOTE}, place: {kind: "chapter", chapter, key: 55}}});
    }
    for (let i = 0; i < 3; i++) {
        ops.push({ref: {kind: "entry", id: hot[i % hot.length]}, kind: "modify", fields: [{path: "initTold.character.外观", before: [], after: [{source: "chapter", chapter, quote: QUOTE}]}]});
    }
    revisions.push({
        id: `r${version + 1}`, version: version + 1, by: ACTOR, what: "bookkeeping", title: `第 ${n} 章记账：记了 15 条情节，兑现 4 个计划`, chapter,
        ops, notes: {notCreated: ["街角的蛋糕店：没有名字，以后再出现可以建"]}, impact: impact(chapter),
    });
    revisions.push({
        id: `r${version + 2}`, version: version + 2, by: {kind: "author"}, what: "edit", title: "改了星瑕的存款", chapter,
        ops: [{ref: {kind: "entry", id: hot[0]}, kind: "modify", fields: [{path: "init.data.panel.fields.存款", before: 40000, after: 41800}]}], impact: impact(chapter),
    });
    return revisions;
}

function ms(start: number) {
    return (performance.now() - start).toFixed(1);
}

function run(chapters: number) {
    entrySeq = changeSeq = checkSeq = 0;
    const dir = mkdtempSync(join(tmpdir(), "t09-log-"));
    const path = join(dir, "log.jsonl");
    // 开局：Agent 读故事种子建的 20 个条目，前 5 个是常出场的。
    const opening = Array.from({length: 20}, () => entry("ch1"));
    const hot = opening.slice(0, 5).map((e) => e.id);
    const lines = [JSON.stringify({id: "r1", version: 1, by: ACTOR, what: "opening", title: "读故事种子", ops: opening.map((e) => ({ref: {kind: "entry", id: e.id}, kind: "create", after: e})), impact: impact("初值")})];
    let version = 2;
    for (let n = 1; n <= chapters; n++) {
        for (const r of chapterRevisions(n, version, hot)) lines.push(JSON.stringify(r));
        version += 3;
    }
    appendFileSync(path, `${lines.join("\n")}\n`);
    const size = statSync(path).size;

    // 打开：读入、逐行解析、按 ops 重放成当前对象。
    let start = performance.now();
    const raw = require("node:fs").readFileSync(path, "utf8") as string;
    const readMs = ms(start);
    start = performance.now();
    const parsed = raw.split("\n").filter((l) => l.length > 0).map((l) => JSON.parse(l) as {ops: Array<{ref: {kind: string; id: string}; kind: string; after?: unknown; fields?: Array<{path: string; after: unknown}>}>});
    const parseMs = ms(start);
    start = performance.now();
    const objects = new Map<string, unknown>();
    for (const r of parsed) {
        for (const op of r.ops) {
            const key = `${op.ref.kind}:${op.ref.id}`;
            if (op.kind === "create") objects.set(key, op.after);
            else if (op.kind === "delete") objects.delete(key);
            else objects.set(key, {...(objects.get(key) as object), [`modified:${op.fields![0]!.path}`]: op.fields![0]!.after});
        }
    }
    const replayMs = ms(start);

    // 朴素折叠：最常出场的条目，在最后一章末尾的存款。
    start = performance.now();
    let money = 40000;
    let applied = 0;
    for (const [key, value] of objects) {
        if (!key.startsWith("change:")) continue;
        const c = value as {kind: string; involves: string[]; patches: Array<{op: string; at: {entry: string; path: string}; value: number}>};
        if (c.kind !== "written" || !c.involves.includes(hot[0]!)) continue;
        for (const p of c.patches) {
            if (p.at.entry === hot[0] && p.at.path === "panel.存款" && p.op === "add") {
                money += p.value;
                applied++;
            }
        }
    }
    const foldMs = ms(start);

    // 追加一次修订并 fsync，取 20 次的中位数。
    const sample = lines[lines.length - 2]!;
    const appendTimes: number[] = [];
    for (let i = 0; i < 20; i++) {
        const t = performance.now();
        const fd = openSync(path, "a");
        writeSync(fd, `${sample}\n`);
        fsyncSync(fd);
        closeSync(fd);
        appendTimes.push(performance.now() - t);
    }
    appendTimes.sort((a, b) => a - b);

    const counts = {entry: 0, change: 0, check: 0};
    for (const key of objects.keys()) counts[key.split(":")[0] as keyof typeof counts]++;
    console.log(
        `${chapters} 章（约 ${(chapters * 3000 / 10000).toFixed(0)} 万字）：修订 ${parsed.length} 次，条目 ${counts.entry}、剧情变更 ${counts.change}、核对点 ${counts.check}；` +
            `日志 ${(size / 1024 / 1024).toFixed(1)} MB；读入 ${readMs} ms，逐行解析 ${parseMs} ms，重放 ${replayMs} ms；` +
            `朴素折叠一个字段 ${foldMs} ms（套了 ${applied} 笔，结果 ${money}）；追加一次并 fsync 中位 ${appendTimes[10]!.toFixed(2)} ms`,
    );
    // 量 Git 增长（evidences/disk-growth.txt）要用到日志本身：设了 KEEP_LOG 就先复制出去。追加测量多写的 20 行不复制。
    if (process.env.KEEP_LOG !== undefined) appendFileSync(process.env.KEEP_LOG, `${lines.join("\n")}\n`);
    rmSync(dir, {recursive: true});
}

for (const arg of process.argv.slice(2)) run(Number(arg));
