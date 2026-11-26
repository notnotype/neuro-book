/**
 * 一回运行的起停与收尾（实机：真 Chrome、真 bwrap、真假站与网关）。执行者换成一个按场景写死的小脚本，放在假的
 * Python 环境里（调度器把 `--bu-python` 当成任意可执行文件），走“正常交付”“不发 ready”“过了时限不退出”三条路：
 * 断言结局与运行记录，以及收尾之后 Chrome 的调试端口、假站的端口都不在了、假密钥回 401。
 */

import {afterEach, describe, expect, test} from "bun:test";
import {chmod, mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {PLAN_FORMAT} from "../record/plan";
import {RunRecordSchema, ScoreSchema} from "../record/schema";
import {attemptDir, readJson, tryDir, tryLayout} from "../record/store";
import {probeTask} from "../tasks/probe";
import {defineTask, taskVersion} from "../tasks/types";
import type {TaskDefinition} from "../tasks/types";
import {startGateway} from "./gateway";
import type {ModelChoice} from "./models";
import {runSchedule} from "./schedule";

const live = process.env.NBOOK_EVAL_LIVE === "1";
const cleanups: Array<() => Promise<unknown>> = [];
afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

const MODEL: ModelChoice = {id: "fake", model: "fake-model", reasoning: "medium", provider: "luna-relay"};
const EVENT = (event: string) => `echo '{"schema":"nbook.browser-eval.event/v1","event":"${event}","line":"page_info()","at":0}'`;
const OUTPUT = JSON.stringify({format: "nbook.browser-eval.executor/v1", status: "completed", success: true, finalAnswer: "答案：你好，雾港作者", error: null, partial: null, usage: null, steps: [{code: "page_info()", output: "ok", error: null}], thinking: [], deliverables: [], versions: {"browser-use": "fake", python: "fake"}});

const SCRIPTS = {
    delivers: `${EVENT("ready")}\n${EVENT("step")}\necho '${OUTPUT}' > /tmp/out/executor.json\n${EVENT("done")}`,
    neverReady: "sleep 30",
    overstays: `${EVENT("ready")}\nsleep 60`,
};

/** 一个“假的 Python 环境”：`bin/python` 是按场景写死的 bash 脚本，不管调度器传什么参数。 */
async function fakePython(root: string, script: string): Promise<string> {
    const bin = join(root, "fake-venv", "bin");
    await mkdir(bin, {recursive: true});
    const python = join(bin, "python");
    await writeFile(python, `#!/bin/bash\n${script}\n`);
    await chmod(python, 0o755);
    return python;
}

async function run(script: string, task: TaskDefinition, timing: {readyTimeoutMs?: number; backstopGraceMs?: number} = {}) {
    const root = await createTestTmpRoot("neuro-book-browser-eval", "调度");
    cleanups.push(() => rm(root, {recursive: true, force: true}));
    const out = join(root, "out");
    const tempRoot = join(root, "temp");
    const gateway = startGateway({routes: [{model: MODEL.model, baseUrl: "http://127.0.0.1:9/v1", apiKey: "k", proxy: null}]});
    cleanups.push(() => gateway.stop());
    const summary = await runSchedule({
        out,
        plan: {format: PLAN_FORMAT, tasks: [{id: task.id, version: taskVersion(task)}], models: [{id: MODEL.id, model: MODEL.model, reasoning: MODEL.reasoning}], arms: ["browser-use"], repeat: 1, maxSteps: 5},
        cells: [{task, model: MODEL, arm: "browser-use", attempt: 1}],
        concurrency: 1,
        providerLimits: {},
        maxTotalInputTokens: null,
        gateway,
        buPython: await fakePython(root, script),
        tempRoot,
        hide: [],
        log: () => undefined,
        ...timing,
    });
    const layout = tryLayout(tryDir(attemptDir(out, {taskId: task.id, model: MODEL.id, arm: "browser-use", attempt: 1}), 1));
    const job = JSON.parse(await readFile(join(layout.job, "job.json"), "utf8")) as {cdpUrl: string; gatewayKey: string};
    const ready = JSON.parse(await readFile(layout.ready, "utf8")) as {urls: {main: string}};
    return {summary, record: await readJson(layout.record, RunRecordSchema), score: await readJson(layout.score, ScoreSchema), job, ready, gatewayUrl: gateway.url};
}

/** 收尾之后：Chrome 的调试端口与假站都连不上了，假密钥回 401。 */
async function expectCleanedUp(result: Awaited<ReturnType<typeof run>>): Promise<void> {
    const cdpHttp = result.job.cdpUrl.replace(/^ws:/u, "http:").replace(/\/devtools\/.*$/u, "/json/version");
    expect(await fetch(cdpHttp).then(() => "open", () => "closed")).toBe("closed");
    expect(await fetch(result.ready.urls.main).then(() => "open", () => "closed")).toBe("closed");
    const gatewayCall = await fetch(`${result.gatewayUrl}/chat/completions`, {method: "POST", headers: {authorization: `Bearer ${result.job.gatewayKey}`, "content-type": "application/json"}, body: "{}"});
    expect(gatewayCall.status).toBe(401);
}

describe.skipIf(!live)("一回运行的起停与收尾", () => {
    test("正常交付：结局 completed，按回答判分，步骤配上了事件；收尾之后都收掉了", async () => {
        const result = await run(SCRIPTS.delivers, probeTask);
        expect(result.summary).toMatchObject({settled: 1, failed: 0});
        expect(result.record?.outcome.kind).toBe("completed");
        expect(result.record?.steps.map((step) => [step.code, step.executed, step.event])).toEqual([["page_info()", true, 1]]);
        expect(result.record?.timing.executorEndedAt).not.toBeNull();
        expect(result.score?.score).toBe(100);
        await expectCleanedUp(result);
    }, 60_000);

    test("执行者不发 ready：到等待时限结束它，记成 harness-error（不计分、要重跑）；收尾之后都收掉了", async () => {
        const result = await run(SCRIPTS.neverReady, probeTask, {readyTimeoutMs: 1_500});
        expect(result.record?.outcome).toMatchObject({kind: "harness-error", phase: "startup"});
        expect(result.record?.notes.some((note) => note.startsWith("executor sent no ready event"))).toBe(true);
        expect(result.score?.score).toBeNull();
        await expectCleanedUp(result);
    }, 120_000);

    test("执行者过了时限还不退出：在“时限 + 宽限”兜底结束，记成 timeout（计分）；收尾之后都收掉了", async () => {
        const short = defineTask({...probeTask, id: "probe-short", timeLimitSec: 1});
        const result = await run(SCRIPTS.overstays, short as TaskDefinition, {backstopGraceMs: 500});
        expect(result.record?.outcome).toMatchObject({kind: "timeout", detail: "killed at backstop"});
        expect(result.score?.score).toBe(0);
        await expectCleanedUp(result);
    }, 60_000);
});
