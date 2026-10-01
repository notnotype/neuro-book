#!/usr/bin/env node
/**
 * 阶段 1 产品生命周期 smoke。每个 L 项独立收口，报告保留原始日志路径；
 * 这里不注入产品测试路由，无法由现有产品观察的合同明确记为 pending。
 */
import {createServer, type Server} from "node:http";
import {mkdtemp, mkdir, readFile, rm, stat, writeFile} from "node:fs/promises";
import {appendFileSync, createWriteStream, existsSync, readFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join, dirname, resolve} from "node:path";
import {spawn} from "node:child_process";
import {randomBytes} from "node:crypto";
import {fileURLToPath} from "node:url";
import {spawnOwnedProcess} from "@notnotype/owned-process";
import {applicationEnvironment, waitForApplicationReady, shutdownNativeProduct} from "@notnotype/neuro-book-manager/product-control";
import {
    PRODUCT_BUN_RUNTIME_ARGS,
    PRODUCT_RUNTIME_COMMAND_BOOTSTRAP,
    PRODUCT_SHUTDOWN_TOKEN_ENVIRONMENT,
    PRODUCT_STARTUP_NONCE_ENVIRONMENT,
} from "@notnotype/neuro-book-contracts/product-runtime";
import {resolveAgentAcceptanceRoot} from "@notnotype/neuro-book-test-support/paths";
import {runBrowserChecks} from "./product-lifecycle/browser";
import {runDevelopmentChecks} from "./product-lifecycle/development";
import type {CheckId, CheckReport, CheckResult, Observation, RunningProduct, SmokeContext} from "./product-lifecycle/types";
import {CHECK_IDS} from "./product-lifecycle/types";
import {observePluginOrder} from "./product-lifecycle/plugin-order";

const appRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const repoRoot = resolve(appRoot, "../..");
const imageRoot = join(repoRoot, ".output");
const adminPassword = "lifecycle-admin-password-123";
const leasePathFor = (stateRoot: string) => join(stateRoot, "workspace", ".nbook", "agent", "migrations", "runtime.lease");
const leaseLockPathFor = (stateRoot: string) => `${leasePathFor(stateRoot)}.lock`;

type Options = {report: string; only: ReadonlySet<CheckId>; skipBuild: boolean; browserExecutable: string};
type Spawned = {child: ReturnType<typeof spawn>; completion: Promise<{code: number | null; signal: string | null}>; output: string[]};

function parseOptions(argv: string[]): Options {
    let report: string | undefined;
    let only: ReadonlySet<CheckId> = new Set(CHECK_IDS);
    let skipBuild = false;
    let browserExecutable = "/usr/bin/google-chrome-stable";
    for (let index = 0; index < argv.length; index += 1) {
        const value = argv[index];
        if (value === "--report") report = argv[++index];
        else if (value === "--only") {
            const ids = argv[++index]?.split(",").filter(Boolean) ?? [];
            const unknown = ids.filter((id): id is string => !CHECK_IDS.includes(id as CheckId));
            if (unknown.length > 0) throw new Error(`未知 smoke 检查项：${unknown.join(", ")}`);
            only = new Set(ids as CheckId[]);
        } else if (value === "--skip-build") skipBuild = true;
        else if (value === "--browser-executable") browserExecutable = argv[++index] ?? browserExecutable;
        else throw new Error(`未知参数：${value}`);
    }
    const evidenceRoot = resolveAgentAcceptanceRoot();
    return {report: resolve(report ?? join(evidenceRoot, "product-lifecycle-report.json")), only, skipBuild, browserExecutable};
}

async function getFreePort(): Promise<number> {
    const server: Server = createServer();
    await new Promise<void>((resolvePromise, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", () => resolvePromise());
    });
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("无法读取运行时分配的端口");
    const port = address.port;
    await new Promise<void>((resolvePromise, reject) => server.close((error) => error ? reject(error) : resolvePromise()));
    return port;
}

