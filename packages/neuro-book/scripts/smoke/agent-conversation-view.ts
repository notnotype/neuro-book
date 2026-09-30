import {mkdir} from "node:fs/promises";
import {join} from "node:path";
import type {Browser, BrowserContext, Page} from "playwright-core";
import type {SmokeFailure} from "./agent-profile-nav";
import {assert} from "./agent-profile-nav";

/** 位置比较的容差：小数像素取整后最多差 1px。 */
const TOLERANCE_PX = 1.5;

/**
 * 验证 AgentConversationView 消息流里随时间变化的行为（Spec `ui.agent-conversation-view` 的“历史与滚动”
 * “展开与折叠”末条，验收第 4、7、9、10 条）：跟随底部、离开底部后阅读位置不动、回到最新、
 * 运行结束整轮收起时最终回复不动且焦点移到摘要行、历史分页后位置不变且开头不完整的一轮沿用同一个组件、
 * 加载失败后重试、原始视图切换、投递状态未知时的重新发送与移除；另查从这个视图切到别的组件时 Lab 不报错。
 *
 * 每个场景开一个新标签页，用 URL 参数（c、s、vp）直接打开，就绪以 `window.__nbLab` 为准，不点 Lab 外壳的导航；
 * 夹具“模拟宿主”的按钮在 Lab 控制抽屉里，按 `data-lab-action` 定位，并用 DOM click 触发，不抢走焦点。
 * 出现失败的场景在 `screenshots` 目录留一张整页截图。
 */
export async function assertAgentConversationViewSmoke(browser: Browser, baseUrl: string, failures: SmokeFailure[], screenshots: string): Promise<void> {
    const context = await browser.newContext({viewport: {width: 1600, height: 1000}});
    const env: SceneEnv = {context, baseUrl, failures, screenshots};
    try {
        await followAndAnchor(env);
        await collapseKeepsFinalReply(env);
        await historyPaging(env);
        await historyRetry(env);
        await rawView(env);
        await deliveryUnknown(env);
        await switchComponent(env);
    } finally {
        await context.close();
    }
}

type SceneEnv = {context: BrowserContext; baseUrl: string; failures: SmokeFailure[]; screenshots: string};

// ─── 场景 ───────────────────────────────────────────────────────────────

/** 跟随底部；向上离开后流式输出、追加步骤与下方整轮收起都不移动正在读的内容；回到最新恢复跟随。 */
async function followAndAnchor(env: SceneEnv): Promise<void> {
    const {failures} = env;
    await withScene(env, "running", async (page) => {
        let metrics = await streamMetrics(page);
        assert(metrics.distance <= 24, failures, `running：打开后应停在底部，距底 ${metrics.distance}px`);

        await labAction(page, "stream");
        await labAction(page, "stream");
        metrics = await streamMetrics(page);
        assert(metrics.distance <= 24, failures, `running：停在底部时流式输出应跟随，距底 ${metrics.distance}px`);

        // 读第一轮的回复：它下面还有很多内容，下方的轮次收起后视口也不会被迫贴底。
        const before = await readAt(page, "[data-final-reply]", "主角叫林默");
        assert((await streamMetrics(page)).distance > 24, failures, "running：读第一轮时应已离开底部");
        assert(await page.locator("[data-jump-latest]").isVisible(), failures, "running：离开底部后应出现“回到最新”");

        await labAction(page, "stream");
        await labAction(page, "step");
        await labAction(page, "stream");
        assertSame(await probeOffset(page), before, failures, "running：离开底部后，下方的流式输出与新步骤不应移动正在读的内容");

        await labAction(page, "finish");
        assertSame(await probeOffset(page), before, failures, "running：下方运行中的轮次结束并整轮收起时，正在读的内容不应移动（验收 4）");

        await page.locator("[data-jump-latest]").click();
        await frames(page);
        metrics = await streamMetrics(page);
        assert(metrics.distance <= 24, failures, `running：点“回到最新”后应到底部，距底 ${metrics.distance}px`);
        await page.locator("[data-jump-latest]").waitFor({state: "hidden", timeout: 2_000}).catch(() => {
            failures.push({kind: "assertion", message: "running：回到底部后“回到最新”应消失"});
        });
    });
}

