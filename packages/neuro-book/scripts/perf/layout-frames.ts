/**
 * 工作台布局的每帧开销：同一组场景在几份构建上交替跑，数样式重算、排版、页面自己的动画帧回调与 DOM 写入，按帧归一。
 * 数次数，不计时：次数和机器快慢无关；帧回调数受负载影响，负载高时多跑几轮，按较低的一端看。不是测试，不进 `bun run test`；
 * 回归由各处的计数断言守（例如 `e2e/workbench-drag-cost.e2e.ts`）。
 *
 *   node scripts/perf/layout-frames.ts --checkout base=<检出的根> --checkout branch=<检出的根> [--rounds 3] [--out <结果.json>]
 *
 * 每份检出用它自己的 `packages/neuro-book/dist`（先在那里 `bun run build`）。每一轮按给出的顺序把每份检出各跑一遍，
 * 每次都是新的状态根与作品（侧栏宽度这类布局会写进状态根，不能带到下一次）。Playwright 必须由 Node 运行
 * （`browser-runner.ts` 的同一结论），所以只用 Node 内置模块与 `@playwright/test`。
 */

import {spawn} from "node:child_process";
import type {ChildProcessWithoutNullStreams} from "node:child_process";
import {randomUUID} from "node:crypto";
import {mkdir, mkdtemp, rm, writeFile} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join, resolve} from "node:path";

import {chromium} from "@playwright/test";
import type {Browser, CDPSession, Locator, Page} from "@playwright/test";

const VIEWPORT = {width: 1440, height: 900};
const PARAGRAPH = "天色将晚，她推开了门，雨下了一整夜。街上没有人，只有远处的灯还亮着，风把门吹得吱吱作响。\n\n";
/** 资源管理器里要能滚：这么多个文件在 `notes/` 下，`z` 开头排在两章后面（树是虚拟列表，排在视口外的行不在 DOM 里）。 */
const TREE_FILES = 240;

interface Checkout {
    readonly label: string;
    readonly packageRoot: string;
}

interface Options {
    readonly checkouts: ReadonlyArray<Checkout>;
    readonly rounds: number;
    readonly out: string | null;
}

function parseOptions(argv: ReadonlyArray<string>): Options {
    const checkouts: Checkout[] = [];
    let rounds = 3;
    let out: string | null = null;
    for (let index = 0; index < argv.length; index += 1) {
        const flag = argv[index];
        const value = argv[index + 1];
        if (value === undefined) throw new Error(`${flag} 缺值`);
        index += 1;
        if (flag === "--checkout") {
            const at = value.indexOf("=");
            if (at <= 0) throw new Error(`--checkout 要写成 <名字>=<检出的根>：${value}`);
            checkouts.push({label: value.slice(0, at), packageRoot: join(resolve(value.slice(at + 1)), "packages", "neuro-book")});
        } else if (flag === "--rounds") {
            rounds = Number(value);
            if (!Number.isInteger(rounds) || rounds < 1) throw new Error(`--rounds 要是正整数：${value}`);
        } else if (flag === "--out") {
            out = resolve(value);
        } else {
            throw new Error(`不认识的参数 ${flag}`);
        }
    }
    if (checkouts.length === 0) throw new Error("至少给一个 --checkout");
    return {checkouts, rounds, out};
}

// ——— 服务与作品 ———

interface Server {
    readonly url: string;
    stop(): Promise<number | null>;
}

/** 和 `e2e/fixtures.ts` 的 `startProductServer` 同一种起法：生产构建的后端加 `dist/web`，经标准输入停止。 */
async function startServer(packageRoot: string, stateRoot: string): Promise<Server> {
    const child: ChildProcessWithoutNullStreams = spawn("bun", ["dist/server/main.js", "--stop-stdin"], {
        cwd: packageRoot,
        env: {...process.env, NBOOK_STATE_ROOT: stateRoot, NBOOK_PORT: "0", NBOOK_RPC_PORT: "0", NBOOK_WEB_ROOT: "dist/web"},
    });
    let output = "";
    const exit = new Promise<number | null>((done) => child.on("exit", (code) => done(code)));
    const url = await new Promise<string>((done, fail) => {
        const timer = setTimeout(() => fail(new Error(`服务 30 秒没起来：\n${output}`)), 30_000);
        const read = (chunk: Buffer): void => {
            output += chunk.toString("utf8");
            const found = /Listening on (\S+)/u.exec(output);
            if (found !== null) {
                clearTimeout(timer);
                done(found[1] as string);
            }
        };
        child.stdout.on("data", read);
        child.stderr.on("data", read);
        void exit.then((code) => fail(new Error(`服务退出（${code}）：\n${output}`)));
    });
    return {
        url,
        async stop() {
            child.stdin.end("stop\n");
            return exit;
        },
    };
}

