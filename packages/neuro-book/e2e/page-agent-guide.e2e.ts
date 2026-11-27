/**
 * Agent 引导界面（`ui.highlight`）在真实 Chrome 里的验收（docs/specs/agent/page-agent.md 验收 1、3 的高亮部分、6、7、10，
 * docs/specs/agent/profile-settings.md 输出 28、29）：生产构建的后端与前端，模型是 Bun 子进程里的本机端点。
 * 判据取页面上与模型请求里能观察到的东西：说明框与描边框（引擎节点的 `data-nb-page-agent`）、页面控件的状态、eval 交给模型的输出。
 *
 * `ui.highlight` 会一直等到用户动作：用例在 eval 跑着时操作页面。想让高亮在“弹层已经打开、量好了之前的样子”之后才装上，
 * 就让代码先轮询窗口标题等一个暗号（`GATE`），用例设了标题，高亮才开始。
 */

import {readFile, readdir} from "node:fs/promises";
import {join} from "node:path";

import {expect, test} from "@playwright/test";
import type {Locator, Page} from "@playwright/test";
import {parse as parseJsonc} from "jsonc-parser";

import {HEIGHT, WIDTH, composer, expectGuideRemoved, guidePart, newSession, openConversation, startEval, startLab} from "./support/page-agent-world";
import type {AgentLab, AgentWorld} from "./support/page-agent-world";

let lab: AgentLab;
/** 询问模式：eval 要在向导里批准。 */
let asking: AgentWorld;
/** eval 由规则放行：用例里没有审批点击。 */
let auto: AgentWorld;

test.beforeAll(async () => {
    lab = await startLab("page-agent-guide");
    asking = await lab.startWorld("asking");
    auto = await lab.startWorld("auto", {allowEval: true});
});

test.afterAll(async () => {
    await lab.stop();
});

test.beforeEach(async ({page}) => {
    // 上一个用例停掉的那一轮没用上的脚本回复，不留给这一个用例。
    await lab.control("/reset", {});
    await page.setViewportSize({width: WIDTH, height: HEIGHT});
});

/** 代码里先等用例把窗口标题改成暗号，再往下做：用例借此决定高亮从哪一刻开始。 */
const GATE = `
for (let waited = 0; waited < 600; waited += 1) {
    const s = await ui.snapshot({maxTokens: 300});
    if (s.window.title === "GATE") break;
    await new Promise((resolve) => setTimeout(resolve, 100));
}`;

const openGate = (page: Page) => page.evaluate(() => {
    document.title = "GATE";
});

/** 说明框当前显示的目标：引擎在说明框上写的 `target:key` 或引用。 */
const calloutTarget = (page: Page) => guidePart(page, "callout").getAttribute("data-nb-page-agent-target");

/** 后端的会话日志（`session.jsonl`）全文：嵌套调用的结局记在这里。 */
async function sessionLogs(world: AgentWorld): Promise<string> {
    const root = join(world.stateRoot, "agent", "sessions");
    const parts: string[] = [];
    for (const name of await readdir(root).catch(() => [] as string[])) parts.push(await readFile(join(root, name, "session.jsonl"), "utf8").catch(() => ""));
    return parts.join("\n");
}

/** 开一个会话，并让模型下一次调 eval（审批与否看后端）。 */
async function ready(page: Page, world: AgentWorld): Promise<void> {
    await openConversation(page, world);
    await newSession(page);
}

// ---------- 验收 1 ----------