/** 正在读过程时运行结束：过程收起，最终回复停在原处，键盘焦点从过程移到整轮摘要行。 */
async function collapseKeepsFinalReply(env: SceneEnv): Promise<void> {
    const {failures} = env;
    // 展开过程里的思维链、画布矮一些，读过程开头时下面还有一屏以上的内容，视口确实离开了底部，校正才有意义。
    await withScene(env, "running", async (page) => {
        await labAction(page, "stream");
        const collapsed = page.locator(".acv-process [data-chain-summary][aria-expanded='false']");
        for (let round = 0; round < 8 && await collapsed.count() > 0; round += 1) {
            await collapsed.first().click();
        }
        await frames(page);
        await readAt(page, "[data-intermediate]", "平铺直叙");
        assert((await streamMetrics(page)).distance > 24, failures, "running（390x560）：读过程开头时应已离开底部");
        const reply = await markProbe(page, "[data-final-reply]", "深夜来客");
        assert(reply !== null, failures, "running：流式输出后应有正在生成的最终回复");
        await page.evaluate(() => document.querySelector<HTMLElement>(".acv-process [data-chain-summary]")?.focus({preventScroll: true}));

        await labAction(page, "finish");
        assertSame(await probeOffset(page), reply, failures, "running：运行结束整轮收起时，最终回复应停在原处");
        const focused = await page.evaluate(() => document.activeElement?.hasAttribute("data-turn-summary") ?? false);
        assert(focused, failures, "running：焦点在被收起的过程里时，应移到整轮摘要行");
    }, "390x560");
}

/** 接近顶部时加载更早一页，可见内容不动；开头不完整的一轮补上用户消息后仍是同一个组件；加载完后各轮都收起。 */
async function historyPaging(env: SceneEnv): Promise<void> {
    const {failures} = env;
    await withScene(env, "history-paged", async (page) => {
        // 内容不足一屏时视图会自己连续请求，等它停下来。
        await waitForHistoryIdle(page);
        const firstTurn = () => page.evaluate(() => {
            const turn = (window as unknown as {__acvFirstTurn?: Element | null}).__acvFirstTurn;
            return {connected: turn?.isConnected ?? false, hasUser: turn?.querySelector("[data-role='user']") != null};
        });
        await page.evaluate(() => {
            (window as unknown as {__acvFirstTurn?: Element | null}).__acvFirstTurn = document.querySelector(".acv-turn");
        });
        // 滚到顶就会请求下一页；夹具延迟 700ms 才补上，这之前记下探针。
        await scrollStreamTo(page, 0);
        const before = await markProbe(page, ".acv-turn [data-role='assistant'] .acv-message__head", null);
        await waitForHistoryIdle(page);
        assertSame(await probeOffset(page), before, failures, "history-paged：加载更早一页后，原来可见的内容不应移动（验收 7）");
        assert((await firstTurn()).connected, failures, "history-paged：开头不完整的一轮补上更早的消息后应沿用同一个组件");

        for (let round = 0; round < 6 && await page.locator("[data-history]").count() > 0; round += 1) {
            await scrollStreamTo(page, 0);
            await waitForHistoryIdle(page);
        }
        assert(await page.locator("[data-history]").count() === 0, failures, "history-paged：全部加载后顶部不应再有“更早的内容”");
        const merged = await firstTurn();
        assert(merged.connected && merged.hasUser, failures, `history-paged：全部加载后，最初开头不完整的一轮应补上用户消息且仍是同一个组件：${JSON.stringify(merged)}`);
        const expanded = await page.locator("[data-turn-summary][aria-expanded='true']").count();
        assert(expanded === 0, failures, `history-paged：从历史加载的轮次应全部整轮收起，实际展开 ${expanded} 个`);
    });
}

/** 加载失败时顶部显示错误与重试；重试成功后错误消失、内容增加。 */
async function historyRetry(env: SceneEnv): Promise<void> {
    const {failures} = env;
    await withScene(env, "history-error", async (page) => {
        const error = page.locator("[data-history='error']");
        assert(await error.isVisible(), failures, "history-error：顶部应显示加载失败");
        const count = await page.locator(".acv-turn").count();
        await error.locator("button").click();
        await waitForHistoryIdle(page);
        assert(await error.count() === 0, failures, "history-error：重试成功后错误应消失");
        const after = await page.locator(".acv-turn").count();
        assert(after > count, failures, `history-error：重试后应多出更早的轮次（${count} → ${after}）`);
    });
}

/** 从溢出菜单切到原始视图：每条消息一块，系统条目全文可见；再切回分轮视图。 */
async function rawView(env: SceneEnv): Promise<void> {
    const {failures} = env;
    await withScene(env, "long-conversation", async (page) => {
        await chooseOverflow(page, "原始视图");
        await page.locator("[data-raw-view]").waitFor({state: "visible", timeout: 5_000});
        const raw = await page.evaluate(() => ({
            blocks: document.querySelectorAll("[data-raw-view] > article").length,
            system: document.querySelectorAll("[data-raw-view] > article[data-raw-kind='system']").length,
            reminderText: document.querySelector("[data-raw-view]")?.textContent?.includes("不要改动") ?? false,
        }));
        assert(raw.blocks === 22, failures, `raw：长对话的 22 条消息应各占一块，实际 ${raw.blocks}`);
        assert(raw.system === 4 && raw.reminderText, failures, `raw：4 条系统条目应全部可见且显示全文：${JSON.stringify(raw)}`);

        await chooseOverflow(page, "分轮视图");
        await page.locator(".acv-turn").first().waitFor({state: "visible", timeout: 5_000});
        assert(await page.locator("[data-raw-view]").count() === 0, failures, "raw：切回分轮视图后不应再有原始视图");
    });
}

