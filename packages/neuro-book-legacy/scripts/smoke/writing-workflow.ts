/**
 * 写作 workflow 真实模型端到端冒烟（Task 122 落地成果 + Task 116 cancel 挂账项）。
 *
 * 覆盖两个内置 workflow：
 * - consistency-audit（只读）：assets/workspace/.nbook/agent/workflows/consistency-audit/workflow.ts
 * - chapter-write-review-revise（写盘）：assets/workspace/.nbook/agent/workflows/chapter-write-review-revise/workflow.ts
 * 以及一个 cancel 场景：对一个进行中的 consistency-audit run 发起取消，断言其终态收敛到 cancelled。
 *
 * 前提模式：
 * - dev server 已启动（bun run dev），Provider apiKey 已在 workspace/.nbook/config.json 或设置页配置好；
 * - 用户提供一个已经 open 的现成测试项目，脚本不自建、不 open 项目；
 * - --project 使用单段 Project Root，直接透传给 POST /api/agent/workflow/runs；本地检查与写盘结果从
 *   <State Root>/workspace/<projectRoot> 读取，因此脚本与 dev server 必须使用同一 State Root。
 *
 * 用法示例（在应用包目录执行）：
 *   bun run smoke:writing-workflow -- --help
 *   bun run smoke:writing-workflow -- --project ming-ding-zhi-shi-2 \
 *     --chapters manuscript/001-volume/001-chapter/index.md,manuscript/001-volume/002-chapter/index.md \
 *     --write-chapter manuscript/001-volume/003-chapter/index.md \
 *     --brief "写一段冒烟测试用的过场戏"
 *
 * 环境变量：
 *   AGENT_HTTP_BASE_URL   dev server 地址，默认 http://localhost:3000（与 agent-http.ts 同口径）。
 */

import {existsSync, statSync} from "node:fs";
import {readFile} from "node:fs/promises";
import path from "node:path";
import type {JsonValue} from "nbook/server/agent/messages/types";
import type {AgentJobStatus} from "nbook/server/agent/jobs/agent-job-manager";
import {resolveStateRoot} from "nbook/server/runtime/installation-paths";
import {projectWorkspaceRef} from "nbook/server/workspace-files/project-identity";

const BASE_URL = process.env.AGENT_HTTP_BASE_URL ?? "http://localhost:3000";
/** 轮询间隔与上限：真实模型多轮调用可能耗时较久，给足 10 分钟。 */
const POLL_INTERVAL_MS = 2_000;
const POLL_TIMEOUT_MS = 10 * 60 * 1000;

/** 缺省写盘场景 brief：明确标注这是冒烟测试章节，避免污染真实剧情语境。 */
const DEFAULT_BRIEF = [
    "这是一次冒烟测试用的章节写作任务，写出的内容不代表真实剧情，也不会被采纳。",
    "请写一段 300-600 字的短篇过场：主角在书房整理旧信件时，发现一张来历不明的地图残片。",
    "只需要基本的场景描写和一个小悬念收尾，不需要展开复杂的多线索伏笔。",
].join("\n");

type CliOptions = {
    /** 单段 Project Root；直接透传给 API，也用于 State Root 下的本地文件解析。 */
    projectRoot: string;
    /** consistency-audit 的章节清单原始字符串（逗号/换行分隔）；未提供时该场景与 cancel 场景一起跳过。 */
    chapters: string | null;
    /** chapter-write-review-revise 的目标章节 index.md 路径；未提供时跳过写盘场景。 */
    writeChapter: string | null;
    brief: string;
    /** 只跑只读（consistency-audit）与 cancel 场景。 */
    skipWrite: boolean;
};

export type ScenarioStatus = "passed" | "failed" | "skipped";

export type ScenarioResult = {
    name: string;
    status: ScenarioStatus;
    detail: string;
    durationMs: number;
};

/** `runWritingWorkflowSmoke` 的运行选项；CLI 与真实模型测试共用。 */
export type WritingWorkflowSmokeOptions = {
    /** dev server 地址；缺省依次读 AGENT_HTTP_BASE_URL、http://localhost:3000。 */
    baseUrl?: string;
    /** 单段 Project Root。 */
    projectRoot: string;
    /** consistency-audit 的章节清单原始字符串；未提供时该场景与 cancel 场景跳过。 */
    chapters: string | null;
    /** chapter-write-review-revise 的目标章节路径；未提供时写盘场景跳过。 */
    writeChapter?: string | null;
    /** 写盘场景的写作任务；缺省使用内置冒烟 brief。 */
    brief?: string;
    /** 只跑只读（consistency-audit）与 cancel 场景。 */
    skipWrite?: boolean;
    /** 写盘场景是否在本地读取目标章节断言非空；与 dev server 不同 State Root 的调用方传 false。 */
    verifyChapterFile?: boolean;
};