test("验收 1：ui.find 找“主题”，按路径逐步 ui.highlight、真实点击推进；中间一步点“上一步”退回前一步；最后一步点“完成”；全程 eval 只审批一次", async ({page}) => {
    await ready(page, asking);
    // 向导里出现过几张审批卡：数“允许”按钮出现的次数。
    await page.evaluate(() => {
        const seen = {count: 0};
        (window as unknown as {approvals: typeof seen}).approvals = seen;
        new MutationObserver((records) => {
            for (const record of records) for (const node of record.addedNodes) {
                if (node instanceof Element && (node.matches("[data-approval-decision='allow']") || node.querySelector("[data-approval-decision='allow']") !== null)) seen.count += 1;
            }
        }).observe(document.body, {subtree: true, childList: true});
    });
    // 路径的三步是：活动栏的设置项（点）、设置窗口的“外观”节（点）、主题那一行（下一步）；在“点”与“下一步”之间插一步看“层”的切换，
    // 它要按“下一步”、可以“上一步”退回去重新点“外观”。
    const run = await startEval(page, lab, "带用户去改主题", `
const found = await ui.find({query: "主题", kind: "setting"});
const path = found.entries[0].path;
const steps = [
    {at: path[0].at, message: "先打开设置。", until: "click"},
    {at: path[1].at, message: "进入“外观”。", until: "click"},
    {at: {target: "settings.layers"}, message: "这里切换设置的层。", until: "next", back: true},
    {at: path[2].at, message: "主题在这一行。", until: "next"},
];
const log = [];
let index = 0;
while (index < steps.length) {
    const result = await ui.highlight({...steps[index], step: index + 1, total: steps.length});
    log.push(String(index) + ":" + result.outcome);
    if (result.outcome === "back") { index -= 1; continue; }
    if (result.outcome !== "clicked" && result.outcome !== "next") break;
    index += 1;
}
return JSON.stringify({entries: found.entries.length, log});`, {approve: true});

    // 第 1 步：高亮的是活动栏的设置项。
    await expect(guidePart(page, "callout")).toContainText("先打开设置。");
    await expect(guidePart(page, "callout")).toContainText("第 1 步，共 4 步");
    expect(await calloutTarget(page)).toBe("workbench.activity:nbook.settings");
    await expect(guidePart(page, "next")).toHaveCount(0);
    await page.locator("[data-nb-target='workbench.activity'][data-nb-key='nbook.settings']").click();

    // 第 2 步：设置窗口里的“外观”节。
    await expect(guidePart(page, "callout")).toContainText("进入“外观”。");
    expect(await calloutTarget(page)).toBe("settings.section:nbook.appearance");
    await page.locator("[data-nb-target='settings.section'][data-nb-key='nbook.appearance']").click();

    // 第 3 步：层切换，按“下一步”的步骤；点“上一步”，代码退回第 2 步重新高亮“外观”。
    await expect(guidePart(page, "callout")).toContainText("这里切换设置的层。");
    await expect(guidePart(page, "next")).toHaveText("下一步");
    await guidePart(page, "back").click();
    await expect(guidePart(page, "callout")).toContainText("进入“外观”。");
    await expect(guidePart(page, "callout")).toContainText("第 2 步，共 4 步");
    expect(await calloutTarget(page)).toBe("settings.section:nbook.appearance");
    await page.locator("[data-nb-target='settings.section'][data-nb-key='nbook.appearance']").click();
    await expect(guidePart(page, "callout")).toContainText("这里切换设置的层。");
    await guidePart(page, "next").click();

    // 第 4 步：主题那一行，最后一步写“完成”。
    await expect(guidePart(page, "callout")).toContainText("主题在这一行。");
    // 设置行本身不可交互，高亮落到它唯一的可交互后代（主题的下拉）：描边框在这一行里面。
    const row = (await page.locator("[data-nb-target='settings.row'][data-nb-key='nbook.workbench/theme']").boundingBox())!;
    const outline = (await guidePart(page, "outline").boundingBox())!;
    expect(outline.x).toBeGreaterThanOrEqual(row.x - 8);
    expect(outline.y).toBeGreaterThanOrEqual(row.y - 8);
    expect(outline.x + outline.width).toBeLessThanOrEqual(row.x + row.width + 8);
    expect(outline.y + outline.height).toBeLessThanOrEqual(row.y + row.height + 8);
    await expect(guidePart(page, "next")).toHaveText("完成");
    await guidePart(page, "next").click();

    const result = JSON.parse(await run.result()) as {entries: number; log: string[]};
    expect(result.log).toEqual(["0:clicked", "1:clicked", "2:back", "1:clicked", "2:next", "3:next"]);
    await expectGuideRemoved(page);
    expect(await page.evaluate(() => (window as unknown as {approvals: {count: number}}).approvals.count)).toBe(1);
    await expect(page.locator("[data-agent-wizard]")).toHaveCount(0);
});

// ---------- 验收 3（高亮部分）、7 ----------

test("验收 3（高亮部分）：高亮等待中刷新窗口，结局是 window-gone；刷新后页面上没有残留的描边框与说明框", async ({page}) => {
    await ready(page, auto);
    const run = await startEval(page, lab, "刷新时的高亮", `
const result = await ui.highlight({at: {target: "workbench.activity", key: "nbook.settings"}, message: "等你点。", until: "click"});
return JSON.stringify({outcome: result.outcome});`);
    await expect(guidePart(page, "callout")).toContainText("等你点。");
    await page.reload();
    await expect(page.locator("[data-explorer-row]").first()).toBeVisible();
    expect(JSON.parse(await run.result())).toEqual({outcome: "window-gone"});
    await expectGuideRemoved(page);
    await expect(guidePart(page, "outline")).toHaveCount(0);
    await expect(guidePart(page, "callout")).toHaveCount(0);
});

