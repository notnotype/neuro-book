/**
 * nb-agent-ui 在 Lab 场景里的真实浏览器行为（docs/specs/ui/agent-conversation-view.md 验收 4、7、9、10、11、12 与
 * “历史与滚动”）：消息流随时间变化的跟随与阅读位置、历史分页与重试、原始视图、投递状态未知、已发送消息的标签与原图
 * 预览、回复 Markdown 的点击，以及输入框的投递方式、命令、附件、展开与模型下拉。这些都要真实的布局、滚动与焦点，
 * happy-dom 给不出，所以在这里测。迁自旧应用的 smoke（归档提交 865c9f593 的 scripts/smoke/agent-*.ts）。
 *
 * 场景里的“模拟宿主”按钮在 Lab 的控制抽屉里，按 `data-lab-action` 定位，用 DOM click 触发，不把焦点从消息流里抢走。
 * 动作从事件页签读（`tab=events`）。
 */

import {rm} from "node:fs/promises";
import {join} from "node:path";

import {expect, test} from "@playwright/test";
import type {Page} from "@playwright/test";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import type {LabDebugState} from "nbook/plugins/lab/shared/debug-api";

import {startDevSession} from "./fixtures";
import type {DevSession} from "./fixtures";

let tmp = "";
let dev: DevSession;

test.beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-e2e", "lab-agent-ui");
    dev = await startDevSession(join(tmp, "state"));
});

