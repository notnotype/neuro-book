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
import type {Page} from "@playwright/test";

import {HEIGHT, WIDTH, expectGuideRemoved, guidePart, newSession, openConversation, startEval, startLab} from "./support/page-agent-world";
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