test("验收 7：高亮等待中停止 eval，日志里结局为 cancelled、页面上没有描边框与说明框；等用户的时间不计入单元时限", async ({page}) => {
    await ready(page, auto);
    // 对照：时限 2 秒的单元自己睡 3.5 秒会超时，说明下面“等了更久却没超时”是等用户不计时、不是时限没起作用。
    const control = await startEval(page, lab, "时限对照", "await new Promise((resolve) => setTimeout(resolve, 3500)); return 'done';", {timeout: 2});
    expect(await control.result()).toContain("超过 2 秒的时限");

    // 等用户不计时：时限 4 秒，说明框停留超过它，之后点“下一步”，eval 照常结束、没有超时。
    const waited = await startEval(page, lab, "等用户不计时", `
const started = Date.now();
const result = await ui.highlight({at: {target: "workbench.activity", key: "nbook.settings"}, message: "慢慢看。", until: "next"});
return JSON.stringify({outcome: result.outcome, seconds: (Date.now() - started) / 1000});`, {timeout: 4});
    await expect(guidePart(page, "callout")).toContainText("慢慢看。");
    // 只能等一段真实时间：没有“时限没起作用”的可观察状态，对照用例已证明时限确实会在 2 秒到点。
    const since = await page.evaluate(() => performance.now());
    await page.waitForFunction((from) => performance.now() > from + 6000, since);
    await expect(guidePart(page, "callout")).toBeVisible();
    await guidePart(page, "next").click();
    const output = await waited.result();
    // 对照那一格超时重置了内核，重置的提示会带进下一格的输出前面；这一格自己的结果在最后一行。
    const done = JSON.parse(output.split("\n").at(-1)!) as {outcome: string; seconds: number};
    expect(output).not.toContain("超过 4 秒");
    expect(done.outcome).toBe("next");
    expect(done.seconds).toBeGreaterThan(5);
    await expectGuideRemoved(page);

    // 停止：对话的停止键。等“下一步”的高亮，免得点停止键本身被算成点错而先结束。
    await startEval(page, lab, "停止时的高亮", `
const result = await ui.highlight({at: {target: "workbench.activity", key: "nbook.settings"}, message: "马上停止。", until: "next"});
return JSON.stringify({outcome: result.outcome});`);
    await expect(guidePart(page, "callout")).toContainText("马上停止。");
    await page.locator("[data-composer-action='stop']").click();
    await expectGuideRemoved(page);
    await expect(guidePart(page, "outline")).toHaveCount(0);
    await expect(guidePart(page, "callout")).toHaveCount(0);
    await expect(page.locator("[data-composer-action='stop']")).toHaveCount(0);
    // 代码已随单元结束，结局只记在日志里：嵌套调用的结果行。
    await expect.poll(async () => (await sessionLogs(auto)).split("\n").some((line) => line.includes("nestedToolResult") && line.includes("马上停止") && line.includes("\"preview\":\"结局：cancelled\""))).toBe(true);
});

// ---------- 验收 6：真实弹层 ----------

/** 一个弹层的“前后”快照：那一层根元素的高度与最后一项的计算样式（说明框挂进根元素的第一个位置，不应改动它们）。 */
async function measureLayer(root: Locator, itemSelector: string): Promise<{height: number; lastItem: Record<string, string>}> {
    // 指针放到同一个角上再量：滚动条的颜色随指针悬停在祖先上而变（nb-ui 的细滚动条），点过说明框之后指针可能正停在这一层上。
    await root.page().mouse.move(1, 1);
    return root.evaluate((element, selector) => {
        const items = element.querySelectorAll(selector);
        const last = items[items.length - 1]!;
        const computed = getComputedStyle(last);
        return {height: element.getBoundingClientRect().height, lastItem: Object.fromEntries([...computed].map((name) => [name, computed.getPropertyValue(name)]))};
    }, itemSelector);
}

/** 说明框的宿主此刻挂在哪个元素里（只看没在淡出的）。 */
const hostParent = (page: Page) => page.evaluateHandle(() => document.querySelector("[data-nb-page-agent=guide]:not([data-closing])")?.parentElement ?? null);

/** 当前焦点元素的样子：标签、角色、文字与值，用来比“焦点没被说明框拿走”。 */
const focusOf = (page: Page) => page.evaluate(() => {
    const active = document.activeElement as HTMLElement | null;
    return active === null ? null : `${active.localName}|${active.getAttribute("role") ?? ""}|${active.getAttribute("aria-label") ?? ""}|${(active.textContent ?? "").slice(0, 20)}|${active instanceof HTMLInputElement ? active.value : ""}`;
});

interface LayerCase {
    readonly name: string;
    open(page: Page): Promise<void>;
    root(page: Page): Locator;
    readonly itemSelector: string;
    /** 高亮的目标（`ui.highlight` 的 `at`）。 */
    readonly at: string;
    /** 弹层里“高亮项”与取值的外显状态：点下一步、打字、按方向键与 Enter 之后都不变。 */
    state(page: Page): Promise<unknown>;
    /** 键盘事件漏给页面时会发生的事（命令被执行等）：没发生时为真。 */
    untouched(page: Page): Promise<boolean>;
    /** 对照：说明框撤掉之后，同样的按键能让弹层动起来（证明上面“没变”不是按键本来就没用）。 */
    keyMoves(page: Page): Promise<boolean>;
}

