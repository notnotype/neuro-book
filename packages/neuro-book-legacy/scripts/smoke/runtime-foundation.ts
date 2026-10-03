/**
 * 底座 smoke：同一公共入口按宿主模式验证环境适配，`--services` 验证第二切片的三个内置服务插件。
 *
 *   node --import tsx scripts/smoke/runtime-foundation.ts --host server
 *   node --import tsx scripts/smoke/runtime-foundation.ts --host browser [--browser-executable <path>]
 *   node --import tsx scripts/smoke/runtime-foundation.ts --services
 *
 * 与其它 playwright smoke 一样在 Node 下运行：Bun 1.3 在 Windows 上与 playwright-core 的启动管道
 * 互不兼容（launch 60s 超时）。server 模式：用同一运行器启动真实子进程运行 server-entry，等到
 * `ready` 后合作停止（POSIX 发 SIGTERM，Windows 写 stdin `stop`），核对停止结果与退出码；
 * 另起一个注入必需门禁失败的子进程核对不接纳。
 * browser 模式：esbuild 以 browser 平台打包 browser-entry，临时 HTTP 服务器提供页面与在场计数端点，
 * 用 playwright-core 启动隔离 Chromium：两个 tab 各自装配、一个 tab 内两个实例隔离、显式销毁、
 * pagehide 只请求停止；核对释放在场从不触发全局关闭。
 * services 模式：子进程运行 services-entry，装配真实 runtime-diagnostics/platform-files/sqlite 与两个消费者：
 * 写入→提交→关闭→另一进程重开读回；存活期间第二进程争用同一日志位置只降级不抢写；逐个移除必需提供者
 * 启动明确失败且不产生数据副作用；句柄未释放时停止报告未完成，释放后显式恢复才 closed。
 * 全部产物在测试支持包分配的系统 Temp 下，finally 删除；不初始化产品数据库、不调用 Provider。
 */

import {spawn} from "node:child_process";
import {existsSync} from "node:fs";
import {mkdir, readdir, readFile, rm, writeFile} from "node:fs/promises";
import {createServer} from "node:http";
import type {AddressInfo} from "node:net";
import {dirname, join} from "node:path";
import {fileURLToPath} from "node:url";
import {parseArgs} from "node:util";

import {resolveAgentScratchPath} from "@notnotype/neuro-book-test-support/paths";
import {build} from "esbuild";
import {chromium} from "playwright-core";
import type {Browser} from "playwright-core";

import {NOTES_BODY, NOTES_ROW, SECRET_SAMPLES, SERVICE_PLUGIN_IDS} from "./runtime-foundation/services-fixture";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const started = Date.now();
let failures = 0;

function log(line: string): void {
    console.log(`[+${String(Date.now() - started).padStart(5, " ")}ms] ${line}`);
}

function check(ok: boolean, label: string): void {
    if (!ok) {
        failures += 1;
    }
    log(`${ok ? "PASS" : "FAIL"} ${label}`);
}

type Json = Record<string, unknown>;

interface ChildRun {
    readonly events: Json[];
    readonly exitCode: number | null;
    readonly stderr: string;
    /** 子进程退出时刻（Date.now）。 */
    readonly exitedAt: number;
}

