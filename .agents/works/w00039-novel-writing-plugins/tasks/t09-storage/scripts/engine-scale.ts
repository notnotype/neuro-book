/**
 * w00039 t09：量 t16 原型引擎（草稿分支 t16/drafts 的 world-engine/engine.ts）在百万字规模下，作者与 Agent 常做的几件事要多久、
 * 世界放在内存里占多少。log-scale.ts 只量了“读日志、重放成对象”；这里量重放之后的计算：
 *
 * - 折叠：某个位置上全部条目的样子（作者翻到第 N 章、Agent 每次读、渲染都要先折叠）；
 * - 待处理：在写到的位置折叠一次再收集；
 * - 文件视图：折叠一次，再把每个条目的主 MDX 按带值写法渲染出来（“lorebook 是渲染出来的视图”要付的代价）；
 * - 发布一次记账（15 条情节、2 个核对点）：原型里是复制整个世界、套上修改、发布前后各算一次待处理（“带来的变化”）。
 *
 * 两种引擎各量一遍：“原型原样”，和只改一处的“章序查表”（原型每次比较位置都在章列表里线性找第几章，改成查表）。
 * 每个规模、每种引擎在单独的子进程里跑，内存不受前一组影响。
 *
 * 模拟数据的形状与 log-scale.ts 相同（每章 5 个计划、15 条情节、2 个核对点、半个新条目），另加：语义档的“态度”每三条情节记一句、
 * 每 10 章由正文写明一次；每 50 章有一个核对点对不上、每 30 章有一条与设定冲突的待定变更。章节正文不放进世界（产品里正文是文件）。
 *
 * 用法（仓库根执行）：bun <本文件> <章数> [<章数> …]；引擎路径默认取草稿 worktree，可用环境变量 ENGINE 指定 engine.ts。
 */
