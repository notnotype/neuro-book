/**
 * 抽一章（docs/specs/story/ingest.md 输出 4、5、7、9、10，验收 5）。请求经真实的 OpenAI SDK 与 HTTP 发往本机端点。
 *
 * 回放：端点给出 w00005 t34 抽样例书时录下的回复（testing/ingest-replay.ts）。管线搬得对，各章最终草稿就与当时相同；
 * 普通章发出的请求除了“已有记录”只详列与本章相关的行（w00024 t10），其余逐字相同：把“已有记录”换回全量，就与当时录下
 * 的逐字相同。另一处允许的差别是核对清单里“格式不对：”后面的校验说明（原来是 zod 的措辞，现在是 TypeBox 的）。前 10 章
 * 的整理材料不大，照旧全量重写，请求原样相同；强制走增量（w00024 t12）时对照 t12 的基线，第 10 章那次的录音是整批写法，
 * 换成手写的增量回复。
 *
 * 故障：在回放上替换某一步的回复，等待由注入的函数记下，不真的等。
 */

import {afterEach, describe, expect, test} from "bun:test";
import {createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
import {join} from "node:path";
import {gunzipSync} from "node:zlib";

import {loadReplay, replay, type ReplayKey} from "../../testing/ingest-replay";
import {startEndpoint, type Endpoint, type EndpointReply, type Responder} from "../../testing/openai-endpoint";
import {sampleDataset} from "../../testing/sample";
import type {Dataset, SourceChapter} from "../core/dataset";
import {consolidate, extractChapter, IngestBadReply, type ChapterRun, type Step} from "./chapter";
import {compile, sourceChapter} from "./compile";
import {recallCandidates, renderContext} from "./context";
import {stripDisabled, type RawDraft} from "./draft-tools";
import {ModelAborted, ModelError, RETRY_DELAYS_MS, type Attempt} from "./model";
import {RECALL_LIMIT} from "./recall";

const FIXTURES = join(import.meta.dir, "..", "..", "tests", "fixtures", "ingest");
const gunzipJson = async <T>(name: string): Promise<T> => JSON.parse(gunzipSync(await readFile(join(FIXTURES, name))).toString("utf8")) as T;

/** 核对清单里“格式不对：”后面的校验说明换成固定文字（见模块头）。 */
const withoutSchemaDetails = (text: string) => text.replace(/格式不对：[^\n]*/gu, "格式不对：…");
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

/**
 * t10 合入时默认路径实际发出的每个请求（系统提示词、用户消息原样，不换回全量已有记录）的 SHA-256，按“章:步骤”。
 * 按书关闭数值与秘密（w00024 t11）之后，两项都开时必须与它逐字相同。
 */
const requestBaseline = async (name: "replay-ch001-010" | "recall-ch010", incremental = false) => {
    const t10 = (JSON.parse(await readFile(join(FIXTURES, "requests-t10.json"), "utf8")) as Record<string, Record<string, string>>)[name]!;
    if (!incremental) return t10;
    // 强制走增量整理时，整理的请求对照 t12 的基线；普通章仍与 t10 逐字相同。
    const t12 = (JSON.parse(await readFile(join(FIXTURES, "requests-t12.json"), "utf8")) as Record<string, Record<string, string>>)[name] ?? {};
    return {...Object.fromEntries(Object.entries(t10).filter(([key]) => !key.endsWith(":consolidation"))), ...t12};
};
const requestHashes = (requests: {key: string; system: string; user: string}[]) => Object.fromEntries(requests.map(request => [request.key, sha256(`${request.system}\n\u0000\n${request.user}`)]));

/**
 * 第 10 章整理的增量回复（手写，代替整批写法的录音）：a5-2 追加第 6 到 8 章的几段，新开一条南嘉鱼的主线；苏天晴的概览
 * 引用了情节与知情，处境引用了状态变动。
 */
const CONSOLIDATION_10 = {
    through: 10,
    merges: [],
    summaries: [
        {entity: "e1-1", facet: "overview", items: [{text: "苏天晴成为反派魔法少女，暂定代号心月狐，并结识了南嘉鱼。", deps: ["p8-1", "p9-1", "k6-1"]}]},
        {entity: "e1-1", facet: "goals", items: [{text: "苏天晴想用定身陷阱让风信子出丑。", deps: ["p6-1", "l6-1"]}]},
    ],
    arcs: [
        {id: "a5-2", title: "苏天晴寻找风信子并完成找茬任务", summary: "苏天晴用定身陷阱制住风信子并录下视频，因此得到暂定代号心月狐。", episodes: ["p6-1", "p6-2", "p6-3", "p7-1", "p7-2", "p8-1"], status: "ongoing"},
        {id: "a10-1", title: "苏天晴与南嘉鱼结为好友", summary: "苏天晴在学校结识南嘉鱼，两人很快成为好友；南嘉鱼暗中是以风信子为目标的反派魔法少女。", episodes: ["p8-2", "p9-1", "p9-4", "p10-1", "p10-2"], status: "ongoing"},
    ],
};
const incremental = (key: ReplayKey): EndpointReply | undefined => (key.chapter === 10 && key.step === "consolidation" ? {kind: "text", text: JSON.stringify(CONSOLIDATION_10)} : undefined);

let endpoint: Endpoint | undefined;
afterEach(() => {
    endpoint?.stop();
    endpoint = undefined;
});

/** 起端点并记下每次请求：认出的步骤、系统提示词加用户消息的摘要、推理档。 */
function serve(respond: Responder, keyOf?: () => ReplayKey | undefined) {
    const requests: {key: string; model: unknown; system: string; user: string; effort: unknown}[] = [];
    endpoint = startEndpoint((body, index, headers) => {
        const reply = respond(body, index, headers);
        const messages = body.messages as {content: string}[];
        const key = keyOf?.();
        requests.push({key: key ? `${key.chapter}:${key.step}` : String(index), model: body.model, system: messages[0]!.content, user: messages[1]!.content, effort: body.reasoning_effort});
        return reply;
    });
    const waits: number[] = [];
    const attempts: {step: Step; attempt: Attempt}[] = [];
    const run: ChapterRun = {
        endpoint: {baseUrl: endpoint.url, model: "gpt-6-luna", apiKey: "test-credential", maxTokens: 32_000},
        sleep: async ms => {
            waits.push(ms);
        },
        onAttempt: (step, attempt) => attempts.push({step, attempt}),
    };
    return {run, requests, waits, attempts};
}

/** 按顺序抽前 `count` 章（第 5、10 章后整理），返回各章草稿、整理稿与每章的结果。 */
async function extractBook(sample: Dataset, count: number, run: ChapterRun, features?: {ledger: boolean; secrets: boolean}, fullLimit?: number) {
    const book = features ? {...sample.book, features} : sample.book;
    const drafts: RawDraft[] = [];
    const consolidations: unknown[] = [];
    const sources = (through: number) => sample.sources.filter(source => source.chapter <= through);
    const results = [];
    for (let chapter = 1; chapter <= count; chapter++) {
        const prior = chapter > 1 ? compile(book, sources(chapter - 1), drafts, consolidations).dataset : null;
        const result = await extractChapter({source: sample.sources[chapter - 1]!, prior, ...(features ? {features} : {}), compileWith: candidate => compile(book, sources(chapter), [...drafts, candidate], consolidations)}, run);
        results.push(result);
        drafts.push(result.draft);
        if (chapter % 5 === 0) {
            const dataset = compile(book, sources(chapter), drafts, consolidations).dataset;
            const since = (consolidations.at(-1) as {through: number} | undefined)?.through ?? 0;
            const outcome = await consolidate(chapter, dataset, since, candidate => compile(book, sources(chapter), drafts, [...consolidations, candidate]), run, fullLimit === undefined ? {} : {fullLimit});
            if (outcome.consolidation) consolidations.push(outcome.consolidation);
        }
    }
    return {drafts, consolidations, results};
}


describe("回放前 10 章（输出 4、7）", () => {
    test("各章最终草稿与整理稿与 t34 那次相同；请求里的已有记录换回全量后与当时逐字相同，整理的请求原样相同", async () => {
        const sample = await sampleDataset();
        const data = await loadReplay();
        const final = await gunzipJson<{drafts: unknown[]; consolidations: unknown[]}>("run-med-100-final.json.gz");
        const recordedRequests = await gunzipJson<Record<string, Record<string, {sha256: string; normalized: string; effort: string}>>>("recorded-requests-ch001-010.json.gz");
        const played = replay(data);
        const {run, requests} = serve(played.responder, () => played.seen.at(-1));

        const {drafts, consolidations, results} = await extractBook(sample, 10, run);
        expect(played.unknown).toEqual([]);
        expect(drafts).toEqual(final.drafts.slice(0, 10) as RawDraft[]);
        expect(consolidations).toEqual(final.consolidations.slice(0, 2));
        expect(results.map(result => result.dropped)).toEqual(Array(10).fill(0));
        // 挑选关着：第 1 章没有已提交的记录，什么都不用选；之后各章按规则缩减。
        expect(results.map(result => result.recall.source)).toEqual(["none", ...Array(9).fill("rule")]);

        // 每一步都发了，而且只发了一次；推理档与当时相同。
        expect(requests.map(request => request.key).sort()).toEqual(Object.entries(recordedRequests).flatMap(([chapter, steps]) => Object.keys(steps).map(step => `${chapter}:${step}`)).sort());
        const priorOf = (chapter: number) => compile(sample.book, sample.sources.filter(source => source.chapter < chapter), drafts.slice(0, chapter - 1), consolidations.filter(item => (item as {through: number}).through < chapter)).dataset;
        let narrowed = 0;
        for (const request of requests) {
            const [chapter, step] = request.key.split(":") as [string, string];
            const recorded = recordedRequests[chapter]![step]!;
            expect({key: request.key, effort: request.effort}).toEqual({key: request.key, effort: recorded.effort});
            let user = request.user;
            if (!step.startsWith("consolidation") && chapter !== "1") {
                const open = "【已有记录】\n";
                const close = `\n\n【第 ${chapter} 章原文】`;
                const sent = user.slice(user.indexOf(open) + open.length, user.indexOf(close));
                const full = renderContext(priorOf(Number(chapter)), Number(chapter) - 1);
                if (sent !== full) narrowed += 1;
                user = user.replace(`${open}${sent}${close}`, `${open}${full}${close}`);
            }
            const text = `${request.system}\n\u0000\n${user}`;
            // 逐字相同；不同时只能是核对清单里的校验说明不同，而且只在核对类请求里。
            const same = sha256(text) === recorded.sha256 ? "same" : sha256(withoutSchemaDetails(text)) === recorded.normalized && step === "review-1" ? "schema details only" : "different";
            expect({key: request.key, same}).not.toEqual({key: request.key, same: "different"});
        }
        // 第 2 章起的普通请求确实只带了一部分已有记录。
        expect(narrowed).toBeGreaterThan(0);
        // 实际发出的请求与 t10 合入时逐字相同。
        expect(requestHashes(requests)).toEqual(await requestBaseline("replay-ch001-010"));
    }, 120_000);

    test("显式给两项都开（ingest.md 输出 18）：每个请求与不给时逐字相同", async () => {
        const sample = await sampleDataset();
        const played = replay(await loadReplay());
        const {run, requests} = serve(played.responder, () => played.seen.at(-1));
        await extractBook(sample, 10, run, {ledger: true, secrets: true});
        expect(played.unknown).toEqual([]);
        expect(requestHashes(requests)).toEqual(await requestBaseline("replay-ch001-010"));
    }, 120_000);

    test("整理材料超过上限时改用增量（输出 4、7）：第 10 批在第 5 批上合成；普通章请求不变，整理请求与 t12 的基线逐字相同", async () => {
        const sample = await sampleDataset();
        const final = await gunzipJson<{consolidations: unknown[]}>("run-med-100-final.json.gz");
        const played = replay(await loadReplay(), incremental);
        const {run, requests} = serve(played.responder, () => played.seen.at(-1));
        const {drafts, consolidations} = await extractBook(sample, 10, run, undefined, 0);
        expect(played.unknown).toEqual([]);
        // 第 5 章是第一次整理，录下的整批回复按增量就是全部新建。第 10 章更新 a5-2、新建 a10-1，没写到的 a5-1、a5-3 照带。
        expect(consolidations).toEqual([{...(final.consolidations[0] as object), base: 0}, {...CONSOLIDATION_10, base: 5}]);
        const batch = compile(sample.book, sample.sources.slice(0, 10), drafts, consolidations).dataset.arcs.filter(arc => arc.through === 10);
        const before = (final.consolidations[0] as {arcs: {id: string; episodes: string[]}[]}).arcs;
        expect(batch.map(arc => [arc.id, arc.episodes])).toEqual([
            ["a5-1", before[0]!.episodes],
            ["a5-2", [...before[1]!.episodes, ...CONSOLIDATION_10.arcs[0]!.episodes]],
            ["a5-3", before[2]!.episodes],
            ["a10-1", CONSOLIDATION_10.arcs[1]!.episodes],
        ]);
        expect(requestHashes(requests)).toEqual(await requestBaseline("replay-ch001-010", true));
    }, 120_000);

    test("全量与增量按当次的大小切换：第 5 章的全量材料在上限内照旧全量，第 10 章超过改增量，接着第 5 批合成", async () => {
        const sample = await sampleDataset();
        const final = await gunzipJson<{consolidations: unknown[]}>("run-med-100-final.json.gz");
        const played = replay(await loadReplay(), incremental);
        const {run, requests} = serve(played.responder, () => played.seen.at(-1));
        // 样例书第 5、10 章全量整理的用户消息约 1.05 万、1.76 万字，上限取在两者之间。
        const {consolidations} = await extractBook(sample, 10, run, undefined, 14_000);
        expect(consolidations).toEqual([final.consolidations[0], {...CONSOLIDATION_10, base: 5}]);
        const user = (key: string) => requests.find(request => request.key === key)!.user;
        expect(user("5:consolidation")).toContain("【各情节的概括】");
        expect(user("10:consolidation")).toContain("“这一段”是第 6 到 10 章。");
    }, 120_000);
});

describe("按书关闭数值与秘密（输出 18）", () => {
    // 第 4 章录下的回复里四类都有：数值 5 条、秘密 1 个（一条说法挂在它上面）、指向秘密的知情 3 条、指向说法的知情 4 条、疑问进展 4 条。
    const combos = [
        {ledger: false, secrets: true},
        {ledger: true, secrets: false},
        {ledger: false, secrets: false},
    ];
    for (const features of combos) {
        test(`数值${features.ledger ? "开" : "关"}、秘密${features.secrets ? "开" : "关"}：关掉的那类不进书，开着的照旧；指向说法的知情与疑问进展都在；去掉的条数记进说明、不算丢弃；请求里没有关掉那类的条目`, async () => {
            const sample = await sampleDataset();
            const final = await gunzipJson<{drafts: RawDraft[]}>("run-med-100-final.json.gz");
            const book = {...sample.book, features};
            const sources = (through: number) => sample.sources.filter(source => source.chapter <= through);
            const priorDrafts = final.drafts.slice(0, 3).map(draft => stripDisabled(draft, features).draft);
            const prior = compile(book, sources(3), priorDrafts).dataset;
            const played = replay(await loadReplay());
            const {run, requests} = serve(played.responder, () => played.seen.at(-1));
            const result = await extractChapter({source: sample.sources[3]!, prior, features, compileWith: candidate => compile(book, sources(4), [...priorDrafts, candidate])}, run);
            expect(played.unknown).toEqual([]);

            const own = <T extends {id: string}>(items: T[]) => items.filter(item => item.id.startsWith("l4-") || item.id.startsWith("x4-") || item.id.startsWith("k4-") || item.id.startsWith("s4-"));
            const ledger = own(result.dataset.ledger).length;
            const secrets = own(result.dataset.secrets).length;
            const knowledge = own(result.dataset.knowledge);
            expect({ledger: ledger > 0, secrets: secrets > 0}).toEqual(features);
            expect(own(result.dataset.statements).some(item => item.secret !== undefined)).toBe(features.secrets);
            // 第 4 章模型写的 4 条指向说法的知情都在（决定 2）。
            expect(["k4-4", "k4-5", "k4-6", "k4-9"].filter(id => knowledge.some(item => item.id === id && item.about.startsWith("s") && !item.derived))).toEqual(["k4-4", "k4-5", "k4-6", "k4-9"]);
            expect(knowledge.some(item => item.about.startsWith("x"))).toBe(features.secrets);
            expect(result.dataset.questions.some(question => question.updates.some(update => update.at.chapter === 4))).toBe(true);
            expect(result.dropped).toBe(0);
            expect(result.notes).toEqual([expect.stringMatching(/^按书的设置去掉了/u)]);
            if (!features.ledger) expect(result.notes[0]).toContain("5 条数值记录");
            if (!features.secrets) expect(result.notes[0]).toContain("1 个秘密");
            expect(result.remaining.some(issue => issue.code === "secret-missing")).toBe(false);

            const draft = requests.find(request => request.key === "4:draft")!.user;
            const later = requests.filter(request => /^4:(review|repair)/u.test(request.key)).map(request => request.user).join("\n");
            expect({ledgerNote: draft.includes("这本书不记数值"), ledgerItem: draft.includes("- 账本："), reconcile: later.includes("[对账]")}).toEqual({ledgerNote: !features.ledger, ledgerItem: features.ledger, reconcile: later.includes("[对账]") && features.ledger});
            expect(draft.includes("about 是他知道或不知道的那条说法的编号")).toBe(!features.secrets);
            expect({secretNote: draft.includes("这本书不记秘密"), secretItem: draft.includes("本章有没有新的秘密"), askSecret: later.includes("建秘密")}).toEqual({secretNote: !features.secrets, secretItem: features.secrets, askSecret: later.includes("建秘密") && features.secrets});
            // 已有记录里不列关掉的那一节。
            expect({secrets: draft.includes("## 秘密与知情"), ledger: draft.includes("## 当前状态")}).toEqual({secrets: draft.includes("## 秘密与知情") && features.secrets, ledger: draft.includes("## 当前状态") && features.ledger});
        }, 60_000);
    }
});

describe("按书关闭数值与秘密：修正里又写了关掉的记录（输出 18）", () => {
    test("核对的修正把数值、秘密、挂秘密的说法与指向秘密的知情加回来：提交前再去掉，计入说明、不算丢弃", async () => {
        const sample = await sampleDataset();
        const final = await gunzipJson<{drafts: RawDraft[]}>("run-med-100-final.json.gz");
        const features = {ledger: false, secrets: false};
        const book = {...sample.book, features};
        const sources = (through: number) => sample.sources.filter(source => source.chapter <= through);
        const priorDrafts = final.drafts.slice(0, 3).map(draft => stripDisabled(draft, features).draft);
        const prior = compile(book, sources(3), priorDrafts).dataset;
        // 在录下的那次核对修正上追加：录下的修正照常修好结构问题，不多出录像里没有的修复请求。
        const data = await loadReplay();
        const recorded = JSON.parse(data["4"]!["review-1"]!.content) as {replace?: Record<string, unknown[]>};
        const patch = {
            ...recorded,
            replace: {
                ...recorded.replace,
                ledger: [...(recorded.replace?.ledger ?? []), {id: "l4-90", owner: "e1-1", track: "神典石", op: "gain", amount: 1, reason: "修正里加的", at: ["4.2"]}],
                secrets: [...(recorded.replace?.secrets ?? []), {id: "x4-90", title: "修正里加的秘密", about: ["e1-1"]}],
                knowledge: [...(recorded.replace?.knowledge ?? []), {id: "k4-90", who: "e1-1", about: "x4-90", state: "knows", how: "修正里加的", at: ["4.2"]}],
            },
        };
        const played = replay(data, key => (key.chapter === 4 && key.step === "review-1" ? {kind: "text", text: JSON.stringify(patch)} : undefined));
        const {run} = serve(played.responder, () => played.seen.at(-1));
        const result = await extractChapter({source: sample.sources[3]!, prior, features, compileWith: candidate => compile(book, sources(4), [...priorDrafts, candidate])}, run);
        expect(played.seen.some(key => key.chapter === 4 && key.step === "review-1")).toBe(true);
        expect({ledger: result.dataset.ledger.length, secrets: result.dataset.secrets.length, knowledge: result.dataset.knowledge.some(item => item.id === "k4-90")}).toEqual({ledger: 0, secrets: 0, knowledge: false});
        expect(result.dropped).toBe(0);
        // 初稿录下的 5 条数值、1 个秘密、3 条指向秘密的知情；录下的核对修正又写了 2 条指向秘密的知情；加上追加的各 1 条。
        expect(result.notes).toEqual(["按书的设置去掉了 6 条数值记录、2 个秘密、6 条指向秘密的知情、1 条说法上的秘密"]);
    }, 60_000);
});

describe("挑相关说法（输出 4、9、10）", () => {
    /** 抽第 10 章（前 9 章用 t34 最终草稿编译），挑选开着，用另一个模型名；挑选的回复由 `recallReply` 给。 */
    async function chapterTen(recallReply: (nth: number, abort: () => void, candidates: string[]) => EndpointReply) {
        const sample = await sampleDataset();
        const final = await gunzipJson<{drafts: RawDraft[]; consolidations: {through: number}[]}>("run-med-100-final.json.gz");
        const sources = (through: number) => sample.sources.filter(source => source.chapter <= through);
        const consolidations = final.consolidations.filter(item => item.through <= 9);
        const prior = compile(sample.book, sources(9), final.drafts.slice(0, 9), consolidations).dataset;
        const controller = new AbortController();
        const candidates = recallCandidates(prior, 9, sample.sources[9]!.paragraphs.join("\n"));
        const ids = candidates.map(item => item.id);
        const played = replay(await loadReplay(), (key, nth) => (key.step === "recall" ? recallReply(nth, () => controller.abort(), ids) : undefined));
        const served = serve(played.responder, () => played.seen.at(-1));
        const run: ChapterRun = {...served.run, recallEndpoint: {...served.run.endpoint, model: "recall-model"}, signal: controller.signal};
        const outcome = await extractChapter({source: sample.sources[9]!, prior, compileWith: candidate => compile(sample.book, sources(10), [...final.drafts.slice(0, 9), candidate], consolidations)}, run).then(
            result => ({ok: true as const, result}),
            (error: unknown) => ({ok: false as const, error}),
        );
        /** 某一步请求里已有记录的说法一节：说明那一行与列出的编号。 */
        const statementsIn = (step: string) => {
            const user = served.requests.find(request => request.key === `10:${step}`)!.user;
            const lines = user.slice(user.indexOf("## 已有的说法"), user.indexOf("\n\n【第 10 章原文】")).split("\n");
            return {note: lines[3] ?? "", ids: lines.map(line => /^(s\d+-\d+)　/u.exec(line)?.[1]).filter(id => id !== undefined)};
        };
        return {...served, played, outcome, candidates, statementsIn, steps: (step: ReplayKey["step"]) => played.seen.filter(key => key.step === step).length};
    }
    const text = (value: unknown): EndpointReply => ({kind: "text", text: JSON.stringify(value)});

    test("用挑选的模型、minimal 档发一次；去重、去掉候选外的、超过上限按回复的先后留前面的；已有记录只列选中的，结果随章带回", async () => {
        // 回复：候选倒着排（模型认为越新越相关），夹着重复的与候选外的编号。
        const run = await chapterTen((_nth, _abort, ids) => {
            const reversed = [...ids].reverse();
            return text({ids: ["s999-1", ...reversed, reversed[0], "x1-1"]});
        });
        expect(run.candidates.length).toBeGreaterThan(RECALL_LIMIT);
        expect(run.played.unknown).toEqual([]);
        expect(run.outcome.ok).toBe(true);
        const recall = run.requests.filter(request => request.key === "10:recall");
        expect(recall.map(request => [request.model, request.effort])).toEqual([["recall-model", "minimal"]]);
        expect(run.requests.filter(request => request.key !== "10:recall").every(request => request.model === "gpt-6-luna")).toBe(true);
        const expected = run.candidates.slice(-RECALL_LIMIT).map(item => item.id);
        expect(run.outcome.ok && run.outcome.result.recall).toEqual({source: "model", ids: expected});
        expect(run.statementsIn("draft")).toEqual({note: "只列挑出来的与本章可能相关的说法。", ids: expected});
        expect(requestHashes(run.requests)).toEqual(await requestBaseline("recall-ch010"));
    }, 60_000);

    test("回复两次都不成形：这一章照常抽完，说法退回规则缩减，说明里写明", async () => {
        const run = await chapterTen(nth => text(nth === 1 ? {ids: null} : {ids: ["s1-1", 3]}));
        expect(run.outcome.ok).toBe(true);
        expect(run.steps("recall")).toBe(2);
        expect(run.outcome.ok && run.outcome.result.recall).toEqual({source: "fallback", ids: []});
        expect(run.outcome.ok && run.outcome.result.notes).toEqual([expect.stringContaining("挑相关说法")]);
        expect(run.statementsIn("draft").note).toBe("只列一部分：挂在上面秘密与疑问上的、不针对具体对象的，以及最近的说法。");
    }, 60_000);

    test("挑选的渠道一直 503：与其他步骤一样以 network 失败，不退回规则、不往下抽", async () => {
        const run = await chapterTen(() => ({kind: "status", status: 503}));
        expect(!run.outcome.ok && run.outcome.error instanceof ModelError && run.outcome.error.kind).toBe("network");
        expect(run.steps("recall")).toBe(6);
        expect(run.steps("beats")).toBe(0);
    }, 60_000);

    test("挑选中途停止：以停止结束，不往下抽", async () => {
        // 端点收到挑选请求时停止，流卡住不结束。
        const run = await chapterTen((_nth, abort) => {
            abort();
            return {kind: "stall", text: "{"};
        });
        expect(!run.outcome.ok && run.outcome.error instanceof ModelAborted).toBe(true);
        expect(run.steps("beats")).toBe(0);
    }, 60_000);
});

describe("渠道失败与不成形的回复（输出 9、10，验收 5）", () => {
    /** 只抽第 1 章，替换其中某一步的回复。 */
    async function chapterOne(override: (key: ReplayKey, nth: number) => EndpointReply | undefined) {
        const sample = await sampleDataset();
        const played = replay(await loadReplay(), override);
        const served = serve(played.responder, () => played.seen.at(-1));
        const outcome = await extractChapter({source: sample.sources[0]!, prior: null, compileWith: candidate => compile(sample.book, sample.sources.slice(0, 1), [candidate])}, served.run).then(
            result => ({ok: true as const, result}),
            (error: unknown) => ({ok: false as const, error}),
        );
        const steps = (step: ReplayKey["step"]) => played.seen.filter(key => key.step === step).length;
        return {...served, outcome, steps, played};
    }
    const status = (code: number): EndpointReply => ({kind: "status", status: code});

    test("草稿请求先回两次 503：等 30、60 秒重发，这一章照常抽完，端点共收到 3 次草稿请求", async () => {
        const run = await chapterOne((key, nth) => (key.step === "draft" && nth <= 2 ? status(503) : undefined));
        expect(run.outcome.ok).toBe(true);
        expect(run.waits).toEqual([30_000, 60_000]);
        expect(run.steps("draft")).toBe(3);
    });

    test("一直回 503：同一请求合计 6 次 HTTP 后以 network 失败，等待用完整张延迟表", async () => {
        const run = await chapterOne(key => (key.step === "beats" ? status(503) : undefined));
        expect(run.outcome.ok).toBe(false);
        expect(!run.outcome.ok && run.outcome.error instanceof ModelError && run.outcome.error.kind).toBe("network");
        expect(run.steps("beats")).toBe(6);
        expect(run.waits).toEqual(RETRY_DELAYS_MS);
    });

    test("401 不重发：以 auth 失败，错误里没有密钥", async () => {
        const run = await chapterOne(key => (key.step === "beats" ? {kind: "status", status: 401, echoKey: true} : undefined));
        expect(!run.outcome.ok && run.outcome.error instanceof ModelError && run.outcome.error.kind).toBe("auth");
        expect(run.steps("beats")).toBe(1);
        expect(!run.outcome.ok && String((run.outcome.error as Error).message)).not.toContain("test-credential");
    });

    test("400 没列合法档位：不降档、不重发，以 provider 失败；请求里的推理档是 minimal", async () => {
        const run = await chapterOne(key => (key.step === "beats" ? status(400) : undefined));
        expect(!run.outcome.ok && run.outcome.error instanceof ModelError && run.outcome.error.kind).toBe("provider");
        expect(run.requests.map(request => request.effort)).toEqual(["minimal"]);
    });

    test("拒绝 minimal 并列出合法档位：改用 low 重发一次，这一章照常抽完", async () => {
        const run = await chapterOne((key, nth) => (key.step === "beats" && nth === 1
            ? {kind: "status", status: 400, message: "Unsupported value: 'minimal' is not supported. Supported values are: 'none', 'low', 'medium'."}
            : undefined));
        expect(run.outcome.ok).toBe(true);
        expect(run.requests.filter(request => request.key === "1:beats").map(request => request.effort)).toEqual(["minimal", "low"]);
    });

    test("跑飞：一段内容之后只剩空白，2000 个空白后中止、按渠道失败重发；那次的用量标不完整", async () => {
        const run = await chapterOne((key, nth) => (key.step === "beats" && nth === 1 ? {kind: "runaway", text: '{"chapter":1,"times":[' } : undefined));
        expect(run.outcome.ok).toBe(true);
        expect(run.waits).toEqual([30_000]);
        const beats = run.attempts.filter(item => item.step === "beats").map(item => ({ok: item.attempt.error === null, complete: item.attempt.usage.complete}));
        expect(beats).toEqual([{ok: false, complete: false}, {ok: true, complete: true}]);
    });

    test("流到一半来了错误事件（luna 的 upstream_error，没有状态码）：按渠道失败重发", async () => {
        const run = await chapterOne((key, nth) => (key.step === "draft" && nth === 1 ? {kind: "stream-error", message: "Upstream service temporarily unavailable"} : undefined));
        expect(run.outcome.ok).toBe(true);
        expect(run.waits).toEqual([30_000]);
    });

    test("流没有结束原因就断了：按渠道失败重发", async () => {
        const run = await chapterOne((key, nth) => (key.step === "draft" && nth === 1 ? {kind: "cut", text: '{"chapter":1'} : undefined));
        expect(run.outcome.ok).toBe(true);
        expect(run.waits).toEqual([30_000]);
    });

    test("回复不是 JSON：重发一次（不等待）就好了；两次都不是：ingest_bad_reply", async () => {
        const once = await chapterOne((key, nth) => (key.step === "beats" && nth === 1 ? {kind: "text", text: "好的，这就写。"} : undefined));
        expect(once.outcome.ok).toBe(true);
        expect(once.waits).toEqual([]);
        expect(once.steps("beats")).toBe(2);
        endpoint?.stop();
        const twice = await chapterOne(key => (key.step === "beats" ? {kind: "text", text: "好的，这就写。"} : undefined));
        expect(!twice.outcome.ok && twice.outcome.error instanceof IngestBadReply && twice.outcome.error.step).toBe("beats");
    });

    test("被截断、没有段落块、草稿缺本章：重发一次后仍是这样，ingest_bad_reply", async () => {
        const cases: [ReplayKey["step"], EndpointReply][] = [
            ["draft", {kind: "text", text: '{"chapter":1,"entities":[]}', finishReason: "length"}],
            ["beats", {kind: "text", text: '{"chapter":1,"times":[],"beats":[]}'}],
            ["draft", {kind: "text", text: '{"chapter":2,"entities":[]}'}],
        ];
        for (const [step, reply] of cases) {
            const run = await chapterOne(key => (key.step === step ? reply : undefined));
            expect({step, error: !run.outcome.ok && run.outcome.error instanceof IngestBadReply}).toEqual({step, error: true});
            expect(run.steps(step)).toBe(2);
            endpoint?.stop();
        }
    });
});

describe("整理不合格（输出 7）", () => {
    test("整理的回复两次都不是 JSON：跳过这一次，不抛错", async () => {
        const sample = await sampleDataset();
        const data = await loadReplay();
        const played = replay(data, key => (key.step === "consolidation" ? {kind: "text", text: "整理不了。"} : undefined));
        const {run} = serve(played.responder, () => played.seen.at(-1));
        const final = await gunzipJson<{drafts: unknown[]}>("run-med-100-final.json.gz");
        const sources = sample.sources.slice(0, 5);
        const dataset = compile(sample.book, sources, final.drafts.slice(0, 5)).dataset;
        const outcome = await consolidate(5, dataset, 0, candidate => compile(sample.book, sources, final.drafts.slice(0, 5), [candidate]), run);
        expect(outcome.consolidation).toBeNull();
        expect(outcome.problems.join("")).toContain("整理跳过");
    });
});

describe("全图的时间矛盾（输出 5）", () => {
    /** 两章的小书：第 1 章有一个第一天正午的时间点；第 2 章的回复写了“第一天早晨、却在正午之后”，与第 1 章矛盾。 */
    const sources: SourceChapter[] = [sourceChapter(1, "第1章", ["第1章", "正午。"]), sourceChapter(2, "第2章", ["第2章", "早晨。", "晚上。"])];
    const chapterOneDraft = {chapter: 1, times: [{id: "t1-1", label: "第一天正午", day: 1, part: "noon", at: ["1.2"]}], beats: [{id: "b1-1", from: 1, to: 2, gist: "正午。", time: "t1-1"}]};

    test("这一章新带来的矛盾由丢弃这一章的时间点消除，照常抽完、丢弃计数；前一章不改", async () => {
        const replies: Record<string, EndpointReply> = {
            beats: {kind: "text", text: JSON.stringify({chapter: 2, times: [{id: "t2-1", label: "第一天早晨", day: 1, part: "morning", rel: [{type: "after", to: "t1-1"}], at: ["2.2"]}], beats: [{id: "b2-1", from: 1, to: 3, gist: "早晨到晚上。", time: "t2-1"}]})},
            draft: {kind: "text", text: JSON.stringify({chapter: 2})},
            check: {kind: "text", text: "{}"},
        };
        const {run} = serve(body => {
            const user = (body.messages as {content: string}[])[1]!.content;
            return user.includes("以及程序核对出的清单") ? replies.check! : user.includes("写草稿里除") ? replies.draft! : replies.beats!;
        });
        const prior = compile({id: "t", title: "t"}, sources.slice(0, 1), [chapterOneDraft]).dataset;
        const result = await extractChapter({source: sources[1]!, prior, compileWith: candidate => compile({id: "t", title: "t"}, sources, [chapterOneDraft, candidate])}, run);
        expect(result.draft.times).toEqual([]);
        expect(result.draft.beats?.map(beat => beat.time)).toEqual([null]);
        expect(result.dropped).toBe(1);
        expect(compile({id: "t", title: "t"}, sources, [chapterOneDraft, result.draft]).issues.filter(issue => issue.level === "error")).toEqual([]);
    });
});

describe("核对与修复的请求正文相同（输出 4）", () => {
    test("清单只有结构问题、核对没改草稿：紧接着的修复照样认成修复，用修复的回复", async () => {
        const sample = await sampleDataset();
        const data = await loadReplay();
        // 草稿里一句台词没写是谁说的：编译报结构错误，进清单；核对回空补丁，修复删掉这一句。
        const draft = {chapter: 1, statements: [{id: "s1-1", text: "有人说了一句话", family: "event", about: [], src: {at: ["1.2"], ch: "speech"}}]};
        const played = replay(data, key => {
            if (key.step === "draft") return {kind: "text", text: JSON.stringify(draft)};
            if (key.step === "review-1") return {kind: "text", text: "{}"};
            if (key.step === "repair-1") return {kind: "text", text: JSON.stringify({remove: ["s1-1"]})};
            return undefined;
        });
        const {run} = serve(played.responder, () => played.seen.at(-1));
        const result = await extractChapter({source: sample.sources[0]!, prior: null, compileWith: candidate => compile(sample.book, sample.sources.slice(0, 1), [candidate])}, run);
        expect(played.seen.map(key => key.step)).toEqual(["beats", "draft", "review-1", "repair-1"]);
        expect(result.dropped).toBe(0);
        expect(result.draft.statements).toEqual([]);
    });
});

describe("整理带来的错误（输出 5、7）", () => {
    test("合并对象让更早一章的账本对不上：这次整理跳过，交回的数据集不变", async () => {
        const sources = [
            sourceChapter(1, "第1章", ["第1章", "阿青的钱袋里有十枚金币。"]),
            sourceChapter(2, "第2章", ["第2章", "阿青又赚了两枚，袋里有两枚金币。"]),
            sourceChapter(3, "第3章", ["第3章", "天黑了。"]),
        ];
        const beats = (chapter: number, to: number) => [{id: `b${chapter}-1`, from: 1, to, gist: "经过。", time: null}];
        const drafts = [
            {chapter: 1, beats: beats(1, 2), entities: [{id: "e1-1", kind: "person", label: "阿青", at: "1.2", names: [{text: "阿青", at: "1.2", primary: true}]}], ledger: [{id: "l1-1", owner: "e1-1", track: "金币", op: "set", value: 10, reason: "钱袋里有十枚", at: ["1.2"]}]},
            // 第 2 章重复建了一个“阿青”，它自己的账从 0 起：加 2 得 2，与原文一致，单独编译没有错误。
            {chapter: 2, beats: beats(2, 2), entities: [{id: "e2-1", kind: "person", label: "阿青", at: "2.2", names: [{text: "阿青", at: "2.2", primary: true}]}], ledger: [{id: "l2-1", owner: "e2-1", track: "金币", op: "gain", amount: 2, value: 2, reason: "又赚了两枚", at: ["2.2"]}]},
            {chapter: 3, beats: beats(3, 2)},
        ];
        const book = {id: "t", title: "t"};
        const before = compile(book, sources, drafts);
        expect(before.issues.filter(issue => issue.level === "error")).toEqual([]);
        // 第 3 章整理把两个阿青合并：第 2 章那一笔的累加变成 12，与原文的 2 对不上，错误落在第 2 章而不是第 3 章。
        const {run} = serve(() => ({kind: "text", text: JSON.stringify({through: 3, merges: [{keep: "e1-1", drop: "e2-1", reason: "同一个阿青"}]})}));
        const outcome = await consolidate(3, before.dataset, 0, candidate => compile(book, sources, drafts, [candidate]), run);
        expect(outcome.consolidation).toBeNull();
        expect(outcome.problems.join("")).toContain("整理稿带来错误");
        expect(outcome.dataset).toBe(before.dataset);
    });
});

describe("增量整理稿的清理（输出 7）", () => {
    /**
     * 三章的小书。第 1 章有两个“林晚”（e1-1、e1-3，称呼相同、可以合并，但都不是这一段新建的）和阿青（e1-2）；第 2 章写林晚
     * 独自赶路，整理过一次（主线 a2-1，林晚与阿青的概览）；第 3 章只写林晚，有一条知情（指向第 2 章那条只关于林晚的说法，
     * 阿青因此不是这一段的相关对象）与一笔状态变动。
     */
    const sources = [
        sourceChapter(1, "第1章", ["第1章", "林晚和阿青上路。"]),
        sourceChapter(2, "第2章", ["第2章", "林晚赶路。"]),
        sourceChapter(3, "第3章", ["第3章", "林晚有三枚金币。"]),
    ];
    const person = (id: string, name: string) => ({id, kind: "person", label: name, at: "1.2", names: [{text: name, at: "1.2", primary: true}]});
    const day = (n: number) => ({times: [{id: `t${n}-1`, label: `第${n}天早晨`, day: n, part: "morning", at: [`${n}.2`]}], beats: [{id: `b${n}-1`, from: 1, to: 2, gist: "经过。", time: `t${n}-1`}], episodes: [{id: `p${n}-1`, title: `第${n}天`, summary: "林晚赶路。", at: [`${n}.2`], time: `t${n}-1`, who: [{e: "e1-1"}]}]});
    const drafts = [
        {chapter: 1, ...day(1), entities: [person("e1-1", "林晚"), person("e1-2", "阿青"), person("e1-3", "林晚")], statements: [{id: "s1-1", text: "林晚和阿青一起上路", family: "event", about: ["e1-1", "e1-2"], src: {at: ["1.2"], ch: "narrator"}}]},
        {chapter: 2, ...day(2), statements: [{id: "s2-1", text: "林晚独自赶路", family: "event", about: ["e1-1"], src: {at: ["2.2"], ch: "narrator"}}]},
        {
            chapter: 3,
            ...day(3),
            knowledge: [{id: "k3-1", who: "e1-1", about: "s2-1", state: "knows", at: ["3.2"]}],
            ledger: [{id: "l3-1", owner: "e1-1", track: "金币", op: "set", value: 3, reason: "有三枚金币", at: ["3.2"]}],
        },
    ];
    const book = {id: "t", title: "t"};
    const first = {
        through: 2,
        base: 0,
        summaries: [
            {entity: "e1-1", facet: "overview", items: [{text: "林晚在赶路。", deps: ["p2-1"]}]},
            {entity: "e1-2", facet: "overview", items: [{text: "阿青和林晚同行。", deps: ["s1-1"]}]},
        ],
        arcs: [{id: "a2-1", title: "林晚赶路", summary: "林晚一路赶路。", episodes: ["p1-1", "p2-1"], status: "ongoing"}],
    };

    test("候选之外的合并、改写没列现有归纳的方面拒绝；知情与状态变动可以当依据；中文的方面名换回英文键、写在句子里的依据拆回 deps；主线只改状态、重复写、未知编号、收早先的情节各有去处", async () => {
        const dataset = compile(book, sources, drafts, [first]).dataset;
        expect(compile(book, sources, drafts, [first]).issues.filter(issue => issue.level === "error")).toEqual([]);
        const reply = {
            through: 3,
            merges: [{keep: "e1-1", drop: "e1-3", reason: "同一个林晚"}],
            summaries: [
                // 第一句照抄材料，依据留在句子里；第二句依据写对了。
                {entity: "e1-1", facet: "overview", items: [{text: "林晚在赶路。〔p2-1〕", deps: []}, {text: "林晚知道自己独自赶路，身上有三枚金币。", deps: ["k3-1", "l3-1"]}]},
                {entity: "e1-2", facet: "overview", items: [{text: "阿青不见了。", deps: ["s1-1"]}]},
                {entity: "e1-2", facet: "appearance", items: [{text: "阿青的样子没有交代。", deps: ["s1-1"]}]},
                // 照材料写了中文的方面名，换回英文键。
                {entity: "e1-1", facet: "外貌", items: [{text: "林晚的样子没有交代。", deps: ["s1-1"]}]},
                // 两句连同各自的依据写进了一条。
                {entity: "e1-1", facet: "history", items: [{text: "林晚和阿青出发。〔s1-1〕林晚一路赶路。〔p2-1、p3-1〕", deps: []}]},
            ],
            arcs: [
                {id: "a2-1", title: "林晚赶路", summary: "林晚到了目的地。", episodes: [], status: "closed"},
                {id: "a2-1", title: "林晚赶路", summary: "又写了一次。", episodes: ["p3-1"], status: "ongoing"},
                {id: "a9-9", title: "林晚的金币", summary: "林晚清点金币。", episodes: ["p3-1"], status: "ongoing"},
                // 新主线收早先的情节：不是这一段的，不收，这条主线也就没有情节了。
                {id: "a8-8", title: "林晚第二天", summary: "林晚第二天赶路。", episodes: ["p2-1"], status: "ongoing"},
            ],
        };
        const {run, requests} = serve(() => ({kind: "text", text: JSON.stringify(reply)}));
        // 小书的全量材料远在上限内，强制走增量。
        const outcome = await consolidate(3, dataset, 2, candidate => compile(book, sources, drafts, [first, candidate]), run, {fullLimit: 0});

        // 输入只列这一段的对象：阿青第 3 章没有涉及，没有列出她的现有归纳。
        expect(requests[0]!.user).toContain("“这一段”是第 3 到 3 章。");
        expect(requests[0]!.user).not.toContain("阿青和林晚同行。");
        expect(outcome.consolidation).toEqual({
            through: 3,
            base: 2,
            merges: [],
            summaries: [
                {entity: "e1-1", facet: "overview", items: [{text: "林晚在赶路。", deps: ["p2-1"]}, reply.summaries[0]!.items[1]]},
                reply.summaries[2],
                {...reply.summaries[3], facet: "appearance"},
                {entity: "e1-1", facet: "history", items: [{text: "林晚和阿青出发。", deps: ["s1-1"]}, {text: "林晚一路赶路。", deps: ["p2-1", "p3-1"]}]},
            ],
            arcs: [
                {id: "a2-1", title: "林晚赶路", summary: "林晚到了目的地。", episodes: [], status: "closed"},
                {id: "a3-1", title: "林晚的金币", summary: "林晚清点金币。", episodes: ["p3-1"], status: "ongoing"},
            ],
        });
        expect(outcome.problems).toEqual([
            "合并 e1-3 到 e1-1 被拒绝：不在这次的合并候选里",
            "摘要 e1-2/overview：这次没有列出它的现有归纳，只能补新的方面",
            "故事线 a2-1：写了两次，只留第一次",
            "故事线 a8-8：p2-1 不是这一段的情节，不收",
            "故事线 a8-8：新主线没有有效的情节",
        ]);
        expect(outcome.dataset.arcs.filter(arc => arc.through === 3).map(arc => [arc.id, arc.status, arc.episodes])).toEqual([["a2-1", "closed", ["p1-1", "p2-1"]], ["a3-1", "ongoing", ["p3-1"]]]);
    });
});