const LAYERS: readonly LayerCase[] = [
    {
        name: "命令面板",
        async open(page) {
            await page.keyboard.press("Control+Shift+P");
            await page.keyboard.type("打开设置");
            await expect(page.getByRole("option", {name: /^打开设置/u})).toBeVisible();
            await page.evaluate(() => {
                const field = document.querySelector("[role=dialog][aria-label='命令面板'] input, [role=dialog] [role=combobox]") as HTMLInputElement;
                field.setSelectionRange(1, 3);
            });
        },
        // 命令面板是对话框里的一个列表；目标所在的层是这个列表（快照的层表头也是“dialog > listbox”）。
        root: (page) => page.getByRole("listbox", {name: "命令面板"}),
        itemSelector: "[role=option]",
        at: `{role: "option", name: "打开设置"}`,
        state: (page) => page.evaluate(() => {
            const field = document.querySelector("[role=dialog] [role=combobox]") as HTMLInputElement;
            return {value: field.value, selection: [field.selectionStart, field.selectionEnd], selected: document.querySelector("[role=option][aria-selected=true]")?.textContent ?? null, options: document.querySelectorAll("[role=option]").length};
        }),
        untouched: async (page) => await page.locator("[data-settings-window]").count() === 0,
        keyMoves: async (page) => {
            await page.keyboard.press("ArrowDown");
            return await page.evaluate(() => !document.querySelector("[role=option][aria-selected=true]")?.textContent?.startsWith("打开设置"));
        },
    },
    {
        name: "下拉（设置里主题的选择）",
        async open(page) {
            await page.keyboard.press("Control+,");
            await expect(page.locator("[data-settings-window]")).toBeVisible();
            await page.getByRole("combobox", {name: "主题"}).click();
            await expect(page.getByRole("listbox")).toBeVisible();
            await page.keyboard.press("ArrowDown");
        },
        root: (page) => page.getByRole("listbox"),
        itemSelector: "[role=option]",
        at: `{role: "option", name: "护眼绿"}`,
        state: (page) => page.evaluate(() => ({highlighted: document.querySelector("[role=listbox] [data-highlighted]")?.textContent ?? null, trigger: document.querySelector("[role=combobox][aria-label='主题'], [role=combobox]")?.textContent ?? null, open: document.querySelector("[role=listbox]") !== null})),
        untouched: async (page) => await page.getByRole("listbox").count() === 1,
        keyMoves: async (page) => {
            const before = await page.evaluate(() => document.querySelector("[role=listbox] [data-highlighted]")?.textContent ?? null);
            await page.keyboard.press("ArrowDown");
            return await page.evaluate((from) => document.querySelector("[role=listbox] [data-highlighted]")?.textContent !== from, before);
        },
    },
    {
        name: "下拉菜单（审批模式）",
        async open(page) {
            await page.getByRole("button", {name: /审批模式/u}).click();
            await expect(page.getByRole("menu")).toBeVisible();
            await page.keyboard.press("ArrowDown");
        },
        root: (page) => page.getByRole("menu"),
        itemSelector: "[role=menuitemradio]",
        at: `{role: "menuitemradio", name: "放行写入"}`,
        state: (page) => page.evaluate(() => ({highlighted: document.querySelector("[role=menu] [data-highlighted]")?.textContent ?? null, checked: document.querySelector("[role=menuitemradio][aria-checked=true]")?.textContent ?? null, mode: [...document.querySelectorAll("button")].find((b) => b.getAttribute("aria-label")?.startsWith("审批模式"))?.getAttribute("aria-label") ?? null})),
        untouched: async (page) => await page.getByRole("button", {name: "审批模式：每次询问"}).count() === 1,
        keyMoves: async (page) => {
            const before = await page.evaluate(() => document.querySelector("[role=menu] [data-highlighted]")?.textContent ?? null);
            await page.keyboard.press("ArrowDown");
            return await page.evaluate((from) => document.querySelector("[role=menu] [data-highlighted]")?.textContent !== from, before);
        },
    },
];