/** GET /api/agent/jobs/[jobId] 的精简本地形状：只声明本脚本实际读取的字段。 */
type JobDetail = {
    jobId: string;
    status: AgentJobStatus;
    error?: string;
    /** completed 时是 WorkflowJobResult（server/agent/workflow/workflow-job.ts），其余状态缺省。 */
    result?: JsonValue;
};

/**
 * 执行写作 workflow 冒烟场景；外部前置（dev server、项目）由调用方负责 gate，
 * 场景自身失败以 `ScenarioResult.status === "failed"` 返回。
 */
export async function runWritingWorkflowSmoke(options: WritingWorkflowSmokeOptions): Promise<ScenarioResult[]> {
    const baseUrl = options.baseUrl ?? BASE_URL;
    const results: ScenarioResult[] = [];

    if (!options.chapters) {
        results.push(skip("consistency-audit（只读）", "未提供 --chapters，跳过（不猜测项目章节结构）"));
        results.push(skip("cancel（consistency-audit）", "未提供 --chapters，cancel 场景需要一个可启动的 consistency-audit run，一并跳过"));
    } else {
        const chapterPaths = splitPaths(options.chapters);
        results.push(await runScenario("consistency-audit（只读）", () => runConsistencyAudit(baseUrl, options.projectRoot, options.chapters!, chapterPaths)));
        results.push(await runScenario("cancel（consistency-audit）", () => runCancelScenario(baseUrl, options.projectRoot, options.chapters!, chapterPaths)));
    }

    if (options.skipWrite) {
        results.push(skip("chapter-write-review-revise（写盘）", "--skip-write 已启用"));
    } else if (!options.writeChapter) {
        results.push(skip("chapter-write-review-revise（写盘）", "未提供 --write-chapter，跳过写盘场景"));
    } else {
        const projectAbsRoot = path.resolve(resolveStateRoot(), "workspace", options.projectRoot);
        results.push(await runScenario(
            "chapter-write-review-revise（写盘）",
            () => runChapterWriteReviewRevise(
                baseUrl,
                options.projectRoot,
                options.writeChapter!,
                options.brief ?? DEFAULT_BRIEF,
                projectAbsRoot,
                options.verifyChapterFile ?? true,
            ),
        ));
    }

    return results;
}

async function main(): Promise<void> {
    let options: CliOptions;
    try {
        options = parseArgs(process.argv.slice(2));
        assertProjectExists(options.projectRoot);
        await assertDevServerAlive();
    } catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
        return;
    }

    const results = await runWritingWorkflowSmoke({
        projectRoot: options.projectRoot,
        chapters: options.chapters,
        writeChapter: options.writeChapter,
        brief: options.brief,
        skipWrite: options.skipWrite,
    });

    printSummary(results);
    if (results.some((result) => result.status === "failed")) {
        process.exitCode = 1;
    }
}

// ── 参数解析 ──

function parseArgs(argv: string[]): CliOptions {
    let projectRoot: string | undefined;
    let chapters: string | undefined;
    let writeChapter: string | undefined;
    let brief: string | undefined;
    let skipWrite = false;

    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i];
        if (arg === "--help" || arg === "-h") {
            printUsage();
            process.exit(0);
        } else if (arg === "--project") {
            projectRoot = projectWorkspaceRef(requireArgValue(argv, ++i, "--project")).projectRoot;
        } else if (arg === "--chapters") {
            chapters = requireArgValue(argv, ++i, "--chapters");
        } else if (arg === "--write-chapter") {
            writeChapter = requireArgValue(argv, ++i, "--write-chapter");
        } else if (arg === "--brief") {
            brief = requireArgValue(argv, ++i, "--brief");
        } else if (arg === "--skip-write") {
            skipWrite = true;
        } else {
            throw new Error(`未知参数：${arg}（用 --help 查看用法）`);
        }
    }

    if (!projectRoot) {
        throw new Error("缺少必填参数 --project（测试项目的单段 Project Root）");
    }
    const trimmedChapters = chapters?.trim();
    return {
        projectRoot,
        chapters: trimmedChapters ? trimmedChapters : null,
        writeChapter: writeChapter?.trim() || null,
        brief: brief?.trim() || DEFAULT_BRIEF,
        skipWrite,
    };
}

