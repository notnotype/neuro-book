/**
 * Files 性能验收的浏览器部分（w00017 t72）：由 `files-perf.ts`（Bun）以 Node 子进程启动——Playwright 必须由 Node
 * 运行，Bun 下启动浏览器时 CDP 握手会超时（`e2e/playwright.config.ts` 的同一结论）。只用 Node 内置模块、
 * `@playwright/test` 与带 `.ts` 后缀的相对导入，同 `scripts/lab-shot.ts`。
 *
 *   node scripts/perf/browser-runner.ts <配置.json> <结果.json>
 *
 * 配置给出样本、状态根、次数与是否采服务端 profile；结果是每个场景的状态（ok / failed / not-run）、汇总与原始样本。
 * 每个场景的失败只记在它自己名下，后面的场景照跑；任一场景不是 ok 时以 1 退出。服务与浏览器在 `finally` 里收口。
 */

import {execFileSync, spawn} from "node:child_process";
import type {ChildProcessWithoutNullStreams} from "node:child_process";
import {readdir, readFile, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {chromium} from "@playwright/test";
import type {Browser, BrowserContext, CDPSession, Page} from "@playwright/test";

import {pageAgent} from "./page-agent.ts";
import type {ArmResult, ArmSpec, TimedEvent} from "./page-agent.ts";
import {classifyFrame, countBy, hotspots, summarize} from "./stats.ts";
import type {CpuProfile, Summary} from "./stats.ts";

export interface RunnerConfig {
    readonly packageRoot: string;
    readonly stateRoot: string;
    readonly bookRoot: string;
    readonly logDirectory: string;
    readonly iterations: number;
    readonly opens: number;
    readonly serverProfile: boolean;
    /** 根目录下必须出现的行（文件树可操作的判据）。 */
    readonly roots: ReadonlyArray<string>;
    readonly wide: {readonly address: string; readonly entries: number};
    readonly sources: ReadonlyArray<string>;
    /** 只跑这些场景（编号）；空为全部。 */
    readonly only: ReadonlyArray<string>;
}

export interface ScenarioResult {
    readonly id: string;
    readonly name: string;
    readonly status: "ok" | "failed" | "not-run";
    readonly error?: string;
    readonly samples?: number;
    readonly feedback?: {readonly committed: Summary; readonly presented: Summary; readonly frames: Summary};
    readonly done?: {readonly committed: Summary; readonly presented: Summary; readonly frames: Summary};
    readonly values?: Readonly<Record<string, Summary>>;
    readonly longFrames?: {readonly count: number; readonly longest: number} | "unavailable";
    readonly events?: ReadonlyArray<TimedEvent>;
    readonly requests?: Readonly<Record<string, number>>;
    readonly received?: Readonly<Record<string, number>>;
    readonly notes?: ReadonlyArray<string>;
    readonly raw?: unknown;
}

export interface RunnerOutput {
    readonly chrome: string;
    readonly unsupported: ReadonlyArray<string>;
    readonly progress: ReadonlyArray<{readonly scenario: string; readonly at: number; readonly kind: string}>;
    readonly results: ReadonlyArray<ScenarioResult>;
    readonly serverProfiles: ReadonlyArray<{readonly label: string; readonly hotspots: ReturnType<typeof hotspots>}>;
    readonly problems: ReadonlyArray<string>;
}

const VIEWPORT = {width: 1440, height: 1000};

// ——— 服务 ———

interface Server {
    readonly url: string;
    readonly pid: number;
    stop(): Promise<number | null>;
}

/** 起生产构建的服务；等监听地址失败时同样经标准输入停止并等它退出，再抛错。 */
async function startServer(config: RunnerConfig, label: string, env: Readonly<Record<string, string>> = {}): Promise<Server> {
    const profile = config.serverProfile ? join(config.logDirectory, `${label}.cpuprofile`) : null;
    const args = [...(profile === null ? [] : ["--cpu-prof", `--cpu-prof-name=${profile}`]), "dist/server/main.js", "--stop-stdin"];
    const child: ChildProcessWithoutNullStreams = spawn("bun", args, {
        cwd: config.packageRoot,
        env: {...process.env, NBOOK_STATE_ROOT: config.stateRoot, NBOOK_PORT: "0", NBOOK_RPC_PORT: "0", NBOOK_WEB_ROOT: "dist/web", ...env},
    });
    let output = "";
    const exit = new Promise<number | null>((resolveExit) => child.on("exit", (code) => resolveExit(code)));
    const stop = async (): Promise<number | null> => {
        child.stdin.end("stop\n");
        const code = await exit;
        await writeFile(join(config.logDirectory, `${label}.log`), output);
        return code;
    };
    try {
        const url = await new Promise<string>((resolveUrl, reject) => {
            const timer = setTimeout(() => reject(new Error("服务 30 秒内没有监听")), 30_000);
            const onData = (chunk: Buffer): void => {
                output += chunk.toString("utf8");
                const match = /Listening on (\S+)/u.exec(output);
                if (match !== null) {
                    clearTimeout(timer);
                    resolveUrl(match[1] as string);
                }
            };
            child.stdout.on("data", onData);
            child.stderr.on("data", onData);
            void exit.then((code) => reject(new Error(`服务提前退出（${String(code)}）`)));
        });
        return {url, pid: child.pid as number, stop};
    } catch (error) {
        if (child.exitCode === null) await stop();
        throw new Error(`${error instanceof Error ? error.message : String(error)}：\n${output}`);
    }
}

/** 服务进程下还有没有项目子进程（`project.js`）。 */
function hasProjectChild(serverPid: number): boolean {
    let listing: string;
    try {
        listing = execFileSync("ps", ["-o", "args=", "--ppid", String(serverPid)], {encoding: "utf8"});
    } catch (error) {
        // `ps` 没有找到任何子进程时以 1 退出：就是没有项目子进程。
        if ((error as {status?: number}).status === 1) return false;
        throw error;
    }
    return listing.split("\n").some((line) => line.includes("project.js"));
}

// ——— 页面 ———

interface Session {
    readonly context: BrowserContext;
    readonly page: Page;
    readonly cdp: CDPSession;
    readonly sent: string[];
    readonly received: string[];
    readonly problems: string[];
}

async function newContext(browser: Browser, config: RunnerConfig): Promise<BrowserContext> {
    const context = await browser.newContext({viewport: VIEWPORT});
    await context.addInitScript(pageAgent, {roots: config.roots});
    return context;
}

async function openPage(context: BrowserContext, url: string): Promise<Session> {
    const page = await context.newPage();
    const sent: string[] = [];
    const received: string[] = [];
    const problems: string[] = [];
    page.on("websocket", (socket) => {
        socket.on("framesent", ({payload}) => {
            const kind = typeof payload === "string" ? classifyFrame(payload) : null;
            if (kind !== null) sent.push(kind);
        });
        socket.on("framereceived", ({payload}) => {
            if (typeof payload !== "string") return;
            try {
                const frame = JSON.parse(payload) as {type?: string};
                if (frame.type === "event") received.push("event");
            } catch {
                // 非 JSON 的帧不是本协议的事件：不计。
            }
        });
    });
    page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));
    page.on("crash", () => problems.push("页面崩溃"));
    page.on("console", (message) => {
        if (message.type() === "error") problems.push(`console: ${message.text()}`);
    });
    const cdp = await context.newCDPSession(page);
    // 诊断页面卡死用：调试器要在卡死之前就开着，卡死后才能暂停取栈（开着会让脚本稍慢，正式测量不开）。
    if (process.env.PERF_DEBUG === "1") await cdp.send("Debugger.enable");
    await page.goto(new URL("/?project=book", url).href);
    await page.waitForFunction(() => window.__perf?.treeReadyAt !== null, undefined, {timeout: 60_000});
    return {context, page, cdp, sent, received, problems};
}

