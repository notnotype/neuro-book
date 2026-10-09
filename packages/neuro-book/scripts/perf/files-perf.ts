/**
 * Files 的性能验收（docs/specs/workbench/files-explorer.md 的“打开与切换”与验收 12，w00017 t72 的计划）：在系统测试
 * 临时根里生成样本项目，生产构建，再由 Node 运行的 `browser-runner.ts` 起服务、开本机 Chrome（无头）逐项测。本脚本
 * 负责样本、构建、结果清单与清理；浏览器部分必须由 Node 运行（Bun 下 Playwright 的 CDP 握手会超时）。
 *
 *   bun run perf:files -- [--count 3000] [--seed 42017] [--wide 400] [--sources 60] [--iterations 30] [--opens 10]
 *                          [--only A1+A2,B1] [--server-profile] [--skip-build] [--keep-temp] [--out <目录>]
 *
 * 结果写到 `--out`（缺省在系统临时根下另建 `neuro-book-perf-results/<时间>`）：`summary.json`、`report.md`。样本、
 * 状态根与服务日志在运行临时根里，结束时删除（`--keep-temp` 保留并打印路径）。任一场景失败或未执行都以非零退出。
 * 产品代码没有为测量加任何东西：只读页面上已有的 DOM 状态、浏览器的性能接口与 RPC 帧。
 */