function requireArgValue(argv: string[], index: number, flag: string): string {
    const value = argv[index];
    if (value === undefined) {
        throw new Error(`${flag} 缺少参数值`);
    }
    return value;
}

function printUsage(): void {
    console.log([
        "写作 workflow 端到端冒烟（真实模型，Task 122 + Task 116 cancel）",
        "",
        "用法：",
        "  bun run smoke:writing-workflow -- --project <project-root> [options]",
        "",
        "参数：",
        "  --project <root>        必填。测试项目的单段 Project Root",
        "  --chapters <paths>      可选。consistency-audit 的章节清单，逗号分隔的 Project Workspace 相对路径；",
        "                          缺省时跳过 consistency-audit 与 cancel 场景",
        "  --write-chapter <path>  可选。chapter-write-review-revise 的目标章节 index.md 路径；缺省跳过写盘场景",
        "  --brief <text>          可选。写盘场景的写作任务；缺省使用内置冒烟 brief",
        "  --skip-write            只跑只读（consistency-audit）与 cancel 场景",
        "",
        "环境变量：",
        "  AGENT_HTTP_BASE_URL     dev server 地址，默认 http://localhost:3000",
        "",
        "前提：dev server 已启动（bun run dev）；--project 指向的项目已 open；模型 Provider apiKey 已配置。",
        "脚本不会创建或打开项目（Task 118 正在改造 projects API）。",
    ].join("\n"));
}

// ── gate ──

/** 本地存在性检查：Project Root 在当前 State Root 下必须是一个真实目录。 */
function assertProjectExists(projectRoot: string): void {
    const absolute = path.resolve(resolveStateRoot(), "workspace", projectRoot);
    if (!existsSync(absolute) || !statSync(absolute).isDirectory()) {
        throw new Error(
            `--project 不存在：${projectRoot}（解析为 ${absolute}）。\n`
            + "请确认传入的是单段 Project Root，"
            + "且 dev server 与本脚本共用同一个 State Root。",
        );
    }
}

/** dev server 探活：打一个轻量 GET，失败即认定服务未启动。 */
async function assertDevServerAlive(): Promise<void> {
    try {
        const response = await fetch(`${BASE_URL}/api/app/version`);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }
    } catch (error) {
        throw new Error(
            `dev server 探活失败（GET ${BASE_URL}/api/app/version）：${error instanceof Error ? error.message : String(error)}。\n`
            + "请先执行 bun run dev 启动开发服务器，或检查 AGENT_HTTP_BASE_URL 是否指向正确端口。",
        );
    }
}

// ── 场景 ──

async function runScenario(name: string, fn: () => Promise<string>): Promise<ScenarioResult> {
    const startedAt = Date.now();
    try {
        const detail = await fn();
        return {name, status: "passed", detail, durationMs: Date.now() - startedAt};
    } catch (error) {
        return {
            name,
            status: "failed",
            detail: error instanceof Error ? error.message : String(error),
            durationMs: Date.now() - startedAt,
        };
    }
}

function skip(name: string, reason: string): ScenarioResult {
    return {name, status: "skipped", detail: reason, durationMs: 0};
}

/** 场景一：consistency-audit 只读审计。 */
async function runConsistencyAudit(baseUrl: string, projectRoot: string, chaptersArg: string, chapterPaths: string[]): Promise<string> {
    const args: Record<string, JsonValue> = {
        chapterPaths: chaptersArg,
        // 显式对齐 maxChapters 与实际传入章数，避免默认上限 12 截断导致断言假失败（workflow 上限 1-20）。
        maxChapters: String(Math.min(20, Math.max(chapterPaths.length, 1))),
    };
    const {jobId, runId} = await startWorkflowRun(baseUrl, projectRoot, "consistency-audit", args);
    const job = await pollJobUntilTerminal(baseUrl, jobId);
    if (job.status !== "completed") {
        throw new Error(`run 未完成：status=${job.status}${job.error ? `，error=${job.error}` : ""}`);
    }
    const workflowResult = expectObject(expectObject(job.result, "job.result").result, "workflow 返回值");
    const verdict = workflowResult.verdict;
    if (verdict !== "clean" && verdict !== "minor-only" && verdict !== "has-major") {
        throw new Error(`verdict 不在预期集合内：${JSON.stringify(verdict)}`);
    }
    const auditedChapters = expectArray(workflowResult.auditedChapters, "auditedChapters");
    if (auditedChapters.length !== chapterPaths.length) {
        throw new Error(`auditedChapters 数量不符：期望 ${chapterPaths.length}，实际 ${auditedChapters.length}`);
    }
    return `run ${runId}（job ${jobId}）：verdict=${verdict}，审计 ${auditedChapters.length}/${chapterPaths.length} 章`;
}