for (const layer of LAYERS) {
    test(`验收 6（${layer.name}）：高亮其中一项，点“下一步”不关弹层；提问框里打字、按方向键与 Enter，弹层的高亮项不变、没有命令执行、页面的焦点与选区不变；说明框不改那一层的高度与最后一项的样式`, async ({page}) => {
        await ready(page, auto);
        const run = await startEval(page, lab, `高亮${layer.name}`, `${GATE}
const out = [];
const first = await ui.highlight({at: ${layer.at}, message: "第一步看这一项。", until: "next", step: 1, total: 2});
out.push(first.outcome);
const second = await ui.highlight({at: ${layer.at}, message: "第二步还是这一项。", until: "next", step: 2, total: 2});
out.push(second.outcome + (second.question === undefined ? "" : ":" + second.question));
return JSON.stringify(out);`, {timeout: 120});

        await layer.open(page);
        const root = layer.root(page);
        const before = await measureLayer(root, layer.itemSelector);
        const stateBefore = await layer.state(page);
        const focusBefore = await focusOf(page);
        await openGate(page);

        // 第一步：说明框挂进这一层的根元素里，那一层的高度与最后一项的样式不变。
        await expect(guidePart(page, "callout")).toContainText("第一步看这一项。");
        expect(await (await hostParent(page)).evaluate((parent, rootElement) => parent === rootElement, await root.elementHandle())).toBe(true);
        expect(await measureLayer(root, layer.itemSelector)).toEqual(before);
        expect(await layer.state(page)).toEqual(stateBefore);

        // 点“下一步”不关掉弹层。
        await guidePart(page, "next").click();
        await expect(guidePart(page, "callout")).toContainText("第二步还是这一项。");
        await expect(root).toBeVisible();
        expect(await layer.state(page)).toEqual(stateBefore);
        expect(await measureLayer(root, layer.itemSelector)).toEqual(before);

        // 提问框：空着按 Enter 不提交；打字、方向键、Home、End 都留在提问框里。
        await guidePart(page, "ask-open").click();
        await expect(guidePart(page, "callout")).toHaveAttribute("data-asking", "");
        for (const key of ["ArrowDown", "ArrowDown", "ArrowUp", "Home", "End", "Enter"]) await page.keyboard.press(key);
        await page.keyboard.type("qwe");
        for (const key of ["ArrowDown", "ArrowUp"]) await page.keyboard.press(key);
        await expect(guidePart(page, "ask")).toHaveValue("qwe");
        // 焦点在提问框里时，菜单与下拉按自己的规矩收起项上的“高亮”标记（失去焦点）；不会变成别的项。
        const duringAsk = await layer.state(page) as {highlighted?: string | null};
        const expectedHighlight = (stateBefore as {highlighted?: string | null}).highlighted;
        if (expectedHighlight !== undefined) expect([expectedHighlight, null]).toContain(duringAsk.highlighted);
        expect({...duringAsk, highlighted: undefined}).toEqual({...(stateBefore as object), highlighted: undefined});
        expect(await layer.untouched(page)).toBe(true);
        await expect(root).toBeVisible();

        // Esc 清空、收起、回到原来的焦点，不关弹层。
        await page.keyboard.press("Escape");
        await expect(guidePart(page, "callout")).not.toHaveAttribute("data-asking", "");
        await expect(root).toBeVisible();
        expect(await focusOf(page)).toBe(focusBefore);
        expect(await layer.state(page)).toEqual(stateBefore);

        // 再问一次，Enter 提交：结局是 asked，弹层与焦点都还在原处。
        await guidePart(page, "ask-open").click();
        await page.keyboard.type("这一项是干什么的");
        await page.keyboard.press("Enter");
        expect(JSON.parse(await run.result())).toEqual(["next", "asked:这一项是干什么的"]);
        await expectGuideRemoved(page);
        await expect(root).toBeVisible();
        expect(await focusOf(page)).toBe(focusBefore);
        expect(await layer.state(page)).toEqual(stateBefore);
        expect(await layer.untouched(page)).toBe(true);
        expect(await measureLayer(root, layer.itemSelector)).toEqual(before);
        // 对照：说明框撤掉之后，同样的按键能让弹层动起来。
        expect(await layer.keyMoves(page)).toBe(true);
    });
}

test("验收 6（弹层之外的控件）：高亮弹层之外的控件后关掉弹层，说明框与描边框仍然可见", async ({page}) => {
    await ready(page, auto);
    const run = await startEval(page, lab, "高亮弹层外的控件", `${GATE}
const result = await ui.highlight({at: {target: "workbench.activity", key: "nbook.settings"}, message: "这个按钮在弹层外面。", until: "next"});
return JSON.stringify({outcome: result.outcome});`, {timeout: 120});
    await page.getByRole("button", {name: /审批模式/u}).click();
    await expect(page.getByRole("menu")).toBeVisible();
    await openGate(page);
    await expect(guidePart(page, "callout")).toContainText("这个按钮在弹层外面。");
    expect(await calloutTarget(page)).toBe("workbench.activity:nbook.settings");
    // 先量一次：说明框此刻不在菜单里面（目标在菜单之外）。
    expect(await (await hostParent(page)).evaluate((parent) => parent !== null && parent.closest("[role=menu]") === null)).toBe(true);

    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0);
    await expect(guidePart(page, "callout")).toBeVisible();
    await expect(guidePart(page, "callout")).toContainText("这个按钮在弹层外面。");
    await expect(guidePart(page, "outline")).toBeVisible();
    // 说明框还能用：点“下一步”，eval 结束。
    await guidePart(page, "next").click();
    expect(JSON.parse(await run.result())).toEqual({outcome: "next"});
    await expectGuideRemoved(page);
});

test("验收 6（设置窗口）：高亮设置窗口里的一项前后，窗口根元素的高度与最后一个按钮的计算样式不变", async ({page}) => {
    await ready(page, auto);
    const run = await startEval(page, lab, "高亮设置窗口里的一项", `${GATE}
const result = await ui.highlight({at: {target: "settings.section", key: "nbook.explorer"}, message: "看这一节。", until: "next"});
return JSON.stringify({outcome: result.outcome});`, {timeout: 120});
    await page.keyboard.press("Control+,");
    await expect(page.locator("[data-settings-window]")).toBeVisible();
    const root = page.getByRole("dialog", {name: "设置"});
    const before = await measureLayer(root, "button");
    await openGate(page);
    await expect(guidePart(page, "callout")).toContainText("看这一节。");
    expect(await (await hostParent(page)).evaluate((parent, rootElement) => parent === rootElement, await root.elementHandle())).toBe(true);
    expect(await measureLayer(root, "button")).toEqual(before);
    await guidePart(page, "next").click();
    expect(JSON.parse(await run.result())).toEqual({outcome: "next"});
    await expectGuideRemoved(page);
    expect(await measureLayer(root, "button")).toEqual(before);
});

// ---------- 验收 10：压暗 ----------