/** 投递状态未知：有说明和两个按钮，不提供编辑等改写历史的操作；重新发送后变为发送中再确认，移除后消息消失。 */
async function deliveryUnknown(env: SceneEnv): Promise<void> {
    const {failures} = env;
    await withScene(env, "message-states", async (page) => {
        const lastUser = page.locator(".acv-message[data-role='user']").last();
        assert(await lastUser.getByText("可能已发送，重新发送可能产生重复").isVisible(), failures, "message-states：投递未知应有文字说明（验收 10）");
        assert(await lastUser.getByRole("button", {name: "编辑"}).count() === 0, failures, "message-states：未确认送达的消息不应提供编辑");
        await lastUser.getByRole("button", {name: "重新发送"}).click();
        await lastUser.getByText("发送中").first().waitFor({state: "visible", timeout: 2_000}).catch(() => {
            failures.push({kind: "assertion", message: "message-states：重新发送后应显示发送中"});
        });
        await lastUser.getByText("发送中").first().waitFor({state: "hidden", timeout: 3_000}).catch(() => {
            failures.push({kind: "assertion", message: "message-states：宿主确认后“发送中”应消失"});
        });
        assert(await lastUser.getByRole("button", {name: "编辑"}).count() === 1, failures, "message-states：确认送达后应恢复编辑");
    });
    await withScene(env, "message-states", async (page) => {
        const count = await page.locator(".acv-message[data-role='user']").count();
        await page.locator(".acv-message[data-role='user']").last().getByRole("button", {name: "移除"}).click();
        await frames(page);
        const after = await page.locator(".acv-message[data-role='user']").count();
        assert(after === count - 1, failures, `message-states：移除后该消息应消失（${count} → ${after}）`);
    });
}

/**
 * 在组件树里切到另一个组件：新组件的场景输入立即就位，它的 fixture 却要等模块加载；这期间舞台不能让旧 fixture
 * 带着别的组件的输入重新挂载。模块已在缓存里时加载赶在淡出动画之前完成，问题不出现，所以人为拖慢目标 fixture 的请求
 * （匹配开发服务器按源文件名给出的模块地址）。页面错误由 `withScene` 统一记下。
 */
async function switchComponent(env: SceneEnv): Promise<void> {
    const {failures} = env;
    await withScene(env, "long-conversation", async (page) => {
        await page.route("**/JsonViewerFixture.vue*", async (route) => {
            await new Promise((resolve) => setTimeout(resolve, 1_000));
            await route.continue();
        });
        await page.locator(".lab-columns > .nb-lab-panel--nav [role='treeitem']").filter({hasText: /^JsonViewer$/u}).click();
        await page.waitForFunction(() => {
            const state = (window as unknown as {__nbLab?: {state(): {component: string; ready: boolean}}}).__nbLab?.state();
            return state?.component === "JsonViewer" && state.ready;
        }, undefined, {timeout: 30_000});
        await frames(page);
        assert(await page.locator("[data-lab-stage] [data-agent-stream]").count() === 0, failures, "switch：切到 JsonViewer 后舞台不应还留着对话视图");
    });
}

// ─── 工具 ───────────────────────────────────────────────────────────────

async function withScene(env: SceneEnv, scene: string, run: (page: Page) => Promise<void>, viewport = "phone"): Promise<void> {
    const {failures} = env;
    const failuresBefore = failures.length;
    const page = await env.context.newPage();
    page.on("pageerror", (error) => failures.push({kind: "page", message: `${scene}：${error.message}`}));
    page.on("console", (message) => {
        if (message.type() === "error") {
            failures.push({kind: "console", message: `${scene}：${message.text()}`});
        }
    });
    try {
        const url = new URL("/lab", env.baseUrl);
        url.search = new URLSearchParams({c: "AgentConversationView", s: scene, vp: viewport}).toString();
        await page.goto(url.href, {waitUntil: "domcontentloaded", timeout: 180_000});
        await page.waitForFunction((expected) => {
            const state = (window as unknown as {__nbLab?: {state(): {scene: string; ready: boolean}}}).__nbLab?.state();
            return state?.scene === expected && state.ready;
        }, scene, {timeout: 120_000});
        await page.waitForFunction(() => document.querySelectorAll("[data-lab-stage]").length === 1
            && document.querySelector("[data-agent-stream]") !== null, undefined, {timeout: 10_000});
        await frames(page);
        await run(page);
    } catch (error) {
        failures.push({kind: "assertion", message: `${scene}：${error instanceof Error ? error.message.split("\n").slice(0, 6).join(" | ") : String(error)}`});
    } finally {
        if (failures.length > failuresBefore) {
            await mkdir(env.screenshots, {recursive: true});
            await page.screenshot({path: join(env.screenshots, `${scene}-${failuresBefore}.png`), fullPage: true}).catch(() => undefined);
        }
        await page.close();
    }
}