/** 场景二：chapter-write-review-revise 写盘 + 多维评审。 */
async function runChapterWriteReviewRevise(
    baseUrl: string,
    projectRoot: string,
    chapterPath: string,
    brief: string,
    projectAbsRoot: string,
    verifyChapterFile: boolean,
): Promise<string> {
    const args: Record<string, JsonValue> = {chapterPath, brief};
    const {jobId, runId} = await startWorkflowRun(baseUrl, projectRoot, "chapter-write-review-revise", args);
    const job = await pollJobUntilTerminal(baseUrl, jobId);
    if (job.status !== "completed") {
        throw new Error(`run 未完成：status=${job.status}${job.error ? `，error=${job.error}` : ""}`);
    }
    const workflowResult = expectObject(expectObject(job.result, "job.result").result, "workflow 返回值");
    const converged = workflowResult.converged;
    if (typeof converged !== "boolean") {
        throw new Error(`converged 不是 boolean：${JSON.stringify(converged)}`);
    }
    const rounds = expectArray(workflowResult.rounds, "rounds");
    if (rounds.length === 0) {
        throw new Error("rounds 为空数组，评审循环未记录任何一轮");
    }

    if (!verifyChapterFile) {
        return `run ${runId}（job ${jobId}）：converged=${converged}，共 ${rounds.length} 轮（调用方声明与 dev server 不同 State Root，本地章节文件断言已跳过）`;
    }

    // 脚本与 dev server 共用本机文件系统：直接读目标章节文件断言非空。
    const absoluteChapterPath = path.resolve(projectAbsRoot, chapterPath);
    const content = await readFile(absoluteChapterPath, "utf8");
    if (!content.trim()) {
        throw new Error(`目标章节文件为空：${absoluteChapterPath}`);
    }
    return `run ${runId}（job ${jobId}）：converged=${converged}，共 ${rounds.length} 轮，文件 ${content.length} 字符`;
}

/**
 * 场景三：cancel（Task 116 挂账项）。
 * 再启动一个 consistency-audit run，拿到 jobId 后立刻请求取消，轮询断言终态收敛到 cancelled。
 * 已知风险：若真实模型响应极快，run 可能在 cancel 生效前已 completed；这是取消场景固有的竞态，
 * 出现该结果时应视为环境过快导致的偶发 flake，而非 cancel 链路本身的缺陷。
 */
async function runCancelScenario(baseUrl: string, projectRoot: string, chaptersArg: string, chapterPaths: string[]): Promise<string> {
    const args: Record<string, JsonValue> = {
        chapterPaths: chaptersArg,
        maxChapters: String(Math.min(20, Math.max(chapterPaths.length, 1))),
    };
    const {jobId, runId} = await startWorkflowRun(baseUrl, projectRoot, "consistency-audit", args);
    await requestJson(baseUrl, `/api/agent/jobs/${jobId}/cancel`, {method: "POST"});
    const job = await pollJobUntilTerminal(baseUrl, jobId);
    if (job.status !== "cancelled") {
        throw new Error(`预期终态 cancelled，实际 ${job.status}${job.error ? `（error=${job.error}）` : ""}`);
    }
    return `run ${runId}（job ${jobId}）：已确认终态 cancelled`;
}

// ── HTTP + 轮询 ──

type StartRunResponse = {jobId: string; runId: string};

/** POST /api/agent/workflow/runs：立即返回 jobId + runId，实际执行在后台，需轮询 job 端点。 */
async function startWorkflowRun(baseUrl: string, projectRoot: string, workflowKey: string, args: Record<string, JsonValue>): Promise<StartRunResponse> {
    const response = await requestJson(baseUrl, "/api/agent/workflow/runs", {
        method: "POST",
        body: {projectRoot, workflowKey, args},
    });
    const record = expectObject(response as JsonValue, "runs.post 响应");
    const jobId = record.jobId;
    const runId = record.runId;
    if (typeof jobId !== "string" || typeof runId !== "string") {
        throw new Error(`runs.post 响应缺少 jobId/runId：${JSON.stringify(response)}`);
    }
    return {jobId, runId};
}