/** 运行 runtime-foundation 下的子进程入口；`ready` 到达后由 `onReady` 触发合作停止。 */
function runServerChild(
    args: string[],
    onReady: (send: (line: string) => void, kill: () => boolean) => void,
    timeoutMs = 20_000,
    entry = "server-entry.ts",
): Promise<ChildRun> {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [...process.execArgv, join(scriptDir, "runtime-foundation", entry), ...args], {stdio: ["pipe", "pipe", "pipe"]});
        const events: Json[] = [];
        let stderr = "";
        let buffered = "";
        const timer = setTimeout(() => {
            child.kill();
            reject(new Error(`子进程 ${timeoutMs}ms 内未退出；events=${JSON.stringify(events)} stderr=${stderr}`));
        }, timeoutMs);
        child.stdout.setEncoding("utf8");
        child.stdout.on("data", (chunk: string) => {
            buffered += chunk;
            const lines = buffered.split("\n");
            buffered = lines.pop() ?? "";
            for (const line of lines) {
                if (line.trim() === "") {
                    continue;
                }
                const event = JSON.parse(line) as Json;
                events.push(event);
                if (event["event"] === "ready") {
                    onReady((text) => child.stdin.write(`${text}\n`), () => child.kill("SIGTERM"));
                }
            }
        });
        child.stderr.setEncoding("utf8");
        child.stderr.on("data", (chunk: string) => {
            stderr += chunk;
        });
        child.on("error", (error) => {
            clearTimeout(timer);
            reject(error);
        });
        child.on("exit", (exitCode) => {
            clearTimeout(timer);
            resolve({events, exitCode, stderr, exitedAt: Date.now()});
        });
    });
}

function eventOf(run: ChildRun, name: string): Json | undefined {
    return run.events.find((event) => event["event"] === name);
}

/** 合作停止：POSIX 发 SIGTERM；Windows 外部信号不可合作，改写 stdin `stop`。 */
function cooperativeStop(send: (line: string) => void, kill: () => boolean): void {
    if (process.platform === "win32") {
        send("stop");
    } else {
        kill();
    }
}

