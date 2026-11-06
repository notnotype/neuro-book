/**
 * 写完以后的检查接真实模型（docs/specs/plot/checks.md 验收 1、2）：只验证问得到、答得上、结构对、能落成诊断；模型判错的记进证据，交评测（w00039 t26），不断言它一定判对。
 *
 * 只在 `NBOOK_LLM_TESTS=1` 时运行。模型取环境里的 `NBOOK_LLM_BASE_URL`、`NBOOK_LLM_API_KEY`、`NBOOK_LLM_MODEL`（开发实验用的，`set -a; . ./.env`），配成自定义服务商，
 * 绑 `main` 与 `fast`。
 */

import {afterAll, describe, expect, test} from "bun:test";
import {rm} from "node:fs/promises";
import {join} from "node:path";

import type {Mark, TellingDraft} from "@notnotype/nb-canon/schema";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {modelsWorld} from "nbook/plugins/models/testing/world";
import type {ModelsWorld} from "nbook/plugins/models/testing/world";

import {remoteCheckModels} from "./backend/check-models";
import {plotModelImplementation} from "./backend/server";
import {badQuotesOf} from "./core/checks/diagnostics";
import {reported, runOk} from "./testing/checks";
import {descriptor} from "./plugin";
import type {CheckRecord} from "./shared/checks";
import {CHECK_DIAGNOSTIC_IDS, MARK_IDS} from "./shared/declarations";
import {chapter, PlotWorld, present} from "./testing/world";

const {NBOOK_LLM_TESTS, NBOOK_LLM_BASE_URL: BASE, NBOOK_LLM_API_KEY: KEY, NBOOK_LLM_MODEL: MODEL} = process.env;
const enabled = NBOOK_LLM_TESTS === "1" && BASE !== undefined && KEY !== undefined && MODEL !== undefined;
const CHAPTERS = Array.from({length: 22}, (_, index) => `ch${String(index + 1)}`);

let root = "";
let world: ModelsWorld | null = null;
afterAll(async () => {
    await world?.close();
    if (root !== "") await rm(root, {recursive: true, force: true});
});

async function realModels() {
    root = await createTestTmpRoot("neuro-book-plot-llm", "llm");
    world = await modelsWorld(join(root, "world"), {env: {PLOT_LLM_KEY: KEY!}});
    const client = await world.window("w");
    const added = await client.addProvider({source: {kind: "custom", name: "实验", baseUrl: BASE!, api: "openai-completions"}});
    if (!added.ok) throw new Error(JSON.stringify(added));
    const provider = added.value.id;
    expect((await client.setKey({provider, value: "env:PLOT_LLM_KEY"})).ok).toBe(true);
    expect((await client.upsertModel({provider, model: {id: MODEL!, enabled: true, contextWindow: 200_000, maxOutput: 16_000}})).ok).toBe(true);
    for (const role of ["main", "fast"]) expect((await client.setRole({id: role, model: `${provider}/${MODEL!}`})).ok).toBe(true);
    const implementation = plotModelImplementation(world.service.port(), {plugin: descriptor.id});
    return remoteCheckModels({
        available: () => Promise.resolve(implementation.methods.available()),
        ask: (input: Parameters<typeof implementation.methods.ask>[0], options: {signal: AbortSignal}) => implementation.methods.ask(input, {signal: options.signal}),
    } as never);
}

/** 记进证据的一章：各次调用的问题与答案、发现、用量。 */
function report(name: string, record: CheckRecord, found: object): void {
    console.log(`\n===== ${name} =====`);
    for (const call of record.calls) console.log(`[${call.layer}] ${call.question.replace(/\n/gu, " ").slice(0, 160)}\n  -> ${JSON.stringify(call.answer)}`);
    console.log(`发现：${JSON.stringify(Object.fromEntries(Object.entries(found).map(([id, items]) => [id.replace("nbook.plot.", ""), (items as unknown[]).length])))}`);
    console.log(`新事实：${JSON.stringify(record.newFacts)}；不完整：${JSON.stringify(record.incomplete)}；引文对不上：${String(badQuotesOf(record))}`);
    console.log(`用量：${JSON.stringify(record.usage)}`);
}

const reveal = (point: string, mode: "hint" | "explicit"): Mark => ({kind: MARK_IDS.reveal, version: 1, point, mode});
const node = (foreshadow: string, role: string): Mark => ({kind: MARK_IDS.node, version: 1, foreshadow, role});
const inText = (w: PlotWorld, chapterId: string, quote: string, marks: Mark[] = []): TellingDraft => {
    w.texts.set(chapterId, `${w.texts.get(chapterId) ?? ""}${quote}。\n`);
    return {source: "chapter", chapter: chapterId, quote, ...(marks.length === 0 ? {} : {marks})};
};

describe.skipIf(!enabled)("写完以后的检查接真实模型", () => {
    test("验收 1：卫兵认出勇者，改成例行盘问；验收 2：试读与泄底", async () => {
        const models = await realModels();

        const a = new PlotWorld(CHAPTERS);
        const hero = a.person("勇者");
        const guard = a.person("卫兵");
        a.point("勇者左手有星形的疤", hero, {保密: "secret"});
        a.texts.set("ch4", "城门口排着长队。旅人戴着一只旧手套，低头走到卫兵面前。\n卫兵盯着旅人的左手看了很久，忽然压低声音：“把手套摘下来。你就是那个勇者吧。”\n旅人没有回答，把手往袖子里缩了缩。\n");
        a.change(chapter("ch4"), {cast: [present(guard)]});
        const slip = await runOk(a, "ch4", models);
        const slipFound = reported(a, [slip]);
        report("验收 1（穿帮）", slip, slipFound);
        expect(slip.calls.length).toBeGreaterThanOrEqual(3);

        a.texts.set("ch4", "城门口排着长队。旅人戴着一只旧手套，低头走到卫兵面前。\n卫兵翻了翻他的路引，打了个哈欠：“下一个。”勇者收起路引，进了城。\n");
        const routine = await runOk(a, "ch4", models);
        const routineFound = reported(a, [routine]);
        report("验收 1（例行盘问）", routine, routineFound);

        const b = new PlotWorld(CHAPTERS);
        const butler = b.person("管家");
        const k = b.point("管家是凶手", butler, {保密: "secret", 读者问题: "谁杀了男爵"});
        const fs = b.foreshadow("真凶之谜", {种类: "mystery", 答案: {ref: k}});
        b.change(chapter("ch3"), {told: [inText(b, "ch3", "清晨，男爵被发现死在书房，胸口插着一把裁纸刀", [node(fs, "plant")])]});
        b.change(chapter("ch6"), {told: [inText(b, "ch6", "园丁的鞋上沾着书房窗下的泥", [node(fs, "mislead")])]});
        b.texts.set("ch11", "警探把所有人叫到客厅，一个一个地问话。\n");
        b.change(chapter("ch12"), {told: [inText(b, "ch12", "深夜，管家独自在储藏室里，仔细擦拭一副沾血的手套，又把它塞进炉子里烧掉")]});
        b.change(chapter("ch20"), {kind: "plan", told: [{source: "outline", chapter: "ch20", anchor: "细纲", marks: [reveal(k, "explicit")]}]});
        const trial = await runOk(b, "ch12", models);
        const trialFound = reported(b, [trial]);
        report("验收 2（试读）", trial, trialFound);
        expect(trial.usage.trial).toBe(1);
        expect(trialFound[CHECK_DIAGNOSTIC_IDS.stale]).toBeUndefined();
    }, 600_000);
});
