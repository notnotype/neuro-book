/**
 * Files 性能验收的浏览器部分（w00017 t72）：由 `files-perf.ts`（Bun）以 Node 子进程启动——Playwright 必须由 Node
 * 运行，Bun 下启动浏览器时 CDP 握手会超时（`e2e/playwright.config.ts` 的同一结论）。只用 Node 内置模块、
 * `@playwright/test` 与带 `.ts` 后缀的相对导入，同 `scripts/lab-shot.ts`。
 *
 *   node scripts/perf/browser-runner.ts <配置.json> <结果.json>
 *
 * 配置给出样本、状态根、次数与是否采服务端 profile；结果是每个场景的状态（ok / failed / not-run）、汇总与原始样本。
 * 每个场景自己建立前置（`scenarios.ts`），失败只记在它自己名下，后面的场景照跑；要求的场景没有执行的记为 not-run。
 * 任一场景不是 ok 时以 1 退出。服务与浏览器在 `finally` 里收口。
 */

import {execFileSync, spawn} from "node:child_process";
import type {ChildProcessWithoutNullStreams} from "node:child_process";
import {readdir, readFile, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {chromium} from "@playwright/test";
import type {Browser, BrowserContext, CDPSession, Page} from "@playwright/test";

import {EVENT_THRESHOLD_MS, pageAgent} from "./page-agent.ts";
import type {ArmResult, ArmSpec} from "./page-agent.ts";
import {E1_CHAPTERS, E1_WIDE, EXPAND_SAMPLES, F1_FILES, SCENARIOS} from "./scenarios.ts";
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
    /** 只跑这些场景（编号，见 `scenarios.ts`）；空为全部。 */
    readonly only: ReadonlyArray<string>;
}

/** Event Timing 的观察：发生了多少次（点击按 `arm` 计，按键按 keydown 计），其中多少次有 16 ms 以上的条目、最长多少。 */
export interface EventTimingSummary {
    readonly samples: number;
    readonly slow: number;
    readonly longest: number | null;
}