/** 一章长正文（编辑组头与正文都在），一章短的，外加够多的文件让资源管理器能滚。返回状态根。 */
async function seed(root: string): Promise<string> {
    const project = join(root, "book");
    await mkdir(join(project, "notes"), {recursive: true});
    await mkdir(join(project, ".nbook"), {recursive: true});
    const id = randomUUID();
    await writeFile(join(project, ".nbook", "project.json"), JSON.stringify({schema: 1, id}));
    await writeFile(join(project, "notes", "short.md"), `# 短章\n\n${PARAGRAPH.repeat(20)}`);
    await writeFile(join(project, "notes", "long.md"), `# 长章\n\n${PARAGRAPH.repeat(2300)}`);
    for (let index = 0; index < TREE_FILES; index += 1) {
        await writeFile(join(project, "notes", `z${String(index).padStart(3, "0")}.md`), `# ${index}\n`);
    }
    const state = join(root, "state");
    await mkdir(join(state, "user"), {recursive: true});
    await writeFile(join(state, "projects.json"), JSON.stringify({schema: 1, projects: [{id, name: "book", path: project}]}));
    return state;
}

// ——— 页面里的计数 ———

/**
 * 在页面脚本之前包一层 `requestAnimationFrame`：页面自己排的回调执行一次记一次。脚本自己等帧、数帧用 `__perf.ownRaf`，不计入。
 * DOM 写入用 `MutationObserver` 数：全部记录，和其中写在分隔线（`.nb-grid-sash` 里）的 `style`。
 */
function installCounters(): void {
    const raw = window.requestAnimationFrame.bind(window);
    const perf = {raf: 0, mutations: 0, sashStyles: 0, ownRaf: raw, observer: null as MutationObserver | null};
    (window as unknown as {__perf: typeof perf}).__perf = perf;
    window.requestAnimationFrame = (callback: FrameRequestCallback): number => raw((time) => {
        perf.raf += 1;
        callback(time);
    });
}

interface Totals {
    readonly recalc: number;
    readonly layout: number;
    readonly raf: number;
    readonly mutations: number;
    readonly sashStyles: number;
    readonly frames: number;
    readonly ms: number;
}

async function cdpCounts(cdp: CDPSession): Promise<{recalc: number; layout: number}> {
    const {metrics} = await cdp.send("Performance.getMetrics") as {metrics: Array<{name: string; value: number}>};
    const read = (name: string): number => metrics.find((item) => item.name === name)?.value ?? 0;
    return {recalc: read("RecalcStyleCount"), layout: read("LayoutCount")};
}

/** 等 N 帧，用脚本自己的 `requestAnimationFrame`。 */
const frames = (page: Page, count: number): Promise<void> => page.evaluate((target) => new Promise<void>((done) => {
    const raf = (window as unknown as {__perf: {ownRaf: typeof requestAnimationFrame}}).__perf.ownRaf;
    let seen = 0;
    const tick = (): void => {
        seen += 1;
        if (seen >= target) done();
        else raf(tick);
    };
    raf(tick);
}), count);

/**
 * 跑一段，返回这段里的总数（帧数由脚本自己的帧循环数）。CDP 的两次读数包在页面里计数的外面：先读起点再开始数，先停下再读终点，
 * 样式重算与排版不会漏掉数帧的那段里发生的。
 */