const row = (address: string): string => `[data-explorer-row="${address}"]`;
const tab = (address: string): string => `[data-editor-group-active] [data-editor-tab][title="${address}"]`;

/** 把行滚进虚拟列表的可见区中部，返回它的中心坐标；行不在 DOM 里时从头往下一屏一屏找。 */
async function reveal(page: Page, selector: string): Promise<{x: number; y: number}> {
    return page.evaluate(async (target) => {
        const tree = document.querySelector<HTMLElement>("[data-explorer-tree]");
        if (tree === null) throw new Error("没有文件树");
        const frame = (): Promise<void> => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())));
        const scan = async (): Promise<boolean> => {
            if (document.querySelector(target) !== null) return true;
            tree.scrollTop = 0;
            await frame();
            for (;;) {
                if (document.querySelector(target) !== null) return true;
                if (tree.scrollTop + tree.clientHeight >= tree.scrollHeight) return false;
                tree.scrollTop += tree.clientHeight * 0.8;
                await frame();
            }
        };
        // 居中之后虚拟列表会重新渲染（刚展开的目录还在补行时位置也会变）：行不见了就重新找，最多校正几次，直到行完整
        // 落在树的视口里。
        for (let attempt = 0; attempt < 8; attempt += 1) {
            if (!(await scan())) throw new Error(`树里找不到 ${target}`);
            const placed = document.querySelector<HTMLElement>(target) as HTMLElement;
            const rect = placed.getBoundingClientRect();
            const bounds = tree.getBoundingClientRect();
            if (attempt > 0 && rect.top >= bounds.top && rect.bottom <= bounds.bottom) return {x: rect.left + Math.min(rect.width / 2, 120), y: rect.top + rect.height / 2};
            tree.scrollTop += rect.top + rect.height / 2 - (bounds.top + bounds.height / 2);
            await frame();
        }
        throw new Error(`${target} 没有完整落在树的视口里`);
    }, selector);
}