/** 轮询 GET /api/agent/jobs/[jobId] 直到终态（completed/failed/cancelled/interrupted）。 */
async function pollJobUntilTerminal(baseUrl: string, jobId: string): Promise<JobDetail> {
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
        const response = await requestJson(baseUrl, `/api/agent/jobs/${jobId}`, {method: "GET"});
        const wrapper = expectObject(response as JsonValue, "jobs 详情响应");
        const jobRecord = expectObject(wrapper.job, "job");
        const status = jobRecord.status;
        if (typeof status !== "string" || !isKnownJobStatus(status)) {
            throw new Error(`job ${jobId} 返回未知 status：${JSON.stringify(status)}`);
        }
        if (isTerminalStatus(status)) {
            return {
                jobId,
                status,
                error: typeof jobRecord.error === "string" ? jobRecord.error : undefined,
                result: jobRecord.result,
            };
        }
        await sleep(POLL_INTERVAL_MS);
    }
    throw new Error(`job ${jobId} 轮询超时（上限 ${Math.round(POLL_TIMEOUT_MS / 1000)}s），仍未到达终态`);
}

const KNOWN_JOB_STATUSES: readonly AgentJobStatus[] = ["running", "waiting", "completed", "failed", "cancelled", "interrupted"];

function isKnownJobStatus(value: string): value is AgentJobStatus {
    return (KNOWN_JOB_STATUSES as readonly string[]).includes(value);
}

function isTerminalStatus(status: AgentJobStatus): boolean {
    return status === "completed" || status === "failed" || status === "cancelled" || status === "interrupted";
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/** 与 agent-http.ts 同口径的最小 fetch 封装。 */
async function requestJson(baseUrl: string, pathname: string, input: {method: "GET" | "POST"; body?: unknown}): Promise<unknown> {
    const response = await fetch(`${baseUrl}${pathname}`, {
        method: input.method,
        headers: input.body ? {"content-type": "application/json"} : undefined,
        body: input.body ? JSON.stringify(input.body) : undefined,
    });
    if (!response.ok) {
        throw new Error(`${input.method} ${pathname} 失败：HTTP ${response.status} ${await response.text()}`);
    }
    return response.json();
}

// ── JsonValue 縮窄辅助（HTTP 边界之外禁止裸 unknown/any，这里是唯一入口） ──

function expectObject(value: JsonValue | undefined, context: string): {[key: string]: JsonValue} {
    if (value === undefined || value === null || typeof value !== "object" || Array.isArray(value)) {
        throw new Error(`${context}：期望 JSON 对象，实际 ${JSON.stringify(value ?? null)}`);
    }
    return value;
}

function expectArray(value: JsonValue | undefined, context: string): JsonValue[] {
    if (!Array.isArray(value)) {
        throw new Error(`${context}：期望数组，实际 ${JSON.stringify(value ?? null)}`);
    }
    return value;
}

/** 章节清单解析：与 workflow 内的 parsePaths 同规则（逗号/中文逗号/换行分隔，去空去重）。 */
function splitPaths(value: string): string[] {
    return value
        .split(/[,，\n]/u)
        .map((item) => item.trim())
        .filter((item, index, all) => item.length > 0 && all.indexOf(item) === index);
}

function printSummary(results: ScenarioResult[]): void {
    console.log("\n# 写作 Workflow 冒烟汇总\n");
    const statusLabel: Record<ScenarioStatus, string> = {passed: "PASS", failed: "FAIL", skipped: "SKIP"};
    for (const result of results) {
        const seconds = (result.durationMs / 1000).toFixed(1);
        console.log(`[${statusLabel[result.status]}] ${result.name}（${seconds}s）`);
        console.log(`    ${result.detail}`);
    }
    const passed = results.filter((result) => result.status === "passed").length;
    const failed = results.filter((result) => result.status === "failed").length;
    const skipped = results.filter((result) => result.status === "skipped").length;
    console.log(`\n共 ${results.length} 个场景：${passed} 通过 / ${failed} 失败 / ${skipped} 跳过`);
}

if (import.meta.main) await main();