async function serverMode(): Promise<void> {
    const cooperative = process.platform === "win32" ? "stdin:stop" : "signal:SIGTERM";
    log(`server 模式：合作停止通道 ${cooperative}`);

    const healthy = await runServerChild([], cooperativeStop);
    const startedEvent = eventOf(healthy, "started");
    const startup = eventOf(healthy, "startup");
    const ready = eventOf(healthy, "ready");
    const stopped = eventOf(healthy, "stopped");
    check(startedEvent?.["shared"] === true, "同一 instanceId 重复启动共享同一实例");
    check(startup?.["status"] === "available" && startup["admission"] === "open", `启动 available 且接纳开放 (${String(startup?.["status"])})`);
    const gates = (startup?.["gates"] as Array<Json> | undefined) ?? [];
    check(gates.every((gate) => gate["status"] === "passed") && gates.length === 2, `门禁 presence/greeter 全部通过 (${gates.map((gate) => `${gate["id"]}:${gate["status"]}`).join(",")})`);
    const outcome = ready?.["outcome"] as Json | undefined;
    check(outcome?.["status"] === "completed" && typeof outcome["value"] === "string" && (outcome["value"] as string).startsWith("hello smoke @"), `接纳操作经命令句柄调用 greeter (${JSON.stringify(outcome?.["value"])})`);
    const stop = stopped?.["stop"] as Json | undefined;
    check(stop?.["status"] === "closed", `合作停止后关闭完成 (${String(stop?.["status"])})`);
    check(stopped?.["source"] === cooperative, `停止来源为 ${cooperative} (${String(stopped?.["source"])})`);
    check(stopped?.["detached"] === true, "停止结算后信号监听已移除");
    check(stopped?.["late"] === "closed", `停止后接纳被拒绝且原因为 closed (${String(stopped?.["late"])})`);
    check(stopped?.["greetAfterStop"] === null, "停止后旧命令句柄不可调用");
    check(stopped?.["presenceReleases"] === 1, `presence 能力释放一次 (${String(stopped?.["presenceReleases"])})`);
    check(healthy.exitCode === 0, `子进程自然退出 exit=${String(healthy.exitCode)}`);
    check(healthy.stderr.trim() === "", `子进程无 stderr 输出${healthy.stderr.trim() === "" ? "" : `：${healthy.stderr.trim().slice(0, 200)}`}`);

    const gated = await runServerChild(["--fail-required", "--fail-optional"], () => undefined);
    const gatedStartup = eventOf(gated, "startup");
    const gatedGates = (gatedStartup?.["gates"] as Array<Json> | undefined) ?? [];
    check(gatedStartup?.["status"] === "failed" && gatedStartup["admission"] === "closed", `必需门禁失败时启动 failed 且不接纳 (${String(gatedStartup?.["status"])})`);
    check(gatedGates.some((gate) => gate["id"] === "flaky" && gate["status"] === "failed" && gate["required"] === false), "可选入口失败被单独报告");
    check(gatedGates.some((gate) => gate["id"] === "greeter" && gate["status"] === "passed"), "无关必需门禁仍通过");
    const gatedStop = gatedStartup?.["stop"] as Json | undefined;
    check(gatedStop?.["status"] === "closed", `失败后已取得资源收口完成 (${String(gatedStop?.["status"])})`);
    const emergency = eventOf(gated, "emergency");
    const emergencyText = JSON.stringify(emergency ?? {});
    check(emergency !== undefined && emergencyText.includes("必需门禁失败") && !emergencyText.includes("should-not-leak"), "紧急输出可见且不含注入的敏感串");
    check(gated.exitCode === 2, `失败子进程以退出码 2 结束 (${String(gated.exitCode)})`);

    // 有界停止：释放永不结算时，宿主截止让停止结算为 incomplete(deadline)，进程在截止后很快退出。
    const stopTimeoutMs = 300;
    let stopRequestedAt = 0;
    const hung = await runServerChild(["--hang-release", `--stop-timeout-ms=${stopTimeoutMs}`], (send, kill) => {
        stopRequestedAt = Date.now();
        cooperativeStop(send, kill);
    });
    const hungStopped = eventOf(hung, "stopped");
    const hungStop = hungStopped?.["stop"] as Json | undefined;
    const elapsed = hung.exitedAt - stopRequestedAt;
    check(hungStop?.["status"] === "incomplete" && hungStop["reason"] === "deadline", `释放挂起时停止结算为 incomplete(deadline) (${String(hungStop?.["status"])}/${String(hungStop?.["reason"])})`);
    check(hungStopped?.["detached"] === true, "有界停止结算后信号监听已移除");
    check(hungStopped?.["late"] === "stopping", `未完成停止后接纳按 stopping 拒绝 (${String(hungStopped?.["late"])})`);
    check(hungStopped?.["presenceReleases"] === 1, `挂起的释放只调用一次，不被重入 (${String(hungStopped?.["presenceReleases"])})`);
    const hungEmergencies = hung.events.filter((event) => event["event"] === "emergency");
    check(hungEmergencies.length === 1 && JSON.stringify(hungEmergencies[0]).includes("关闭未完成：deadline"), `紧急输出一次报告 deadline (${hungEmergencies.length})`);
    check(hung.exitCode === 3, `未完成停止以退出码 3 结束 (${String(hung.exitCode)})`);
    check(stopRequestedAt > 0 && elapsed >= stopTimeoutMs && elapsed < stopTimeoutMs + 5_000, `停止请求到退出 ${elapsed}ms：受 ${stopTimeoutMs}ms 截止约束，未被挂起的释放拖住`);
}

interface PresenceCounter {
    registered: string[];
    released: string[];
    globalCloses: number;
}