async function measure(page: Page, cdp: CDPSession, run: () => Promise<void>): Promise<Totals> {
    const before = await cdpCounts(cdp);
    await page.evaluate(() => {
        type Perf = {raf: number; mutations: number; sashStyles: number; ownRaf: typeof requestAnimationFrame; observer: MutationObserver | null; frames: number; counting: boolean; start: number; rafStart: number};
        const perf = (window as unknown as {__perf: Perf}).__perf;
        const count = (records: MutationRecord[]): void => {
            perf.mutations += records.length;
            for (const record of records) {
                if (record.attributeName === "style" && record.target instanceof Element && record.target.closest(".nb-grid-sash") !== null) perf.sashStyles += 1;
            }
        };
        perf.mutations = 0;
        perf.sashStyles = 0;
        perf.observer = new MutationObserver(count);
        perf.observer.observe(document.documentElement, {subtree: true, attributes: true, childList: true, characterData: true});
        perf.frames = 0;
        perf.counting = true;
        perf.start = performance.now();
        perf.rafStart = perf.raf;
        const tick = (): void => {
            if (!perf.counting) return;
            perf.frames += 1;
            perf.ownRaf(tick);
        };
        perf.ownRaf(tick);
    });
    await run();
    const inPage = await page.evaluate(() => {
        type Perf = {raf: number; mutations: number; sashStyles: number; observer: MutationObserver | null; frames: number; counting: boolean; start: number; rafStart: number};
        const perf = (window as unknown as {__perf: Perf}).__perf;
        perf.counting = false;
        const pending = perf.observer?.takeRecords() ?? [];
        perf.observer?.disconnect();
        perf.mutations += pending.length;
        for (const record of pending) {
            if (record.attributeName === "style" && record.target instanceof Element && record.target.closest(".nb-grid-sash") !== null) perf.sashStyles += 1;
        }
        return {raf: perf.raf - perf.rafStart, mutations: perf.mutations, sashStyles: perf.sashStyles, frames: perf.frames, ms: performance.now() - perf.start};
    });
    const after = await cdpCounts(cdp);
    return {recalc: after.recalc - before.recalc, layout: after.layout - before.layout, ...inPage};
}

// ——— 场景 ———

/** 等过渡结束（没有 `[data-moving]`），再等几帧让收尾的写入落地。 */
async function settle(page: Page): Promise<void> {
    for (let tries = 0; tries < 300 && await page.locator("[data-moving]").count() > 0; tries += 1) await frames(page, 2);
    if (await page.locator("[data-moving]").count() > 0) throw new Error("过渡 600 帧还没结束");
    await frames(page, 5);
}

/** 指针移到状态栏中间：留在入口或分隔线上会有悬停效果，混进下一个场景的计数。 */
async function pointerAway(page: Page): Promise<void> {
    const bar = await page.locator("[data-workbench-surface] > [data-grid-scope] > [data-leaf='statusbar']").boundingBox();
    if (bar === null) throw new Error("没有状态栏");
    await page.mouse.move(bar.x + bar.width / 2, bar.y + bar.height / 2);
}

async function centre(locator: Locator): Promise<{x: number; y: number}> {
    const box = await locator.boundingBox();
    if (box === null) throw new Error(`没有 ${String(locator)}`);
    return {x: box.x + box.width / 2, y: box.y + box.height / 2};
}

/** 一步一帧地把指针移过去。 */
async function glide(page: Page, from: {x: number; y: number}, to: {x: number; y: number}, steps: number): Promise<void> {
    for (let step = 1; step <= steps; step += 1) {
        await page.mouse.move(from.x + (to.x - from.x) * step / steps, from.y + (to.y - from.y) * step / steps);
        await frames(page, 1);
    }
}

/** 拿起资源管理器那一节（侧栏“项目”容器的分节），过了起拖门槛。 */
async function liftExplorer(page: Page): Promise<{x: number; y: number}> {
    const at = await centre(page.locator("[data-panel-tab=\"view:nbook.explorer\"]"));
    await page.mouse.move(at.x, at.y);
    await page.mouse.down();
    const moved = {x: at.x + 20, y: at.y + 80};
    await page.mouse.move(moved.x, moved.y, {steps: 4});
    return moved;
}

async function assertLiveDrag(page: Page): Promise<void> {
    if (await page.locator("html[data-workbench-dragging]").count() !== 1) throw new Error("根上没有 data-workbench-dragging：不在拖动中");
    if (await page.locator("[data-lifted]").count() === 0) throw new Error("没有 [data-lifted]：不是实时布局");
}

async function drop(page: Page): Promise<void> {
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await settle(page);
    await pointerAway(page);
}

interface ScenarioResult {
    readonly id: string;
    readonly totals: Totals;
    /** 归一的分母：帧数，或场景自己的次数（滚动、改窗口）。 */
    readonly per: {readonly unit: "frame" | "scroll" | "resize"; readonly count: number};
    readonly note?: string;
}

/** 返回 null：这份构建没有这个场景要的东西（例如基线还没有右轨），汇总里这一格空着。 */
type Scenario = (page: Page, cdp: CDPSession) => Promise<ScenarioResult | null>;

/** 右栏的入口：基线是右栏上面的入口条，有右轨的构建是右轨上的入口带。 */
async function rightEntries(page: Page): Promise<Locator> {
    const strip = page.locator("[data-region-strip='auxiliarybar']");
    return await strip.count() > 0 ? strip : page.locator("[data-rail='auxiliarybar'] [data-tool-band]");
}

