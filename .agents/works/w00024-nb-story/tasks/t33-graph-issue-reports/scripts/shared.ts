/**
 * t33 各脚本共用的东西：数据与输出目录、模型端点、单价、请求的提示词片段与逐次记录（plan.md 的“检测”“修复”）。
 *
 * 端点与密钥只从环境变量读（NBOOK_LLM_BASE_URL、NBOOK_LLM_API_KEY），用 `bun --env-file=<仓库根>/.env` 运行；不读任何配置文件。
 */

import {createHash} from "node:crypto";
import {mkdir, readFile, writeFile} from "node:fs/promises";
import {dirname, join} from "node:path";

import type {Dataset} from "../../../../../../packages/nb-story/src/core/dataset";
import {callModel, type Attempt, type IngestEffort, type ModelEndpoint} from "../../../../../../packages/nb-story/src/ingest/model";
import {DEFAULT_INGEST_MAX_TOKENS} from "../../../../../../packages/nb-story/src/qa/config";

export const REPO = join(import.meta.dir, "../../../../../..");
export const LOCAL = join(REPO, ".local/agent/works/w00024-nb-story/tasks/t33-graph-issue-reports");
export const RUNS = join(LOCAL, "runs");
export const GRAPH = join(LOCAL, "data/graph-164.json");
export const RULES = join(REPO, "packages/nb-story/src/ingest/rules.md");

export const loadGraph = async (): Promise<Dataset> => (await Bun.file(GRAPH).json()) as Dataset;

export function endpoint(): ModelEndpoint {
    return {baseUrl: process.env.NBOOK_LLM_BASE_URL ?? "", model: "gpt-6-luna", apiKey: process.env.NBOOK_LLM_API_KEY ?? "", maxTokens: DEFAULT_INGEST_MAX_TOKENS, apiKeyEnv: "NBOOK_LLM_API_KEY"};
}

/** 单价（元 / 百万 token）：仓库抽取费用的统一口径，deepseek-flash 低谷价（与 t32 的小抽取相同）。 */
export const PRICE = {input: 1, output: 4, cacheRead: 0.02};
/** 累计费用的下界到这里就停（plan.md：超过 ¥20 停下，留一点余量）。 */
export const BUDGET_STOP = 19;

export const yuan = (usage: {input: number; output: number; cacheRead: number}) =>
    ((usage.input - usage.cacheRead) * PRICE.input + usage.cacheRead * PRICE.cacheRead + usage.output * PRICE.output) / 1e6;

/** 报告的说明：A 顺带、B 单独一步、C 事后扫描共用，保证三组问的是同一件事。 */
export const ISSUE_SPEC = `graphIssues 是已有记录本身的问题，例如：同一个人的马甲和本人没有用 identity 说法连起来；同一个对象建了两个；称呼挂错了对象；泛称或一类人被建成了具体的人物或身份；对象的类别错了；说法的类别错了；说法挂错了对象。每条写：
{"type":"alias-link | same-entity | wrong-name | generic-entity | wrong-kind | wrong-family | wrong-about | other","records":[涉及的已有记录编号],"evidence":["章.段"],"claim":"一句话说明问题和应该怎样改","confidence":"high | medium | low"}
evidence 只能引你读到的原文段落。没有发现就写空数组。`;

/** 修订的写法：C 组与修复共用。 */
export const REVISION_SPEC = `revisions 是对图的修订，每条是下面一种，都带 "reason"（一句话）与 "evidence"（["章.段"]）：
- {"op":"addStatement","statement":{"text":"…","family":"identity 等说法类别","about":["对象编号"],"kind":"fact | belief | claim","certainty":"certain | candidate","src":{"at":["章.段"],"ch":"narrator | speech | thought | document","by":"说话人的对象编号或 null"}}}
- {"op":"editStatement","id":"说法编号","set":{只写要改的字段：family、kind、certainty、about、by、text}}
- {"op":"setEntityKind","id":"对象编号","kind":"person | persona | group | place | item | concept | task | other"}
- {"op":"addName","entity":"对象编号","text":"称呼","at":"章.段"}
- {"op":"moveName","from":"对象编号","to":"对象编号","text":"称呼"}
- {"op":"removeName","entity":"对象编号","text":"称呼"}
- {"op":"mergeEntities","keep":"对象编号","drop":"对象编号"}
- {"op":"reject","issue":问题的序号（从 0 起）}：这条问题不成立，reason 写为什么
规则与抽取时相同：马甲和本人不要合并，用 identity 说法连起来；identity 说法的 about 正好两个人物或身份，原文明确说是同一个人时 certainty 写 certain。不确定的不要改。`;