/** 目录行的展开箭头：内容文件夹的行点在行上不展开，展开与收起都点箭头。 */
async function revealTwisty(page: Page, address: string): Promise<{x: number; y: number}> {
    await reveal(page, row(address));
    return centerOf(page, `${row(address)} [data-explorer-twisty]`);
}

async function centerOf(page: Page, selector: string): Promise<{x: number; y: number}> {
    // 标签条放不下时标签可能在横向滚动区之外：先滚进可见区再取坐标。
    await page.locator(selector).first().scrollIntoViewIfNeeded();
    const box = await page.locator(selector).first().boundingBox();
    if (box === null) throw new Error(`${selector} 不可见`);
    return {x: box.x + box.width / 2, y: box.y + box.height / 2};
}

/** 在坐标上真实点击并等页面里的终点；页面 30 秒没有回应时取主线程的调用栈。 */
async function measure(session: Session, at: {x: number; y: number}, spec: ArmSpec): Promise<ArmResult> {
    await session.page.evaluate((armed) => window.__perf?.arm(armed), spec);
    await session.page.mouse.click(at.x, at.y);
    const waiting = session.page.evaluate(() => window.__perf?.result ?? null);
    const stuck = new Promise<"stuck">((done) => setTimeout(() => done("stuck"), 30_000));
    const result = await Promise.race([waiting, stuck]);
    if (result === "stuck") throw new Error(`页面 30 秒没有回应（${JSON.stringify(spec)}）：${await pausedStack(session)}`);
    if (result === null) throw new Error("页面里没有测量代理");
    if (result.error !== null) throw new Error(result.error);
    return result;
}

async function pausedStack(session: Session): Promise<string> {
    // 主线程卡死时这些调用本身也可能不返回：每一步都限时。
    const within = <T>(work: Promise<T>): Promise<T | null> => Promise.race([work, new Promise<null>((done) => setTimeout(() => done(null), 5000))]);
    if (process.env.PERF_DEBUG !== "1" && await within(session.cdp.send("Debugger.enable")) === null) return "调试器 5 秒内没有回应（主线程卡死；设 PERF_DEBUG=1 重跑可取栈）";
    const paused = new Promise<{callFrames: Array<{functionName: string; url: string; location: {lineNumber: number; columnNumber?: number}}>}>((done) => session.cdp.once("Debugger.paused", done));
    void session.cdp.send("Debugger.pause").catch(() => null);
    const event = await within(paused);
    if (event === null) return "暂停不了（主线程没有在运行脚本，或卡在原生代码里）";
    return event.callFrames.slice(0, 15).map((frame) => `${frame.functionName || "(匿名)"} ${frame.url.split("/").pop() ?? ""}:${String(frame.location.lineNumber + 1)}`).join(" ← ");
}

async function expand(session: Session, address: string): Promise<void> {
    const selector = row(address);
    const at = await revealTwisty(session.page, address);
    if (await session.page.locator(selector).getAttribute("aria-expanded") === "true") return;
    await session.page.mouse.click(at.x, at.y);
    await session.page.waitForFunction((target) => document.querySelector(target)?.getAttribute("aria-expanded") === "true", selector);
}

async function closeAllTabs(session: Session): Promise<void> {
    for (let guard = 0; guard < 100; guard += 1) {
        const close = session.page.locator("[data-editor-tab-close]").first();
        if (await close.count() === 0) return;
        await close.click();
        const discard = session.page.locator("[data-editor-close-discard]");
        if (await discard.isVisible()) await discard.click();
    }
    throw new Error("关不完标签");
}

/**
 * 计时之外核验正文真的能输入：在活动视图末尾键入记号，核对它进了正文，撤销，核对正文与未保存标记都回到原样。
 * 判定只凭属性可能早于输入路径就绪，这一步把那种情况变成失败。
 */
async function verifyInput(session: Session, editor: "markdown" | "code"): Promise<void> {
    const page = session.page;
    const token = "PERFINPUT";
    const host = `[data-editor-group-active] [data-editor-kind="${editor}"]`;
    const text = (): Promise<string> => page.locator(editor === "markdown" ? `${host} [data-editor-prose]` : `${host} .view-lines`).textContent().then((value) => value ?? "");
    await page.locator(editor === "markdown" ? `${host} [data-editor-prose]` : `${host} .monaco-editor`).click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type(token);
    await page.waitForFunction(({target, word}) => (document.querySelector(target)?.textContent ?? "").includes(word), {target: editor === "markdown" ? `${host} [data-editor-prose]` : `${host} .view-lines`, word: token});
    for (let attempt = 0; attempt < token.length && (await text()).includes(token); attempt += 1) await page.keyboard.press("Control+z");
    if ((await text()).includes(token)) throw new Error(`撤销后记号还在（${editor}）`);
    // 未保存标记消失即正文回到了已保存的内容（Monaco 的可见行随滚动变化，不能逐字比较）。
    await page.waitForFunction(() => document.querySelector("[data-editor-group-active] [data-editor-tab][aria-selected=\"true\"]")?.hasAttribute("data-editor-tab-dirty") === false);
}

