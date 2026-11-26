/**
 * 浏览器 Agent 评测的命令行（用法见同目录 `README.md`）。机器读的输出写到标准输出（版本化 JSON），进度与诊断写到标准错误。
 * 退出码：0 成功，1 运行出错，2 参数或环境不对。
 */

import {dirname, join, resolve} from "node:path";

import {Command, CommanderError} from "commander";

import {resolveAgentTempRoot} from "@notnotype/neuro-book-test-support/paths";

import {EvalEnvError, defaultEnvFile, readEnvFile} from "./env";
import {RunRecordSchema} from "./record/schema";
import {attemptDir, readJson, tryDir, tryLayout} from "./record/store";
import {ProjectionLeakError, writeReport} from "./report/report";
import {startGateway} from "./runner/gateway";
import {MODELS, assertNoProxyEnv, routesFor} from "./runner/models";
import type {ModelChoice} from "./runner/models";
import {runSchedule} from "./runner/schedule";
import type {Cell} from "./runner/schedule";
import {startSite} from "./sites/server";
import type {RunningSite} from "./sites/server";
import {PHASE1, TASKS} from "./tasks/index";
import {probeTask} from "./tasks/probe";
import type {TaskDefinition} from "./tasks/types";

interface CommonOptions {
    readonly out?: string;
    readonly envFile?: string;
    readonly modelProxy?: string;
    readonly buPython?: string;
    readonly chrome?: string;
    readonly concurrency: string;
    readonly geminiLimit: string;
    readonly maxSteps: string;
    readonly maxTotalInputTokens?: string;
    readonly models: string;
}

/** 参数不对：以 2 退出。 */
class UsageError extends Error {}

function positiveInteger(value: string, label: string): number {
    const number = Number(value);
    if (!/^\d+$/u.test(value) || number < 1) throw new UsageError(`${label} must be a positive integer, got ${value}`);
    return number;
}

/** 按逗号分隔的名字从已知的里挑；不认识的名字报参数错误并列出认识的。 */
function pick<T extends {readonly id: string}>(spec: string, known: readonly T[], label: string): T[] {
    return spec.split(",").map((raw) => {
        const id = raw.trim();
        const found = known.find((item) => item.id === id);
        if (found === undefined) throw new UsageError(`unknown ${label}: ${id} (known: ${known.map((item) => item.id).join(", ")})`);
        return found;
    });
}

function log(message: string): void {
    process.stderr.write(`[${new Date().toISOString().slice(11, 19)}] ${message}\n`);
}

/** run 与 probe 共用的准备：检查环境、读密钥、起网关，交回调度要的东西。 */
async function prepare(options: CommonOptions) {
    assertNoProxyEnv();
    const envFile = options.envFile ?? await defaultEnvFile(import.meta.dir);
    const models = pick(options.models, MODELS, "model");
    const routes = routesFor(models, await readEnvFile(envFile), envFile, options.modelProxy ?? process.env.NBOOK_EVAL_MODEL_PROXY ?? null);
    const stamp = new Date().toISOString().replace(/[-:]/gu, "").replace(/\..*$/u, "");
    const out = resolve(options.out ?? join(resolveAgentTempRoot(), "acceptance", "browser-eval", stamp));
    const buPython = resolve(options.buPython ?? join(dirname(envFile), ".local/agent/evals/browser/venv/bin/python"));
    if (!(await Bun.file(buPython).exists())) throw new EvalEnvError("env-file-missing", `browser-use python not found: ${buPython} (see evals/browser/README.md)`);
    const gateway = startGateway({routes});
    const tempRoot = join(resolveAgentTempRoot(), "acceptance", "browser-eval", `chrome-${process.pid}`);
    return {models, out, buPython, gateway, tempRoot};
}

/** 按“第几次、题、模型”排格：先把每道题每个模型的第 1 次都跑一遍，早出的结果覆盖得全。 */
function cellsFor(tasks: readonly TaskDefinition[], models: readonly ModelChoice[], repeat: number): Cell[] {
    const cells: Cell[] = [];
    for (let attempt = 1; attempt <= repeat; attempt++) for (const task of tasks) for (const model of models) cells.push({task, model, arm: "browser-use", attempt});
    return cells;
}