export interface ScenarioResult {
    readonly id: string;
    readonly name: string;
    readonly status: "ok" | "failed" | "not-run";
    readonly error?: string;
    readonly samples?: number;
    readonly feedback?: {readonly committed: Summary; readonly presented: Summary; readonly frames: Summary};
    readonly done?: {readonly committed: Summary; readonly presented: Summary; readonly frames: Summary};
    readonly eventTiming?: EventTimingSummary;
    readonly values?: Readonly<Record<string, Summary>>;
    readonly longFrames?: {readonly count: number; readonly longest: number} | "unavailable";
    readonly requests?: Readonly<Record<string, number>>;
    readonly received?: Readonly<Record<string, number>>;
    readonly notes?: ReadonlyArray<string>;
    /** 逐次的原始样本：外壳写进 `samples.json.gz`，汇总从同一份数据算出。 */
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

/** 起生产构建的服务；等监听地址失败（含进程起不来）时同样经标准输入停止并等它退出，再抛错。 */
async function startServer(config: RunnerConfig, label: string, env: Readonly<Record<string, string>> = {}): Promise<Server> {
    const profile = config.serverProfile ? join(config.logDirectory, `${label}.cpuprofile`) : null;
    const args = [...(profile === null ? [] : ["--cpu-prof", `--cpu-prof-name=${profile}`]), "dist/server/main.js", "--stop-stdin"];
    const child: ChildProcessWithoutNullStreams = spawn("bun", args, {
        cwd: config.packageRoot,
        env: {...process.env, NBOOK_STATE_ROOT: config.stateRoot, NBOOK_PORT: "0", NBOOK_RPC_PORT: "0", NBOOK_WEB_ROOT: "dist/web", ...env},
    });
    let output = "";
    // 进程起不来（找不到 bun、没有权限）只有 error、没有 exit：两者都结算同一个退出结果。
    const exit = new Promise<number | null>((resolveExit) => {
        child.on("exit", (code) => resolveExit(code));
        child.on("error", (error) => {
            output += `\n进程启动失败：${error.message}`;
            resolveExit(null);
        });
    });
    child.stdin.on("error", (error) => {
        output += `\n写标准输入失败：${error.message}`;
    });
    const stop = async (): Promise<number | null> => {
        if (child.exitCode === null && child.pid !== undefined) child.stdin.end("stop\n");
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
            void exit.then((code) => {
                clearTimeout(timer);
                reject(new Error(`服务提前退出（${String(code)}）`));
            });
        });
        return {url, pid: child.pid as number, stop};
    } catch (error) {
        await stop();
        // 报告只显示第一行：把输出的最后一行（致命诊断或启动失败的原因）带上来。
        throw new Error(`${error instanceof Error ? error.message : String(error)}：${output.trim().split("\n").at(-1) ?? ""}\n${output}`);
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
    await context.addInitScript(pageAgent, {roots: config.roots, eventThreshold: EVENT_THRESHOLD_MS});
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
/** 资源地址的各级父目录，从根往下。 */
const ancestors = (address: string): string[] => {
    const parts = address.slice("project://".length).split("/");
    return parts.slice(0, -1).map((_, index) => `project://${parts.slice(0, index + 1).join("/")}`);
};

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
        // 刚展开的目录还在列出时，滚动锚点会把视口挪走，一遍扫描可能错过目标：从头再扫几遍才算找不到。
        let misses = 0;
        for (let attempt = 0; attempt < 8; attempt += 1) {
            if (!(await scan())) {
                misses += 1;
                if (misses >= 3) throw new Error(`树里找不到 ${target}`);
                attempt -= 1;
                continue;
            }
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

async function collapse(session: Session, address: string): Promise<void> {
    const at = await revealTwisty(session.page, address);
    if (await session.page.locator(row(address)).getAttribute("aria-expanded") !== "true") return;
    await session.page.mouse.click(at.x, at.y);
    await session.page.waitForFunction((target) => document.querySelector(target)?.getAttribute("aria-expanded") === "false", row(address));
}

/** 展开地址的各级父目录，让它的行出现在树里（场景自己建立前置，单独运行也成立）。 */
async function expandTo(session: Session, address: string): Promise<void> {
    for (const parent of ancestors(address)) await expand(session, parent);
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

/** 双击行以常驻标签打开，等标签出现。 */
async function openFile(session: Session, address: string): Promise<void> {
    await expandTo(session, address);
    const at = await reveal(session.page, row(address));
    await session.page.mouse.dblclick(at.x, at.y);
    await session.page.waitForFunction((selector) => document.querySelector(selector) !== null, tab(address));
}

/**
 * 计时之外核验树真能用键盘操作：焦点给树，按两次下方向键，焦点行（`aria-activedescendant`）真的换了。不点行：点目录行
 * 会改变展开状态，影响后面的打开。
 */
async function verifyTree(page: Page): Promise<void> {
    const active = (): Promise<string | null> => page.locator("[data-explorer-tree]").getAttribute("aria-activedescendant");
    await page.locator("[data-explorer-tree]").focus();
    await page.keyboard.press("ArrowDown");
    await page.waitForFunction(() => Boolean(document.querySelector("[data-explorer-tree]")?.getAttribute("aria-activedescendant")));
    const first = await active();
    await page.keyboard.press("ArrowDown");
    await page.waitForFunction((previous) => {
        const current = document.querySelector("[data-explorer-tree]")?.getAttribute("aria-activedescendant");
        return Boolean(current) && current !== previous;
    }, first);
}

/**
 * 计时之外核验正文真的能输入：在活动视图末尾键入记号，等它进了正文、标签变成未保存，再撤销，等正文与未保存标记都回到
 * 原样。判定只凭属性可能早于输入路径就绪，输入没有进文档时 dirty 不会变，这一步把两种情况都变成失败。
 */
async function verifyInput(session: Session, editor: "markdown" | "code"): Promise<void> {
    const page = session.page;
    const token = "PERFINPUT";
    const host = `[data-editor-group-active] [data-editor-kind="${editor}"]`;
    const textSelector = editor === "markdown" ? `${host} [data-editor-prose]` : `${host} .view-lines`;
    const text = (): Promise<string> => page.locator(textSelector).textContent().then((value) => value ?? "");
    const dirtySelector = "[data-editor-group-active] [data-editor-tab][aria-selected=\"true\"][data-editor-tab-dirty]";
    if (await page.locator(dirtySelector).count() > 0) throw new Error(`核验输入前文档已经是未保存状态（${editor}）`);
    await page.locator(editor === "markdown" ? `${host} [data-editor-prose]` : `${host} .monaco-editor`).click();
    await page.keyboard.press("Control+End");
    await page.keyboard.type(token);
    await page.waitForFunction(({target, word, dirty}) => (document.querySelector(target)?.textContent ?? "").includes(word) && document.querySelector(dirty) !== null, {target: textSelector, word: token, dirty: dirtySelector});
    for (let attempt = 0; attempt < token.length && (await text()).includes(token); attempt += 1) await page.keyboard.press("Control+z");
    if ((await text()).includes(token)) throw new Error(`撤销后记号还在（${editor}）`);
    // 未保存标记消失即正文回到了已保存的内容（Monaco 的可见行随滚动变化，不能逐字比较）。
    await page.waitForFunction((dirty) => document.querySelector(dirty) === null, dirtySelector);
    // 光标回到开头：切回这个标签时恢复的视图状态在文件头，判定用的记号在可见行里（Monaco 只渲染可见区）。
    await page.keyboard.press("Control+Home");
}

async function longFramesBetween(page: Page, from: number, to: number): Promise<{count: number; longest: number} | "unavailable"> {
    return page.evaluate(({start, end}) => {
        const agent = window.__perf;
        if (agent === undefined || agent.unsupported.includes("long-animation-frame")) return "unavailable" as const;
        const frames = agent.frames.filter((frame) => frame.start + frame.duration >= start && frame.start <= end);
        return {count: frames.length, longest: Math.round(Math.max(0, ...frames.map((frame) => frame.duration)))};
    }, {start: from, end: to});
}

/** 时间窗里的长动画帧本身（起点、时长、脚本归因），放进逐次样本。 */
async function framesBetween(page: Page, from: number, to: number): Promise<unknown[]> {
    return page.evaluate(({start, end}) => (window.__perf?.frames ?? []).filter((frame) => frame.start + frame.duration >= start && frame.start <= end).map((frame) => ({...frame, start: Math.round(frame.start - start), duration: Math.round(frame.duration)})), {start: from, end: to});
}

const addFrames = (into: {count: number; longest: number} | "unavailable", more: {count: number; longest: number} | "unavailable"): {count: number; longest: number} | "unavailable" =>
    into === "unavailable" || more === "unavailable" ? "unavailable" : {count: into.count + more.count, longest: Math.max(into.longest, more.longest)};

const now = (page: Page): Promise<number> => page.evaluate(() => performance.now());

/**
 * 一次点击的 Event Timing 条目（按下、抬起、click 都在起点之后几毫秒内）里最长的；没有 16 ms 以上的条目为 null。在页面里
 * 匹配，只传回每次一个数：整份条目表随会话增长，整份传回来的序列化会自己造出长动画帧。
 */
async function clickTimings(page: Page, starts: ReadonlyArray<number>): Promise<Array<number | null>> {
    return page.evaluate((clicks) => {
        window.__perf?.drainEvents();
        const names = new Set(["pointerdown", "pointerup", "mousedown", "mouseup", "click"]);
        const events = (window.__perf?.events ?? []).filter((event) => names.has(event.name));
        return clicks.map((start) => {
            const own = events.filter((event) => event.start >= start - 1 && event.start <= start + 50);
            return own.length === 0 ? null : Math.max(...own.map((event) => event.duration));
        });
    }, [...starts]);
}

const timingOf = (values: ReadonlyArray<number | null>): EventTimingSummary => {
    const slow = values.filter((value): value is number => value !== null);
    return {samples: values.length, slow: slow.length, longest: slow.length === 0 ? null : Math.max(...slow)};
};

interface Sample extends ArmResult {
    readonly address: string;
}

const summaries = (from: ReadonlyArray<ArmResult>): Pick<ScenarioResult, "feedback" | "done" | "samples"> => ({
    samples: from.length,
    feedback: {committed: summarize(from.map((sample) => sample.feedbackCommitted)), presented: summarize(from.map((sample) => sample.feedbackPresented)), frames: summarize(from.map((sample) => sample.feedbackFrames))},
    done: {committed: summarize(from.map((sample) => sample.doneCommitted)), presented: summarize(from.map((sample) => sample.donePresented)), frames: summarize(from.map((sample) => sample.doneFrames))},
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

const volumeName = (index: number): string => `volume-${String(index).padStart(2, "0")}`;

/** 从给定的卷依次取章节，取够 `count` 个为止；不够时返回实际取到的。 */
async function chaptersFrom(config: RunnerConfig, volumes: ReadonlyArray<number>, count: number): Promise<string[]> {
    const picked: string[] = [];
    for (const volume of volumes) {
        if (picked.length >= count) break;
        picked.push(...(await chapters(config, volumeName(volume))).slice(0, count - picked.length));
    }
    return picked;
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

    const unknown = config.only.filter((id) => !SCENARIOS.some((scenario) => scenario.id === id));
    if (unknown.length > 0) problems.push(`不认识的场景：${unknown.join("、")}`);
    const wanted = (id: string): boolean => config.only.length === 0 || config.only.includes(id);
    /** 当前场景用的页面：场景失败时截一张图到日志目录（`--keep-temp` 时保留）。 */
    let currentPage: Page | null = null;
    const run = async (id: string, body: () => Promise<Omit<ScenarioResult, "id" | "name" | "status">>): Promise<void> => {
        if (!wanted(id)) return;
        const name = SCENARIOS.find((scenario) => scenario.id === id)?.name ?? id;
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
    /** 新的浏览器上下文（新的客户端身份）里打开项目做一件事；不论成败都关掉上下文。 */
    const withFreshPage = async <T>(server: Server, scenario: string, work: (session: Session) => Promise<T>): Promise<T> => {
        const context = await newContext(browser as Browser, config);
        try {
            const session = await openPage(context, server.url);
            const value = await work(session);
            await closeSession(session, scenario);
            return value;
        } finally {
            await context.close();
        }
    };

    try {
        if (unknown.length > 0) throw new Error(problems[0]);
        browser = await chromium.launch({channel: "chrome", headless: true});
        chrome = browser.version();

        // A1、A2：服务刚启动的第一次打开；关掉页面后在项目宽限期内再打开。每轮的服务与页面各自收口，失败不带进后面的场景。
        await run("A1+A2", async () => {
            const cold: number[] = [];
            const reopen: number[] = [];
            const boot: number[] = [];
            for (let index = 0; index < config.opens; index += 1) {
                const started = performance.now();
                const server = await serve(`open-${String(index)}`);
                boot.push(performance.now() - started);
                try {
                    for (const into of [cold, reopen]) {
                        into.push(await withFreshPage(server, "A1+A2", async (session) => {
                            const ready = await session.page.evaluate(() => window.__perf?.treeReadyAt ?? -1);
                            await verifyTree(session.page);
                            unsupported = await session.page.evaluate(() => window.__perf?.unsupported ?? []);
                            return ready;
                        }));
                    }
                } finally {
                    await shut(server, `open-${String(index)}`);
                }
            }
            return {samples: cold.length, values: {"服务启动到监听（脚本侧）": summarize(boot), "A1 第一次打开：导航到树可操作": summarize(cold), "A2 宽限期内再打开：导航到树可操作": summarize(reopen)}, raw: {boot, cold, reopen}};
        });

        // A3：项目子进程退出之后再打开（新代次）。
        await run("A3", async () => {
            const server = await serve("reopen-after-exit", {NBOOK_PROJECT_GRACE_MS: "1"});
            const values: number[] = [];
            try {
                for (let index = 0; index <= config.opens; index += 1) {
                    const ready = await withFreshPage(server, "A3", async (session) => {
                        const value = await session.page.evaluate(() => window.__perf?.treeReadyAt ?? -1);
                        await verifyTree(session.page);
                        return value;
                    });
                    if (index > 0) values.push(ready);
                    const deadline = Date.now() + 30_000;
                    while (hasProjectChild(server.pid)) {
                        if (Date.now() > deadline) throw new Error("项目子进程 30 秒内没有退出");
                        await new Promise((done) => setTimeout(done, 100));
                    }
                }
            } finally {
                await shut(server, "reopen-after-exit");
            }
            return {samples: values.length, values: {"导航到树可操作": summarize(values)}, raw: {values}};
        });

        const server = await serve("main");
        try {
            // A4：同一客户端身份的展开记录恢复多个已展开目录（全部卷、笔记与宽目录）。计到全部已展开目录都列出来为止。
            await run("A4", async () => {
                const context = await newContext(browser as Browser, config);
                try {
                    const setup = await openPage(context, server.url);
                    await closeAllTabs(setup);
                    await expand(setup, "project://manuscripts");
                    for (let volume = 1; volume <= 10; volume += 1) await expand(setup, `project://manuscripts/${volumeName(volume)}`);
                    await expandTo(setup, config.wide.address);
                    await expand(setup, config.wide.address);
                    // 从头扫到尾，直到整棵树里没有加载中的行：这时的内容高度就是恢复完的目标。
                    const height = await setup.page.evaluate(async () => {
                        const tree = document.querySelector<HTMLElement>("[data-explorer-tree]");
                        if (tree === null) throw new Error("没有文件树");
                        const frame = (): Promise<void> => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(() => done())));
                        for (let pass = 0; pass < 50; pass += 1) {
                            let loading = false;
                            tree.scrollTop = 0;
                            await frame();
                            for (;;) {
                                if (document.querySelector("[data-explorer-status=\"loading\"]") !== null) loading = true;
                                if (tree.scrollTop + tree.clientHeight >= tree.scrollHeight) break;
                                tree.scrollTop += tree.clientHeight * 0.8;
                                await frame();
                            }
                            if (!loading) return tree.scrollHeight;
                        }
                        throw new Error("展开的目录一直没有列完");
                    });
                    // 只关页面：上下文（客户端身份）留着，后面的页面按它的展开记录恢复。
                    problems.push(...setup.problems);
                    await setup.page.close();
                    await context.addInitScript((target) => {
                        window.__perfRestoreHeight = target;
                    }, height);
                    const ready: number[] = [];
                    const restored: number[] = [];
                    let frames: {count: number; longest: number} | "unavailable" = {count: 0, longest: 0};
                    for (let index = 0; index < config.opens; index += 1) {
                        const page = await context.newPage();
                        try {
                            await page.goto(new URL("/?project=book", server.url).href);
                            await page.waitForFunction(() => window.__perf?.restoredAt !== null, undefined, {timeout: 60_000});
                            const times = await page.evaluate(() => ({ready: window.__perf?.treeReadyAt ?? -1, restored: window.__perf?.restoredAt ?? -1}));
                            ready.push(times.ready);
                            restored.push(times.restored);
                            frames = addFrames(frames, await longFramesBetween(page, 0, times.restored));
                            await verifyTree(page);
                        } finally {
                            await page.close();
                        }
                    }
                    return {
                        samples: restored.length,
                        values: {"导航到树可操作（根目录已列出）": summarize(ready), "导航到展开状态恢复完（全部已展开目录都已列出）": summarize(restored)},
                        longFrames: frames,
                        notes: [`恢复完的树内容高度 ${String(height)} px`],
                        raw: {ready, restored, height},
                    };
                } finally {
                    await context.close();
                }
            });

            // B、C、D-warm、D3、E1、F1 在同一个新上下文里依次进行；D-cold 每次另开新上下文。
            const context = await newContext(browser as Browser, config);
            const session = await openPage(context, server.url);
            currentPage = session.page;
            try {
                await closeAllTabs(session);
                const volume1 = await chapters(config, volumeName(1));
                const volume2 = await chapters(config, volumeName(2));

                /**
                 * 点行或标签打开，每次之后核验真实输入；汇总、点击的 Event Timing 与逐次样本。核验时的输入会把 preview 标签
                 * 转正，冷打开的标签因此逐个累积（贴近边读边改的使用），不是一直替换同一个 preview。
                 */
                const openSamples = async (targets: ReadonlyArray<string>, editor: "markdown" | "code", viaTree: boolean): Promise<Sample[]> => {
                    const samples: Sample[] = [];
                    for (const address of targets) {
                        const at = viaTree ? await reveal(session.page, row(address)) : await centerOf(session.page, tab(address));
                        samples.push({address, ...await measure(session, at, {kind: "open", address, marker: await markerOf(config, address), editor, fromRow: viaTree})});
                        await verifyInput(session, editor);
                    }
                    return samples;
                };
                const openResult = async (samples: ReadonlyArray<Sample>, t0: number, t1: number, extra: Partial<ScenarioResult> = {}): Promise<Omit<ScenarioResult, "id" | "name" | "status">> => {
                    // 先读长动画帧，再取点击的 Event Timing：后者的调用不落进前者的时间窗。
                    const longFrames = await longFramesBetween(session.page, t0, t1);
                    const frames = await framesBetween(session.page, t0, t1);
                    const clicks = await clickTimings(session.page, samples.map((sample) => sample.start));
                    return {
                        ...summaries(samples),
                        eventTiming: timingOf(clicks),
                        longFrames,
                        requests: countBy(session.sent),
                        ...extra,
                        raw: {samples: samples.map((sample, index) => ({...sample, click: clicks[index] ?? null})), t0, frames},
                    };
                };

                const coldScenario = async (targets: ReadonlyArray<string>, editor: "markdown" | "code"): Promise<Omit<ScenarioResult, "id" | "name" | "status">> => {
                    const [first, ...rest] = targets;
                    if (first === undefined || rest.length < config.iterations) throw new Error(`没有足够的文件（要 ${String(config.iterations + 1)} 个）`);
                    for (const parent of new Set(targets.flatMap(ancestors))) await expand(session, parent);
                    session.sent.length = 0;
                    const [firstSample] = await openSamples([first], editor, true);
                    const t0 = await now(session.page);
                    const samples = await openSamples(rest.slice(0, config.iterations), editor, true);
                    const t1 = await now(session.page);
                    const [firstClick] = await clickTimings(session.page, [(firstSample as Sample).start]);
                    return openResult(samples, t0, t1, {
                        values: {"第一次（含控件代码）：选中与标签 presented": summarize([(firstSample as Sample).feedbackPresented]), "第一次（含控件代码）：正文 presented": summarize([(firstSample as Sample).donePresented])},
                        notes: [`第一次（含控件代码）的点击 Event Timing：${firstClick === null || firstClick === undefined ? `没有 ${String(EVENT_THRESHOLD_MS)} ms 以上的条目` : `${String(firstClick)} ms`}`],
                    });
                };
                await run("B1", () => coldScenario(volume2.slice(0, 1).concat(volume1.slice(0, config.iterations)), "markdown"));
                await run("B2", () => coldScenario(config.sources, "code"));

                const hotScenario = async (a: string, b: string, editor: "markdown" | "code", viaTree: boolean): Promise<Omit<ScenarioResult, "id" | "name" | "status">> => {
                    for (const address of [a, b]) await openFile(session, address);
                    session.sent.length = 0;
                    const t0 = await now(session.page);
                    const samples = await openSamples(Array.from({length: config.iterations}, (_, index) => (index % 2 === 0 ? a : b)), editor, viaTree);
                    return openResult(samples, t0, await now(session.page));
                };
                const [m1, m2] = volume1.slice(-2) as [string, string];
                const [s1, s2] = config.sources.slice(-2) as [string, string];
                await run("C1-md", async () => {
                    await closeAllTabs(session);
                    return hotScenario(m1, m2, "markdown", false);
                });
                await run("C2-md", () => hotScenario(m1, m2, "markdown", true));
                await run("C1-code", async () => {
                    await closeAllTabs(session);
                    return hotScenario(s1, s2, "code", false);
                });
                await run("C2-code", () => hotScenario(s1, s2, "code", true));
                /** 打开一个文件、在它的编辑器里按 Ctrl+\ 向右拆分，再在新组里来回点两个标签。 */
                const splitScenario = async (a: string, b: string, editor: "markdown" | "code"): Promise<Omit<ScenarioResult, "id" | "name" | "status">> => {
                    await closeAllTabs(session);
                    await openFile(session, b);
                    await session.page.locator(`[data-editor-group-active] [data-editor-kind="${editor}"] ${editor === "markdown" ? "[data-editor-prose]" : ".monaco-editor"}`).click();
                    await session.page.keyboard.press("Control+\\");
                    await session.page.waitForFunction(() => document.querySelectorAll("[data-editor-group]").length === 2);
                    return hotScenario(a, b, editor, false);
                };
                await run("C1-md-split", () => splitScenario(...(volume2.slice(-2) as [string, string]), "markdown"));
                await run("C1-code-split", () => splitScenario(...(config.sources.slice(-4, -2) as [string, string]), "code"));

                // F1：资源保留。打开再关闭同一批文件为一轮，每轮后 GC 读堆；文件取 B、C 没用过的卷。
                await run("F1", async () => {
                    await closeAllTabs(session);
                    const files = await chaptersFrom(config, [4, 5, 6, 7, 8, 9, 10], F1_FILES);
                    if (files.length < F1_FILES) throw new Error(`样本不够：第 4–10 卷只有 ${String(files.length)} 个章节（要 ${String(F1_FILES)} 个）`);
                    const heaps: number[] = [];
                    const opened: number[] = [];
                    for (let round = 0; round < 5; round += 1) {
                        for (const address of files) await openFile(session, address);
                        opened.push(await session.page.locator("[data-editor-tab]").count());
                        await closeAllTabs(session);
                        // 测量代理自己记下的 Event Timing 与长动画帧也在页面堆里，随点击增长：读堆前清掉，堆里只剩产品的东西。
                        await session.page.evaluate(() => {
                            window.__perf?.events.splice(0);
                            window.__perf?.frames.splice(0);
                        });
                        await session.cdp.send("HeapProfiler.collectGarbage");
                        heaps.push(await session.page.evaluate(() => Math.round(((performance as Performance & {memory?: {usedJSHeapSize: number}}).memory?.usedJSHeapSize ?? 0) / 1024 / 1024 * 10) / 10));
                    }
                    if (opened.some((count) => count !== F1_FILES)) throw new Error(`每轮应打开 ${String(F1_FILES)} 个标签，实际 ${opened.join(" / ")}`);
                    const mounted = await session.page.evaluate(() => ({prose: document.querySelectorAll(".ProseMirror").length, monaco: document.querySelectorAll(".monaco-editor").length}));
                    return {samples: heaps.length, values: {"每轮 GC 后的堆（MB）": summarize(heaps)}, notes: [`每轮打开 ${String(F1_FILES)} 个标签再全部关闭；各轮堆：${heaps.join(" / ")} MB`, `关闭全部标签后挂载的控件：富文本 ${String(mounted.prose)}、Monaco ${String(mounted.monaco)}（DOM 计数；模型与编辑状态的释放由 t71 的控制器测试证明）`], raw: {files, opened, heaps, mounted}};
                });

                // D1、D2：冷的每次在新页面（新客户端，没有列出过）里第一次展开；热的在同一页收起再展开（列出结果还在）。
                const coldExpand = async (id: string, target: string): Promise<Omit<ScenarioResult, "id" | "name" | "status">> => {
                    const samples: ArmResult[] = [];
                    const sent: string[] = [];
                    let frames: {count: number; longest: number} | "unavailable" = {count: 0, longest: 0};
                    for (let index = 0; index < EXPAND_SAMPLES; index += 1) {
                        await withFreshPage(server, id, async (fresh) => {
                            await expandTo(fresh, target);
                            if (await fresh.page.locator(row(target)).getAttribute("aria-expanded") === "true") throw new Error("新页面里目录已经展开：客户端记录没有隔离");
                            fresh.sent.length = 0;
                            const sample = await measure(fresh, await revealTwisty(fresh.page, target), {kind: "expand", address: target});
                            samples.push(sample);
                            sent.push(...fresh.sent);
                            frames = addFrames(frames, await longFramesBetween(fresh.page, sample.start, sample.start + sample.donePresented));
                        });
                    }
                    return {...summaries(samples), longFrames: frames, requests: countBy(sent), raw: {samples}};
                };
                const warmExpand = async (target: string): Promise<Omit<ScenarioResult, "id" | "name" | "status">> => {
                    await expandTo(session, target);
                    await expand(session, target);
                    session.sent.length = 0;
                    const samples: ArmResult[] = [];
                    const t0 = await now(session.page);
                    for (let index = 0; index < EXPAND_SAMPLES; index += 1) {
                        await collapse(session, target);
                        samples.push(await measure(session, await revealTwisty(session.page, target), {kind: "expand", address: target}));
                    }
                    return {...summaries(samples), longFrames: await longFramesBetween(session.page, t0, await now(session.page)), requests: countBy(session.sent), raw: {samples}};
                };
                const content = "project://lorebook.content/characters";
                await run("D1-cold", () => coldExpand("D1-cold", config.wide.address));
                await run("D1-warm", () => warmExpand(config.wide.address));
                await run("D2-cold", () => coldExpand("D2-cold", content));
                await run("D2-warm", () => warmExpand(content));

                // D3：展开宽目录后从树顶用滚轮滚到底。
                await run("D3", async () => {
                    await expandTo(session, config.wide.address);
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
                        const t0 = await now(session.page);
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
                        longFrames = addFrames(longFrames, await longFramesBetween(session.page, t0, await now(session.page)));
                    }
                    return {samples: longest.length, values: {"帧间隔": summarize(intervals), "每次滚动的最长帧间隔": summarize(longest)}, longFrames, raw: {intervals, longest}};
                });

                // E1：在磁盘上并发改写已展开卷里的 250 个章节与宽目录里的 250 个文件，同时在打开的章节里连续键入。键入用
                // ASCII：中文经文本插入进来，没有键盘事件，按键的 Event Timing 就无从观察。
                await run("E1", async () => {
                    await closeAllTabs(session);
                    const picked = await chaptersFrom(config, [3, 4, 5, 6, 7, 8, 9, 10, 1, 2], E1_CHAPTERS);
                    const wideDir = join(config.bookRoot, config.wide.address.replace("project://", ""));
                    const wideFiles = (await readdir(wideDir)).sort().slice(0, E1_WIDE);
                    if (picked.length < E1_CHAPTERS || wideFiles.length < E1_WIDE) throw new Error(`样本不够：章节 ${String(picked.length)} 个、宽目录 ${String(wideFiles.length)} 个（各要 ${String(E1_CHAPTERS)}、${String(E1_WIDE)} 个）`);
                    await expand(session, "project://data");
                    for (const volume of new Set(picked.map((address) => address.slice(0, address.lastIndexOf("/"))))) {
                        await expandTo(session, volume);
                        await expand(session, volume);
                    }
                    await expandTo(session, config.wide.address);
                    await expand(session, config.wide.address);
                    const opened = picked[0] as string;
                    await openFile(session, opened);
                    const victims = picked.map((address) => join(config.bookRoot, address.replace("project://", ""))).concat(wideFiles.map((name) => join(wideDir, name)));
                    const sentinel = "project://data/aaa-perf-sentinel.json";
                    const typed = "typing while the disk changes ";
                    const settle: number[] = [];
                    const perKey: Array<number | null> = [];
                    let frames: {count: number; longest: number} | "unavailable" = {count: 0, longest: 0};
                    const received: string[] = [];
                    const sent: string[] = [];
                    const rounds: Array<{settle: number; keys: Array<number | null>}> = [];
                    for (let round = 0; round < 5; round += 1) {
                        await session.page.locator("[data-editor-group-active] [data-editor-prose]").click();
                        await session.page.keyboard.press("Control+End");
                        await session.page.evaluate(() => {
                            const tree = document.querySelector<HTMLElement>("[data-explorer-tree]");
                            if (tree !== null) tree.scrollTop = 0;
                        });
                        session.sent.length = 0;
                        session.received.length = 0;
                        const t0 = await now(session.page);
                        // 页面里逐帧看哨兵行与“磁盘已变化”提示，记下两者都出现的那一帧；与键入并行，不等键入结束。
                        const settled = session.page.evaluate(({selector}) => new Promise<number>((resolveSettled, rejectSettled) => {
                            const started = performance.now();
                            const tick = (): void => {
                                if (document.querySelector(selector) !== null && document.querySelector("[data-editor-group-active] [data-editor-banner]") !== null) resolveSettled(performance.now());
                                else if (performance.now() - started > 60_000) rejectSettled(new Error("60 秒内没有看到哨兵与提示"));
                                else requestAnimationFrame(tick);
                            };
                            requestAnimationFrame(tick);
                        }), {selector: row(sentinel)});
                        const writing = (async (): Promise<void> => {
                            await Promise.all(victims.map((path, index) => writeFile(path, `# 外部改写 ${String(round)}-${String(index)}\n`)));
                            await writeFile(join(config.bookRoot, sentinel.replace("project://", "")), `{"round": ${String(round)}}\n`);
                        })();
                        const [settledAt] = await Promise.all([settled, writing, session.page.keyboard.type(typed, {delay: 25})]);
                        const t1 = await now(session.page);
                        settle.push(settledAt - t0);
                        // 每次按键：它的 keydown、keypress、keyup、beforeinput、input 里最长的 Event Timing（都在按下之后
                        // 几毫秒内；键入间隔 25 ms）；没有 16 ms 以上的条目为 null。
                        const observed = await session.page.evaluate(({from, to}) => {
                            window.__perf?.drainEvents();
                            const names = new Set(["keydown", "keypress", "keyup", "beforeinput", "input"]);
                            const timed = (window.__perf?.events ?? []).filter((event) => names.has(event.name));
                            return (window.__perf?.keys ?? []).filter((at) => at >= from && at <= to).map((at) => {
                                const own = timed.filter((event) => event.start >= at - 1 && event.start < at + 20);
                                return own.length === 0 ? null : Math.max(...own.map((event) => event.duration));
                            });
                        }, {from: t0, to: t1});
                        if (observed.length < typed.length) throw new Error(`第 ${String(round + 1)} 轮只观察到 ${String(observed.length)} 次按键（键入 ${String(typed.length)} 个字符）`);
                        perKey.push(...observed);
                        rounds.push({settle: settledAt - t0, keys: observed});
                        frames = addFrames(frames, await longFramesBetween(session.page, t0, t1));
                        received.push(...session.received);
                        sent.push(...session.sent);
                        // 收尾：重新载入磁盘版本、删掉哨兵，下一轮从同样的状态开始。
                        await session.page.locator("[data-editor-banner-action=\"reload\"]").click();
                        await session.page.waitForFunction(() => document.querySelector("[data-editor-group-active] [data-editor-banner]") === null);
                        await rm(join(config.bookRoot, sentinel.replace("project://", "")));
                        await session.page.waitForFunction((selector) => document.querySelector(selector) === null, row(sentinel), {timeout: 60_000});
                    }
                    return {
                        samples: 5,
                        values: {"第一次写入到树里出现哨兵、已打开文件提示磁盘已变化": summarize(settle)},
                        eventTiming: timingOf(perKey),
                        longFrames: frames,
                        requests: countBy(sent),
                        received: countBy(received),
                        notes: [`每轮改写 ${String(victims.length)} 个文件（章节 ${String(picked.length)}、宽目录 ${String(wideFiles.length)}），同时键入 ${String(typed.length)} 个 ASCII 字符`],
                        raw: {victims: victims.length, rounds},
                    };
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
        for (const server of servers) await server.stop().catch((error: unknown) => problems.push(`收口时停服务失败：${error instanceof Error ? error.message : String(error)}`));
        for (const scenario of SCENARIOS) {
            if (wanted(scenario.id) && !results.some((result) => result.id === scenario.id)) results.push({id: scenario.id, name: scenario.name, status: "not-run", error: "没有执行：前面的步骤失败（见问题）"});
        }
        const order = (id: string): number => SCENARIOS.findIndex((scenario) => scenario.id === id);
        results.sort((a, b) => order(a.id) - order(b.id));
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