import {execFileSync, spawn} from "node:child_process";
import {randomUUID} from "node:crypto";
import {mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {loadavg, tmpdir} from "node:os";
import {join, resolve} from "node:path";

import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {writeSample} from "../files-sample";
import type {RunnerConfig, RunnerOutput, ScenarioResult} from "./browser-runner";
import type {Summary} from "./stats";

const PACKAGE_ROOT = resolve(import.meta.dir, "..", "..");

interface Options {
    readonly count: number;
    readonly seed: number;
    readonly wide: number;
    readonly sources: number;
    readonly iterations: number;
    readonly opens: number;
    readonly only: ReadonlyArray<string>;
    readonly serverProfile: boolean;
    readonly skipBuild: boolean;
    readonly keepTemp: boolean;
    readonly out: string | null;
}

function parseArgs(argv: ReadonlyArray<string>): Options {
    const options = {count: 3000, seed: 42017, wide: 400, sources: 60, iterations: 30, opens: 10, only: [] as string[], serverProfile: false, skipBuild: false, keepTemp: false, out: null as string | null};
    for (let index = 0; index < argv.length; index += 1) {
        const flag = argv[index];
        const value = (): string => {
            const next = argv[index + 1];
            if (next === undefined) throw new Error(`${String(flag)} 需要一个值`);
            index += 1;
            return next;
        };
        const integer = (): number => {
            const parsed = Number(value());
            if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${String(flag)} 要一个正整数`);
            return parsed;
        };
        if (flag === "--count") options.count = integer();
        else if (flag === "--seed") options.seed = integer();
        else if (flag === "--wide") options.wide = integer();
        else if (flag === "--sources") options.sources = integer();
        else if (flag === "--iterations") options.iterations = integer();
        else if (flag === "--opens") options.opens = integer();
        else if (flag === "--only") options.only = value().split(",").map((id) => id.trim()).filter((id) => id !== "");
        else if (flag === "--server-profile") options.serverProfile = true;
        else if (flag === "--skip-build") options.skipBuild = true;
        else if (flag === "--keep-temp") options.keepTemp = true;
        else if (flag === "--out") options.out = resolve(value());
        else throw new Error(`不认识的参数：${String(flag)}`);
    }
    // 源码场景：第一次加 iterations 次冷打开，再留两个给已打开过的场景。
    if (options.sources < options.iterations + 3) throw new Error(`--sources 至少要比 --iterations 多 3（现在 ${String(options.sources)}）`);
    return options;
}

async function run(command: string, args: ReadonlyArray<string>): Promise<number | null> {
    const child = spawn(command, args, {cwd: PACKAGE_ROOT, stdio: "inherit"});
    return new Promise<number | null>((resolveExit) => child.on("exit", resolveExit));
}

function revision(): string {
    try {
        const head = execFileSync("git", ["rev-parse", "--short", "HEAD"], {cwd: PACKAGE_ROOT, encoding: "utf8"}).trim();
        const dirty = execFileSync("git", ["status", "--porcelain", "--untracked-files=no"], {cwd: PACKAGE_ROOT, encoding: "utf8"}).trim() !== "";
        return dirty ? `${head}（工作区有未提交的改动）` : head;
    } catch (error) {
        return `未知（${error instanceof Error ? error.message : String(error)}）`;
    }
}

const round2 = (value: number): number => Math.round(value * 100) / 100;

async function main(): Promise<number> {
    const options = parseArgs(process.argv.slice(2));
    const out = options.out ?? join(tmpdir(), "neuro-book-perf-results", new Date().toISOString().replaceAll(":", "-"));
    await mkdir(out, {recursive: true});
    const root = await createTestTmpRoot("neuro-book-perf", "files-perf");
    const loadBefore = loadavg();
    let output: RunnerOutput | null = null;
    let runnerExit: number | null = null;
    const problems: string[] = [];
    try {
        if (!options.skipBuild && (await run("bun", ["run", "build"])) !== 0) throw new Error("生产构建失败");
        const book = join(root, "Book");
        const stateRoot = join(root, "state");
        const logDirectory = join(root, "logs");
        await mkdir(logDirectory, {recursive: true});
        const description = await writeSample(book, {count: options.count, seed: options.seed, wide: options.wide, sources: options.sources});
        const id = randomUUID();
        await mkdir(join(book, ".nbook"), {recursive: true});
        await writeFile(join(book, ".nbook", "project.json"), JSON.stringify({schema: 1, id}));
        await mkdir(join(stateRoot, "user"), {recursive: true});
        await writeFile(join(stateRoot, "projects.json"), JSON.stringify({schema: 1, projects: [{id, name: "book", path: book}]}));

        const config: RunnerConfig = {
            packageRoot: PACKAGE_ROOT,
            stateRoot,
            bookRoot: book,
            logDirectory,
            iterations: options.iterations,
            opens: options.opens,
            serverProfile: options.serverProfile,
            roots: ["project://data", "project://lorebook.content", "project://manuscripts", "project://notes"],
            wide: {address: `project://${description.wideDirectory.path}`, entries: description.wideDirectory.entries},
            sources: description.sources,
            only: options.only,
        };
        const configPath = join(root, "runner-config.json");
        const resultPath = join(root, "runner-result.json");
        await writeFile(configPath, JSON.stringify(config));
        runnerExit = await run("node", ["scripts/perf/browser-runner.ts", configPath, resultPath]);
        output = JSON.parse(await readFile(resultPath, "utf8")) as RunnerOutput;
        const summary = {
            date: new Date().toISOString(),
            revision: revision(),
            command: `bun run perf:files -- ${process.argv.slice(2).join(" ")}`.trim(),
            options,
            machine: {loadBefore: loadBefore.map(round2), loadAfter: loadavg().map(round2)},
            sample: {count: description.count, sources: description.sources.length, wide: description.wideDirectory, totalBytes: description.totalBytes, seed: description.seed},
            ...output,
        };
        await writeFile(join(out, "summary.json"), `${JSON.stringify(summary, null, 2)}\n`);
        await writeFile(join(out, "report.md"), report(summary));
        process.stdout.write(report(summary));
    } catch (error) {
        problems.push(error instanceof Error ? (error.stack ?? error.message) : String(error));
        console.error(problems.at(-1));
    } finally {
        if (options.keepTemp) console.log(`运行临时根保留在：${root}`);
        else await rm(root, {recursive: true, force: true});
        console.log(`结果：${out}`);
    }
    const incomplete = output === null || output.results.some((result) => result.status !== "ok") || output.problems.length > 0;
    return problems.length > 0 || runnerExit !== 0 || incomplete ? 1 : 0;
}

interface ReportInput {
    readonly date: string;
    readonly revision: string;
    readonly command: string;
    readonly chrome: string;
    readonly unsupported: ReadonlyArray<string>;
    readonly machine: {readonly loadBefore: ReadonlyArray<number>; readonly loadAfter: ReadonlyArray<number>};
    readonly sample: {readonly count: number; readonly sources: number; readonly wide: {readonly entries: number}};
    readonly results: ReadonlyArray<ScenarioResult>;
    readonly progress: ReadonlyArray<unknown>;
    readonly problems: ReadonlyArray<string>;
    readonly serverProfiles: RunnerOutput["serverProfiles"];
}

function report(summary: ReportInput): string {
    const cell = (value: Summary | undefined): string => (value === undefined ? "—" : `${String(value.p50)} / ${String(value.p95)} / ${String(value.max)}`);
    const lines = [
        `# Files 性能（${String(summary.sample.count)} 个 Markdown、${String(summary.sample.sources)} 个源码文件、宽目录 ${String(summary.sample.wide.entries)} 项）`,
        "",
        `- 时间 ${summary.date}，源码 ${summary.revision}，Chrome ${summary.chrome}（无头，1440×1000）`,
        `- 命令：\`${summary.command}\``,
        `- 负载（1/5/15 分钟）：运行前 ${summary.machine.loadBefore.join(" / ")}，运行后 ${summary.machine.loadAfter.join(" / ")}`,
        `- 浏览器不支持的观察类型：${summary.unsupported.length === 0 ? "无" : summary.unsupported.join("、")}；进度条出现 ${String(summary.progress.filter((entry) => (entry as {kind?: string}).kind === "added").length)} 次`,
        "- 时长单位毫秒，写作 p50 / p95 / 最大值；committed 是条件第一次成立的帧，presented 是其后一帧（已呈现）。",
        "",
        "| 编号 | 场景 | 状态 | 次数 | 选中与标签 presented | 帧数 | 完成 committed | 完成 presented | 长动画帧（次数，最长） | 请求 |",
        "|---|---|---|---|---|---|---|---|---|---|",
        ...summary.results.map((result) => `| ${[
            result.id,
            result.name,
            result.status === "ok" ? "ok" : `**${result.status}**`,
            String(result.samples ?? "—"),
            cell(result.feedback?.presented),
            cell(result.feedback?.frames),
            cell(result.done?.committed),
            cell(result.done?.presented),
            result.longFrames === undefined ? "—" : result.longFrames === "unavailable" ? "不可用" : `${String(result.longFrames.count)}，${String(result.longFrames.longest)}`,
            Object.entries(result.requests ?? {}).map(([kind, count]) => `${kind} ×${String(count)}`).join("；") || "—",
        ].join(" | ")} |`),
        "",
        "## 其它数值",
        "",
        ...summary.results.flatMap((result) => [
            ...Object.entries(result.values ?? {}).map(([name, value]) => `- ${result.id} ${name}：${cell(value)}`),
            ...(result.received === undefined ? [] : [`- ${result.id} 收到的变化事件帧：${JSON.stringify(result.received)}`]),
            ...(result.notes ?? []).map((note) => `- ${result.id} ${note}`),
            ...(result.error === undefined ? [] : [`- ${result.id} 失败：${result.error.split("\n")[0] ?? ""}`]),
        ]),
        ...(summary.serverProfiles.length === 0 ? [] : ["", "## 服务端 CPU 热点", "", ...summary.serverProfiles.map((profile) => `- ${profile.label}：${profile.hotspots.slice(0, 10).map((entry) => `${entry.name} ${String(entry.selfMs)} ms`).join("；")}`)]),
        ...(summary.problems.length === 0 ? [] : ["", "## 问题", "", ...summary.problems.map((problem) => `- ${problem.split("\n")[0] ?? ""}`)]),
        "",
    ];
    return lines.join("\n");
}

process.exitCode = await main();