export interface CallRecord {
    group: string;
    run: number;
    chapter: number;
    requestHash: string;
    attempts: (Attempt & {startedAt: string})[];
    replies: {round: number; finishReason: string | null; effortUsed?: string; text: string}[];
    outcome: "ok" | "bad" | "error" | null;
    error?: string;
    json?: unknown;
}

export const recordPath = (group: string, run: number, name: string) => join(RUNS, `${group}-${run}`, `${name}.json`);

export async function readRecord(path: string): Promise<CallRecord | null> {
    try {
        return JSON.parse(await readFile(path, "utf8")) as CallRecord;
    } catch {
        return null;
    }
}

/** 已经写下的全部记录的费用下界：每次 HTTP 尝试都算，失败的、用量不完整的也算。 */
export async function spentSoFar(): Promise<number> {
    let total = 0;
    for await (const file of new Bun.Glob("*/*.json").scan(RUNS)) {
        const record = await readRecord(join(RUNS, file));
        for (const attempt of record?.attempts ?? []) total += yuan(attempt.usage);
    }
    return total;
}

/**
 * 一个逻辑请求：与产品的 `asker` 相同，回复不成形（截断、不是 JSON、`valid` 不认）时重发一次；渠道失败由 `callModel` 重试。
 * 每次尝试结束、每次回复都立即写回记录文件，中途被打断也留下已花的用量。已有 `outcome` 的记录直接返回（断点续跑）。
 */
export async function logicalCall(input: {path: string; group: string; run: number; chapter: number; system: string; user: string; effort: IngestEffort; valid: (json: unknown) => boolean}): Promise<CallRecord> {
    const existing = await readRecord(input.path);
    if (existing?.outcome) return existing;
    const requestHash = createHash("sha256").update(input.system).update("\n\u0000\n").update(input.user).digest("hex").slice(0, 16);
    const record: CallRecord = {group: input.group, run: input.run, chapter: input.chapter, requestHash, attempts: [], replies: [], outcome: null};
    await mkdir(dirname(input.path), {recursive: true});
    // 写入排队：尝试结束时的保存不等待，若与后面的保存并发写同一个文件，内容会交错或被旧状态盖掉（2026-10-28 第一次正式跑
    // 坏了 11 个文件）。每次保存都接在上一次之后，并在写的那一刻取记录的快照。
    let queue: Promise<void> = Promise.resolve();
    const save = () => (queue = queue.then(() => writeFile(input.path, JSON.stringify(record, null, 2))));
    let startedAt = "";
    try {
        for (let round = 1; round <= 2; round++) {
            const reply = await callModel(endpoint(), {
                system: input.system, user: input.user, effort: input.effort, tag: `t33/${input.group}-${input.run}/${input.chapter}/${round}`,
                onAttemptStart: () => { startedAt = new Date().toISOString(); },
                onAttempt: attempt => { record.attempts.push({...attempt, startedAt}); void save(); },
                onRetry: info => console.error(`  ${input.group}-${input.run} 第 ${input.chapter} 章：${info.error.kind}，${Math.round(info.waitMs / 1000)} 秒后重试`),
            });
            record.replies.push({round, finishReason: reply.finishReason, ...(reply.effortUsed ? {effortUsed: reply.effortUsed} : {}), text: reply.text});
            if (reply.finishReason !== "length" && reply.json !== null && input.valid(reply.json)) {
                record.outcome = "ok";
                record.json = reply.json;
                break;
            }
            if (round === 2) record.outcome = "bad";
            await save();
        }
    } catch (error) {
        record.outcome = "error";
        record.error = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    }
    await save();
    return record;
}