/** 右轨的展开按钮；没有右轨的构建是 null。 */
async function railExpand(page: Page): Promise<Locator | null> {
    const button = page.locator("[data-rail='auxiliarybar'] [data-rail-expand]").first();
    return await button.count() > 0 ? button : null;
}

async function setRailExpanded(page: Page, button: Locator, expanded: boolean): Promise<void> {
    const state = page.locator("[data-rail='auxiliarybar']");
    if ((await state.getAttribute("data-rail-state") === "expanded") !== expanded) await button.click();
    await page.locator(`[data-rail='auxiliarybar'][data-rail-state='${expanded ? "expanded" : "collapsed"}']`).waitFor();
    await settle(page);
    await pointerAway(page);
}

/** 消息视图分节头上的框架按钮（浮动、回到停靠）：悬停才显示，用元素自己的 click，不靠指针。 */
async function pressPanelAction(page: Page, selector: string): Promise<boolean> {
    const button = page.locator(selector).first();
    if (await button.count() === 0) return false;
    await button.evaluate((element) => (element as HTMLElement).click());
    return true;
}

const SCENARIOS: ReadonlyArray<readonly [string, Scenario]> = [
    ["still", async (page, cdp) => {
        await settle(page);
        const totals = await measure(page, cdp, () => frames(page, 120));
        return {id: "still", totals, per: {unit: "frame", count: totals.frames}};
    }],
    ["tree-scroll", async (page, cdp) => {
        // 树本身是滚动元素（`ExplorerTree.vue`）；在它的可见部分中间滚。
        const tree = page.locator("[data-explorer-tree]");
        const at = await centre(tree);
        await page.mouse.move(at.x, at.y);
        await frames(page, 30);
        const scroller = (): Promise<number> => tree.evaluate((element) => element.scrollTop);
        const top = await scroller();
        const totals = await measure(page, cdp, async () => {
            for (let index = 0; index < 30; index += 1) {
                await page.mouse.wheel(0, index % 2 === 0 ? 80 : -40);
                await frames(page, 2);
            }
        });
        const moved = (await scroller()) - top;
        if (!(moved > 0)) throw new Error(`资源管理器没滚动（scrollTop 变了 ${moved}）`);
        await pointerAway(page);
        return {id: "tree-scroll", totals, per: {unit: "scroll", count: 30}, note: `scrollTop +${moved}`};
    }],
    ["sidebar-sash", async (page, cdp) => {
        const sash = page.getByRole("separator", {name: /^调整 \S+ 与 (?:center|g0) 的宽度$/u});
        const at = await centre(sash);
        await page.mouse.move(at.x, at.y);
        await page.mouse.down();
        await page.mouse.move(at.x + 2, at.y);
        await frames(page, 2);
        const totals = await measure(page, cdp, () => glide(page, {x: at.x + 2, y: at.y}, {x: at.x + 122, y: at.y}, 60));
        await page.mouse.up();
        await settle(page);
        await pointerAway(page);
        return {id: "sidebar-sash", totals, per: {unit: "frame", count: totals.frames}};
    }],
    ["resize", async (page, cdp) => {
        const totals = await measure(page, cdp, async () => {
            for (let index = 0; index < 20; index += 1) {
                await page.setViewportSize({width: index % 2 === 0 ? 1300 : VIEWPORT.width, height: VIEWPORT.height});
                await frames(page, 3);
            }
        });
        await settle(page);
        return {id: "resize", totals, per: {unit: "resize", count: 20}};
    }],
    ["live-hold", async (page, cdp) => {
        const lifted = await liftExplorer(page);
        const target = await centre(page.locator("[data-editor-group-active]"));
        await glide(page, lifted, target, 8);
        await settle(page);
        await assertLiveDrag(page);
        await frames(page, 30);
        const totals = await measure(page, cdp, () => frames(page, 60));
        await drop(page);
        return {id: "live-hold", totals, per: {unit: "frame", count: totals.frames}};
    }],
    ["live-path", async (page, cdp) => {
        const lifted = await liftExplorer(page);
        const editor = await centre(page.locator("[data-editor-group-active]"));
        await glide(page, lifted, editor, 8);
        await settle(page);
        await assertLiveDrag(page);
        // 编辑组 → 右栏 → 右栏的入口（基线是入口条，有右轨的是右轨的入口带） → 底部面板 → 活动栏：经过三块面板、两处入口。
        // 区域里分节的叶 id 是生成的，从入口条往下取一点当那块面板。
        const below = async (region: string, by: number): Promise<{x: number; y: number}> => {
            const box = await page.locator(`[data-region-strip="${region}"]`).boundingBox();
            if (box === null) throw new Error(`没有 ${region} 的入口条`);
            return {x: box.x + box.width / 2, y: box.y + box.height + by};
        };
        const stops = [
            await centre(page.locator("[data-content='view:nbook.agent.conversation']")),
            await centre(await rightEntries(page)),
            await below("panel", 60),
            await centre(page.locator("[data-tool-band]").first()),
        ];
        const totals = await measure(page, cdp, async () => {
            let from = editor;
            for (const stop of stops) {
                await glide(page, from, stop, 30);
                await frames(page, 20);
                from = stop;
            }
        });
        await drop(page);
        return {id: "live-path", totals, per: {unit: "frame", count: totals.frames}};
    }],
    // 下面几个是右轨与浮动窗里的视图段（w00043 t19）：基线没有的返回 null。
    ["rail-expand", async (page, cdp) => {
        const button = await railExpand(page);
        if (button === null) return null;
        const totals = await measure(page, cdp, async () => {
            await setRailExpanded(page, button, true);
            await setRailExpanded(page, button, false);
        });
        return {id: "rail-expand", totals, per: {unit: "frame", count: totals.frames}, note: "展开再收起"};
    }],
    ["rail-drag", async (page, cdp) => {
        const button = await railExpand(page);
        if (button === null) return null;
        await setRailExpanded(page, button, true);
        const at = await centre(page.locator("[data-rail='auxiliarybar'] [data-rail-handle]"));
        await page.mouse.move(at.x, at.y);
        await page.mouse.down();
        await page.mouse.move(at.x - 2, at.y);
        await frames(page, 2);
        const totals = await measure(page, cdp, () => glide(page, {x: at.x - 2, y: at.y}, {x: at.x - 122, y: at.y}, 60));
        await page.mouse.up();
        await settle(page);
        await setRailExpanded(page, button, false);
        return {id: "rail-drag", totals, per: {unit: "frame", count: totals.frames}};
    }],
    ["float-dock", async (page, cdp) => {
        const float = "[data-panel-head='section:nbook.agent.conversation'] [data-panel-action='nbook.view.float']";
        if (await page.locator(float).count() === 0) return null;
        const totals = await measure(page, cdp, async () => {
            await pressPanelAction(page, float);
            await page.locator("[data-leaf][data-float]").waitFor();
            await settle(page);
            await pressPanelAction(page, "[data-panel-action='nbook.view.dock']");
            await page.locator("[data-leaf][data-float]").waitFor({state: "detached"});
            await settle(page);
        });
        await pointerAway(page);
        return {id: "float-dock", totals, per: {unit: "frame", count: totals.frames}, note: "浮出再回到停靠"};
    }],
    // 改了布局（资源管理器挪进右栏），放在最后。
    ["rail-switch", async (page, cdp) => {
        const button = await railExpand(page);
        if (button === null) return null;
        await setRailExpanded(page, button, true);
        await page.locator("[data-panel-tab='view:nbook.explorer']").click({button: "right"});
        await page.getByRole("menuitem", {name: "新容器（右栏）", exact: true}).click();
        await settle(page);
        const entries = page.locator("[data-rail='auxiliarybar'] [data-tool-band] [data-tool-entry]");
        if (await entries.count() < 2) throw new Error("右栏没有两个容器");
        const conversation = page.locator("[data-rail='auxiliarybar'] [data-tool-band] [data-tool-view='nbook.agent.conversation']");
        const other = page.locator("[data-rail='auxiliarybar'] [data-tool-band] [data-tool-entry]:not([data-tool-view='nbook.agent.conversation'])").first();
        const totals = await measure(page, cdp, async () => {
            for (const entry of [conversation, other, conversation, other]) {
                await entry.click();
                await frames(page, 2);
                await settle(page);
            }
        });
        await pointerAway(page);
        return {id: "rail-switch", totals, per: {unit: "frame", count: totals.frames}, note: "展开着视图段的容器与收着的容器来回切四次"};
    }],
];