function spawnCaptured(command: string, args: string[], options: {cwd: string; env: NodeJS.ProcessEnv; stdio?: ("pipe" | "ignore")[]}): Spawned {
    const output: string[] = [];
    const child = spawn(command, args, {cwd: options.cwd, env: options.env, stdio: options.stdio ?? ["ignore", "pipe", "pipe"]});
    child.stdout?.on("data", (chunk: Buffer) => output.push(String(chunk)));
    child.stderr?.on("data", (chunk: Buffer) => output.push(String(chunk)));
    const completion = new Promise<{code: number | null; signal: string | null}>((resolvePromise, reject) => {
        child.once("error", reject);
        child.once("exit", (code, signal) => resolvePromise({code, signal}));
    });
    return {child, completion, output};
}

async function waitForCompletion(completion: Promise<{code: number | null; signal: string | null}>, timeoutMs: number): Promise<{code: number | null; signal: string | null} | null> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        return await Promise.race([
            completion,
            new Promise<null>((resolvePromise) => { timer = setTimeout(() => resolvePromise(null), timeoutMs); }),
        ]);
    } finally {
        if (timer !== undefined) clearTimeout(timer);
    }
}

async function prepareState(ctx: SmokeContext, stateRoot: string, id: CheckId): Promise<void> {
    await mkdir(stateRoot, {recursive: true});
    const env = await ctx.environment(stateRoot, false);
    const bootstrap = join(imageRoot, ...PRODUCT_RUNTIME_COMMAND_BOOTSTRAP.split("/"));
    const run = async (args: string[], stdin?: string): Promise<void> => {
        const child = spawn(process.execPath, [...PRODUCT_BUN_RUNTIME_ARGS, bootstrap, ...args], {
            cwd: repoRoot,
            env,
            stdio: [stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
        });
        const output: string[] = [];
        child.stdout?.on("data", (chunk: Buffer) => output.push(String(chunk)));
        child.stderr?.on("data", (chunk: Buffer) => output.push(String(chunk)));
        if (stdin !== undefined) child.stdin?.end(stdin);
        const result = await new Promise<{code: number | null; signal: string | null}>((resolvePromise, reject) => {
            child.once("error", reject);
            child.once("exit", (code, signal) => resolvePromise({code, signal}));
        });
        ctx.log(id, `product-command ${args.join(" ")} => ${JSON.stringify(result)}\n${output.join("").slice(-3000)}`);
        if (result.code !== 0) throw new Error(`准备 State Root 失败：${args.join(" ")}，退出 ${String(result.code)}`);
    };
    await run(["command", "migrate-database"]);
    await run(["command", "migrate-application-state", "--apply"]);
    await run(["command", "create-admin", "admin", "--password-stdin"], adminPassword);
}

async function readLeaseFailureState(stateRoot: string): Promise<string> {
    const leasePath = leasePathFor(stateRoot);
    const lockPath = `${leasePath}.lock`;
    try {
        const lease = await readFile(leasePath, "utf8");
        let lock = "absent";
        try {
            const lockStat = await stat(lockPath);
            lock = `${lockStat.isDirectory() ? "directory" : "file"} mtime=${lockStat.mtime.toISOString()}`;
        } catch (error) {
            const errno = error as NodeJS.ErrnoException;
            if (errno.code !== "ENOENT") lock = `stat-error=${String(error)}`;
        }
        return `lease=${lease.slice(0, 1000)} lock=${lock}`;
    } catch (error) {
        const errno = error as NodeJS.ErrnoException;
        if (errno.code === "ENOENT") return "lease=absent lock=absent";
        return `lease-read-error=${String(error)}`;
    }
}
async function startProduct(ctx: SmokeContext, stateRoot: string, id: CheckId, options: {port?: number; direct?: boolean; ready?: boolean} = {}): Promise<RunningProduct> {
    const port = options.port ?? await ctx.freePort();
    const token = randomBytes(32).toString("base64url");
    const nonce = randomBytes(32).toString("base64url");
    const env = await ctx.environment(stateRoot, false);
    Object.assign(env, {PORT: String(port), NUXT_PORT: String(port), NITRO_PORT: String(port)});
    env[PRODUCT_SHUTDOWN_TOKEN_ENVIRONMENT] = token;
    env[PRODUCT_STARTUP_NONCE_ENVIRONMENT] = nonce;
    delete env.NODE_PATH;
    const bootstrap = join(imageRoot, ...PRODUCT_RUNTIME_COMMAND_BOOTSTRAP.split("/"));
    const args = options.direct
        ? [...PRODUCT_BUN_RUNTIME_ARGS, join(imageRoot, "server", "index.mjs")]
        : [...PRODUCT_BUN_RUNTIME_ARGS, bootstrap, "command", "start"];
    const lease = spawnOwnedProcess({command: process.execPath, args, cwd: repoRoot, env, stdin: "ignore", stdout: "pipe", stderr: "pipe", graceMs: 2_000, hardKillWaitMs: 5_000});
    const output: string[] = [];
    const outputLogPath = join(ctx.evidenceRoot, `${id}-product-output.log`);
    appendFileSync(outputLogPath, `\nport=${port} stateRoot=${stateRoot} direct=${String(options.direct ?? false)}\n`);
    ctx.log(id, `Product stdout/stderr: ${outputLogPath}`);
    const capture = (label: string, chunk: Buffer): void => {
        const text = String(chunk);
        output.push(text);
        appendFileSync(outputLogPath, `[${label}] ${text}`);
    };
    lease.stdout?.on("data", (chunk: Buffer) => capture("stdout", chunk));
    lease.stderr?.on("data", (chunk: Buffer) => capture("stderr", chunk));
    const completion = lease.completion.then((result) => {
        ctx.log(id, `Product completion=${JSON.stringify(result)} output=${outputLogPath}`);
        return {code: result.exitCode, signal: result.signal};
    });
    const expectedVersion = JSON.parse(readFileSync(join(imageRoot, "server", "package.json"), "utf8")) as {version?: string};
    try {
        if (options.ready !== false) await waitForApplicationReady(port, expectedVersion.version ?? "unknown", completion, 120_000, options.direct ? undefined : nonce);
    } catch (error) {
        const completionAtFailure = await Promise.race([completion, new Promise<null>((resolvePromise) => setTimeout(() => resolvePromise(null), 2_000))]);
        const leaseState = await readLeaseFailureState(stateRoot);
        await lease.terminate("startup-failure").catch((cleanupError: unknown) => ctx.log(id, `startup-cleanup-error ${String(cleanupError)}`));
        const tail = output.join("").slice(-12000);
        ctx.log(id, `startup-failure output=${outputLogPath} completion=${JSON.stringify(completionAtFailure)} lease=${leaseState}\n${tail}\n${String(error)}`);
        throw new Error(`${String(error)}；Product output=${outputLogPath}；completion=${JSON.stringify(completionAtFailure)}；lease=${leaseState}\n${tail}`, {cause: error});
    }
    ctx.log(id, `started port=${String(port)} direct=${String(options.direct ?? false)}\n${output.join("").slice(-3000)}`);
    return {
        lease,
        outputLogPath,
        completion,
        port,
        url: `http://127.0.0.1:${String(port)}`,
        stateRoot,
        token,
        leasePath: leasePathFor(stateRoot),
        stop: async () => shutdownNativeProduct({port, token, completion, forceTerminate: async () => { await lease.terminate("shutdown"); }}),
        dispose: async () => {
            const stopped = await lease.terminate("shutdown");
            await completion;
            ctx.log(id, `dispose-complete=${JSON.stringify(stopped)} leaseLock=${String(existsSync(leaseLockPathFor(stateRoot)))} output=${outputLogPath}\n${output.join("").slice(-12000)}`);
        },
    };
}

type LifecycleArchiveOutcome = {
    readonly duringStatus: number;
    readonly duringBody: string;
    readonly receivedBytes: number;
    readonly contentLength: number | null;
    readonly archiveComplete: boolean;
    readonly readError: string;
    readonly completion: {code: number | null; signal: string | null};
    readonly leaseLock: boolean;
    readonly controlResult: string;
};

async function seedLifecycleProject(
    product: RunningProduct,
    id: CheckId,
    log: (message: string) => void,
): Promise<{cookie: string; projectRoot: string; publicId: string}> {
    const login = await fetch(`${product.url}/api/auth/login`, {
        method: "POST",
        headers: {"content-type": "application/json"},
        body: JSON.stringify({username: "admin", password: adminPassword}),
    });
    const loginBody = await login.text();
    const headersWithCookies = login.headers as Headers & {getSetCookie?: () => string[]};
    const setCookies = headersWithCookies.getSetCookie?.() ?? [login.headers.get("set-cookie") ?? ""];
    const cookie = setCookies.map((value) => value.split(";", 1)[0]).filter(Boolean).join("; ");
    log(`login status=${String(login.status)} body=${loginBody.slice(0, 500)} cookie=${String(Boolean(cookie))}`);
    if (login.status !== 200 || !cookie) throw new Error(`登录失败：HTTP ${String(login.status)}`);

    const created = await fetch(`${product.url}/api/projects`, {
        method: "POST",
        headers: {"content-type": "application/json", cookie},
        body: JSON.stringify({title: `Lifecycle archive ${id}`}),
    });
    const createdBody = await created.text();
    log(`project-create status=${String(created.status)} body=${createdBody.slice(0, 1000)}`);
    if (created.status < 200 || created.status >= 300) throw new Error(`创建临时 Project 失败：HTTP ${String(created.status)}`);
    const createdDto = JSON.parse(createdBody) as {project?: {projectRoot?: unknown}};
    const projectRoot = createdDto.project?.projectRoot;
    if (typeof projectRoot !== "string" || !projectRoot) throw new Error("创建临时 Project 响应缺少 projectRoot");

    const projectDir = join(product.stateRoot, "workspace", projectRoot);
    const seededBytes = 128 * 1024 * 1024 + 1;
    const filePath = join(projectDir, "lifecycle-large.bin");
    await mkdir(projectDir, {recursive: true});
    const stream = createWriteStream(filePath);
    try {
        await new Promise<void>((resolvePromise, reject) => {
            let remaining = seededBytes;
            let settled = false;
            const fail = (error: unknown) => {
                if (!settled) {
                    settled = true;
                    reject(error);
                }
            };
            stream.once("error", fail);
            stream.once("finish", () => {
                if (!settled) {
                    settled = true;
                    resolvePromise();
                }
            });
            const pump = () => {
                try {
                    while (remaining > 0) {
                        const chunkSize = Math.min(8 * 1024 * 1024, remaining);
                        remaining -= chunkSize;
                        if (!stream.write(randomBytes(chunkSize))) {
                            stream.once("drain", pump);
                            return;
                        }
                    }
                    stream.end();
                } catch (error) {
                    fail(error);
                }
            };
            pump();
        });
    } catch (error) {
        stream.destroy();
        throw error;
    }
    log(`project-seed root=${projectRoot} bytes=${String(seededBytes)} path=${filePath}`);

    const opened = await fetch(`${product.url}/api/projects/open`, {
        method: "POST",
        headers: {"content-type": "application/json", cookie},
        body: JSON.stringify({projectRoot}),
    });
    const openedBody = await opened.text();
    log(`project-open status=${String(opened.status)} body=${openedBody.slice(0, 1000)}`);
    if (opened.status < 200 || opened.status >= 300) throw new Error(`打开临时 Project 失败：HTTP ${String(opened.status)}`);
    const openedDto = JSON.parse(openedBody) as {publicId?: unknown};
    if (typeof openedDto.publicId !== "string" || !openedDto.publicId) throw new Error("打开临时 Project 响应缺少 publicId");
    return {cookie, projectRoot, publicId: openedDto.publicId};
}

async function drainLifecycleArchive(
    product: RunningProduct,
    id: CheckId,
    log: (message: string) => void,
    stop: () => Promise<string>,
): Promise<LifecycleArchiveOutcome> {
    const project = await seedLifecycleProject(product, id, log);
    const query = new URLSearchParams({projectRoot: project.projectRoot, publicId: project.publicId});
    const downloadUrl = `${product.url}/api/workspace-files/download?${query.toString()}`;
    const response = await fetch(downloadUrl, {
        headers: {cookie: project.cookie},
        signal: AbortSignal.timeout(180_000),
    });
    const contentLengthHeader = response.headers.get("content-length");
    const contentLength = contentLengthHeader && /^\d+$/u.test(contentLengthHeader) ? Number(contentLengthHeader) : null;
    log(`download status=${String(response.status)} contentLength=${String(contentLength)} contentType=${String(response.headers.get("content-type"))}`);
    if (response.status !== 200) throw new Error(`Workspace archive 下载失败：HTTP ${String(response.status)} ${await response.text()}`);
    if (!response.body) throw new Error("Workspace archive 下载缺少流响应");

    const reader = response.body.getReader();
    let receivedBytes = 0;
    let archiveComplete = false;
    let readError = "";
    let controlPromise: Promise<{value: string; error: string}> | undefined;
    let duringPromise: Promise<{status: number; body: string}> | undefined;
    try {
        const first = await reader.read();
        if (first.done || !first.value) throw new Error("Workspace archive 未读取到首块，无法建立在途请求");
        receivedBytes += first.value.byteLength;
        log(`download-first-chunk bytes=${String(first.value.byteLength)}；先暂停读取以保持响应在途`);
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
        controlPromise = stop().then(
            (value) => ({value, error: ""}),
            (error: unknown) => ({value: "error", error: error instanceof Error ? error.message : String(error)}),
        );
        // 给停止请求/信号时间进入排空；探测完成前不恢复大文件读取。
        await new Promise((resolvePromise) => setTimeout(resolvePromise, 250));
        duringPromise = fetch(`${product.url}/api/app/version`, {
            headers: {cookie: project.cookie},
            signal: AbortSignal.timeout(15_000),
        }).then(async (duringResponse) => ({status: duringResponse.status, body: await duringResponse.text()})).catch((error: unknown) => ({
            status: 0,
            body: error instanceof Error ? error.message : String(error),
        }));
        await duringPromise;

        try {
            while (true) {
                const part = await reader.read();
                if (part.done) {
                    archiveComplete = true;
                    break;
                }
                if (part.value) receivedBytes += part.value.byteLength;
            }
        } catch (error) {
            readError = String(error);
            log(`download-interrupted received=${receivedBytes} error=${readError}`);
        }
        if (!controlPromise || !duringPromise) throw new Error("关闭与排空期间请求未建立");
        const [control, during] = await Promise.all([controlPromise, duringPromise]);
        let completion = await waitForCompletion(product.completion, 45_000);
        if (completion === null) {
            log("停止后 45000ms 未退出，开始 smoke 清理；不将清理结果算作优雅退出");
            await product.dispose();
            completion = {code: null, signal: "SIGKILL"};
        }
        const leaseLock = existsSync(leaseLockPathFor(product.stateRoot));
        log(JSON.stringify({
            downloadStatus: response.status,
            contentLength,
            receivedBytes,
            archiveComplete,
            controlResult: control.value,
            controlError: control.error,
            duringStatus: during.status,
            duringBody: during.body.slice(0, 500),
            completion,
            leaseLock,
        }));
        return {
            duringStatus: during.status,
            duringBody: during.body,
            receivedBytes,
            contentLength,
            archiveComplete,
            readError,
            completion,
            leaseLock,
            controlResult: control.value,
        };
    } finally {
        if (!archiveComplete) await reader.cancel().catch((error: unknown) => log(`reader-cancel-error ${String(error)}`));
        if (controlPromise) await controlPromise.catch((error: unknown) => log(`control-cleanup-error ${String(error)}`));
        if (duringPromise) await duringPromise.catch((error: unknown) => log(`probe-cleanup-error ${String(error)}`));
    }
}


function resultFor(observations: Observation[]): CheckResult {
    if (observations.some((item) => item.result === "fail")) return "fail";
    if (observations.some((item) => item.result === "pending")) return "pending";
    return "pass";
}
async function runLifecycleDrainCheck(
    ctx: SmokeContext,
    id: "L3" | "L4",
    direct: boolean,
    observe: (observation: Observation) => void,
): Promise<void> {
    const stateRoot = join(ctx.tempRoot, `${id.toLowerCase()}-state`);
    let product: RunningProduct | undefined;
    try {
        await ctx.prepare(stateRoot, id);
        const runningProduct = await ctx.start(stateRoot, id, {direct});
        product = runningProduct;
        const outcome = await drainLifecycleArchive(
            runningProduct,
            id,
            (message) => ctx.log(id, message),
            id === "L3" ? async () => {
                const owner = JSON.parse(await readFile(runningProduct.leasePath, "utf8")) as {pid: number};
                if (!Number.isSafeInteger(owner.pid) || owner.pid === process.pid) throw new Error("无效的 Product lease owner pid");
                process.kill(owner.pid, "SIGTERM");
                ctx.log(id, `SIGTERM sent pid=${owner.pid}`);
                return "sigterm";
            } : () => runningProduct.stop(),
        );
        const archiveBytesComplete = outcome.contentLength === null
            ? outcome.receivedBytes > 128 * 1024 * 1024
            : outcome.receivedBytes === outcome.contentLength;
        const processAndLease = outcome.completion.code === 0 && !outcome.leaseLock;
        observe({
            id: "drain-new-request",
            result: outcome.duringStatus === 503 ? "pass" : "fail",
            evidence: `在途 archive 期间 /api/app/version 返回 ${String(outcome.duringStatus)}（期望 503），body=${outcome.duringBody.slice(0, 300)}`,
        });
        observe({
            id: "inflight-complete",
            result: outcome.archiveComplete && archiveBytesComplete ? "pass" : "fail",
            evidence: `archive EOF=${String(outcome.archiveComplete)}，received=${outcome.receivedBytes}，content-length=${String(outcome.contentLength)}，字节完整=${String(archiveBytesComplete)}，readError=${outcome.readError}`,
        });
        observe({
            id: "process-exit-and-lease",
            result: processAndLease ? "pass" : "fail",
            evidence: `关闭后 completion=${JSON.stringify(outcome.completion)}，runtime.lease.lock=${outcome.leaseLock ? "仍存在" : "已释放"}`,
        });
        if (id === "L4") {
            observe({
                id: "control-stop",
                result: outcome.controlResult === "graceful" ? "pass" : "fail",
                evidence: `PRODUCT_SHUTDOWN_PATH stop=${outcome.controlResult}；required process/lease status=${processAndLease ? "pass" : "fail"}`,
            });
        }
    } catch (error) {
        const evidence = error instanceof Error ? error.stack ?? error.message : String(error);
        ctx.log(id, `lifecycle-drain-error ${evidence}`);
        observe({id: "drain-new-request", result: "fail", evidence: `无法建立并观测 archive 在途请求：${evidence}`});
        observe({id: "inflight-complete", result: "fail", evidence: `archive 未能读完且核对完整字节：${evidence}`});
        observe({id: "process-exit-and-lease", result: "fail", evidence: `未取得 code 0 且 lease lock 已释放的证据：${evidence}`});
        if (id === "L4") observe({id: "control-stop", result: "fail", evidence: `PRODUCT_SHUTDOWN_PATH 未取得成功结果：${evidence}`});
    } finally {
        observe(await observePluginOrder(stateRoot, join(ctx.evidenceRoot, `${id}-plugins.jsonl`), "close-order"));
        if (product) await product.dispose().catch((error: unknown) => ctx.log(id, `dispose-error ${String(error)}`));
    }
}


async function productionChecks(ctx: SmokeContext): Promise<void> {
    await ctx.check("L2", async (observe) => {
        const stateRoot = join(ctx.tempRoot, "l2-state");
        await ctx.prepare(stateRoot, "L2");
        const product = await ctx.start(stateRoot, "L2");
        try {
            await product.stop();
            observe(await observePluginOrder(stateRoot, join(ctx.evidenceRoot, "L2-plugins.jsonl"), "activation-order"));
        } finally {
            await product.dispose();
        }
    });

    await ctx.check("L3", async (observe) => {
        await runLifecycleDrainCheck(ctx, "L3", true, observe);
    });

    await ctx.check("L4", async (observe) => {
        await runLifecycleDrainCheck(ctx, "L4", false, observe);
    });

    await ctx.check("L5", async (observe) => {
        const stateRoot = join(ctx.tempRoot, "l5-unmigrated");
        await mkdir(stateRoot, {recursive: true});
        const port = await ctx.freePort();
        const env = await ctx.environment(stateRoot, false);
        Object.assign(env, {PORT: String(port), NUXT_PORT: String(port), NITRO_PORT: String(port)});
        delete env.NODE_PATH;
        const child = spawnCaptured(process.execPath, [...PRODUCT_BUN_RUNTIME_ARGS, join(imageRoot, "server", "index.mjs")], {cwd: repoRoot, env});
        const completion = await waitForCompletion(child.completion, 30_000);
        const output = child.output.join("");
        const noListener = (await fetch(`http://127.0.0.1:${String(port)}/api/app/version`).then(() => false).catch((error: unknown) => { ctx.log("L5", `listener-probe-error ${String(error)}`); return true; }));
        ctx.log("L5", `${output.slice(-8000)}\ncompletion=${JSON.stringify(completion)} noListener=${String(noListener)}`);
        const hasFatalDiagnostic = /emergency|启动|startup|门禁|migration|迁移|fatal|致命/iu.test(output);
        observe({id: "fatal-exit", result: completion?.code === 1 && hasFatalDiagnostic ? "pass" : "fail", evidence: `未迁移 State Root 退出 ${JSON.stringify(completion)}，致命诊断=${String(hasFatalDiagnostic)}`});
        observe({id: "bounded", result: completion === null ? "fail" : "pass", evidence: completion === null ? "30 秒内未结束" : "在 30 秒内结束"});
        observe({id: "no-listener", result: noListener ? "pass" : "fail", evidence: noListener ? "端口无残留监听" : "端口仍可连接"});
        if (completion === null) await child.child.kill("SIGKILL");
    });

    await ctx.check("L6", async (observe) => {
        const stateRoot = join(ctx.tempRoot, "l6-state");
        await ctx.prepare(stateRoot, "L6");
        const product = await ctx.start(stateRoot, "L6");
        try {
            await rm(leaseLockPathFor(stateRoot), {recursive: true, force: true});
            const completion = await waitForCompletion(product.completion, 45_000);
            ctx.log("L6", JSON.stringify({completion, leaseLock: existsSync(leaseLockPathFor(stateRoot))}));
            observe({id: "lease-exit", result: completion?.code === 75 ? "pass" : "fail", evidence: `删除 runtime.lease.lock 后退出 ${JSON.stringify(completion)}，期望 75`});
        } finally { await product.dispose(); }
    });
}

function makeContext(options: Options, tempRoot: string, evidenceRoot: string): SmokeContext & {reports: CheckReport[]; buildLog: string} {
    const reports: CheckReport[] = [];
    let buildLog = "";
    const ctx: SmokeContext & {reports: CheckReport[]; buildLog: string} = {
        appRoot, repoRoot, imageRoot, tempRoot, evidenceRoot, browserExecutable: options.browserExecutable, selected: options.only,
        reports,
        get buildLog() { return buildLog; },
        set buildLog(value: string) { buildLog = value; },
        log(id, message) {
            const path = join(tempRoot, `${id}.log`);
            appendFileSync(path, `[${new Date().toISOString()}] ${message}\n`, "utf8");
        },
        async check(id, run) {
            if (!options.only.has(id)) return;
            const started = Date.now();
            const observations: Observation[] = [];
            try { await run((observation) => observations.push(observation)); }
            catch (error) { observations.push({id: "exception", result: "fail", evidence: error instanceof Error ? error.stack ?? error.message : String(error)}); }
            const result = resultFor(observations);
            const logPath = join(tempRoot, `${id}.log`);
            await writeFile(logPath, observations.map((item) => `${item.result} ${item.id}: ${item.evidence}`).join("\n") + "\n", {flag: "a"});
            reports.push({id, result, durationMs: Date.now() - started, evidence: observations.map((item) => `${item.id}: ${item.evidence}`).join("；"), logPath, observations});
            console.log(`${id}\t${result}\t${String(Date.now() - started)}ms\t${observations.map((item) => `${item.result}:${item.id}=${item.evidence}`).join("；")}`);
        },
        async prepare(stateRoot, id) { await prepareState(ctx, stateRoot, id); },
        async start(stateRoot, id, startOptions) { return startProduct(ctx, stateRoot, id, startOptions); },
        freePort: getFreePort,
        environment: async (stateRoot, development) => applicationEnvironment(repoRoot, stateRoot, development, join(stateRoot, "cache")),
    };
    return ctx;
}

async function runBuild(ctx: SmokeContext & {buildLog: string}, skipBuild: boolean): Promise<void> {
    if (skipBuild) return;
    const child = spawnCaptured("bun", ["run", "nuxt:build"], {cwd: appRoot, env: process.env});
    const completion = await child.completion;
    ctx.buildLog = child.output.join("");
    await writeFile(join(ctx.evidenceRoot, "product-lifecycle-build.log"), ctx.buildLog);
    if (completion.code !== 0) throw new Error(`生产构建失败，退出 ${String(completion.code)}`);
}

async function main(): Promise<void> {
    const options = parseOptions(process.argv.slice(2));
    const evidenceRoot = resolve(dirname(options.report));
    await mkdir(evidenceRoot, {recursive: true});
    const tempRoot = await mkdtemp(join(tmpdir(), "neuro-book-product-lifecycle-"));
    const ctx = makeContext(options, tempRoot, evidenceRoot);
    const startedAt = Date.now();
    try {
        if (!options.skipBuild) await runBuild(ctx, false);
        if (!existsSync(join(imageRoot, "server", "index.mjs"))) throw new Error(`缺少生产产物：${join(imageRoot, "server", "index.mjs")}；请先构建或不要使用 --skip-build`);
        await productionChecks(ctx);
        await runBrowserChecks(ctx);
        await runDevelopmentChecks(ctx);
    } catch (error) {
        console.error(error instanceof Error ? error.stack ?? error.message : String(error));
    } finally {
        for (const id of CHECK_IDS) if (options.only.has(id) && !ctx.reports.some((report) => report.id === id)) {
            const report: CheckReport = {id, result: "pending", durationMs: 0, evidence: "检查未执行：依赖步骤失败。", logPath: join(tempRoot, `${id}.log`), observations: []};
            ctx.reports.push(report);
            console.log(`${id}\tpending\t0ms\t检查未执行：依赖步骤失败`);
        }
        const persistedResults: CheckReport[] = [];
        for (const item of ctx.reports) {
            const target = join(evidenceRoot, `${item.id}.log`);
            let content = "";
            try { content = await readFile(item.logPath, "utf8"); } catch (error) { console.error(`读取 ${item.logPath} 失败：${String(error)}`); content = `${item.evidence}\n`; }
            await writeFile(target, content, "utf8");
            persistedResults.push({...item, logPath: target});
        }
        const report = {schema: "nbook.smoke/product-lifecycle/v1", startedAt: new Date(startedAt).toISOString(), durationMs: Date.now() - startedAt, skipBuild: options.skipBuild, selected: [...options.only], results: persistedResults.sort((a, b) => CHECK_IDS.indexOf(a.id) - CHECK_IDS.indexOf(b.id))};
        await writeFile(options.report, `${JSON.stringify(report, null, 2)}\n`);
        await rm(tempRoot, {recursive: true, force: true});
        console.log(`报告\t${options.report}\n总耗时\t${String(report.durationMs)}ms`);
        if (report.results.some((item) => item.result === "fail")) process.exitCode = 1;
    }
}

await main();