test.afterAll(async () => {
    dev.child.kill("SIGTERM");
    expect(await dev.exit).toBe(0);
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

/** 位置比较的容差：小数像素取整后最多差 1px。 */
const TOLERANCE_PX = 1.5;

const labState = (page: Page) => page.evaluate(() => (window as unknown as {__nbLab?: {state(): LabDebugState}}).__nbLab?.state() ?? null);

async function openScene(page: Page, component: string, scene: string, viewport = "phone"): Promise<void> {
    await page.setViewportSize({width: 1440, height: 1100});
    await page.goto(`${dev.pageUrl}lab?c=${component}&s=${scene}&vp=${viewport}&tab=events`);
    await expect.poll(async () => (await labState(page))?.ready).toBe(true);
    await frames(page);
}

const stage = (page: Page) => page.locator(".lab-main [data-lab-stage]");

/** 等两帧：界面更新之后的布局与 ResizeObserver 校正都已完成。 */
async function frames(page: Page): Promise<void> {
    await page.evaluate(() => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
}

/** 点“模拟宿主”的按钮；用 DOM click，不把焦点从消息流里抢走。 */
async function labAction(page: Page, action: string): Promise<void> {
    await page.locator(`[data-lab-action="${action}"]`).evaluate((element) => (element as HTMLElement).click());
    await frames(page);
}

/** 事件页签里的 action，最早的在前；正文变化太频繁，不计入。 */
async function actions(page: Page): Promise<Array<Record<string, unknown>>> {
    const rows = await page.locator('[data-lab-panel="events"] .nb-lab-event-chip').evaluateAll((chips) => chips.map((chip) => ({
        name: chip.textContent?.trim() ?? "",
        payload: chip.nextElementSibling?.textContent?.trim() ?? "",
    })));
    return rows
        .filter((row) => row.name === "action")
        .map((row) => JSON.parse(row.payload) as Record<string, unknown>)
        .filter((payload) => payload.type !== "composer.draftChanged")
        .reverse();
}

const lastAction = async (page: Page) => (await actions(page)).at(-1);

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

/** 记下探针元素（选择器匹配、且含有 text 的第一个；text 为 null 时取第一个），返回它相对消息流顶部的位置。 */
async function markProbe(page: Page, selector: string, text: string | null): Promise<number | null> {
    return page.evaluate(({selector, text}) => {
        const element = [...document.querySelectorAll(selector)].find((item) => text === null || item.textContent?.includes(text)) ?? null;
        (window as unknown as {__acvProbe?: Element | null}).__acvProbe = element;
        const stream = document.querySelector<HTMLElement>("[data-agent-stream]")!;
        return element === null ? null : element.getBoundingClientRect().top - stream.getBoundingClientRect().top;
    }, {selector, text});
}

/** 把匹配的元素滚到消息流顶部下方 40px 处并记为探针，返回它的位置。 */
async function readAt(page: Page, selector: string, text: string): Promise<number | null> {
    await page.evaluate(({selector, text}) => {
        const stream = document.querySelector<HTMLElement>("[data-agent-stream]")!;
        const element = [...document.querySelectorAll(selector)].find((item) => item.textContent?.includes(text));
        if (element !== undefined) stream.scrollTop += element.getBoundingClientRect().top - stream.getBoundingClientRect().top - 40;
    }, {selector, text});
    await frames(page);
    return markProbe(page, selector, text);
}

async function probeOffset(page: Page): Promise<number | null> {
    return page.evaluate(() => {
        const element = (window as unknown as {__acvProbe?: Element | null}).__acvProbe;
        const stream = document.querySelector<HTMLElement>("[data-agent-stream]")!;
        return element?.isConnected === true ? element.getBoundingClientRect().top - stream.getBoundingClientRect().top : null;
    });
}

function expectSameOffset(actual: number | null, expected: number | null, message: string): void {
    expect(actual, message).not.toBeNull();
    expect(expected, message).not.toBeNull();
    expect(Math.abs(actual! - expected!), message).toBeLessThanOrEqual(TOLERANCE_PX);
}

/** 历史行不再是加载中（夹具的模拟延迟是 700ms），并且校正已完成。 */
async function waitForHistoryIdle(page: Page): Promise<void> {
    await expect(page.locator("[data-history='loading']")).toHaveCount(0, {timeout: 10_000});
    await frames(page);
}

/** 从顶栏溢出菜单选一项，并等菜单关掉。 */
async function chooseOverflow(page: Page, item: string): Promise<void> {
    await stage(page).getByRole("button", {name: "更多操作"}).click();
    await page.getByRole("menuitem", {name: item}).click();
    await expect(page.getByRole("menu")).toBeHidden();
}

test.describe("对话视图的消息流", () => {
    test("停在底部时跟随；离开底部后下方的输出与整轮收起都不移动正在读的内容；回到最新（验收 4）", async ({page}) => {
        await openScene(page, "AgentConversationView", "running");
        expect((await streamMetrics(page)).distance).toBeLessThanOrEqual(24);

        await labAction(page, "stream");
        await labAction(page, "stream");
        expect((await streamMetrics(page)).distance, "停在底部时流式输出应跟随").toBeLessThanOrEqual(24);

        // 读第一轮的回复：它下面还有很多内容，下方的轮次收起后视口也不会被迫贴底。
        const before = await readAt(page, "[data-final-reply]", "主角叫林默");
        expect((await streamMetrics(page)).distance).toBeGreaterThan(24);
        await expect(page.locator("[data-jump-latest]")).toBeVisible();

        await labAction(page, "stream");
        await labAction(page, "step");
        await labAction(page, "stream");
        expectSameOffset(await probeOffset(page), before, "下方的流式输出与新步骤不应移动正在读的内容");

        await labAction(page, "finish");
        expectSameOffset(await probeOffset(page), before, "下方的轮次结束并整轮收起时，正在读的内容不应移动");

        await page.locator("[data-jump-latest]").click();
        await expect.poll(async () => (await streamMetrics(page)).distance).toBeLessThanOrEqual(24);
        await expect(page.locator("[data-jump-latest]")).toBeHidden();

        // 往上翻着读时发出一条消息：回到最新并恢复跟随。
        await readAt(page, "[data-final-reply]", "主角叫林默");
        await expect(page.locator("[data-jump-latest]")).toBeVisible();
        await stage(page).locator(".ProseMirror").click();
        await page.keyboard.type("继续写下一章");
        await page.keyboard.press("Enter");
        await expect.poll(async () => (await actions(page)).some((action) => action.type === "composer.submit")).toBe(true);
        await expect.poll(async () => (await streamMetrics(page)).distance).toBeLessThanOrEqual(24);
        await expect(page.locator("[data-jump-latest]")).toBeHidden();
    });

    test("正在读过程时运行结束：最终回复停在原处，焦点从过程移到整轮摘要行", async ({page}) => {
        await openScene(page, "AgentConversationView", "running", "390x560");
        await labAction(page, "stream");
        const collapsed = page.locator(".acv-process [data-chain-summary][aria-expanded='false']");
        for (let round = 0; round < 8 && await collapsed.count() > 0; round += 1) await collapsed.first().click();
        await frames(page);
        await readAt(page, "[data-intermediate]", "平铺直叙");
        expect((await streamMetrics(page)).distance).toBeGreaterThan(24);
        const reply = await markProbe(page, "[data-final-reply]", "深夜来客");
        expect(reply).not.toBeNull();
        await page.evaluate(() => document.querySelector<HTMLElement>(".acv-process [data-chain-summary]")?.focus({preventScroll: true}));

        await labAction(page, "finish");
        expectSameOffset(await probeOffset(page), reply, "运行结束整轮收起时，最终回复应停在原处");
        expect(await page.evaluate(() => document.activeElement?.hasAttribute("data-turn-summary") ?? false)).toBe(true);
    });

    test("加载更早一页后可见内容不动，开头不完整的一轮沿用同一个组件；全部加载后各轮收起（验收 7）", async ({page}) => {
        await openScene(page, "AgentConversationView", "history-paged");
        await waitForHistoryIdle(page);
        await page.evaluate(() => {
            (window as unknown as {__acvFirstTurn?: Element | null}).__acvFirstTurn = document.querySelector(".acv-turn");
        });
        const firstTurn = () => page.evaluate(() => {
            const turn = (window as unknown as {__acvFirstTurn?: Element | null}).__acvFirstTurn;
            return {connected: turn?.isConnected ?? false, hasUser: turn?.querySelector("[data-role='user']") != null};
        });
        await scrollStreamTo(page, 0);
        const before = await markProbe(page, ".acv-turn [data-role='assistant'] .acv-message__head", null);
        await expect(page.locator("[data-history='loading']")).toHaveCount(1);
        await waitForHistoryIdle(page);
        expectSameOffset(await probeOffset(page), before, "加载更早一页后，原来可见的内容不应移动");
        expect((await firstTurn()).connected).toBe(true);

        for (let round = 0; round < 6 && await page.locator("[data-history]").count() > 0; round += 1) {
            await scrollStreamTo(page, 0);
            await waitForHistoryIdle(page);
        }
        await expect(page.locator("[data-history]")).toHaveCount(0);
        expect(await firstTurn()).toEqual({connected: true, hasUser: true});
        await expect(page.locator("[data-turn-summary][aria-expanded='true']")).toHaveCount(0);
    });

    test("加载失败时顶部显示错误与重试，重试成功后多出更早的轮次", async ({page}) => {
        await openScene(page, "AgentConversationView", "history-error");
        const error = page.locator("[data-history='error']");
        await expect(error).toBeVisible();
        const count = await page.locator(".acv-turn").count();
        await error.locator("button").click();
        await waitForHistoryIdle(page);
        await expect(error).toHaveCount(0);
        expect(await page.locator(".acv-turn").count()).toBeGreaterThan(count);
    });

    test("溢出菜单切到原始视图：每条消息一块，系统条目全文可见；再切回分轮视图（验收 9）", async ({page}) => {
        await openScene(page, "AgentConversationView", "long-conversation");
        await chooseOverflow(page, "原始视图");
        await expect(page.locator("[data-raw-view] > article")).toHaveCount(22);
        await expect(page.locator("[data-raw-view] > article[data-raw-kind='system']")).toHaveCount(4);
        await expect(page.locator("[data-raw-view]")).toContainText("不要改动");
        await chooseOverflow(page, "分轮视图");
        await expect(page.locator(".acv-turn").first()).toBeVisible();
        await expect(page.locator("[data-raw-view]")).toHaveCount(0);
    });

    test("投递状态未知：有说明、没有编辑；重新发送后经发送中确认，移除后消息消失（验收 10）", async ({page}) => {
        await openScene(page, "AgentConversationView", "message-states");
        const users = page.locator(".acv-message[data-role='user']");
        const lastUser = users.last();
        await expect(lastUser.getByText("可能已发送，重新发送可能产生重复")).toBeVisible();
        await expect(lastUser.getByRole("button", {name: "编辑"})).toHaveCount(0);
        await lastUser.getByRole("button", {name: "重新发送"}).click();
        await expect(lastUser.getByText("发送中").first()).toBeVisible();
        await expect(lastUser.getByText("发送中")).toHaveCount(0, {timeout: 5_000});
        await expect(lastUser.getByRole("button", {name: "编辑"})).toHaveCount(1);

        await openScene(page, "AgentConversationView", "message-states");
        const count = await users.count();
        await users.last().getByRole("button", {name: "移除"}).click();
        await expect(users).toHaveCount(count - 1);
    });

    test("已发送消息按文字写法显示：点引用发出 reference.open，点图片打开原图预览且整张留在画布里，没有地址的图片不打开", async ({page}) => {
        await openScene(page, "AgentConversationView", "message-states");
        const message = page.locator(".acv-user-content", {hasText: "先读"});
        await message.scrollIntoViewIfNeeded();
        await expect(message.locator("[data-prompt-card]")).toHaveCount(3);
        await expect(message.locator("[data-prompt-paste] [data-prompt-paste-action='expand']")).toHaveCount(1);
        await message.locator("[data-inline-chip='reference']").first().click();
        await expect.poll(async () => (await lastAction(page))?.type).toBe("reference.open");

        await message.locator("[data-inline-chip='image']").nth(1).click();
        await frames(page);
        await expect(page.locator("[role='dialog']")).toHaveCount(0);
        await message.locator("[data-inline-chip='image']").first().click();
        const image = page.locator("[role='dialog'] img");
        await expect(image).toBeVisible();
        const [canvasBox, dialogBox, imageBox] = await Promise.all([page.locator("[data-lab-canvas]").boundingBox(), page.locator("[role='dialog']").boundingBox(), image.boundingBox()]);
        const inside = (inner: typeof canvasBox, outer: typeof canvasBox) => inner !== null && outer !== null
            && inner.x >= outer.x - 0.5 && inner.y >= outer.y - 0.5 && inner.x + inner.width <= outer.x + outer.width + 0.5 && inner.y + inner.height <= outer.y + outer.height + 0.5;
        expect(inside(dialogBox, canvasBox) && inside(imageBox, dialogBox), "原图预览应整个留在画布里，图片不被裁掉").toBe(true);
        await page.keyboard.press("Escape");
        await expect(page.locator("[role='dialog']")).toHaveCount(0);
    });

    test("运行中逐步展开：思维链与工具组不用点就逐项列出（验收 22）", async ({page}) => {
        await openScene(page, "AgentConversationView", "running-live");
        await expect(stage(page).locator(".acv-steps").first()).toBeVisible();
        // 思考折叠时露出去掉 Markdown 标记的第一段（验收 30）。
        const steps = stage(page).locator(".acv-steps").first();
        await expect(steps.locator(".nb-collapsible-row__detail", {hasText: "读第六章开头"})).toBeVisible();
        expect(await steps.innerText()).not.toContain("**");
        await openScene(page, "AgentConversationView", "running");
        await expect(stage(page).locator(".acv-steps")).toHaveCount(0);
    });

    test("运行中不能补充说明与排队：回车与 Ctrl+回车都不发送，发送键禁用；登记的命令照常执行（验收 23）", async ({page}) => {
        await openScene(page, "AgentConversationView", "running-no-steer");
        const editor = stage(page).locator(".ProseMirror");
        await editor.click();
        await page.keyboard.type("加快节奏");
        await expect(page.locator("[data-composer-action='send']")).toBeDisabled();
        await page.keyboard.press("Enter");
        await page.keyboard.press("Control+Enter");
        expect((await actions(page)).some((action) => action.type === "composer.submit")).toBe(false);
        await page.keyboard.press("Control+A");
        await page.keyboard.press("Backspace");
        await page.keyboard.type("/ren");
        await expect(page.getByRole("option")).toHaveCount(1);
        await page.keyboard.press("Enter");
        await page.keyboard.type("第三章 雨夜");
        await page.keyboard.press("Enter");
        await expect.poll(() => lastAction(page)).toEqual({type: "command.run", name: "rename", argsText: "第三章 雨夜"});
    });

    test("嵌入别的页面：没有顶栏与模型下拉，答案卡片照常显示（验收 24）", async ({page}) => {
        await openScene(page, "AgentConversationView", "embedded");
        const body = stage(page);
        await expect(body.locator("[data-lab-answer]")).toHaveCount(1);
        await expect(body.getByRole("button", {name: "更多操作"})).toHaveCount(0);
        await expect(body.locator(".acv-model-picker__trigger")).toHaveCount(0);
    });

    test("结果节点：整轮收起后答案卡片仍露出，被退回的那次收在过程里；卡片里的出处与复制分别到达宿主（验收 20、21）", async ({page}) => {
        await openScene(page, "AgentConversationView", "answer");
        const body = stage(page);
        await expect(body.locator("[data-lab-answer]")).toHaveCount(1);
        await expect(body.locator("[data-lab-answer]")).toContainText("第十二下钟声");
        await expect(body.locator("[data-turn-summary]")).toHaveCount(1);
        await body.locator("[data-answer-ref]").first().click();
        await expect.poll(() => lastAction(page)).toEqual({type: "reference.open", target: "paragraph://3.4"});
        await body.locator("[data-role='assistant'] .acv-message__actions").getByRole("button", {name: "复制"}).click();
        await expect.poll(() => lastAction(page)).toEqual({type: "tool.copy", toolCallId: "w7"});
        // 展开整轮与思维链：被退回的那次是一行、写着退回原因，答案卡片仍只有一张（验收 29）。
        await body.locator("[data-turn-summary]").click();
        await body.locator("[data-chain-summary]").first().click();
        await expect(body.locator(".acv-steps")).toContainText("退回：evidence 不能为空");
        await expect(body.locator("[data-lab-answer]")).toHaveCount(1);
    });

    test("附注：整轮收起后没核实的出处仍在回复气泡里，点出处到达宿主；没登记的附注显示为淡色一行（验收 28）", async ({page}) => {
        await openScene(page, "AgentConversationView", "reply-unverified");
        const body = stage(page);
        const replies = body.locator("[data-final-reply]");
        await expect(body.locator("[data-turn-summary]").first()).toBeVisible();
        await expect(replies.first().locator("[data-lab-unverified]")).toContainText("41.20");
        await replies.first().locator("[data-unverified-ref]").click();
        await expect.poll(() => lastAction(page)).toEqual({type: "reference.open", target: "paragraph://41.20"});
        await expect(replies.last().locator("[data-annotation='nb-story.reading-position']")).toHaveText("这一轮按读到 41.30 的位置回答");
    });

    test("会话列表：点一行发 session.select，点新建发 session.create，出错时重试发 sessions.refresh（验收 26、27）", async ({page}) => {
        await openScene(page, "AgentSessionList", "list");
        const body = stage(page);
        await expect(body.locator("[data-session]")).toHaveCount(6);
        await expect(body.locator("[data-session='c-overview']")).toHaveAttribute("aria-current", "true");
        // 场景里有带提醒、没有说明、运行中与带标记的行：同一列表的行等高。
        const heights = await body.locator("[data-session]").evaluateAll((rows) => rows.map((row) => row.getBoundingClientRect().height));
        expect(new Set(heights).size).toBe(1);
        await body.locator("[data-session='c-early']").click();
        await expect.poll(() => lastAction(page)).toEqual({type: "session.select", sessionId: "c-early"});
        await body.locator("[data-session-create]").click();
        await expect.poll(() => lastAction(page)).toEqual({type: "session.create"});
        await openScene(page, "AgentSessionList", "error");
        await stage(page).locator("[data-session-retry]").click();
        await expect.poll(() => lastAction(page)).toEqual({type: "sessions.refresh"});
    });

    test("回复里 Markdown 的引用、外链与图片：分别发出 reference.open、link.open 与视图内部的原图预览请求", async ({page}) => {
        await openScene(page, "AgentMarkdown", "links");
        const body = stage(page);
        await body.locator("[data-reference-link]").first().click();
        await body.getByRole("link", {name: "排版指南"}).click();
        await body.locator("img").first().click();
        await expect.poll(async () => (await actions(page)).map((action) => action.type)).toEqual(["reference.open", "link.open", "image.preview"]);
        expect((await actions(page))[1]).toEqual({type: "link.open", href: "https://example.com/guide"});
    });

    test("英文界面：视图自己的文字（顶栏、溢出菜单）与子组件的文字都是英文", async ({page}) => {
        await openScene(page, "AgentConversationView", "english");
        const more = stage(page).getByRole("button", {name: "More actions"});
        await expect(more).toBeVisible();
        await expect(stage(page).locator("[data-turn-summary]").first()).toContainText("Process");
        await more.click();
        await expect(page.getByRole("menuitem", {name: "Raw view"})).toBeVisible();
    });

    test("没有注入渲染组件：回复按纯文字显示，输入框是普通文本框", async ({page}) => {
        await openScene(page, "AgentConversationView", "plain");
        await expect(stage(page).locator("[data-final-reply]").first()).toBeVisible();
        await expect(stage(page).locator(".nb-markdown")).toHaveCount(0);
        await expect(stage(page).locator(".plain-markdown").first()).toBeVisible();
        await expect(stage(page).locator("textarea.plain-prompt-editor")).toHaveCount(1);
        await expect(stage(page).locator(".ProseMirror")).toHaveCount(0);
    });

    test("harness 记录回放：真实 harness 的日志画成一轮，过程摘要计入两次工具调用，最终回复是 Markdown", async ({page}) => {
        await openScene(page, "AgentConversationView", "harness-replay", "1400x900");
        await expect(stage(page).locator(".acv-turn")).toHaveCount(1);
        await expect(stage(page).locator("[data-turn-summary]")).toContainText("2 次操作");
        const reply = stage(page).locator("[data-final-reply]");
        await expect(reply).toContainText("只有林默听见了第十二下钟声");
        await expect(reply.locator("strong")).toHaveText("林默");
    });

    test("思考与提醒是淡色小字：注入的 Markdown 显示也用所在位置的颜色与字号", async ({page}) => {
        await openScene(page, "AgentConversationView", "long-conversation", "1400x900");
        // 思考收在整轮、思维链与思考行三层折叠里：逐层点开，直到消息流里没有收起的项。
        const collapsed = page.locator("[data-agent-stream] [aria-expanded='false']");
        for (let round = 0; round < 40 && await collapsed.count() > 0; round += 1) await collapsed.first().evaluate((element) => (element as HTMLElement).click());
        const thinking = page.locator(".acv-thinking .nb-markdown").first();
        await expect(thinking).toBeVisible();
        const [body, muted] = await Promise.all([
            page.locator("[data-final-reply] .nb-markdown").first().evaluate((element) => {
                const style = getComputedStyle(element);
                return {color: style.color, size: style.getPropertyValue("--markdown-font-size").trim()};
            }),
            thinking.evaluate((element) => {
                const style = getComputedStyle(element);
                return {color: style.color, size: style.getPropertyValue("--markdown-font-size").trim()};
            }),
        ]);
        expect(muted.color).not.toBe(body.color);
        expect(muted.size).not.toBe(body.size);
    });

    test("步骤行在过程区里收窄到 6px 内边距，单独挂载时是缺省的 8px", async ({page}) => {
        await openScene(page, "CollapsibleRow", "plain");
        const padding = (locator: ReturnType<Page["locator"]>) => locator.evaluate((element) => getComputedStyle(element).paddingLeft);
        expect(await padding(stage(page).locator(".nb-collapsible-row__row").first())).toBe("8px");

        await openScene(page, "AgentConversationView", "running");
        const collapsed = page.locator(".acv-process [data-chain-summary][aria-expanded='false']").first();
        await collapsed.click();
        await expect(page.locator(".acv-steps .nb-collapsible-row__row").first()).toBeVisible();
        expect(await padding(page.locator(".acv-steps .nb-collapsible-row__row").first())).toBe("6px");
    });
});

test.describe("输入框", () => {
    const editor = (page: Page) => stage(page).locator(".ProseMirror");
    const cardStates = (page: Page) => stage(page).locator("[data-prompt-card-state]").evaluateAll((elements) => elements.map((element) => element.getAttribute("data-prompt-card-state") ?? ""));

    async function attach(page: Page, files: Array<{name: string; mimeType: string}>): Promise<void> {
        const chooser = page.waitForEvent("filechooser");
        await page.locator("[data-composer-action='plus']").click();
        await page.getByRole("menuitem", {name: "添加附件"}).click();
        await (await chooser).setFiles(files.map((file) => ({...file, buffer: Buffer.from("lab")})));
    }

    test("空闲：回车以 prompt 发送并由宿主清空；开头的 / 列出命令与参数提示并发出 command.run；Shift+Tab 切换模式（验收 12）", async ({page}) => {
        await openScene(page, "AgentConversationComposer", "idle");
        await editor(page).click();
        await page.keyboard.type("把第三章改紧凑");
        await page.keyboard.press("Enter");
        await expect.poll(() => lastAction(page)).toEqual({type: "composer.submit", text: "把第三章改紧凑", delivery: "prompt"});
        await expect(editor(page)).toHaveText("");

        await page.keyboard.type("/ren");
        // 菜单传送到页面上的浮层，不在舞台里。
        const options = page.getByRole("option");
        await expect(options).toHaveCount(1);
        await expect(options.first()).toContainText("/rename");
        await expect(options.first()).toContainText("新标题");
        await page.keyboard.press("Enter");
        await page.keyboard.type("第三章 雨夜");
        await page.keyboard.press("Enter");
        await expect.poll(() => lastAction(page)).toEqual({type: "command.run", name: "rename", argsText: "第三章 雨夜"});

        await page.keyboard.press("Shift+Tab");
        await expect.poll(() => lastAction(page)).toEqual({type: "mode.set", mode: "discuss"});
        await expect(page.locator("[data-composer-action='mode'].is-accent")).toHaveCount(1);
    });

    test("运行中：正文为空时是停止；回车是 steer、Ctrl+回车是 followup，两条依次进排队消息（验收 11）", async ({page}) => {
        await openScene(page, "AgentConversationComposer", "running");
        await expect(page.locator("[data-composer-action='stop']")).toHaveCount(1);
        await editor(page).click();
        await page.keyboard.type("保留雨夜那段");
        await expect(page.locator("[data-composer-action='send']")).toHaveCount(1);
        await page.keyboard.press("Enter");
        await page.keyboard.type("下一轮查错别字");
        await page.keyboard.press("Control+Enter");
        await expect.poll(async () => (await actions(page)).filter((action) => action.type === "composer.submit").map((action) => action.delivery)).toEqual(["steer", "followup"]);
        await expect.poll(() => stage(page).locator("[data-queued]").evaluateAll((elements) => elements.map((element) => element.getAttribute("data-queued")))).toEqual(["steer", "followup"]);
        await page.locator("[data-composer-action='stop']").click();
        await expect.poll(async () => (await lastAction(page))?.type).toBe("composer.stop");
    });

    test("停止的第二个选项（验收 39）：Tab 从停止键到下拉箭头，回车打开、回车选“停止并清空排队”，发出 clearQueue、焦点回编辑器；点停止键本身不带", async ({page}) => {
        await openScene(page, "AgentConversationComposer", "stop-menu");
        const more = stage(page).locator("[data-composer-action='stop-more']");
        await stage(page).locator("[data-composer-action='stop']").focus();
        await page.keyboard.press("Tab");
        await expect(more).toBeFocused();
        await page.keyboard.press("Enter");
        await expect(more).toHaveAttribute("aria-expanded", "true");
        await expect(page.getByRole("menuitem", {name: "停止并清空排队（2 条）"})).toBeVisible();
        await page.keyboard.press("Enter");
        await expect.poll(() => lastAction(page)).toEqual({type: "composer.stop", clearQueue: true});
        await expect(editor(page)).toBeFocused();
        // Lab 的宿主停下就收口运行，停止键随之消失：重开场景。点菜单外面的按钮关上时不抢焦点，焦点在被点的按钮上。
        await openScene(page, "AgentConversationComposer", "stop-menu");
        await stage(page).locator("[data-composer-action='stop-more']").click();
        await expect(page.getByRole("menuitem", {name: "停止并清空排队（2 条）"})).toBeVisible();
        // 点的是输入框之外的按钮（夹具的“下次上传失败”）。
        const outside = page.locator("[data-lab-action='fail-upload']");
        await outside.click();
        await expect(page.getByRole("menuitem")).toHaveCount(0);
        // 编辑器的聚焦会晚一帧：等两帧再看焦点仍在被点的按钮上。
        await frames(page);
        await expect(outside).toBeFocused();
        await stage(page).locator("[data-composer-action='stop']").click();
        await expect.poll(() => lastAction(page)).toEqual({type: "composer.stop"});
    });

    test("留着的话（验收 38）：390 宽英文场景里原因先截断、Continue 完整；点 Continue 发 run.continue", async ({page}) => {
        await openScene(page, "AgentConversationView", "held-english");
        const head = stage(page).locator("[data-queued-head]");
        await expect(head).toContainText("3 paused");
        const reason = await head.locator(".acv-queued__head-reason").evaluate((element) => ({scroll: element.scrollWidth, client: element.clientWidth}));
        expect(reason.scroll).toBeGreaterThan(reason.client);
        const box = await head.boundingBox();
        const button = await head.locator("[data-queued-continue]").boundingBox();
        expect(button!.x + button!.width).toBeLessThanOrEqual(box!.x + box!.width + TOLERANCE_PX);
        expect(await head.locator("[data-queued-continue]").evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
        await expect(stage(page).locator("li[data-queued][data-held='true']")).toHaveCount(3);
        await head.locator("[data-queued-continue]").click();
        await expect.poll(() => lastAction(page)).toEqual({type: "run.continue"});
    });

    test("附件：模型不支持图片时也能加（发送时换一行字，conversation.md 输出 31）；上传中与失败时不能发送；重试后就绪，发送的文字里有图片标签", async ({page}) => {
        await openScene(page, "AgentConversationComposer", "no-images");
        await attach(page, [{name: "草图.png", mimeType: "image/png"}, {name: "设定.txt", mimeType: "text/plain"}]);
        await expect(stage(page).locator("[role='status']").filter({hasText: "不支持图片"})).toHaveCount(0);
        await expect.poll(async () => (await cardStates(page)).length).toBe(2);

        await openScene(page, "AgentConversationComposer", "idle");
        await labAction(page, "fail-upload");
        await editor(page).click();
        await page.keyboard.type("看图");
        await attach(page, [{name: "草图.png", mimeType: "image/png"}]);
        const send = page.locator("[data-composer-action='send']");
        await expect(send).toBeDisabled();
        await expect(send).toHaveAttribute("title", /上传/u);
        await page.keyboard.press("Enter");
        expect((await actions(page)).some((action) => action.type === "composer.submit")).toBe(false);
        await expect.poll(() => cardStates(page)).toEqual(["failed"]);
        await expect(send).toHaveAttribute("title", /失败/u);
        await stage(page).locator("[data-prompt-card-action='retry']").click();
        await expect.poll(() => cardStates(page)).toEqual(["ready"]);
        await expect(send).toBeEnabled();
        await editor(page).click();
        await page.keyboard.press("End");
        await page.keyboard.press("Enter");
        await expect.poll(async () => String((await lastAction(page))?.text ?? "")).toMatch(/!\[image #1\]\(session:\/\/attachments\/.+\)/u);
    });

    test("展开：输入框长高，回车换行、Ctrl+回车发送；模型下拉发出 model.set", async ({page}) => {
        await openScene(page, "AgentConversationComposer", "idle", "free");
        const composer = page.locator("[data-agent-composer]");
        const before = (await composer.boundingBox())!.height;
        await page.locator("[data-composer-action='expand']").click();
        await expect.poll(async () => (await composer.boundingBox())!.height).toBeGreaterThan(before * 2);
        await page.keyboard.type("第一行");
        await page.keyboard.press("Enter");
        await page.keyboard.type("第二行");
        expect((await actions(page)).some((action) => action.type === "composer.submit")).toBe(false);
        await page.keyboard.press("Control+Enter");
        await expect.poll(() => lastAction(page)).toEqual({type: "composer.submit", text: "第一行\n第二行", delivery: "prompt"});

        await page.locator("[data-model-picker]").click();
        await page.getByRole("menuitemradio", {name: "DeepSeek Chat"}).click();
        await expect.poll(() => lastAction(page)).toEqual({type: "model.set", modelKey: "deepseek-chat"});
    });

    test("角色模型选择器：窄面板与英文下面板、分段与说明没有横向溢出，触发器的长名字被省略、档位留着；选档、回到跟随在 Lab 里来回", async ({page}) => {
        for (const scene of ["narrow", "narrow-long-names", "english-narrow-seven", "wide"]) {
            await openScene(page, "AgentRoleModelPicker", scene);
            await page.locator("[data-model-picker]").click();
            const panel = page.locator("[data-model-picker-panel]");
            await expect(panel).toBeVisible();
            // 面板内容与分段组都不超出面板：溢出会被面板裁掉，看不见的只有量得出。
            const overflow = await panel.evaluate((element) => {
                const box = element.getBoundingClientRect();
                const outside = [...element.querySelectorAll<HTMLElement>("*")].filter((child) => {
                    const rect = child.getBoundingClientRect();
                    return rect.width > 0 && (rect.right > box.right + 1 || rect.left < box.left - 1);
                });
                return {scroll: element.scrollWidth - element.clientWidth, outside: outside.slice(0, 3).map((child) => child.className || child.tagName)};
            });
            expect(overflow, scene).toEqual({scroll: 0, outside: []});
            await page.keyboard.press("Escape");
        }

        // 长名字：触发器里省略名字与模型，档位留着。
        await openScene(page, "AgentRoleModelPicker", "narrow-long-names");
        const trigger = page.locator("[data-model-picker]");
        const ellipsis = await trigger.locator(".acv-role-picker__name").evaluate((element) => ({clipped: element.scrollWidth > element.clientWidth, overflow: getComputedStyle(element).textOverflow}));
        expect(ellipsis).toEqual({clipped: true, overflow: "ellipsis"});
        await expect(trigger.locator(".acv-role-picker__level")).toBeVisible();

        // 选档：停在选的档上（Lab 里没有服务端，场景自己回写），“用默认”回到跟随。
        await openScene(page, "AgentRoleModelPicker", "role");
        await page.locator("[data-model-picker]").click();
        const radios = page.locator("[data-model-picker-thinking] button[role='radio']");
        await radios.nth(1).click();
        await expect(radios.nth(1)).toHaveAttribute("aria-checked", "true");
        // test-lint-allow fixed-wait: 断言“选了不会自己弹回”：控件的放手计时器是 1.5 秒（THINKING_RELEASE_MS），只有等过它才看得出弹没弹回
        await page.waitForTimeout(1_800);
        await expect(radios.nth(1)).toHaveAttribute("aria-checked", "true");
        await page.locator("[data-model-picker-reset]").click();
        await expect(page.locator("[data-model-picker-effort-note]")).toContainText("跟随");
    });

    test("只读：编辑器只读，添加附件、发送、模式与模型都不可用", async ({page}) => {
        await openScene(page, "AgentConversationComposer", "readonly");
        await expect(editor(page)).toHaveAttribute("aria-readonly", "true");
        for (const action of ["plus", "send", "mode"]) await expect(page.locator(`[data-composer-action='${action}']`)).toBeDisabled();
        await expect(page.locator("[data-model-picker]")).toBeDisabled();
    });

    test("没有注入编辑器：普通文本框，没有添加附件；登记的 /命令 照常执行", async ({page}) => {
        await openScene(page, "AgentConversationComposer", "plain");
        await expect(editor(page)).toHaveCount(0);
        await page.locator("[data-composer-action='plus']").click();
        await expect(page.getByRole("menuitem", {name: "添加附件"})).toHaveCount(0);
        await page.keyboard.press("Escape");
        const textarea = stage(page).locator("textarea");
        await expect(textarea).toHaveValue("/rename 雨夜");
        await textarea.focus();
        await page.keyboard.press("Enter");
        await expect.poll(() => lastAction(page)).toEqual({type: "command.run", name: "rename", argsText: "雨夜"});
    });
});

test.describe("向导与状态栏（docs/specs/agent/conversation.md 输出 10–15）", () => {
    const box = async (page: Page, selector: string) => (await page.locator(selector).first().boundingBox())!;

    test("向导贴在消息流底部，不盖最后一条；往上滚时浮在内容上；最高占视图的 60%", async ({page}) => {
        await openScene(page, "AgentConversationView", "approval-long", "tablet");
        const wizard = page.locator("[data-agent-wizard]");
        await expect(wizard).toBeVisible();
        const stream = await box(page, "[data-agent-stream]");
        expect(await wizard.locator(".acv-wizard-frame").evaluate((element) => element.getBoundingClientRect().height)).toBeLessThanOrEqual(stream.height * 0.6 + TOLERANCE_PX);
        // 贴底：最后一条在向导上方。
        await scrollStreamTo(page, 1_000_000);
        const covered = await page.evaluate(() => {
            const content = document.querySelector(".acv-stream__content")!;
            const wizardTop = document.querySelector("[data-agent-wizard]")!.getBoundingClientRect().top;
            const siblings = [...content.children].filter((element) => !element.hasAttribute("data-agent-wizard"));
            return siblings.at(-1)!.getBoundingClientRect().bottom - wizardTop;
        });
        expect(covered).toBeLessThanOrEqual(TOLERANCE_PX);
        // 往上滚：还在视图底部，内容从它后面过去。
        const bottom = (await wizard.boundingBox())!;
        await scrollStreamTo(page, 0);
        const scrolled = (await wizard.boundingBox())!;
        expect(Math.abs(scrolled.y + scrolled.height - (bottom.y + bottom.height))).toBeLessThanOrEqual(TOLERANCE_PX);
    });

    test("等用户时输入框隐藏、不能操作，但草稿还在；焦点在向导容器，不在批准按钮", async ({page}) => {
        await openScene(page, "AgentConversationView", "approval-edit");
        await expect(page.locator("[data-agent-composer]")).toBeHidden();
        await expect(page.locator("[data-agent-composer]")).toHaveAttribute("inert", "");
        const focused = await page.evaluate(() => document.activeElement?.hasAttribute("data-agent-wizard") ?? false);
        expect(focused).toBe(true);
    });

    test("收起成小条，没有批准按钮；Esc 不提交；用 action 提交一个事项一条", async ({page}) => {
        await openScene(page, "AgentConversationView", "approval-batch");
        await page.locator("[data-approval-decision='allow']").click();
        await expect(page.locator("[data-wizard-count]")).toHaveText("第 2 / 3 个");
        await page.keyboard.press("Escape");
        await expect(page.locator("[data-wizard-collapsed]")).toBeVisible();
        await expect(page.locator("[data-approval-decision='allow']")).toHaveCount(0);
        await expect(page.locator("[data-wizard-expand]")).toBeFocused();
        expect((await actions(page)).filter((action) => action.type === "input.submit")).toEqual([]);
        await page.locator("[data-wizard-expand]").click();
        await expect(page.locator("[data-wizard-count]")).toHaveText("第 2 / 3 个");
    });

    test("提问：选项、其它、表单都能填；表单不对不能提交", async ({page}) => {
        await openScene(page, "AgentConversationView", "ask-form");
        const submit = page.locator("[data-question-submit]");
        await expect(submit).toBeDisabled();
        await page.getByRole("textbox", {name: "名字"}).fill("苏晴");
        await page.getByRole("textbox", {name: "名字"}).blur();
        // 必填的年龄还没填：表单不对。
        await expect(submit).toBeDisabled();
        await page.getByRole("textbox", {name: "年龄"}).fill("27");
        await page.getByRole("textbox", {name: "年龄"}).blur();
        await expect(submit).toBeEnabled();
        await submit.click();
        const sent = (await actions(page)).find((action) => action.type === "input.submit") as {resolutions: {answer: {data: {answers: {form: unknown}[]}}}};
        expect(sent.resolutions.answer.data.answers[0]!.form).toMatchObject({name: "苏晴", age: 27});
    });

    test("继续按钮和发送按钮一样大，图标在按钮正中；写了字变回发送", async ({page}) => {
        await openScene(page, "AgentConversationView", "host-resume");
        const button = page.locator("[data-composer-action='resume']");
        await expect(button).toBeVisible();
        const geometry = await button.evaluate((element) => {
            const outer = element.getBoundingClientRect();
            const icon = element.querySelector("span, svg")!.getBoundingClientRect();
            return {width: outer.width, height: outer.height, dx: Math.abs(outer.left + outer.width / 2 - (icon.left + icon.width / 2)), dy: Math.abs(outer.top + outer.height / 2 - (icon.top + icon.height / 2)), iconWidth: icon.width};
        });
        expect(geometry.iconWidth).toBeGreaterThan(8);
        expect(geometry.dx).toBeLessThanOrEqual(0.5);
        expect(geometry.dy).toBeLessThanOrEqual(0.5);
        await button.click();
        expect(await lastAction(page)).toEqual({type: "run.continue"});
        await page.getByRole("textbox", {name: "消息输入框"}).click();
        await page.keyboard.type("再写点");
        await expect(page.locator("[data-composer-action='send']")).toBeVisible();
    });

    for (const [viewport, name] of [["phone", "窄屏"], ["desktop", "宽屏"]] as const) {
        test(`${name}：气泡、输入框、向导的左右边界对齐，滚动条不占宽度`, async ({page}) => {
            await openScene(page, "AgentConversationView", "idle-host", viewport);
            const stream = await box(page, "[data-agent-stream]");
            const composer = await box(page, ".acv-composer__frame");
            const width = await page.locator(".acv-stream__content").evaluate((element) => element.getBoundingClientRect().width);
            // 滚动条是叠加的，不占宽度：内容只比消息流少左右各 12 的边距。
            expect(Math.abs(width - (stream.width - 24))).toBeLessThanOrEqual(TOLERANCE_PX);
            const left = stream.x + 12;
            const right = stream.x + stream.width - 12;
            if (stream.width <= 824) {
                expect(Math.abs(composer.x - left)).toBeLessThanOrEqual(TOLERANCE_PX);
                expect(Math.abs(composer.x + composer.width - right)).toBeLessThanOrEqual(TOLERANCE_PX);
            }
        });
    }
});

test.describe("状态栏的可选项（docs/specs/agent/conversation.md 输出 45）", () => {
    const item = (page: Page, id: string) => page.locator(`[data-agent-status] [data-status-item="${id}"]`);
    const box = async (page: Page, selector: string) => (await page.locator(selector).first().boundingBox())!;

    test("缺省：右边用量与费用；设置打开模型与插件的项、改了次序后按设置排", async ({page}) => {
        await openScene(page, "AgentStatusBar", "idle");
        await expect(item(page, "usage")).toBeVisible();
        await expect(item(page, "cost")).toBeVisible();
        await expect(item(page, "model")).toHaveCount(0);

        await openScene(page, "AgentStatusBar", "model-and-plugin");
        const order = await page.locator("[data-status-right] [data-status-item]").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-status-item")));
        expect(order).toEqual(["model", "cost", "usage"]);
        await expect(item(page, "lab.words")).toBeVisible();
    });

    test("窄（280px）：右边从前往后收进“…”，费用最后收；收起的不占位也看不见；悬停写收起的项", async ({page}) => {
        await openScene(page, "AgentStatusBar", "narrow", "desktop");
        await expect(page.locator("[data-status-more]")).toBeVisible();
        await expect(item(page, "cost")).toBeVisible();
        await expect(item(page, "model")).toBeHidden();
        await expect(item(page, "usage")).toBeHidden();
        const bar = await box(page, "[data-agent-status]");
        const cost = await box(page, "[data-status-item='cost']");
        expect(cost.x + cost.width).toBeLessThanOrEqual(bar.x + bar.width + TOLERANCE_PX);
        await page.locator("[data-status-more]").hover();
        await expect(page.locator(".nb-ui-tooltip-surface")).toContainText("Claude Sonnet");
    });

    test("用量换到左边：画在上下文后面、提醒前面", async ({page}) => {
        await openScene(page, "AgentStatusBar", "left-usage", "desktop");
        const left = await page.locator("[data-agent-status] .acv-status__left [data-status-item]").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-status-item")));
        expect(left).toEqual(["context", "usage"]);
        const usage = await box(page, "[data-status-item='usage']");
        const reminder = await box(page, "[data-status-phase]");
        expect(usage.x + usage.width).toBeLessThanOrEqual(reminder.x);
    });

    test("窄（280px）且用量在左边：右边收完再收左边的用量；提醒完整，上下文留着；悬停按呈现顺序写收起的项", async ({page}) => {
        await openScene(page, "AgentStatusBar", "narrow-left-usage", "desktop");
        await expect(page.locator("[data-status-more]")).toBeVisible();
        await expect(item(page, "context")).toBeVisible();
        await expect(item(page, "usage")).toBeHidden();
        await expect(item(page, "cost")).toBeHidden();
        await expect(item(page, "model")).toBeHidden();
        const bar = await box(page, "[data-agent-status]");
        const reminder = await box(page, "[data-status-phase]");
        expect(reminder.x + reminder.width).toBeLessThanOrEqual(bar.x + bar.width + TOLERANCE_PX);
        await expect(page.locator("[data-status-phase]")).toHaveText("等你回答");
        await page.locator("[data-status-more]").hover();
        await expect(page.locator(".nb-ui-tooltip-surface")).toContainText(/^162\.4k · .*\$0\.07 · Claude Sonnet/u);
    });

    test("右键弹勾选菜单，勾一项发 statusLine.toggle，最后一项发 statusLine.openSettings", async ({page}) => {
        await openScene(page, "AgentConversationView", "status-line");
        await page.locator("[data-agent-status]").click({button: "right", position: {x: 20, y: 10}});
        await expect(page.getByRole("menuitemcheckbox", {name: "用量与缓存命中"})).toBeVisible();
        await page.getByRole("menuitemcheckbox", {name: "用量与缓存命中"}).click();
        expect(await lastAction(page)).toEqual({type: "statusLine.toggle", id: "usage"});
        await page.locator("[data-agent-status]").click({button: "right", position: {x: 20, y: 10}});
        await page.getByRole("menuitem", {name: "状态栏设置…"}).click();
        expect(await lastAction(page)).toEqual({type: "statusLine.openSettings"});
    });
});

test.describe("状态栏设置页（docs/specs/agent/conversation.md 输出 46）", () => {
    const rows = (page: Page, side: "left" | "right") => page.locator(`[data-sortable-section='${side}'] [data-status-row]`).evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-status-row")));
    const previewIn = (page: Page, side: "left" | "right") => page.locator(`[data-status-line-preview] .acv-status__${side} [data-status-item]`).evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-status-item")));
    /** 在一行的标题上按下，竖直挪 `dy`（分多步，每步都过会话的帧合并），松手。 */
    async function dragRow(page: Page, id: string, dy: number): Promise<void> {
        const box = (await page.locator(`[data-status-row='${id}']`).boundingBox())!;
        const x = box.x + 60;
        const y = box.y + 10;
        await page.mouse.move(x, y);
        await page.mouse.down();
        await page.mouse.move(x, y + Math.sign(dy) * 8, {steps: 2});
        await page.mouse.move(x, y + dy, {steps: 12});
        await page.mouse.up();
    }

    test("缺省：左右两组按目录次序；预览与列表一致；左边第一项不能上移、右边最后一项不能下移", async ({page}) => {
        await openScene(page, "StatusLinePage", "default");
        expect(await rows(page, "left")).toEqual(["context"]);
        expect(await rows(page, "right")).toEqual(["usage", "cost", "model"]);
        await expect(page.locator("[data-status-row='context'] [data-status-move-up]")).toBeDisabled();
        await expect(page.locator("[data-status-row='usage'] [data-status-move-up]")).toBeEnabled();
        await expect(page.locator("[data-status-row='model'] [data-status-move-down]")).toBeDisabled();
        await expect(page.locator("[data-status-line-preview] [data-status-item='usage']")).toBeVisible();
        await expect(page.locator("[data-status-line-preview] [data-status-item='model']")).toHaveCount(0);
    });

    test("改过的设置：次序按设置排，插件的项带“插件”标记、预览里画着", async ({page}) => {
        await openScene(page, "StatusLinePage", "customized");
        expect(await rows(page, "right")).toEqual(["cost", "usage", "model"]);
        expect(await rows(page, "left")).toEqual(["context", "x.words"]);
        await expect(page.locator("[data-status-row='x.words']")).toContainText("插件");
        await expect(page.locator("[data-status-line-preview] [data-status-item='x.words']")).toBeVisible();
    });

    test("配置写不了：勾选、上移下移与拖动把手都停用", async ({page}) => {
        await openScene(page, "StatusLinePage", "readonly");
        await expect(page.locator("[data-status-row='cost'] [data-status-move-down]")).toBeDisabled();
        await expect(page.locator("[data-status-row='cost'] input[type='checkbox'], [data-status-row='cost'] [role='checkbox']").first()).toBeDisabled();
        await expect(page.locator("[data-sortable-key='cost'] [data-sortable-handle]")).toBeDisabled();
    });

    test("拖到另一组：用量拖到左边第一位，写完后两组与预览都跟着变；没有落点线", async ({page}) => {
        await openScene(page, "StatusLinePage", "default", "desktop");
        const from = (await page.locator("[data-status-row='usage']").boundingBox())!;
        const to = (await page.locator("[data-status-row='context']").boundingBox())!;
        await dragRow(page, "usage", to.y - from.y - 8);
        await expect.poll(() => rows(page, "left")).toEqual(["usage", "context"]);
        expect(await rows(page, "right")).toEqual(["cost", "model"]);
        await expect.poll(() => previewIn(page, "left")).toEqual(["usage", "context"]);
        await expect(page.locator(".is-over, .is-over-after")).toHaveCount(0);
    });

    test("左边唯一的一项慢慢拖过右边的分区头：左边只换一次，不来回跳", async ({page}) => {
        await openScene(page, "StatusLinePage", "default", "desktop");
        // 记下拖动中左边出现过的每一种样子（MutationObserver 每次改动都记），之后去掉连续重复的。
        await page.evaluate(() => {
            const list = document.querySelector("[data-sortable-list]")!;
            const seen: string[] = [];
            (window as unknown as {__left: string[]}).__left = seen;
            new MutationObserver(() => {
                seen.push([...list.querySelectorAll("[data-sortable-section='left'][data-sortable-key]")].map((element) => element.getAttribute("data-sortable-key")).join(","));
            }).observe(list, {childList: true, subtree: true});
        });
        const from = (await page.locator("[data-status-row='context']").boundingBox())!;
        const head = (await page.locator("[data-sortable-head][data-sortable-section='right']").boundingBox())!;
        const x = from.x + 60;
        const y = from.y + 10;
        await page.mouse.move(x, y);
        await page.mouse.down();
        // 一像素一步，从行上到分区头下面 30px：途中正好扫过换边的那一带。
        const distance = Math.round(head.y + head.height + 30 - y);
        for (let step = 1; step <= distance; step += 1) await page.mouse.move(x, y + step);
        await expect.poll(() => rows(page, "left")).toEqual([]);
        expect(await rows(page, "right")).toContain("context");
        const left = await page.evaluate(() => (window as unknown as {__left: string[]}).__left.filter((entry, index, all) => index === 0 || entry !== all[index - 1]));
        // 换到右边以后（左边空了），左边再没出现过“上下文”：没有来回跳。
        expect(left).toContain("");
        expect(left.slice(left.indexOf(""))).toEqual([""]);
        await page.keyboard.press("Escape");
        await page.mouse.up();
        await expect.poll(() => rows(page, "left")).toEqual(["context"]);
    });

    test("上移跨组：右边第一项上移到左边最后；左边第一项不能上移", async ({page}) => {
        await openScene(page, "StatusLinePage", "default", "desktop");
        await expect(page.locator("[data-status-row='context'] [data-status-move-up]")).toBeDisabled();
        await page.locator("[data-status-row='usage'] [data-status-move-up]").click();
        await expect.poll(() => rows(page, "left")).toEqual(["context", "usage"]);
        expect(await rows(page, "right")).toEqual(["cost", "model"]);
    });

    test("换过边的设置：两组与预览按设置画", async ({page}) => {
        await openScene(page, "StatusLinePage", "crossed", "desktop");
        expect(await rows(page, "left")).toEqual(["usage"]);
        expect(await rows(page, "right")).toEqual(["cost", "model", "context"]);
        await expect.poll(() => previewIn(page, "left")).toEqual(["usage"]);
    });

    test("写入失败：拖动中两组跟着变，放下后回到原样", async ({page}) => {
        await openScene(page, "StatusLinePage", "write-fails", "desktop");
        const from = (await page.locator("[data-status-row='usage']").boundingBox())!;
        const to = (await page.locator("[data-status-row='context']").boundingBox())!;
        const x = from.x + 60;
        const y = from.y + 10;
        await page.mouse.move(x, y);
        await page.mouse.down();
        await page.mouse.move(x, y - 8, {steps: 2});
        await page.mouse.move(x, y + to.y - from.y - 8, {steps: 12});
        // 先确认真的拖起来了，再看放下后回原样：没拿起时“回到原样”也成立，证明不了什么。
        await expect.poll(() => rows(page, "left")).toEqual(["usage", "context"]);
        await page.mouse.up();
        await expect.poll(() => rows(page, "left")).toEqual(["context"]);
        expect(await rows(page, "right")).toEqual(["usage", "cost", "model"]);
    });
});

/*
 * 文字选择（docs/specs/runtime/browser-host.md 输出 12 的“文字选择”）：桌面壳在 `<html>` 上设 `data-desktop-frame`，根上默认不可选；
 * 对话里的内容由组件自己声明可选。判法同 text-selection.e2e.ts：把含某段文案的文本节点整个选中，读 `Selection.toString()`（不可选的读出空串）。
 */
test.describe("桌面壳里的文字选择", () => {
    test.beforeEach(async ({page}) => {
        await page.addInitScript(() => {
            const mark = (): boolean => document.documentElement !== null && (document.documentElement.setAttribute("data-desktop-frame", ""), true);
            if (!mark()) {
                const observer = new MutationObserver(() => void (mark() && observer.disconnect()));
                observer.observe(document, {childList: true});
            }
        });
    });

    /** 区域里第一个含 `needle` 的文本节点整个选中后能复制走的文字；没有这样的节点时是 `null`。 */
    const copyable = (page: Page, selector: string, needle: string): Promise<string | null> => page.locator(selector).first().evaluate((root, wanted) => {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
            if (!(node.textContent ?? "").includes(wanted)) continue;
            const selection = getSelection()!;
            selection.setBaseAndExtent(node, 0, node, node.textContent!.length);
            const text = selection.toString();
            selection.removeAllRanges();
            return text;
        }
        return null;
    }, needle);

    test("消息流里的回复可选", async ({page}) => {
        await openScene(page, "AgentConversationView", "answer");
        await expect(page.locator("html")).toHaveAttribute("data-desktop-frame", "");
        await expect(stage(page).locator("[data-lab-answer]")).toContainText("第十二下钟声");
        expect(await copyable(page, ".lab-main [data-agent-stream]", "第十二下钟声")).toContain("第十二下钟声");
        // 消息流里的折叠标题是按钮：继承不到消息流的可选。
        const summary = stage(page).locator("[data-turn-summary]").first();
        const label = await summary.evaluate((element) => {
            const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
            for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) if ((node.textContent ?? "").trim() !== "") return node.textContent!.trim();
            return "";
        });
        expect(label).not.toBe("");
        expect(await copyable(page, ".lab-main [data-turn-summary]", label)).toBe("");
    });

    test("停靠区里的审批向导（在消息流之外）：要改的路径与正文里的改动可选，标题不可选", async ({page}) => {
        await openScene(page, "AgentDock", "approval");
        const frame = stage(page).locator(".acv-wizard-frame").first();
        await expect(frame.locator(".acv-wizard-frame__body")).toContainText("他回头看了一眼");
        // diff 按词拆成几个文本节点，判新增的那一段。
        expect(await copyable(page, ".lab-main .acv-wizard-frame__body", "看了一眼")).toBe("看了一眼");
        expect(await copyable(page, ".lab-main .acv-wizard-frame__detail", "第三章")).toContain("第三章");
        const title = (await frame.locator(".acv-wizard-frame__title").innerText()).trim();
        expect(title).not.toBe("");
        expect(await copyable(page, ".lab-main .acv-wizard-frame__title", title)).toBe("");
    });
});

/**
 * “消息”视图外框的分栏（AgentMessages.md 的“拖宽度”）：列表栏与聊天区之间是 nb-layout 的分隔线。拖动要真实的布局与指针，happy-dom 给不出。
 */
test.describe("消息视图的分栏", () => {
    const separator = (page: Page) => stage(page).getByRole("separator");
    const listPanel = (page: Page) => stage(page).locator("[data-messages-list-panel]");
    const strip = (page: Page) => stage(page).locator("[data-messages-strip]");
    const widthOf = async (page: Page, selector: string) => stage(page).locator(selector).evaluate((element) => (element as HTMLElement).offsetWidth);

    /** 按住分隔线横着拖 `dx` 像素再松手。 */
    async function dragSeparator(page: Page, dx: number): Promise<void> {
        const box = (await separator(page).boundingBox())!;
        const x = box.x + box.width / 2;
        const y = box.y + box.height / 2;
        await page.mouse.move(x, y);
        await page.mouse.down();
        await page.mouse.move(x + dx, y, {steps: 8});
        await page.mouse.up();
        await frames(page);
    }

    test("宽版：拖线改列表栏的宽度，收起再展开还是拖出来的宽度", async ({page}) => {
        await openScene(page, "AgentMessages", "wide", "900x560");
        await expect(listPanel(page)).toBeVisible();
        expect(await widthOf(page, "[data-messages-list-panel]")).toBe(260);

        await dragSeparator(page, 60);
        expect(Math.abs(await widthOf(page, "[data-messages-list-panel]") - 320)).toBeLessThanOrEqual(TOLERANCE_PX);

        // 宽度交回了宿主：收起、展开都会按宿主给的宽度重新分配，没交回就回到 260。
        await stage(page).locator("[data-messages-collapse]").click();
        await expect(strip(page)).toBeVisible();
        await stage(page).locator("[data-messages-toggle]").click();
        await expect(listPanel(page)).toBeVisible();
        await expect.poll(async () => Math.abs(await widthOf(page, "[data-messages-list-panel]") - 320)).toBeLessThanOrEqual(TOLERANCE_PX);
    });

    test("宽版：拖到最小宽度以内再过门槛收成头像列，往外拖展开；键盘左右键改宽度", async ({page}) => {
        await openScene(page, "AgentMessages", "wide", "900x560");
        // 260 往里拖 130：到 130，小于 200 - 40。
        await dragSeparator(page, -130);
        await expect(strip(page)).toBeVisible();
        await expect(listPanel(page)).toBeHidden();
        expect(await widthOf(page, "[data-messages-strip]")).toBe(52);

        // 收着时往外拖过门槛就展开，展开后不小于最小宽度。
        await dragSeparator(page, 170);
        await expect(listPanel(page)).toBeVisible();
        await expect(strip(page)).toBeHidden();
        const expanded = await widthOf(page, "[data-messages-list-panel]");
        expect(expanded).toBeGreaterThanOrEqual(200);

        await separator(page).focus();
        await page.keyboard.press("ArrowRight");
        await frames(page);
        expect(await widthOf(page, "[data-messages-list-panel]")).toBe(expanded + 10);
    });

    test("宽版收着时：按住线往外拖过门槛再拖回门槛内，不松手时就回到头像列；焦点在线上按 Enter 展开、再按收起", async ({page}) => {
        await openScene(page, "AgentMessages", "wide-collapsed", "900x560");
        await expect(strip(page)).toBeVisible();
        const box = (await separator(page).boundingBox())!;
        const x = box.x + box.width / 2;
        const y = box.y + box.height / 2;
        await page.mouse.move(x, y);
        await page.mouse.down();
        await page.mouse.move(x + 180, y, {steps: 8});
        await expect(listPanel(page)).toBeVisible();
        await expect(strip(page)).toBeHidden();
        // 拖回门槛内：面板回到头像列的宽度，画的也要换回头像列（列表不能挤在 52 像素里）。
        await page.mouse.move(x + 10, y, {steps: 8});
        await expect(strip(page)).toBeVisible();
        await expect(listPanel(page)).toBeHidden();
        await page.mouse.up();
        await frames(page);
        await expect(strip(page)).toBeVisible();

        await separator(page).focus();
        await page.keyboard.press("Enter");
        await expect(listPanel(page)).toBeVisible();
        await expect.poll(async () => widthOf(page, "[data-messages-list-panel]")).toBe(260);
        await expect(separator(page)).toBeFocused();
        await page.keyboard.press("Enter");
        await expect(strip(page)).toBeVisible();
        await expect(listPanel(page)).toBeHidden();
    });

    test("宽版英文、列表栏最窄：切换行的标签不压到收起按钮", async ({page}) => {
        await openScene(page, "AgentMessages", "wide-narrowest-english", "900x560");
        const tab = (await stage(page).locator("[data-messages-tab='sessions']").boundingBox())!;
        const collapse = (await stage(page).locator("[data-messages-collapse]").boundingBox())!;
        expect(tab.x + tab.width).toBeLessThanOrEqual(collapse.x);
    });

    test("窄版：抽屉从头像列伸出来压在聊天区上，行点得到；线拖不动", async ({page}) => {
        await openScene(page, "AgentMessages", "narrow-drawer", "900x560");
        await expect(listPanel(page)).toBeVisible();
        const drawer = (await listPanel(page).boundingBox())!;
        const rail = (await strip(page).boundingBox())!;
        expect(drawer.x).toBeGreaterThanOrEqual(rail.x + rail.width - TOLERANCE_PX);
        expect(drawer.width).toBeGreaterThan(200);
        // 抽屉真的画在聊天区上面：行中心最上面的元素就是这一行。不靠 click 判断：抽屉被 52 像素的那块面板裁掉时，
        // click 会先把行滚进那块面板再点，照样点得到。
        const row = stage(page).locator("[data-messages-contact='nbook.bots/vega']");
        expect(await row.evaluate((element) => {
            const box = element.getBoundingClientRect();
            const top = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
            return top !== null && element.contains(top);
        })).toBe(true);
        await row.click();
        await expect(page.locator('[data-lab-panel="events"] .nb-lab-event-chip', {hasText: "open-contact"})).toHaveCount(1);

        await dragSeparator(page, 80);
        expect(await widthOf(page, "[data-messages-strip]")).toBe(52);
        await expect(separator(page)).toHaveAttribute("aria-disabled", "true");
    });
});