/** 视口里一个像素的 RGB：截一像素的图，再在页面里画到画布上读出来。 */
async function pixel(page: Page, x: number, y: number): Promise<[number, number, number]> {
    const png = await page.screenshot({clip: {x, y, width: 1, height: 1}});
    return page.evaluate(async (base64) => {
        const image = new Image();
        image.src = `data:image/png;base64,${base64}`;
        await image.decode();
        const canvas = document.createElement("canvas");
        canvas.width = 1;
        canvas.height = 1;
        const context = canvas.getContext("2d")!;
        context.drawImage(image, 0, 0);
        const [r, g, b] = context.getImageData(0, 0, 1, 1).data;
        return [r!, g!, b!] as [number, number, number];
    }, png.toString("base64"));
}

const luminance = ([r, g, b]: readonly [number, number, number]) => 0.299 * r + 0.587 * g + 0.114 * b;

/** 一个元素里靠右下角、不压文字的一点（取点要避开会随状态变的内容：它在测前后都是同一个背景）。 */
async function cornerOf(locator: Locator): Promise<readonly [number, number]> {
    const box = (await locator.boundingBox())!;
    return [Math.round(box.x + box.width - 6), Math.round(box.y + box.height - 6)];
}

test("验收 10（活动栏）：带 dim 高亮活动栏的一项，目标与说明框不暗、其余压暗；点侧栏里的另一个控件它照常响应，结局为 missed，没有残留的压暗", async ({page}) => {
    await page.emulateMedia({reducedMotion: "reduce"});
    await ready(page, auto);
    const run = await startEval(page, lab, "压暗活动栏", `${GATE}
const result = await ui.highlight({at: {target: "workbench.activity", key: "nbook.settings"}, message: "点这里。", until: "click", dim: true});
return JSON.stringify({outcome: result.outcome, clicked: result.clicked});`, {timeout: 120});

    const editor = page.getByRole("region", {name: "编辑器"}).first();
    const far = await cornerOf(editor);
    const targetBox = (await page.locator("[data-nb-target='workbench.activity'][data-nb-key='nbook.settings']").boundingBox())!;
    const targetPoint = [Math.round(targetBox.x + targetBox.width / 2), Math.round(targetBox.y + targetBox.height / 2)] as const;
    const plain = {far: await pixel(page, ...far), target: await pixel(page, ...targetPoint)};
    await openGate(page);
    await expect(guidePart(page, "callout")).toContainText("点这里。");
    const callout = (await guidePart(page, "callout").boundingBox())!;
    const calloutPoint = [Math.round(callout.x + callout.width - 6), Math.round(callout.y + callout.height / 2)] as const;
    // 说明框要比被压暗的背景亮出一截（它自己不暗）。
    const dimmed = {far: await pixel(page, ...far), target: await pixel(page, ...targetPoint), callout: await pixel(page, ...calloutPoint)};
    // Spec 只说“压暗”，没给力度；取亮度至少降 20（约 8%）为“看得出变暗”，实测降约 33。
    expect(luminance(dimmed.far)).toBeLessThan(luminance(plain.far) - 20);
    expect(Math.abs(luminance(dimmed.target) - luminance(plain.target))).toBeLessThan(8);
    expect(luminance(dimmed.callout)).toBeGreaterThan(luminance(dimmed.far) + 20);

    // 点侧栏里的另一个控件：照常响应（它变成按下），结局 missed，带上被点的元素。
    const other = page.locator("[data-nb-target='workbench.container'][data-nb-key='view:nbook.canon.entries']");
    await expect(other).not.toHaveAttribute("aria-pressed", "true");
    await other.click();
    await expect(other).toHaveAttribute("aria-pressed", "true");
    const result = JSON.parse(await run.result()) as {outcome: string; clicked: unknown};
    expect(result.outcome).toBe("missed");
    expect(JSON.stringify(result.clicked)).toContain("设定");
    await expectGuideRemoved(page);
    expect(Math.abs(luminance(await pixel(page, ...far)) - luminance(plain.far))).toBeLessThan(4);
});

test("验收 10（下拉）：在打开的下拉里带 dim 高亮一项，下拉的其它项也压暗，目标项不暗", async ({page}) => {
    await page.emulateMedia({reducedMotion: "reduce"});
    await ready(page, auto);
    const run = await startEval(page, lab, "压暗下拉的一项", `${GATE}
const result = await ui.highlight({at: {role: "option", name: "护眼绿"}, message: "选这个。", until: "next", dim: true});
return JSON.stringify({outcome: result.outcome});`, {timeout: 120});
    await page.keyboard.press("Control+,");
    await expect(page.locator("[data-settings-window]")).toBeVisible();
    await page.getByRole("combobox", {name: "主题"}).click();
    const listbox = page.getByRole("listbox");
    await expect(listbox).toBeVisible();
    // 鼠标挪开：悬停会改项的底色，量前后要同一个状态。
    await page.mouse.move(4, 4);
    const options = listbox.getByRole("option");
    const target = options.filter({hasText: "护眼绿"});
    const other = options.filter({hasNotText: "护眼绿"}).last();
    const otherPoint = await cornerOf(other);
    const targetPoint = await cornerOf(target);
    const plain = {other: await pixel(page, ...otherPoint), target: await pixel(page, ...targetPoint)};
    await openGate(page);
    await expect(guidePart(page, "callout")).toContainText("选这个。");
    const dimmed = {other: await pixel(page, ...otherPoint), target: await pixel(page, ...targetPoint)};
    expect(luminance(dimmed.other)).toBeLessThan(luminance(plain.other) - 20);
    expect(Math.abs(luminance(dimmed.target) - luminance(plain.target))).toBeLessThan(8);
    await guidePart(page, "next").click();
    expect(JSON.parse(await run.result())).toEqual({outcome: "next"});
    await expectGuideRemoved(page);
    await expect(listbox).toBeVisible();
    expect(Math.abs(luminance(await pixel(page, ...otherPoint)) - luminance(plain.other))).toBeLessThan(4);
});