async function browserMode(executable: string | undefined): Promise<void> {
    const scratch = resolveAgentScratchPath("w00017-runtime-foundation-smoke", `browser-${process.pid}`);
    await mkdir(scratch, {recursive: true});
    const counter: PresenceCounter = {registered: [], released: [], globalCloses: 0};
    let browser: Browser | null = null;
    const server = createServer();
    try {
        // 1. 打包页面入口：platform browser，引用任何 node 内建即失败。
        const result = await build({
            entryPoints: [join(scriptDir, "runtime-foundation", "browser-entry.ts")],
            bundle: true,
            format: "esm",
            platform: "browser",
            target: "es2022",
            write: false,
            logLevel: "silent",
        });
        const bundle = result.outputFiles[0]!.text;
        check(!/from\s*["']node:/u.test(bundle) && !bundle.includes("process.stderr"), `浏览器 bundle 不含服务端模块 (${(bundle.length / 1024).toFixed(1)} KiB)`);
        // 空 icon 阻止完整版 Chrome 请求 /favicon.ico；否则 404 会被下方的控制台错误断言计为页面错误。
        const html = `<!doctype html><html><head><meta charset="utf-8"><title>runtime-foundation smoke</title><link rel="icon" href="data:,"></head><body><script type="module" src="/entry.js"></script></body></html>`;
        await writeFile(join(scratch, "index.html"), html, "utf8");

        // 2. 临时 HTTP 服务器：页面 + 在场计数端点。
        server.on("request", (request, response) => {
            const url = new URL(request.url ?? "/", "http://127.0.0.1");
            const id = url.searchParams.get("id") ?? "";
            if (url.pathname === "/") {
                response.writeHead(200, {"content-type": "text/html; charset=utf-8"}).end(html);
            } else if (url.pathname === "/entry.js") {
                response.writeHead(200, {"content-type": "text/javascript; charset=utf-8"}).end(bundle);
            } else if (url.pathname === "/presence/register" && request.method === "POST") {
                counter.registered.push(id);
                response.writeHead(204).end();
            } else if (url.pathname === "/presence/release" && request.method === "POST") {
                counter.released.push(id);
                response.writeHead(204).end();
            } else if (url.pathname === "/close") {
                counter.globalCloses += 1;
                response.writeHead(204).end();
            } else {
                response.writeHead(404).end();
            }
        });
        await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
        const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
        log(`临时页面 ${origin}`);

        // 3. 真实浏览器：两个 tab（两个窗口）各自装配。
        browser = await chromium.launch({headless: true, timeout: 60_000, ...(executable === undefined ? {} : {executablePath: executable})});
        log(`chromium ${browser.version()} 已启动`);
        const pageErrors: string[] = [];
        const openPage = async () => {
            const page = await browser!.newPage();
            page.on("pageerror", (error) => pageErrors.push(error.message));
            page.on("console", (message) => {
                if (message.type() === "error") {
                    pageErrors.push(message.text());
                }
            });
            await page.goto(`${origin}/`, {waitUntil: "load", timeout: 30_000});
            await page.waitForFunction(() => "runtimeFoundation" in globalThis, undefined, {timeout: 10_000});
            return page;
        };
        const pageA = await openPage();
        const pageB = await openPage();

        const startA = (await pageA.evaluate(() => (globalThis as unknown as {runtimeFoundation: {start(id: string): Promise<unknown>}}).runtimeFoundation.start("win-a"))) as Json;
        const startB = (await pageB.evaluate(() => (globalThis as unknown as {runtimeFoundation: {start(id: string): Promise<unknown>}}).runtimeFoundation.start("win-b"))) as Json;
        const startA2 = (await pageA.evaluate(() => (globalThis as unknown as {runtimeFoundation: {start(id: string): Promise<unknown>}}).runtimeFoundation.start("win-a-second"))) as Json;
        const startAgain = (await pageA.evaluate(() => (globalThis as unknown as {runtimeFoundation: {start(id: string): Promise<unknown>}}).runtimeFoundation.start("win-a"))) as Json;
        for (const [label, start] of [["窗口 A", startA], ["窗口 B", startB], ["窗口 A 第二实例", startA2]] as const) {
            const startup = start["startup"] as Json;
            check(startup["status"] === "available" && start["admission"] === "open", `${label} 启动 available 且接纳开放 (${String(startup["status"])})`);
        }
        check(startAgain["shared"] === true, "同一窗口内重复启动同一 instanceId 共享实例");
        check(counter.registered.length === 3 && new Set(counter.registered).size === 3, `三个实例各自登记在场 (${counter.registered.join(",")})`);

        const greetA = await pageA.evaluate(() => (globalThis as unknown as {runtimeFoundation: {greet(id: string, name: string): Promise<string | null>}}).runtimeFoundation.greet("win-a", "A"));
        const greetB = await pageB.evaluate(() => (globalThis as unknown as {runtimeFoundation: {greet(id: string, name: string): Promise<string | null>}}).runtimeFoundation.greet("win-b", "B"));
        check(typeof greetA === "string" && greetA.startsWith("hello A @"), `窗口 A 经接纳操作调用 greeter (${String(greetA)})`);
        check(typeof greetB === "string" && greetB.startsWith("hello B @"), `窗口 B 经接纳操作调用 greeter (${String(greetB)})`);

        // 4. 显式销毁窗口 A 的第一个实例：同窗口第二实例与窗口 B 不受影响；在场释放一次、无全局关闭。
        const destroyed = (await pageA.evaluate(() => (globalThis as unknown as {runtimeFoundation: {destroy(id: string): Promise<unknown>}}).runtimeFoundation.destroy("win-a"))) as Json;
        const stop = destroyed["stop"] as Json;
        check(stop["status"] === "closed", `显式销毁关闭完成 (${String(stop["status"])})`);
        check(destroyed["source"] === "destroy" && destroyed["detached"] === true, "停止来源 destroy 且卸载监听已移除");
        check(destroyed["late"] === "closed", `销毁后接纳被拒绝且原因为 closed (${String(destroyed["late"])})`);
        check(destroyed["greetAfterStop"] === null, "销毁后旧命令句柄不可调用");
        const greetA2 = await pageA.evaluate(() => (globalThis as unknown as {runtimeFoundation: {greet(id: string, name: string): Promise<string | null>}}).runtimeFoundation.greet("win-a-second", "A2"));
        const greetBAgain = await pageB.evaluate(() => (globalThis as unknown as {runtimeFoundation: {greet(id: string, name: string): Promise<string | null>}}).runtimeFoundation.greet("win-b", "B2"));
        check(typeof greetA2 === "string" && greetA2.startsWith("hello A2 @"), "同窗口第二实例不受销毁影响");
        check(typeof greetBAgain === "string" && greetBAgain.startsWith("hello B2 @"), "另一窗口不受销毁影响");
        check(counter.released.length === 1 && counter.released[0] === "win-a" && counter.globalCloses === 0, `只释放 win-a 的在场，未发送全局关闭 (released=${counter.released.join(",")} closes=${counter.globalCloses})`);

        // 5. 门禁故障：注入必需失败的实例不接纳，紧急输出可见。
        const gated = (await pageA.evaluate(() => (globalThis as unknown as {runtimeFoundation: {start(id: string, options: unknown): Promise<unknown>}}).runtimeFoundation.start("win-a-gated", {failRequired: true, failOptional: true}))) as Json;
        const gatedStartup = gated["startup"] as Json;
        const gatedGates = gatedStartup["gates"] as Array<Json>;
        check(gatedStartup["status"] === "failed" && gated["admission"] === "closed", `注入必需失败的实例不接纳 (${String(gatedStartup["status"])})`);
        check(gatedGates.some((gate) => gate["id"] === "flaky" && gate["status"] === "failed" && gate["required"] === false), "可选入口失败单独报告");
        const emergencies = (await pageA.evaluate(() => (globalThis as unknown as {runtimeFoundation: {emergencies(): unknown}}).runtimeFoundation.emergencies())) as Array<Json>;
        check(emergencies.some((report) => report["stage"] === "startup") && !JSON.stringify(emergencies).includes("should-not-leak"), "紧急输出可见且不含敏感串");

        // 5b. 有界销毁：在场释放永不结算时，截止让销毁结算为 incomplete(deadline)，页面不被挂住。
        const bounded = (await pageA.evaluate(async () => {
            const api = (globalThis as unknown as {runtimeFoundation: {start(id: string, options: unknown): Promise<unknown>; destroy(id: string): Promise<unknown>}}).runtimeFoundation;
            await api.start("win-a-bounded", {hangRelease: true, stopTimeoutMs: 200});
            const begin = performance.now();
            const result = (await api.destroy("win-a-bounded")) as Record<string, unknown>;
            return {...result, elapsed: Math.round(performance.now() - begin)};
        })) as Json;
        const boundedStop = bounded["stop"] as Json;
        check(boundedStop["status"] === "incomplete" && boundedStop["reason"] === "deadline", `释放挂起时销毁结算为 incomplete(deadline) (${String(boundedStop["status"])}/${String(boundedStop["reason"])})`);
        check(bounded["detached"] === true && bounded["late"] === "stopping", `有界销毁后监听移除、接纳按 stopping 拒绝 (late=${String(bounded["late"])})`);
        const boundedElapsed = bounded["elapsed"];
        check(typeof boundedElapsed === "number" && boundedElapsed >= 190 && boundedElapsed < 5_000, `销毁耗时 ${String(boundedElapsed)}ms，受 200ms 截止约束`);

        // 6. pagehide 只请求停止；不等待关闭结果。
        const unloaded = (await pageB.evaluate(() => (globalThis as unknown as {runtimeFoundation: {unload(id: string): unknown}}).runtimeFoundation.unload("win-b"))) as Json;
        check(unloaded["source"] === "unload" && unloaded["phase"] !== "available", `pagehide 记录为 unload 并进入停止 (phase=${String(unloaded["phase"])})；关闭结果不作保证`);
        await pageB.close();
        check(pageErrors.length === 0, `页面无未捕获错误${pageErrors.length === 0 ? "" : `：${pageErrors.slice(0, 3).join(" | ")}`}`);
    } finally {
        await browser?.close();
        await new Promise<void>((resolve) => server.close(() => resolve()));
        await rm(scratch, {recursive: true, force: true});
        log(`scratch 已删除：${scratch}`);
    }
}

/** 等待一个就绪的子进程：返回 stop 函数，供父进程在做完并发检查后再合作停止。 */
function startHeldChild(args: string[]): {ready: Promise<void>; run: Promise<ChildRun>; stop(): void} {
    let stopper: (() => void) | null = null;
    const {promise: ready, resolve} = Promise.withResolvers<void>();
    const run = runServerChild(args, (send, kill) => {
        stopper = () => cooperativeStop(send, kill);
        resolve();
    }, 30_000, "services-entry.ts");
    // 子进程在 ready 前退出（启动失败）也要让等待方醒来。
    void run.then(() => resolve(), () => resolve());
    return {ready, run, stop: () => stopper?.()};
}

function logLines(text: string): Json[] {
    return text.split("\n").filter((line) => line.trim() !== "").map((line) => JSON.parse(line) as Json);
}

/** node:sqlite 的实验特性告警是运行时固定输出，不算子进程错误；其余 stderr 行都算。 */
function unexpectedStderr(text: string): string {
    return text.split("\n").filter((line) => line.trim() !== "" && !line.includes("ExperimentalWarning: SQLite") && !line.includes("--trace-warnings")).join("\n");
}

async function servicesMode(): Promise<void> {
    const scratch = resolveAgentScratchPath("w00017-runtime-foundation-smoke", `services-${process.pid}`);
    const logDir = join(scratch, "logs");
    const dataDir = join(scratch, "data");
    const dbDir = join(scratch, "db");
    log(`services 模式：scratch=${scratch}`);
    try {
        await rm(scratch, {recursive: true, force: true});
        await mkdir(dataDir, {recursive: true});
        await mkdir(dbDir, {recursive: true});
        const base = ["--scratch", scratch];

        // 1. 移除任一必需提供者：启动明确失败、不接纳；缺依赖的 notes 不激活，没有文件或数据库副作用。
        //    audit 不依赖文件能力，移除 platform-files 时它仍会激活并在自己的位置登记 audit.sqlite——这是独立消费者
        //    的正常行为，随启动失败收口，不算越界。
        for (const omitted of SERVICE_PLUGIN_IDS) {
            const run = await runServerChild([...base, "--phase", "write", "--omit", omitted], () => undefined, 30_000, "services-entry.ts");
            const startup = eventOf(run, "startup");
            const stop = startup?.["stop"] as Json | undefined;
            const failed = ((startup?.["gates"] as Json[] | undefined) ?? []).filter((gate) => gate["status"] === "failed").map((gate) => String(gate["id"]));
            check(startup?.["status"] === "failed" && startup["admission"] === "closed" && stop?.["status"] === "closed", `移除 ${omitted}：启动 failed、不接纳、已取得资源收口 (${String(startup?.["status"])}; failed=${failed.join(",")})`);
            check(failed.includes("notes"), `移除 ${omitted}：依赖它的 notes 门禁失败`);
            check(run.exitCode === 2, `移除 ${omitted}：退出码 2 (${String(run.exitCode)})`);
            check((await readdir(dataDir)).length === 0 && !existsSync(join(dbDir, "notes.sqlite")), `移除 ${omitted}：notes 没有文件或数据库副作用`);
            const emergency = eventOf(run, "emergency");
            check(emergency !== undefined && JSON.stringify(emergency).includes("必需门禁失败"), `移除 ${omitted}：紧急输出可见`);
            check(unexpectedStderr(run.stderr) === "", `移除 ${omitted}：无非预期 stderr${unexpectedStderr(run.stderr) === "" ? "" : `：${unexpectedStderr(run.stderr).slice(0, 200)}`}`);
        }
        // 诊断在场时，启动失败也进入日志文件（在收口前写出）。
        const failureLines = existsSync(join(logDir, "server-current.jsonl")) ? logLines(await readFile(join(logDir, "server-current.jsonl"), "utf8")) : [];
        check(failureLines.some((line) => line["event"] === "application.startup-emergency"), `启动门禁失败写入诊断日志 (${failureLines.filter((line) => line["event"] === "application.startup-emergency").length} 条)`);

        // 2. 写阶段：三插件激活，notes 写文件并提交一行；存活期间第二进程争用同一日志位置。
        const writer = startHeldChild([...base, "--phase", "write"]);
        await writer.ready;
        const contender = startHeldChild([...base, "--phase", "read"]);
        await contender.ready;
        contender.stop();
        writer.stop();
        const [written, contended] = await Promise.all([writer.run, contender.run]);
        const ready = eventOf(written, "ready");
        const notes = ready?.["notes"] as Json | undefined;
        const rows = (notes?.["rows"] as Json[] | undefined) ?? [];
        check(notes?.["text"] === NOTES_BODY, "写阶段：文件经授予写入后可读回");
        check(rows.length === 1 && rows[0]?.["body"] === NOTES_ROW, `写阶段：SQLite 事务提交且注入样式文本按值保存 (${rows.length} 行)`);
        const audit = ready?.["audit"] as Json | undefined;
        check(audit?.["sharedSqliteInstance"] === true, "同一解析作用域的两个消费者共享同一 SQLite 服务实例");
        check(audit?.["isolatedResourceFile"] === "audit.sqlite", `同名资源按 owner 作用域隔离 (${String(audit?.["isolatedResourceFile"])})`);
        check(audit?.["secondOwnerCode"] === "file-owned", `同一物理文件拒绝第二 owner (${String(audit?.["secondOwnerCode"])})`);
        const writerDiagnostics = ready?.["diagnostics"] as Json | undefined;
        check((writerDiagnostics?.["exporter"] as Json | undefined)?.["state"] === "open" && writerDiagnostics?.["degraded"] === null, "写阶段：诊断文件出口获授日志位置");
        check(((ready?.["query"] as string[] | undefined) ?? []).includes("notes.write"), "消费者可查询本实例诊断");
        const contendedReady = eventOf(contended, "ready");
        const contendedDiagnostics = contendedReady?.["diagnostics"] as Json | undefined;
        check((contendedDiagnostics?.["degraded"] as Json | null | undefined)?.["reason"] === "location-conflict", `并发实例争用同一日志位置时降级 (${JSON.stringify(contendedDiagnostics?.["degraded"])})`);
        const writtenStop = eventOf(written, "stopped")?.["stop"] as Json | undefined;
        check(writtenStop?.["status"] === "closed" && written.exitCode === 0, `写阶段合作停止后 closed (${String(writtenStop?.["status"])}, exit=${String(written.exitCode)})`);
        check(contended.exitCode === 0, `争用实例仍可用并正常关闭 (exit=${String(contended.exitCode)})`);
        check(unexpectedStderr(written.stderr) === "" && unexpectedStderr(contended.stderr) === "", `写阶段与争用实例无非预期 stderr${unexpectedStderr(written.stderr + contended.stderr) === "" ? "" : `：${unexpectedStderr(written.stderr + contended.stderr).slice(0, 200)}`}`);

        const logText = await readFile(join(logDir, "server-current.jsonl"), "utf8");
        const lines = logLines(logText);
        const writerId = String(ready?.["instanceId"]);
        const contenderId = String(contendedReady?.["instanceId"]);
        check(lines.some((line) => line["event"] === "notes.write" && (line["data"] as Json)["$source"] !== undefined && ((line["data"] as Json)["$source"] as Json)["instanceId"] === writerId), "日志文件读回写阶段记录，来源身份在 data.$source");
        check(!lines.some((line) => ((line["data"] as Json | undefined)?.["$source"] as Json | undefined)?.["instanceId"] === contenderId), "争用实例未写入被占用的日志位置");
        check(!logText.includes(SECRET_SAMPLES.token) && !logText.includes(SECRET_SAMPLES.password) && logText.includes("[REDACTED]"), "日志文件中敏感样本只剩占位符");

        // 3. 读阶段：新进程重开同一文件与数据库，只读回持久值。
        const reader = startHeldChild([...base, "--phase", "read"]);
        await reader.ready;
        reader.stop();
        const reread = await reader.run;
        const rereadNotes = eventOf(reread, "ready")?.["notes"] as Json | undefined;
        const rereadRows = (rereadNotes?.["rows"] as Json[] | undefined) ?? [];
        check(rereadNotes?.["text"] === NOTES_BODY && rereadRows.length === 1 && rereadRows[0]?.["body"] === NOTES_ROW, "关闭后另一进程重开：文件与已提交行读回一致");
        check((eventOf(reread, "stopped")?.["stop"] as Json | undefined)?.["status"] === "closed" && reread.exitCode === 0, "读阶段合作停止后 closed");

        // 4. 句柄未释放：停止报告未完成，服务拒绝新操作；释放后显式恢复才 closed，数据保留。
        const holder = startHeldChild([...base, "--phase", "read", "--hold-handle"]);
        await holder.ready;
        holder.stop();
        const held = await holder.run;
        const heldStopped = eventOf(held, "stopped");
        const heldStop = heldStopped?.["stop"] as Json | undefined;
        check(heldStop?.["status"] === "incomplete", `句柄未释放时停止报告未完成而非 closed (${String(heldStop?.["status"])}/${String(heldStop?.["reason"])})`);
        check(heldStopped?.["probe"] === "stopping", `关闭未完成期间服务拒绝新操作 (${String(heldStopped?.["probe"])})`);
        check((heldStopped?.["recovered"] as Json | undefined)?.["status"] === "closed" && heldStopped?.["phase"] === "closed" && held.exitCode === 0, "释放句柄后显式恢复 closed");
        check(existsSync(join(dataDir, "notes", "entry.txt")) && existsSync(join(dbDir, "notes.sqlite")), "关闭与恢复不删除数据文件");
    } finally {
        await rm(scratch, {recursive: true, force: true});
        log(`scratch 已删除：${scratch}`);
    }
}

async function main(): Promise<void> {
    const {values} = parseArgs({
        options: {
            host: {type: "string"},
            services: {type: "boolean", default: false},
            "browser-executable": {type: "string"},
        },
    });
    const host = values.host;
    if (values.services) {
        await servicesMode();
    } else if (host === "server") {
        await serverMode();
    } else if (host === "browser") {
        await browserMode(values["browser-executable"]);
    } else {
        throw new Error("用法：node --import tsx scripts/smoke/runtime-foundation.ts --host server|browser [--browser-executable <path>] | --services");
    }
    log(`failures=${failures}`);
    process.exitCode = failures === 0 ? 0 : 1;
}

await main();