async function longFramesBetween(session: Session, from: number, to: number): Promise<{count: number; longest: number} | "unavailable"> {
    return session.page.evaluate(({start, end}) => {
        const agent = window.__perf;
        if (agent === undefined || agent.unsupported.includes("long-animation-frame")) return "unavailable" as const;
        const frames = agent.frames.filter((frame) => frame.start + frame.duration >= start && frame.start <= end);
        return {count: frames.length, longest: Math.round(Math.max(0, ...frames.map((frame) => frame.duration)))};
    }, {start: from, end: to});
}

const now = (session: Session): Promise<number> => session.page.evaluate(() => performance.now());

interface Collected {
    feedbackCommitted: number[];
    feedbackPresented: number[];
    feedbackFrames: number[];
    doneCommitted: number[];
    donePresented: number[];
    doneFrames: number[];
}

const collected = (): Collected => ({feedbackCommitted: [], feedbackPresented: [], feedbackFrames: [], doneCommitted: [], donePresented: [], doneFrames: []});
const push = (into: Collected, result: ArmResult): void => {
    into.feedbackCommitted.push(result.feedbackCommitted);
    into.feedbackPresented.push(result.feedbackPresented);
    into.feedbackFrames.push(result.feedbackFrames);
    into.doneCommitted.push(result.doneCommitted);
    into.donePresented.push(result.donePresented);
    into.doneFrames.push(result.doneFrames);
};
const summaries = (from: Collected): Pick<ScenarioResult, "feedback" | "done" | "samples"> => ({
    samples: from.donePresented.length,
    feedback: {committed: summarize(from.feedbackCommitted), presented: summarize(from.feedbackPresented), frames: summarize(from.feedbackFrames)},
    done: {committed: summarize(from.doneCommitted), presented: summarize(from.donePresented), frames: summarize(from.doneFrames)},
});

