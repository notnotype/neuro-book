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
        await page.locator("[data-composer-action='attach']").click();
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

    test("附件：模型不支持图片时拒收并说明；上传中与失败时不能发送；重试后就绪，发送的文字里有图片标签", async ({page}) => {
        await openScene(page, "AgentConversationComposer", "no-images");
        await attach(page, [{name: "草图.png", mimeType: "image/png"}, {name: "设定.txt", mimeType: "text/plain"}]);
        await expect(stage(page).locator("[role='status']").filter({hasText: "不支持图片"})).toBeVisible();
        await expect.poll(() => cardStates(page)).toEqual(["ready"]);

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

    test("只读：编辑器只读，添加附件、发送、模式与模型都不可用", async ({page}) => {
        await openScene(page, "AgentConversationComposer", "readonly");
        await expect(editor(page)).toHaveAttribute("aria-readonly", "true");
        for (const action of ["attach", "send", "mode"]) await expect(page.locator(`[data-composer-action='${action}']`)).toBeDisabled();
        await expect(page.locator("[data-model-picker]")).toBeDisabled();
    });

    test("没有注入编辑器：普通文本框，没有添加附件；登记的 /命令 照常执行", async ({page}) => {
        await openScene(page, "AgentConversationComposer", "plain");
        await expect(editor(page)).toHaveCount(0);
        await expect(page.locator("[data-composer-action='attach']")).toHaveCount(0);
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