/** 打开作品与两章，右栏与底部面板都显示出来；返回开着 Performance 域的 CDP 会话。 */
async function openBook(page: Page, url: string): Promise<CDPSession> {
    await page.goto(new URL("/?project=book", url).href);
    await page.locator("[data-workbench-root][data-rpc-state='online']").waitFor({timeout: 30_000});
    const folder = page.locator("[data-explorer-row=\"project://notes\"]");
    if (await folder.getAttribute("aria-expanded") !== "true") await folder.click();
    for (const name of ["short", "long"]) {
        await page.locator(`[data-explorer-row="project://notes/${name}.md"]`).dblclick();
        await page.locator("[data-editor-tab]", {hasText: `${name}.md`}).waitFor();
    }
    await page.locator("[data-editor-group-active] [data-editor-prose]", {hasText: "长章"}).waitFor();
    for (const region of ["auxiliarybar", "panel"]) {
        const toggle = page.locator(`[data-titlebar-layout="${region}"]`);
        if (await toggle.getAttribute("aria-pressed") !== "true") await toggle.click();
        // 有右轨的构建里右栏没有入口条，入口在右轨上。
        await page.locator(region === "auxiliarybar" ? "[data-region-strip='auxiliarybar'], [data-rail='auxiliarybar']" : `[data-region-strip="${region}"]`).first().waitFor();
    }
    await settle(page);
    await pointerAway(page);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Performance.enable");
    return cdp;
}