import {spawnSync} from "node:child_process";
import {copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from "node:fs";
import {cpus, tmpdir} from "node:os";
import {dirname, join, resolve} from "node:path";

const ENGINE = resolve(process.env.ENGINE ?? ".worktree/w00039-t16-drafts/packages/neuro-book/src/plugins/drafts/web/components/world-engine/engine.ts");

/* ---------- 子进程：量一个规模、一种引擎 ---------- */

type AnyWorld = Record<string, any>;

const ACTOR = {kind: "agent", session: "写作助手 · 星瑕"};
const BLOCK = "星瑕平时戴着滤镜，看起来是个普通的高中男生。存款还剩 {panel.存款}，魔力 {panel.魔力}。".repeat(3);
const TEXT = "订了星瑾小时候最喜欢的那家店的草莓蛋糕，写了“给星瑾”";
const QUOTE = "她订了一个草莓蛋糕，店员问要不要写字，她想了半天，写了“给星瑾”。";

const componentTypes = [
    {ns: "character", label: "人物", version: 1, fields: [
        {id: "外观", label: "外观", kind: "text", retold: true},
        {id: "样子", label: "现在的样子", kind: "text"},
        {id: "态度", label: "现在的态度", kind: "text", precision: "semantic"},
    ]},
    {ns: "panel", label: "面板", version: 1, fields: [
        {id: "存款", label: "存款", kind: "number", min: 0, precision: "exact"},
        {id: "魔力", label: "魔力", kind: "number", min: 0, precision: "exact"},
    ]},
];

function buildWorld(chapterCount: number): {world: AnyWorld; draft: unknown; hot: string[]} {
    const chapters = Array.from({length: chapterCount}, (_, i) => ({id: `ch${i + 1}`, title: `第 ${i + 1} 章`, outline: "", text: "（正文在文件里）"}));
    const world: AnyWorld = {version: 0, componentTypes, chapters, entries: {}, changes: {}, checks: {}, questions: {}, suggestions: {}, revisions: [], reductions: {}};
    let entrySeq = 0;
    let changeSeq = 0;
    let checkSeq = 0;
    const revision = (what: string, title: string, chapter: string | undefined, ops: unknown[], by: unknown = ACTOR) => {
        world.version += 1;
        // 日志里的修订与当前对象是两份数据（从文件读进来时就是两份），所以这里断开引用。
        world.revisions.push(JSON.parse(JSON.stringify({id: `r${world.version}`, version: world.version, by, what, title, chapter, ops,
            impact: {where: `${chapter ?? "初值"} 末尾`, resolved: [], added: [], values: [{label: "星瑕 存款", before: "41800", after: "41500"}]}})));
    };
    const newEntry = (chapter: string | undefined) => {
        const id = `e${++entrySeq}`;
        const entry = {
            id, type: "人物", parent: null, folder: "人物", order: entrySeq,
            ...(chapter === undefined ? {} : {appears: {kind: "chapter", chapter, key: 10}}),
            init: {
                name: `人物${entrySeq}`, aliases: ["别名甲", "别名乙"], summary: "一句话描述，二三十个字左右的样子。",
                text: [{id: "b1", source: BLOCK}, {id: "b2", source: BLOCK}, {id: "b3", source: BLOCK}],
                data: {
                    character: {enabled: true, fields: {外观: "银白长发及腰，浅灰蓝的眼睛，个子娇小", 样子: "哥哥", 态度: "冷淡"}},
                    panel: {enabled: true, fields: {存款: 40000, 魔力: 3200}},
                },
            },
            initBasis: {"panel.存款": {kind: "quote", quote: "卡里还有四万"}},
            initTold: {"character.外观": [{source: "chapter", chapter: "ch1", quote: QUOTE}]},
        };
        world.entries[id] = entry;
        return entry;
    };
    const change = (kind: "written" | "plan", chapter: string, key: number, involves: string[], patches: unknown[], links: unknown[] = [], status = "active") => {
        const id = `c${++changeSeq}`;
        const value = {
            id, kind, text: TEXT, at: {kind: "chapter", chapter, key},
            told: [{source: kind === "plan" ? "outline" : "chapter", chapter, quote: kind === "plan" ? TEXT : QUOTE}],
            involves, lines: [], links, patches, status, by: ACTOR,
            ...(status === "held" ? {held: {reason: "conflict", note: "设定是金色眼眸，正文写了碧色", against: {entry: involves[0], path: "character.外观"}}} : {}),
        };
        world.changes[id] = value;
        return value;
    };

    const opening = Array.from({length: 20}, () => newEntry(undefined));
    revision("opening", "读故事种子", undefined, opening.map((e) => ({ref: {kind: "entry", id: e.id}, kind: "create", after: e})));
    const hot = opening.slice(0, 5).map((e) => e.id);
    const money = new Map(hot.map((id) => [id, 40000]));

    for (let n = 1; n <= chapterCount; n++) {
        const chapter = `ch${n}`;
        const plans = Array.from({length: 5}, (_, i) =>
            change("plan", chapter, i * 10, [hot[i % 5]!], [{op: "add", at: {entry: hot[i % 5], path: "panel.魔力"}, value: -10}]));
        revision("plan", `第 ${n} 章细纲`, chapter, plans.map((p) => ({ref: {kind: "change", id: p.id}, kind: "create", after: p})));

        const ops: unknown[] = [];
        if (n % 2 === 0) {
            const e = newEntry(chapter);
            ops.push({ref: {kind: "entry", id: e.id}, kind: "create", after: e});
        }
        const checkAt = [55, 155];
        let nextCheck = 0;
        const addCheck = () => {
            const id = `k${++checkSeq}`;
            const off = nextCheck === 1 && n % 50 === 0 ? 100 : 0; // 每 50 章一个核对点对不上
            const value = {id, at: {entry: hot[0], path: "panel.存款"}, value: money.get(hot[0]!)! + off, told: {source: "chapter", chapter, quote: QUOTE}, place: {kind: "chapter", chapter, key: checkAt[nextCheck]}};
            world.checks[id] = value;
            ops.push({ref: {kind: "check", id}, kind: "create", after: value});
            nextCheck++;
        };
        for (let i = 0; i < 15; i++) {
            if (nextCheck === 0 && i * 10 > checkAt[0]!) addCheck();
            const subject = hot[i % 5]!;
            const delta = (i + n) % 2 === 0 ? -300 : 300;
            money.set(subject, money.get(subject)! + delta);
            const patches: unknown[] = [
                {op: "add", at: {entry: subject, path: "panel.存款"}, value: delta, basis: {kind: "quote", quote: "存进两万联邦币"}},
                {op: "set", at: {entry: subject, path: "character.样子"}, value: i % 2 === 0 ? "哥哥" : "妹妹", basis: {kind: "quote", quote: "哥哥的样子回来了"}},
            ];
            if (i % 3 === 0) patches.push({op: n % 10 === 0 && i === 0 ? "set" : "note", at: {entry: subject, path: "character.态度"}, value: `第 ${n} 章：对哥哥的态度软了一点`});
            const status = n % 30 === 0 && i === 14 ? "held" : "active";
            const c = change("written", chapter, i * 10, [subject, hot[(i + 1) % 5]!], patches, i < 4 ? [{kind: "fulfills", plan: plans[i]!.id}] : [], status);
            ops.push({ref: {kind: "change", id: c.id}, kind: "create", after: c});
        }
        addCheck();
        for (let i = 0; i < 3; i++) {
            ops.push({ref: {kind: "entry", id: hot[i]}, kind: "modify", fields: [{path: "initTold.character.外观", before: [], after: [{source: "chapter", chapter, quote: QUOTE}]}]});
        }
        revision("bookkeeping", `第 ${n} 章记账`, chapter, ops);
        revision("edit", "改了星瑕的外观", chapter, [{ref: {kind: "entry", id: hot[0]}, kind: "modify", fields: [{path: "init.data.character.fields.外观", before: "银白长发", after: "银白长发及腰"}]}], {kind: "author"});
    }

    // 要量的那次发布：最后一章补记 15 条情节和 2 个核对点。
    const last = `ch${chapterCount}`;
    const puts: unknown[] = [];
    for (let i = 0; i < 15; i++) {
        const id = `new-c${i}`;
        puts.push({ref: {kind: "change", id}, after: {
            id, kind: "written", text: TEXT, at: {kind: "chapter", chapter: last, key: 200 + i}, told: [{source: "chapter", chapter: last, quote: QUOTE}],
            involves: [hot[i % 5]], lines: [], links: [], status: "active", by: ACTOR,
            patches: [{op: "add", at: {entry: hot[i % 5], path: "panel.存款"}, value: i % 2 === 0 ? -100 : 100, basis: {kind: "quote", quote: "又花了一百"}}],
        }});
    }
    for (let i = 0; i < 2; i++) {
        const id = `new-k${i}`;
        puts.push({ref: {kind: "check", id}, after: {id, at: {entry: hot[0], path: "panel.存款"}, value: 0, told: {source: "chapter", chapter: last, quote: QUOTE}, place: {kind: "chapter", chapter: last, key: 300 + i}}});
    }
    const draft = {by: ACTOR, what: "bookkeeping", title: `第 ${chapterCount} 章补记`, chapter: last, puts};
    return {world, draft, hot};
}

function median(samples: number[]): number {
    const sorted = [...samples].sort((a, b) => a - b);
    return sorted[Math.floor(sorted.length / 2)]!;
}

function time(runs: number, work: () => void): number {
    const samples: number[] = [];
    for (let i = 0; i < runs; i++) {
        const start = performance.now();
        work();
        samples.push(performance.now() - start);
    }
    return median(samples);
}

async function child(chapterCount: number, enginePath: string, label: string) {
    const engine = await import(enginePath);
    Bun.gc(true);
    const heapBefore = process.memoryUsage().heapUsed;
    const {world, draft, hot} = buildWorld(chapterCount);
    Bun.gc(true);
    const heapAfter = process.memoryUsage().heapUsed;
    const revisionBytes = world.revisions.reduce((sum: number, r: unknown) => sum + JSON.stringify(r).length, 0);

    const end = engine.currentPosition(world);
    const mid = {kind: "chapter", chapter: `ch${Math.ceil(chapterCount / 2)}`, edge: "start"};
    const runs = chapterCount >= 1000 ? 3 : 5;
    let folded: AnyWorld = {};
    const foldEnd = time(runs, () => { folded = engine.fold(world, end); });
    const foldMid = time(runs, () => engine.fold(world, mid));
    const foldPlanned = time(runs, () => engine.fold(world, end, "planned"));
    let pendingCount = 0;
    const pending = time(runs, () => { pendingCount = engine.pendingItems(world).length; });
    let renderedChars = 0;
    const renderOne = time(runs, () => {
        for (const block of folded.entries[hot[0]!].state.text) engine.renderForAgent(folded, hot[0], block.source);
    });
    const renderAll = time(runs, () => {
        const f = engine.fold(world, end);
        renderedChars = 0;
        for (const id of Object.keys(f.entries)) for (const block of f.entries[id].state.text) renderedChars += engine.renderForAgent(f, id, block.source).length;
    });
    const clone = time(runs, () => structuredClone(world));
    const publish = time(runs, () => engine.publish(world, draft));

    const f = (ms: number) => ms.toFixed(ms < 10 ? 1 : 0);
    console.log(
        `${chapterCount} 章（约 ${(chapterCount * 3000 / 10000).toFixed(0)} 万字），${label}：` +
        `条目 ${Object.keys(world.entries).length}、变更 ${Object.keys(world.changes).length}、核对点 ${Object.keys(world.checks).length}、修订 ${world.revisions.length}（JSON ${(revisionBytes / 1024 / 1024).toFixed(1)} MB）；` +
        `世界占堆 ${((heapAfter - heapBefore) / 1024 / 1024).toFixed(0)} MB（rss ${(process.memoryUsage().rss / 1024 / 1024).toFixed(0)} MB）\n` +
        `  折叠：末尾 ${f(foldEnd)} ms，中间一章开头 ${f(foldMid)} ms，按计划 ${f(foldPlanned)} ms；待处理 ${f(pending)} ms（${pendingCount} 条）\n` +
        `  渲染：一个条目 ${f(renderOne)} ms；全部条目成文件视图（含一次折叠）${f(renderAll)} ms，${(renderedChars / 10000).toFixed(0)} 万字\n` +
        `  发布一次记账：${f(publish)} ms（其中复制整个世界 ${f(clone)} ms，其余是套修改与发布前后各一次待处理）`,
    );
}

/* ---------- 父进程：准备“章序查表”的引擎副本，按规模逐个开子进程 ---------- */

function patchedEngine(): {path: string; cleanup: () => void} {
    const dir = mkdtempSync(join(tmpdir(), "t09-engine-"));
    const source = readFileSync(ENGINE, "utf8");
    const original = "    return world.chapters.findIndex((chapter) => chapter.id === id);\n";
    if (!source.includes(original)) throw new Error("engine.ts 的 chapterIndex 和预期不同，先核对再改补丁");
    const patched = source.replace(original, [
        "    let map = chapterIndexCache.get(world.chapters);",
        "    if (map === undefined) {",
        "        map = new Map(world.chapters.map((chapter, index) => [chapter.id, index]));",
        "        chapterIndexCache.set(world.chapters, map);",
        "    }",
        "    return map.get(id) ?? -1;",
        "",
    ].join("\n")).replace("export function chapterIndex(", "const chapterIndexCache = new WeakMap<Chapter[], Map<string, number>>();\nexport function chapterIndex(");
    writeFileSync(join(dir, "engine.ts"), patched);
    copyFileSync(join(dirname(ENGINE), "model.ts"), join(dir, "model.ts"));
    return {path: join(dir, "engine.ts"), cleanup: () => rmSync(dir, {recursive: true})};
}

if (process.argv[2] === "--child") {
    await child(Number(process.argv[3]), process.argv[4]!, process.argv[5]!);
} else {
    console.log(`机器：${cpus()[0]?.model}；Bun ${Bun.version}；引擎 ${ENGINE}`);
    const patched = patchedEngine();
    try {
        for (const arg of process.argv.slice(2)) {
            for (const [path, label] of [[ENGINE, "原型原样"], [patched.path, "章序查表"]] as const) {
                const result = spawnSync(process.execPath, [import.meta.path, "--child", arg, path, label], {encoding: "utf8"});
                process.stdout.write(result.stdout);
                if (result.status !== 0) process.stderr.write(result.stderr);
            }
        }
    } finally {
        patched.cleanup();
    }
}