async function markerOf(config: RunnerConfig, address: string): Promise<string> {
    const head = (await readFile(join(config.bookRoot, address.replace(/^project:\/\//u, "")), "utf8")).slice(0, 400);
    const marker = /NBOOK-SAMPLE-\d+-\d+/u.exec(head)?.[0];
    if (marker === undefined) throw new Error(`${address} 没有标记`);
    return marker;
}

async function chapters(config: RunnerConfig, volume: string): Promise<string[]> {
    return (await readdir(join(config.bookRoot, "manuscripts", volume))).filter((name) => name.endsWith(".md")).sort().map((name) => `project://manuscripts/${volume}/${name}`);
}

// ——— 场景 ———

async function main(): Promise<number> {
    const [configPath, resultPath] = process.argv.slice(2);
    if (configPath === undefined || resultPath === undefined) throw new Error("用法：node scripts/perf/browser-runner.ts <配置.json> <结果.json>");
    const config = JSON.parse(await readFile(configPath, "utf8")) as RunnerConfig;
    const results: ScenarioResult[] = [];
    const progress: Array<{scenario: string; at: number; kind: string}> = [];
    const problems: string[] = [];
    const serverProfiles: Array<{label: string; hotspots: ReturnType<typeof hotspots>}> = [];
    let browser: Browser | null = null;
    const servers = new Set<Server>();
    let unsupported: ReadonlyArray<string> = [];
    let chrome = "";

    const wanted = (id: string): boolean => config.only.length === 0 || config.only.includes(id);
    /** 当前场景用的页面：场景失败时截一张图到日志目录（`--keep-temp` 时保留）。 */
    let currentPage: Page | null = null;
    const run = async (id: string, name: string, body: () => Promise<Omit<ScenarioResult, "id" | "name" | "status">>): Promise<void> => {
        if (!wanted(id)) return;
        process.stdout.write(`${id} ${name}…\n`);
        try {
            results.push({id, name, status: "ok", ...await body()});
        } catch (error) {
            const shot = join(config.logDirectory, `${id}-failed.png`);
            const saved = currentPage === null ? false : await currentPage.screenshot({path: shot}).then(() => true, () => false);
            results.push({id, name, status: "failed", error: error instanceof Error ? error.message : String(error), ...(saved ? {notes: [`失败时的截图：${shot}`]} : {})});
            process.stdout.write(`  失败：${error instanceof Error ? error.message.split("\n")[0] : String(error)}\n`);
        }
    };
    const serve = async (label: string, env: Readonly<Record<string, string>> = {}): Promise<Server> => {
        const server = await startServer(config, label, env);
        servers.add(server);
        return server;
    };
    const shut = async (server: Server, label: string): Promise<void> => {
        servers.delete(server);
        const code = await server.stop();
        if (code !== 0) throw new Error(`服务 ${label} 以 ${String(code)} 退出`);
        if (config.serverProfile) {
            const profile = JSON.parse(await readFile(join(config.logDirectory, `${label}.cpuprofile`), "utf8")) as CpuProfile;
            serverProfiles.push({label, hotspots: hotspots(profile)});
        }
    };
    const closeSession = async (session: Session, scenario: string): Promise<void> => {
        const recorded = await session.page.evaluate(() => window.__perf?.progress ?? []).catch(() => []);
        progress.push(...recorded.map((entry) => ({scenario, ...entry})));
        problems.push(...session.problems);
        await session.context.close();
    };

    try {
        browser = await chromium.launch({channel: "chrome", headless: true});
        chrome = browser.version();

        // A1、A2：服务刚启动的第一次打开；关掉页面后在项目宽限期内再打开。
        await run("A1+A2", "打开项目：服务刚启动 / 宽限期内再打开", async () => {
            const cold: number[] = [];
            const reopen: number[] = [];
            const boot: number[] = [];
            for (let index = 0; index < config.opens; index += 1) {
                const started = performance.now();
                const server = await serve(`open-${String(index)}`);
                boot.push(performance.now() - started);
                for (const into of [cold, reopen]) {
                    const context = await newContext(browser as Browser, config);
                    const session = await openPage(context, server.url);
                    into.push(await session.page.evaluate(() => window.__perf?.treeReadyAt ?? -1));
                    // 计时之外：树真能操作，键盘把焦点移到下一行。
                    await session.page.locator(row(config.roots[0] as string)).click();
                    await session.page.keyboard.press("ArrowDown");
                    await session.page.waitForFunction(() => document.activeElement?.closest("[data-explorer-tree]") !== null);
                    unsupported = await session.page.evaluate(() => window.__perf?.unsupported ?? []);
                    await closeSession(session, "A1+A2");
                }
                await shut(server, `open-${String(index)}`);
            }
            return {samples: cold.length, values: {"服务启动到监听（脚本侧）": summarize(boot), "A1 第一次打开：导航到树可操作": summarize(cold), "A2 宽限期内再打开：导航到树可操作": summarize(reopen)}};
        });

        // A3：项目子进程退出之后再打开（新代次）。
        await run("A3", "打开项目：子进程退出后重开", async () => {
            const server = await serve("reopen-after-exit", {NBOOK_PROJECT_GRACE_MS: "1"});
            const values: number[] = [];
            try {
                for (let index = 0; index <= config.opens; index += 1) {
                    const context = await newContext(browser as Browser, config);
                    const session = await openPage(context, server.url);
                    if (index > 0) values.push(await session.page.evaluate(() => window.__perf?.treeReadyAt ?? -1));
                    await closeSession(session, "A3");
                    const deadline = Date.now() + 30_000;
                    while (hasProjectChild(server.pid)) {
                        if (Date.now() > deadline) throw new Error("项目子进程 30 秒内没有退出");
                        await new Promise((done) => setTimeout(done, 100));
                    }
                }
            } finally {
                await shut(server, "reopen-after-exit");
            }
            return {samples: values.length, values: {"导航到树可操作": summarize(values)}};
        });

        const server = await serve("main");
        try {
            // A4：同一客户端身份的展开记录恢复多个已展开目录（全部卷与宽目录）。
            await run("A4", "打开项目：恢复多个已展开目录", async () => {
                const context = await newContext(browser as Browser, config);
                try {
                    const setup = await openPage(context, server.url);
                    await closeAllTabs(setup);
                    await expand(setup, "project://manuscripts");
                    for (let volume = 1; volume <= 10; volume += 1) await expand(setup, `project://manuscripts/volume-${String(volume).padStart(2, "0")}`);
                    await expand(setup, "project://notes");
                    await expand(setup, config.wide.address);
                    const rows = await setup.page.evaluate(() => document.querySelectorAll("[data-explorer-row]").length);
                    await setup.page.close();
                    const values: number[] = [];
                    for (let index = 0; index < config.opens; index += 1) {
                        const page = await context.newPage();
                        await page.goto(new URL("/?project=book", server.url).href);
                        await page.waitForFunction(() => window.__perf?.treeReadyAt !== null, undefined, {timeout: 60_000});
                        values.push(await page.evaluate(() => window.__perf?.treeReadyAt ?? -1));
                        await page.close();
                    }
                    return {samples: values.length, values: {"导航到树可操作": summarize(values)}, notes: [`展开后 DOM 里的行 ${String(rows)}（虚拟列表只渲染可见区）`]};
                } finally {
                    await context.close();
                }
            });

            // B1、B2、C1、C2：同一个新上下文里依次进行。
            const context = await newContext(browser as Browser, config);
            const session = await openPage(context, server.url);
            currentPage = session.page;
            try {
                await closeAllTabs(session);
                for (const address of ["project://manuscripts", "project://manuscripts/volume-01", "project://manuscripts/volume-02"]) await expand(session, address);
                const volume1 = await chapters(config, "volume-01");
                const volume2 = await chapters(config, "volume-02");

                const coldScenario = async (targets: ReadonlyArray<string>, editor: "markdown" | "code"): Promise<Omit<ScenarioResult, "id" | "name" | "status">> => {
                    const [first, ...rest] = targets;
                    if (first === undefined || rest.length < config.iterations) throw new Error(`没有足够的文件（要 ${String(config.iterations + 1)} 个）`);
                    session.sent.length = 0;
                    const firstResult = await measure(session, await reveal(session.page, row(first)), {kind: "open", address: first, marker: await markerOf(config, first), editor, fromRow: true});
                    const all = collected();
                    const t0 = await now(session);
                    for (const address of rest.slice(0, config.iterations)) {
                        push(all, await measure(session, await reveal(session.page, row(address)), {kind: "open", address, marker: await markerOf(config, address), editor, fromRow: true}));
                    }
                    const t1 = await now(session);
                    await verifyInput(session, editor);
                    return {
                        ...summaries(all),
                        values: {"第一次（含控件代码）：选中与标签 presented": summarize([firstResult.feedbackPresented]), "第一次（含控件代码）：正文 presented": summarize([firstResult.donePresented])},
                        longFrames: await longFramesBetween(session, t0, t1),
                        requests: countBy(session.sent),
                    };
                };
                await run("B1", "未打开过的章节：选中与标签 / 正文（富文本）", () => coldScenario(volume2.slice(0, 1).concat(volume1.slice(0, config.iterations)), "markdown"));
                await run("B2", "未打开过的源码文件：选中与标签 / 正文（源码）", async () => {
                    await expand(session, "project://data");
                    return coldScenario(config.sources, "code");
                });

                const hotScenario = async (a: string, b: string, editor: "markdown" | "code", viaTree: boolean): Promise<Omit<ScenarioResult, "id" | "name" | "status">> => {
                    for (const address of [a, b]) {
                        const at = await reveal(session.page, row(address));
                        await session.page.mouse.dblclick(at.x, at.y);
                        await session.page.waitForFunction((selector) => document.querySelector(selector) !== null, tab(address));
                    }
                    session.sent.length = 0;
                    const all = collected();
                    const t0 = await now(session);
                    for (let index = 0; index < config.iterations; index += 1) {
                        const address = index % 2 === 0 ? a : b;
                        const at = viaTree ? await reveal(session.page, row(address)) : await centerOf(session.page, tab(address));
                        push(all, await measure(session, at, {kind: "open", address, marker: await markerOf(config, address), editor, fromRow: viaTree}));
                    }
                    const t1 = await now(session);
                    return {...summaries(all), longFrames: await longFramesBetween(session, t0, t1), requests: countBy(session.sent)};
                };
                const [m1, m2] = volume1.slice(-2) as [string, string];
                const [s1, s2] = config.sources.slice(-2) as [string, string];
                await run("C1-md", "已打开过：来回点标签（富文本，单组）", async () => {
                    await closeAllTabs(session);
                    return hotScenario(m1, m2, "markdown", false);
                });
                await run("C2-md", "已打开过：从资源树再点（富文本）", () => hotScenario(m1, m2, "markdown", true));
                await run("C1-code", "已打开过：来回点标签（源码，单组）", async () => {
                    await closeAllTabs(session);
                    return hotScenario(s1, s2, "code", false);
                });
                await run("C2-code", "已打开过：从资源树再点（源码）", () => hotScenario(s1, s2, "code", true));
                await run("C1-md-split", "已打开过：来回点标签（富文本，双组）", async () => {
                    await closeAllTabs(session);
                    const [d1, d2] = volume2.slice(-2) as [string, string];
                    const at = await reveal(session.page, row(volume2[1] as string));
                    await session.page.mouse.dblclick(at.x, at.y);
                    await session.page.locator("[data-editor-group-active] [data-editor-prose]").click();
                    await session.page.keyboard.press("Control+\\");
                    await session.page.waitForFunction(() => document.querySelectorAll("[data-editor-group]").length === 2);
                    const result = await hotScenario(d1, d2, "markdown", false);
                    await verifyInput(session, "markdown");
                    return result;
                });

                // F1：资源保留。打开再关闭 20 个文件为一轮，每轮后 GC 读堆。
                await run("F1", "资源保留：打开再关闭 20 个文件 × 5 轮", async () => {
                    await closeAllTabs(session);
                    const heaps: number[] = [];
                    const files = volume1.slice(config.iterations, config.iterations + 20);
                    for (let round = 0; round < 5; round += 1) {
                        for (const address of files) {
                            const at = await reveal(session.page, row(address));
                            await session.page.mouse.dblclick(at.x, at.y);
                            await session.page.waitForFunction((selector) => document.querySelector(selector) !== null, tab(address));
                        }
                        await closeAllTabs(session);
                        await session.cdp.send("HeapProfiler.collectGarbage");
                        heaps.push(await session.page.evaluate(() => Math.round(((performance as Performance & {memory?: {usedJSHeapSize: number}}).memory?.usedJSHeapSize ?? 0) / 1024 / 1024 * 10) / 10));
                    }
                    const mounted = await session.page.evaluate(() => ({prose: document.querySelectorAll(".ProseMirror").length, monaco: document.querySelectorAll(".monaco-editor").length}));
                    return {samples: heaps.length, values: {"每轮 GC 后的堆（MB）": summarize(heaps)}, notes: [`各轮堆：${heaps.join(" / ")} MB`, `关闭全部标签后挂载的控件：富文本 ${String(mounted.prose)}、Monaco ${String(mounted.monaco)}（DOM 计数；模型与编辑状态的释放由 t71 的控制器测试证明）`], raw: {heaps, mounted}};
                });

                // D1：展开宽目录；每次先把父行滚回视口收起。
                await run("D1", `展开 ${String(config.wide.entries)} 项的目录`, async () => {
                    await expand(session, "project://notes");
                    const all = collected();
                    const t0 = await now(session);
                    for (let index = 0; index < 10; index += 1) {
                        const at = await revealTwisty(session.page, config.wide.address);
                        if (await session.page.locator(row(config.wide.address)).getAttribute("aria-expanded") === "true") {
                            await session.page.mouse.click(at.x, at.y);
                            await session.page.waitForFunction((selector) => document.querySelector(selector)?.getAttribute("aria-expanded") === "false", row(config.wide.address));
                        }
                        push(all, await measure(session, await revealTwisty(session.page, config.wide.address), {kind: "expand", address: config.wide.address}));
                    }
                    return {...summaries(all), longFrames: await longFramesBetween(session, t0, await now(session))};
                });

                // D2：展开内容目录（每项探测 index.md，读 content.xml）。
                await run("D2", "展开内容目录（lorebook.content/characters）", async () => {
                    await expand(session, "project://lorebook.content");
                    const target = "project://lorebook.content/characters";
                    session.sent.length = 0;
                    const all = collected();
                    const t0 = await now(session);
                    for (let index = 0; index < 10; index += 1) {
                        const at = await revealTwisty(session.page, target);
                        if (await session.page.locator(row(target)).getAttribute("aria-expanded") === "true") {
                            await session.page.mouse.click(at.x, at.y);
                            await session.page.waitForFunction((selector) => document.querySelector(selector)?.getAttribute("aria-expanded") === "false", row(target));
                        }
                        push(all, await measure(session, await revealTwisty(session.page, target), {kind: "expand", address: target}));
                    }
                    return {...summaries(all), longFrames: await longFramesBetween(session, t0, await now(session)), requests: countBy(session.sent)};
                });

                // D3：展开宽目录后从树顶用滚轮滚到底。
                await run("D3", "滚动展开后的文件树（滚轮从顶到底）", async () => {
                    await expand(session, config.wide.address);
                    const intervals: number[] = [];
                    const longest: number[] = [];
                    let longFrames: {count: number; longest: number} | "unavailable" = {count: 0, longest: 0};
                    for (let round = 0; round < 5; round += 1) {
                        await session.page.evaluate(() => {
                            const tree = document.querySelector<HTMLElement>("[data-explorer-tree]");
                            if (tree !== null) tree.scrollTop = 0;
                        });
                        const box = await session.page.locator("[data-explorer-tree]").boundingBox();
                        if (box === null) throw new Error("文件树不可见");
                        await session.page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
                        const t0 = await now(session);
                        await session.page.evaluate(() => window.__perf?.startFrames());
                        for (let step = 0; step < 400; step += 1) {
                            await session.page.mouse.wheel(0, 200);
                            const atEnd = await session.page.evaluate(() => {
                                const tree = document.querySelector<HTMLElement>("[data-explorer-tree]");
                                return tree === null || tree.scrollTop + tree.clientHeight >= tree.scrollHeight - 1;
                            });
                            if (atEnd) break;
                        }
                        await session.page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
                        const stamps = await session.page.evaluate(() => window.__perf?.stopFrames() ?? []);
                        const gaps = stamps.slice(1).map((stamp, index) => stamp - (stamps[index] as number));
                        intervals.push(...gaps);
                        longest.push(Math.max(0, ...gaps));
                        const frames = await longFramesBetween(session, t0, await now(session));
                        if (frames === "unavailable") longFrames = "unavailable";
                        else if (longFrames !== "unavailable") longFrames = {count: longFrames.count + frames.count, longest: Math.max(longFrames.longest, frames.longest)};
                    }
                    return {samples: longest.length, values: {"帧间隔": summarize(intervals), "每次滚动的最长帧间隔": summarize(longest)}, longFrames};
                });

                // E1：在磁盘上并发改写 500 个文件的同时连续键入。
                await run("E1", "外部改写 500 个文件时连续键入", async () => {
                    await closeAllTabs(session);
                    for (const address of ["project://manuscripts/volume-03", "project://data"]) await expand(session, address);
                    const volume3 = await chapters(config, "volume-03");
                    const opened = volume3[0] as string;
                    const at = await reveal(session.page, row(opened));
                    await session.page.mouse.dblclick(at.x, at.y);
                    await session.page.waitForFunction((selector) => document.querySelector(selector) !== null, tab(opened));
                    const wideDir = join(config.bookRoot, config.wide.address.replace("project://", ""));
                    const victims = volume3.slice(0, 250).map((address) => join(config.bookRoot, address.replace("project://", "")))
                        .concat((await readdir(wideDir)).sort().slice(0, 250).map((name) => join(wideDir, name)));
                    const sentinel = "project://data/aaa-perf-sentinel.json";
                    const summary: Record<string, number[]> = {"第一次写入到树里出现哨兵、已打开文件提示磁盘已变化": [], "键入事件：输入延迟": [], "键入事件：处理时长": [], "键入事件：到下一次绘制": []};
                    let frames: {count: number; longest: number} | "unavailable" = {count: 0, longest: 0};
                    const received: string[] = [];
                    const sent: string[] = [];
                    for (let round = 0; round < 5; round += 1) {
                        await session.page.locator("[data-editor-group-active] [data-editor-prose]").click();
                        await session.page.keyboard.press("Control+End");
                        await session.page.evaluate(() => {
                            const tree = document.querySelector<HTMLElement>("[data-explorer-tree]");
                            if (tree !== null) tree.scrollTop = 0;
                        });
                        session.sent.length = 0;
                        session.received.length = 0;
                        const t0 = await now(session);
                        const writing = (async (): Promise<void> => {
                            await Promise.all(victims.map((path, index) => writeFile(path, `# 外部改写 ${String(round)}-${String(index)}\n`)));
                            await writeFile(join(config.bookRoot, sentinel.replace("project://", "")), `{"round": ${String(round)}}\n`);
                        })();
                        await Promise.all([writing, session.page.keyboard.type("后台改写期间的输入", {delay: 25})]);
                        await session.page.waitForFunction(({selector}) => document.querySelector(selector) !== null && document.querySelector("[data-editor-group-active] [data-editor-banner]") !== null, {selector: row(sentinel)}, {timeout: 60_000});
                        const t1 = await now(session);
                        summary["第一次写入到树里出现哨兵、已打开文件提示磁盘已变化"]?.push(t1 - t0);
                        const keys = await session.page.evaluate(({from, to}) => (window.__perf?.events ?? []).filter((event) => event.start >= from && event.start <= to && event.name.startsWith("key")), {from: t0, to: t1});
                        for (const event of keys) {
                            summary["键入事件：输入延迟"]?.push(event.processingStart - event.start);
                            summary["键入事件：处理时长"]?.push(event.processingEnd - event.processingStart);
                            summary["键入事件：到下一次绘制"]?.push(event.duration);
                        }
                        const observed = await longFramesBetween(session, t0, t1);
                        if (observed === "unavailable") frames = "unavailable";
                        else if (frames !== "unavailable") frames = {count: frames.count + observed.count, longest: Math.max(frames.longest, observed.longest)};
                        received.push(...session.received);
                        sent.push(...session.sent);
                        // 收尾：重新载入磁盘版本、删掉哨兵，下一轮从同样的状态开始。
                        await session.page.locator("[data-editor-banner-action=\"reload\"]").click();
                        await session.page.waitForFunction(() => document.querySelector("[data-editor-group-active] [data-editor-banner]") === null);
                        await rm(join(config.bookRoot, sentinel.replace("project://", "")));
                        await session.page.waitForFunction((selector) => document.querySelector(selector) === null, row(sentinel), {timeout: 60_000});
                    }
                    const values: Record<string, Summary> = {};
                    for (const [name, list] of Object.entries(summary)) if (list.length > 0) values[name] = summarize(list);
                    return {samples: 5, values, longFrames: frames, requests: countBy(sent), received: countBy(received), notes: [`键入事件（Event Timing，≥16 ms 才记录）共 ${String(summary["键入事件：到下一次绘制"]?.length ?? 0)} 个`]};
                });
            } finally {
                await closeSession(session, "B–F");
            }
        } finally {
            await shut(server, "main").catch((error: unknown) => problems.push(error instanceof Error ? error.message : String(error)));
        }
    } catch (error) {
        problems.push(error instanceof Error ? (error.stack ?? error.message) : String(error));
    } finally {
        await browser?.close();
        for (const server of servers) await server.stop().catch(() => null);
        const output: RunnerOutput = {chrome, unsupported, progress, results, serverProfiles, problems};
        await writeFile(resultPath, `${JSON.stringify(output, null, 2)}\n`);
    }
    const failed = results.some((result) => result.status !== "ok") || problems.length > 0;
    return failed ? 1 : 0;
}

process.exitCode = await main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.stack : error);
    return 1;
});