// ---------- 验收 9：后台与 bot 的会话没有 ui ----------

/** 最近一次“以工具结果结尾”的请求里 eval 的说明：模型这一轮看到的 eval 说明。 */
async function lastEvalDescription(): Promise<string> {
    const request = (await lab.requests()).findLast((item) => item.messages.at(-1)?.role === "tool");
    return request?.descriptions["eval"] ?? "";
}

test("验收 9：前台会话的 eval 说明列 ui、typeof ui 为 object；bot 归属的会话里说明不列 ui、typeof ui 为 undefined", async ({page}) => {
    await ready(page, auto);
    const code = `return JSON.stringify({type: typeof ui});`;
    // 对照：前台会话有 ui（没有这一步，下面的“没有”可能只是 eval 的说明与对象本来就不带）。
    const foreground = await startEval(page, lab, "前台看 ui", code);
    expect(JSON.parse(await foreground.result())).toEqual({type: "object"});
    const foregroundDescription = await lastEvalDescription();
    expect(foregroundDescription).toContain("`ui`");

    // bot 归属的会话（会话头的 owner）：点联系人星璃，同一个输入框发给她。
    await page.getByRole("navigation", {name: "联系人与最近会话"}).getByRole("button", {name: "星璃"}).click();
    await expect(composer(page)).toBeVisible();
    const bot = await startEval(page, lab, "bot 看 ui", code);
    expect(JSON.parse(await bot.result())).toEqual({type: "undefined"});
    const botDescription = await lastEvalDescription();
    expect(botDescription).not.toBe(foregroundDescription);
    expect(botDescription).not.toContain("`ui`");
    // eval 工具本身还在：bot 的说明不是空的。
    expect(botDescription.length).toBeGreaterThan(100);
});

// ---------- Profile 设置页：全局对象一行（profile-settings.md 输出 28、29） ----------

interface ToolBinding {
    added?: string[];
    removed?: string[];
    objects?: {added?: string[]; removed?: string[]};
}

const bindingsOf = async (world: AgentWorld) => (parseJsonc(await readFile(join(world.stateRoot, "settings.json"), "utf8")) as Record<string, Record<string, ToolBinding> | undefined>)["nbook.agent/toolBindings"] ?? {};

/** 打开作品和设置窗口的 Profile 分区。 */
async function openProfiles(page: Page, world: AgentWorld): Promise<void> {
    await page.goto(new URL("/?project=book", world.server.url).href);
    await expect(page.locator("[data-explorer-row]").first()).toBeVisible();
    await expect(async () => {
        await page.keyboard.press("Control+,");
        await expect(page.locator("[data-settings-nav-current]")).toBeFocused({timeout: 500});
    }).toPass();
    await page.locator("[data-settings-window]").getByRole("button", {name: "Profile", exact: true}).click();
    await expect(page.locator("[data-profile-rail-item='nbook.agent.main']")).toBeVisible();
}

/** 工具一节写的“开着 N 个”，与这一节里实际列出的行数（一个对象一行）。 */
const toolCount = (page: Page) => page.evaluate(() => {
    const label = [...document.querySelectorAll("*")].find((node) => node.children.length === 0 && /^开着 \d+ 个$/u.test(node.textContent ?? ""));
    if (label === undefined) throw new Error("没有找到“开着 N 个”");
    let section: Element | null = label;
    while (section !== null && section.querySelector("[data-profile-tool]") === null) section = section.parentElement;
    if (section === null) throw new Error("“开着 N 个”所在的一节里没有工具行");
    return {shown: Number(/\d+/u.exec(label.textContent!)![0]), rows: section.querySelectorAll("[data-profile-tool]").length};
});