function program(): Command {
    const cli = new Command("browser-eval").description("浏览器 Agent 评测").exitOverride().configureOutput({outputError: (text) => process.stderr.write(text)});
    const common = (command: Command) => command
        .option("--models <ids>", `模型，逗号分隔（${MODELS.map((m) => m.id).join("、")}）`, MODELS.map((m) => m.id).join(","))
        .option("--out <dir>", "运行目录（缺省在系统 Temp 下新建一个并打印）")
        .option("--env-file <path>", "模型密钥的 .env（缺省是主工作区根的）")
        .option("--model-proxy <url>", "发往 extremelycat 的模型请求走的代理（或环境变量 NBOOK_EVAL_MODEL_PROXY）")
        .option("--bu-python <path>", "browser-use 环境里的 python（缺省 .local/agent/evals/browser/venv/bin/python）")
        .option("--chrome <path>", "Chrome 的路径（缺省 /usr/bin/google-chrome-stable）")
        .option("--concurrency <n>", "同时跑几个", "4")
        .option("--gemini-limit <n>", "extremelycat 同时最多几个", "2")
        .option("--max-steps <n>", "执行者最多几次模型请求", "100")
        .option("--max-total-input-tokens <n>", "整批的总输入 token 止损线");

    common(cli.command("run").description("跑题并落盘；同一个 --out 再跑时续跑"))
        .option("--tasks <ids>", `题，逗号分隔，或 phase1（${PHASE1.join("、")}）`, "phase1")
        .option("--repeat <n>", "每题每模型跑几次", "1")
        .action(async (options: CommonOptions & {tasks: string; repeat: string}) => {
            const tasks = options.tasks === "phase1" ? TASKS : pick(options.tasks, TASKS, "task");
            const prepared = await prepare(options);
            log(`out: ${prepared.out}`);
            try {
                const summary = await runSchedule({
                    out: prepared.out,
                    cells: cellsFor(tasks, prepared.models, positiveInteger(options.repeat, "--repeat")),
                    concurrency: positiveInteger(options.concurrency, "--concurrency"),
                    providerLimits: {extremelycat: positiveInteger(options.geminiLimit, "--gemini-limit")},
                    gateway: prepared.gateway,
                    buPython: prepared.buPython,
                    chromePath: options.chrome,
                    tempRoot: prepared.tempRoot,
                    maxTotalInputTokens: options.maxTotalInputTokens === undefined ? null : positiveInteger(options.maxTotalInputTokens, "--max-total-input-tokens"),
                    maxSteps: positiveInteger(options.maxSteps, "--max-steps"),
                    log,
                });
                process.stdout.write(`${JSON.stringify({format: "nbook.browser-eval.run-summary/v1", out: prepared.out, ...summary})}\n`);
            } finally {
                await prepared.gateway.stop();
            }
        });

    common(cli.command("probe").description("每个模型跑一道最小题，核对网关记下的实收参数（推理档、工具、图片）"))
        .action(async (options: CommonOptions) => {
            const prepared = await prepare(options);
            log(`out: ${prepared.out}`);
            try {
                await runSchedule({
                    out: prepared.out,
                    cells: cellsFor([probeTask], prepared.models, 1),
                    concurrency: prepared.models.length,
                    providerLimits: {extremelycat: positiveInteger(options.geminiLimit, "--gemini-limit")},
                    gateway: prepared.gateway,
                    buPython: prepared.buPython,
                    chromePath: options.chrome,
                    tempRoot: prepared.tempRoot,
                    maxTotalInputTokens: null,
                    maxSteps: 5,
                    log,
                });
            } finally {
                await prepared.gateway.stop();
            }
            for (const model of prepared.models) {
                const attempt = attemptDir(prepared.out, {taskId: probeTask.id, model: model.id, arm: "browser-use", attempt: 1});
                const record = await readJson(tryLayout(tryDir(attempt, 1)).record, RunRecordSchema);
                const calls = record?.usage.gateway ?? [];
                process.stdout.write(`${JSON.stringify({format: "nbook.browser-eval.probe/v1", model: model.id, outcome: record?.outcome ?? null, answer: record?.result.finalAnswer ?? null, requests: calls.length, reasoningEfforts: [...new Set(calls.map((c) => c.reasoningEffort))], maxTokens: [...new Set(calls.map((c) => c.maxTokens))], tools: [...new Set(calls.map((c) => c.tools))], maxImages: Math.max(0, ...calls.map((c) => c.images)), upstream: calls.map((c) => c.upstream), usageKnown: calls.filter((c) => c.usage !== null).length})}\n`);
            }
        });

    cli.command("report")
        .description("从运行目录出报表：私有的 report.json、report.html 与可入库的投影 summary.json、summary.html")
        .requiredOption("--out <dir>", "运行目录")
        .action(async (options: {out: string}) => {
            const paths = await writeReport(resolve(options.out));
            process.stdout.write(`${JSON.stringify({format: "nbook.browser-eval.report-paths/v1", ...paths})}\n`);
        });

    cli.command("sites")
        .description("只起假站，给人工打开看页面；Ctrl-C 停止")
        .option("--task <id>", "按这道题的种子起它的站（缺省每个站各起一份，用第一道用到它的题的种子）")
        .action(async (options: {task?: string}) => {
            const tasks = options.task === undefined ? TASKS.filter((task, i) => TASKS.findIndex((other) => other.site === task.site) === i) : pick(options.task, TASKS, "task");
            const sites: Array<RunningSite<unknown>> = [];
            for (const task of tasks) {
                const site = await startSite(task.site, task.seed);
                sites.push(site);
                process.stdout.write(`${JSON.stringify({format: "nbook.browser-eval.sites/v1", site: task.site.name, task: task.id, urls: site.urls})}\n`);
            }
            await new Promise<void>((resolveSignal) => {
                process.once("SIGINT", resolveSignal);
                process.once("SIGTERM", resolveSignal);
            });
            await Promise.all(sites.map((site) => site.stop()));
        });
    return cli;
}

try {
    await program().parseAsync(process.argv);
} catch (error) {
    if (error instanceof CommanderError) process.exit(error.exitCode === 0 ? 0 : 2);
    if (error instanceof ProjectionLeakError) {
        process.stderr.write(`projection-leak: ${error.message}\n`);
        process.exit(1);
    }
    if (error instanceof EvalEnvError || error instanceof UsageError) {
        process.stderr.write(`${error instanceof EvalEnvError ? error.code : "usage"}: ${error.message}\n`);
        process.exit(2);
    }
    process.stderr.write(`${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
    process.exit(1);
}