async function runOnce(browser: Browser, checkout: Checkout): Promise<ScenarioResult[]> {
    const root = await mkdtemp(join(tmpdir(), "nbook-layout-frames-"));
    let server: Server | null = null;
    try {
        server = await startServer(checkout.packageRoot, await seed(root));
        const context = await browser.newContext({viewport: VIEWPORT, reducedMotion: "no-preference"});
        await context.addInitScript(installCounters);
        const page = await context.newPage();
        try {
            const cdp = await openBook(page, server.url);
            const results: ScenarioResult[] = [];
            for (const [, scenario] of SCENARIOS) {
                const result = await scenario(page, cdp);
                if (result !== null) results.push(result);
            }
            return results;
        } finally {
            await context.close();
        }
    } finally {
        if (server !== null) await server.stop();
        await rm(root, {recursive: true, force: true});
    }
}

// ——— 汇总 ———

const median = (values: ReadonlyArray<number>): number => {
    const sorted = [...values].sort((left, right) => left - right);
    const middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 === 1 ? sorted[middle] as number : ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
};

const METRICS = ["recalc", "layout", "raf", "mutations", "sashStyles"] as const;

function table(runs: ReadonlyArray<{readonly label: string; readonly results: ReadonlyArray<ScenarioResult>}>, labels: ReadonlyArray<string>): string {
    const lines = ["场景\t单位\t构建\t" + METRICS.map((metric) => `${metric}/单位`).join("\t") + "\traf/秒\t帧数"];
    for (const [id] of SCENARIOS) {
        for (const label of labels) {
            const picked = runs.filter((run) => run.label === label).flatMap((run) => run.results.filter((result) => result.id === id));
            if (picked.length === 0) {
                lines.push([id, "-", label, ...METRICS.map(() => "-"), "-", "-"].join("\t"));
                continue;
            }
            const unit = picked[0]?.per.unit ?? "frame";
            const cells = METRICS.map((metric) => median(picked.map((result) => result.totals[metric] / result.per.count)).toFixed(2));
            const perSecond = median(picked.map((result) => result.totals.raf / (result.totals.ms / 1000))).toFixed(1);
            const frameCount = median(picked.map((result) => result.totals.frames)).toFixed(0);
            lines.push([id, unit, label, ...cells, perSecond, frameCount].join("\t"));
        }
    }
    return lines.join("\n");
}

async function main(): Promise<void> {
    const options = parseOptions(process.argv.slice(2));
    const browser = await chromium.launch({channel: "chrome", headless: true});
    const runs: Array<{label: string; round: number; results: ScenarioResult[]}> = [];
    try {
        for (let round = 1; round <= options.rounds; round += 1) {
            for (const checkout of options.checkouts) {
                process.stderr.write(`第 ${round} 轮 ${checkout.label}…\n`);
                runs.push({label: checkout.label, round, results: await runOnce(browser, checkout)});
            }
        }
    } finally {
        await browser.close();
    }
    const summary = table(runs, options.checkouts.map((checkout) => checkout.label));
    process.stdout.write(`${summary}\n`);
    if (options.out !== null) await writeFile(options.out, `${JSON.stringify({checkouts: options.checkouts, rounds: options.rounds, runs, summary}, null, 2)}\n`);
}

await main();