test("Profile 设置页输出 28、29：ui 是一行、等级写执行、悬停列方法、开着 N 个按对象算；去掉写 objects.removed，在对话框里加回", async ({page}) => {
    const world = await lab.startWorld("profile-ui");
    await openProfiles(page, world);
    const row = page.locator("[data-profile-tool-object='ui']");
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("执行");
    // 没有警示：Profile 的工具里有 eval。
    await expect(row.locator("[class*='triangle-alert']")).toHaveCount(0);
    // 悬停说明：对象的界面说明，加每个方法与等级。
    await row.locator("[data-grace-area-trigger]").first().hover();
    await expect(page.getByText(/方法：ui\.find/u).first()).toBeVisible();
    const tip = page.locator("[role=tooltip]").filter({hasText: "ui.highlight"}).first();
    await expect(tip).toContainText("看懂并引导界面");
    for (const method of ["ui.find：读", "ui.highlight：读", "ui.screenshot：执行", "ui.snapshot：读"]) await expect(tip).toContainText(method);
    await page.mouse.move(2, 2);

    // 计数按对象算：显示的数等于列出的行数，去掉 ui 少 1 而不是少 4（它有 4 个方法）。
    const before = await toolCount(page);
    expect(before.shown).toBe(before.rows);
    await row.locator("[data-profile-tool-remove]").click();
    await expect(row).toHaveCount(0);
    await expect.poll(async () => (await bindingsOf(world))["nbook.agent.main"]?.objects?.removed).toEqual(["ui"]);
    const removed = await toolCount(page);
    expect(removed.shown).toBe(before.shown - 1);
    expect(removed.rows).toBe(before.rows - 1);

    // 对话框里加回：从 objects.removed 里删掉，行回来。
    await page.locator("[data-profile-tools-add]").first().click();
    const dialog = page.locator("[data-profile-add-tools]");
    await expect(dialog.locator("[data-add-tool='object:ui']")).toBeVisible();
    await dialog.locator("[data-add-tool='object:ui'] [data-add-tool-toggle]").click();
    await dialog.getByRole("button", {name: "完成"}).click();
    await expect(row).toHaveCount(1);
    await expect.poll(async () => (await bindingsOf(world))["nbook.agent.main"]?.objects?.removed ?? []).toEqual([]);
    expect((await toolCount(page)).shown).toBe(before.shown);
});

test("Profile 设置页输出 28：Profile 的工具里没有 eval 时 ui 这一行照样列出，说明是“要先加入 eval 才用得上”并带警示图标", async ({page}) => {
    const world = await lab.startWorld("profile-no-eval");
    await openProfiles(page, world);
    // 对照：默认的 Profile 有 eval，ui 这一行没有警示。
    await expect(page.locator("[data-profile-tool-object='ui']")).not.toContainText("要先加入 eval");
    // 新建的用户 Profile 只有读、grep、glob，没有 eval。
    await page.locator("[data-profile-create]").click();
    await page.locator("[data-profile-new] input").fill("no-eval");
    await page.getByRole("button", {name: "新建并打开"}).click();
    await expect(page.locator("[data-profile-detail='user.no-eval']")).toBeVisible();
    await expect(page.locator("[data-profile-tool='nbook.agent.eval']")).toHaveCount(0);
    const row = page.locator("[data-profile-tool-object='ui']");
    await expect(row).toHaveCount(1);
    await expect(row).toContainText("要先加入 eval 才用得上");
    await expect(row.locator("[class*='triangle-alert']")).toHaveCount(1);
});

test("Profile 设置页输出 29：声明了 defaultTools: false 的 Profile 本来没有 ui，行不列；对话框里加入时写 objects.added", async ({page}) => {
    // 内置的临时帮手声明了 defaultTools: false（用户级 Profile 没有这个声明）。
    const world = await lab.startWorld("profile-no-default-tools");
    await openProfiles(page, world);
    await page.locator("[data-profile-rail-item='nbook.agent.adhoc']").click();
    await expect(page.locator("[data-profile-detail='nbook.agent.adhoc']")).toBeVisible();
    // 对照：这一节确实列着它的工具，“没有 ui 行”不是整节没画出来。
    await expect(page.locator("[data-profile-tool='nbook.agent.read']")).toHaveCount(1);
    const row = page.locator("[data-profile-tool-object='ui']");
    await expect(row).toHaveCount(0);
    await page.locator("[data-profile-tools-add]").first().click();
    const dialog = page.locator("[data-profile-add-tools]");
    await dialog.locator("[data-add-tool='object:ui'] [data-add-tool-toggle]").click();
    await dialog.getByRole("button", {name: "完成"}).click();
    await expect(row).toHaveCount(1);
    await expect.poll(async () => (await bindingsOf(world))["nbook.agent.adhoc"]?.objects).toEqual({added: ["ui"], removed: []});
});

test("Profile 设置页输出 29：动对象行时，这个对象的方法在 removed 里的旧条目一并删掉", async ({page}) => {
    const world = await lab.startWorld("profile-old-entries", {tweak(settings) {
        settings["nbook.agent/toolBindings"] = {"nbook.agent.main": {removed: ["nbook.page-agent.highlight"]}};
    }});
    await openProfiles(page, world);
    const row = page.locator("[data-profile-tool-object='ui']");
    await expect(row).toHaveCount(1);
    // 对照：旧条目在设置里（没有它，下面“删掉了”什么也说明不了）。
    expect((await bindingsOf(world))["nbook.agent.main"]?.removed).toEqual(["nbook.page-agent.highlight"]);
    await row.locator("[data-profile-tool-remove]").click();
    await expect(row).toHaveCount(0);
    await expect.poll(async () => (await bindingsOf(world))["nbook.agent.main"]?.objects?.removed).toEqual(["ui"]);
    expect((await bindingsOf(world))["nbook.agent.main"]?.removed ?? []).not.toContain("nbook.page-agent.highlight");
});