/** 从顶栏溢出菜单选一项，并等菜单关掉，免得下一次点击落在正在退场的菜单上。 */
async function chooseOverflow(page: Page, item: string): Promise<void> {
    await page.locator("[data-lab-stage]").getByRole("button", {name: "更多操作"}).click();
    await page.getByRole("menuitem", {name: item}).click();
    await page.getByRole("menu").waitFor({state: "hidden", timeout: 5_000}).catch(async () => {
        await page.keyboard.press("Escape");
    });
}

/** 等两帧：界面更新之后的布局与 ResizeObserver 校正都已完成。 */
async function frames(page: Page): Promise<void> {
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

/** 点“模拟宿主”的按钮；用 DOM click，不把焦点从消息流里抢走。 */
async function labAction(page: Page, action: string): Promise<void> {
    await page.locator(`[data-lab-action="${action}"]`).evaluate((element) => (element as HTMLElement).click());
    await frames(page);
}

async function streamMetrics(page: Page): Promise<{scrollTop: number; distance: number}> {
    return page.evaluate(() => {
        const stream = document.querySelector<HTMLElement>("[data-agent-stream]")!;
        return {scrollTop: stream.scrollTop, distance: stream.scrollHeight - stream.scrollTop - stream.clientHeight};
    });
}

async function scrollStreamTo(page: Page, top: number): Promise<void> {
    await page.evaluate((value) => {
        document.querySelector<HTMLElement>("[data-agent-stream]")!.scrollTop = value;
    }, top);
    await frames(page);
}

/** 把匹配的元素滚到消息流顶部下方 40px 处并记为探针，返回它的位置。 */
async function readAt(page: Page, selector: string, text: string): Promise<number | null> {
    await page.evaluate(({selector, text}) => {
        const stream = document.querySelector<HTMLElement>("[data-agent-stream]")!;
        const element = [...document.querySelectorAll(selector)].find((item) => item.textContent?.includes(text));
        if (element !== undefined) {
            stream.scrollTop += element.getBoundingClientRect().top - stream.getBoundingClientRect().top - 40;
        }
    }, {selector, text});
    await frames(page);
    return markProbe(page, selector, text);
}

/** 记下探针元素（选择器匹配、且含有 text 的第一个；text 为 null 时取第一个），返回它相对消息流顶部的位置。 */
async function markProbe(page: Page, selector: string, text: string | null): Promise<number | null> {
    return page.evaluate(({selector, text}) => {
        const element = [...document.querySelectorAll(selector)].find((item) => text === null || item.textContent?.includes(text)) ?? null;
        (window as unknown as {__acvProbe?: Element | null}).__acvProbe = element;
        const stream = document.querySelector<HTMLElement>("[data-agent-stream]")!;
        return element === null ? null : element.getBoundingClientRect().top - stream.getBoundingClientRect().top;
    }, {selector, text});
}

async function probeOffset(page: Page): Promise<number | null> {
    return page.evaluate(() => {
        const element = (window as unknown as {__acvProbe?: Element | null}).__acvProbe;
        const stream = document.querySelector<HTMLElement>("[data-agent-stream]")!;
        return element?.isConnected ? element.getBoundingClientRect().top - stream.getBoundingClientRect().top : null;
    });
}

function assertSame(actual: number | null, expected: number | null, failures: SmokeFailure[], message: string): void {
    assert(
        actual !== null && expected !== null && Math.abs(actual - expected) <= TOLERANCE_PX,
        failures,
        `${message}：之前 ${expected?.toFixed(1)}px，之后 ${actual?.toFixed(1) ?? "已移除"}`,
    );
}

/** 等历史行不再是加载中（夹具的模拟延迟是 700ms），再等校正完成。 */
async function waitForHistoryIdle(page: Page): Promise<void> {
    await page.waitForTimeout(100);
    await page.waitForFunction(() => document.querySelector("[data-history='loading']") === null, undefined, {timeout: 10_000});
    await frames(page);
    await page.waitForTimeout(100);
    await page.waitForFunction(() => document.querySelector("[data-history='loading']") === null, undefined, {timeout: 10_000});
    await frames(page);
}
