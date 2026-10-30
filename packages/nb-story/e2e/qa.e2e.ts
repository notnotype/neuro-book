/**
 * 书里的问答页（docs/specs/story/viewer.md 的问答页、story/qa.md 的“网页”）：生产构建的网页，真实的 `nbstory serve`，
 * 模型是子进程里的脚本端点（testing/qa-endpoint-server.ts）。要让一轮停在中途时让端点先等着，页面点“停止”或放行。
 *
 * 服务读用例自己的配置（XDG_CONFIG_HOME），密钥是编的假值，只发往本机端点。
 */

import {mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {expect, test, type Page} from "@playwright/test";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {login, makeLibrary, makePartialLibrary, startQaEndpoint, startServe, type QaEndpoint, type StoryServer} from "./fixtures";

const KEY_ENV = "NBSTORY_E2E_QA_CREDENTIAL";

let root: string;
let endpoint: QaEndpoint;
let server: StoryServer;
let cleanupLibrary: () => Promise<void>;
let configFile: string;

/** 第 1 版的配置（服务读到时升级成第 2 版）；作答方式写成结构化：下面多数用例用 answer 交卷。 */
const baseConfig = () => ({model: {baseUrl: endpoint.url, id: "qa-model", apiKeyEnv: KEY_ENV}, qa: {answer: "structured"}});

const READ_THEN_ANSWER = [
    {kind: "tools", calls: [{name: "read", args: {from: {chapter: 37, paragraph: 8}, to: {chapter: 37, paragraph: 8}}}], thinking: "先翻到 37 章找地狱猫"},
    {
        kind: "tools",
        calls: [
            {
                name: "answer",
                args: {
                    conclusion: "读者在 37.8 就知道了",
                    conclusionType: "明说",
                    knowledge: [{who: "读者", state: "知道", how: "旁白点破", refs: ["37.8"]}],
                    explanation: "旁白在 37.8 点破了身份",
                    evidence: ["37.8"],
                    coverage: "第 37 章",
                },
            },
        ],
    },
];

test.beforeAll(async () => {
    root = await createTestTmpRoot("nb-story-e2e-qa", "nb-story e2e qa");
    endpoint = await startQaEndpoint();
    const library = await makeLibrary("qa");
    cleanupLibrary = library.cleanup;
    const configHome = join(root, "xdg");
    await mkdir(join(configHome, "nbstory"), {recursive: true});
    configFile = join(configHome, "nbstory", "config.json");
    await writeFile(configFile, JSON.stringify(baseConfig()));
    server = await startServe(library.library, {XDG_CONFIG_HOME: configHome, [KEY_ENV]: "fake-e2e-qa-credential"});
});

test.afterAll(async () => {
    expect(await server.stop()).toBe(0);
    await endpoint.stop();
    await cleanupLibrary();
    await rm(root, {recursive: true, force: true});
});

test.beforeEach(async ({context}) => {
    await login(context, server);
});

async function ask(page: Page, question: string): Promise<void> {
    const input = page.getByRole("textbox", {name: "消息输入框"});
    await input.click();
    await input.fill(question);
    await input.press("Enter");
}

test("新对话：提问后看到过程与答案卡片；出处在抽屉里打开；刷新后对话还在，能续问", async ({page}) => {
    await endpoint.script(READ_THEN_ANSWER);
    await page.goto(`${server.base}/book/fox/qa?at=38.57`);
    // 新对话的位置控件（t25）：写着读到哪里，跟着查看器的位置。
    await expect(page.getByTestId("qa-position")).toContainText("38.57");
    await expect(page.getByText("新对话从这里读起")).toBeVisible();
    // 第一个请求（读原文）照常回，第二个（交卷）先等着：这时页面停在运行中。
    await endpoint.hold(1);
    await ask(page, "地狱猫是谁？");

    const card = page.locator("[data-qa-answer]");
    // 受理之后输入框清空（换到新对话的草稿也是新版本）。
    await expect(page.getByRole("textbox", {name: "消息输入框"})).toHaveText("");
    // 运行中：过程逐步列出读原文的那一步，列表里这个对话在运行中。设了阅读位置，模型的思考不显示（qa.md 输出 43，
    // 思考里可能有后文的词）：读到这一步时它已经到了页面上，所以这里不显示是真的被收起，不是还没到。
    await expect(page.getByText("37.8—37.8").first()).toBeVisible();
    await expect(page.getByText("先翻到 37 章找地狱猫")).toHaveCount(0);
    await expect(page.locator("aside").getByText("运行中")).toHaveCount(1);
    await endpoint.release();
    await expect(card).toBeVisible();
    // 结束后整轮过程收成一行摘要。
    // 1 次操作（交卷是结果，不计），模型回了 2 次。
    await expect(page.getByText("过程 · 1 次操作 · 2 次请求").first()).toBeVisible();
    await expect(card).toContainText("读者在 37.8 就知道了");
    await expect(card.getByText("明说")).toBeVisible();
    // 地址里记下了这个对话；列表里它不再是运行中。
    await expect(page).toHaveURL(/[?&]c=\d{17}-[0-9a-z]{6}/u);
    await expect(page.locator("aside").getByText("运行中")).toHaveCount(0, {timeout: 2500});

    await card.locator(".answer-foot").getByRole("button", {name: "37.8"}).click();
    await expect(page.getByTestId("drawer")).toContainText("37.8");

    await page.reload();
    await expect(page.locator("[data-qa-answer]")).toContainText("读者在 37.8 就知道了");
    await expect(page.getByRole("button", {name: /地狱猫是谁？/u}).first()).toBeVisible();

    await endpoint.script([{kind: "text", text: "接着说：见 37.110—38.2。"}]);
    await ask(page, "再说说？");
    await expect(page.getByText("接着说：见")).toBeVisible();
    // 跨章的出处：抽屉从起点那一章读到终点那一章，引用的几段高亮。
    await page.locator("[data-qa-page] main, [data-qa-page]").getByText("37.110—38.2").first().click();
    const drawer = page.getByTestId("drawer-source");
    await expect(drawer.locator(".is-cited").first()).toContainText("37.110");
    await expect(drawer.locator(".is-cited").last()).toContainText("38.2");
});

test("运行中：过程逐步出现，点停止后这一轮记为已停止；删除对话要确认，删后列表里没有它", async ({page}) => {
    await endpoint.script([{kind: "tools", calls: [{name: "read", args: {from: {chapter: 37}}}]}, {kind: "text", text: "不会到这里"}]);
    await page.goto(`${server.base}/book/fox/qa?at=38.57`);
    await page.getByRole("button", {name: "新对话"}).first().click();
    await endpoint.hold();
    await ask(page, "要停下的问题");
    const stop = page.locator("[data-qa-stop]");
    await expect(stop).toBeVisible();
    await stop.click();
    await endpoint.release();
    await expect(stop).toBeHidden();
    await expect(page.getByText("要停下的问题").first()).toBeVisible();
    // 这一轮记为已停止，刷新后（按记录显示）也是。
    await expect(page.getByText("已停止").first()).toBeVisible();
    await page.reload();
    await expect(page.getByText("已停止").first()).toBeVisible();

    await page.locator("[data-qa-remove]").click();
    await page.getByRole("alertdialog").getByRole("button", {name: "删除"}).click();
    await expect(page).not.toHaveURL(/[?&]c=/u);
    await expect(page.getByRole("button", {name: /要停下的问题/u})).toHaveCount(0);
});

test("@ 引用：选人物、段落与章插进问题，模型收到带 id 的引用；问题里的小块点开在抽屉里；列表只显示名称", async ({page}) => {
    await endpoint.script([{kind: "text", text: "引用收到了"}]);
    await page.goto(`${server.base}/book/fox/qa?at=38.57`);
    await page.getByRole("button", {name: "新对话"}).first().click();
    const input = page.getByRole("textbox", {name: "消息输入框"});
    await input.click();
    const pick = async (typed: string, label: string) => {
        await page.keyboard.type(typed);
        const option = page.locator("[role='option']", {hasText: label}).first();
        await expect(option).toBeVisible();
        await page.keyboard.press("Enter");
        await expect(option).toHaveCount(0);
    };
    await pick("@地狱猫", "地狱猫");
    await pick("在 @37.8", "37.8");
    await pick("和 @37", "第 37 章");
    // 晚于阅读位置的段落列出但不能选。
    await page.keyboard.type("@39");
    await expect(page.locator("[role='option']", {hasText: "第 39 章"})).toHaveAttribute("aria-disabled", "true");
    await page.keyboard.press("Escape");
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Backspace");
    await page.keyboard.press("Backspace");
    await page.keyboard.type("做了什么？");
    await page.keyboard.press("Enter");
    await expect(page.getByText("引用收到了")).toBeVisible();

    const sent = JSON.stringify((await endpoint.bodies()).at(-1));
    expect(sent).toMatch(/\]\(entity:\/\/[^)]+\) 在 \[37\.8\]\(paragraph:\/\/37\.8\) 和 \[第 37 章\]\(chapter:\/\/37\) 做了什么？/u);

    // 已发出的问题里，三个引用是小块：点段落开原文，点章开这一章开头，点人物开人物卡。
    const chips = page.locator("[data-qa-page] [data-inline-chip='reference']");
    await chips.filter({hasText: "37.8"}).first().click();
    await expect(page.getByTestId("drawer-source").locator(".is-cited").first()).toContainText("37.8");
    await chips.filter({hasText: "第 37 章"}).first().click();
    await expect(page.getByTestId("drawer-source").locator(".is-cited").first()).toContainText("37.1");
    await chips.first().click();
    await expect(page.getByTestId("drawer")).toContainText("南嘉鱼");
    // 列表与页头里只有名称，没有引用的写法。
    await expect(page.locator("aside").getByText(/在 37\.8 和 第 37 章 做了什么？/u).first()).toBeVisible();
    await expect(page.locator("[data-qa-page]")).not.toContainText("entity://");
    // 抽屉开着会记在这本书的阅读状态里，关上，免得盖住后面用例的输入框。
    await page.getByTestId("drawer").getByRole("button", {name: "关闭"}).click();
    await expect(page.locator("[data-testid='drawer']:not([data-closing])")).toHaveCount(0);
});

test("没有配置时：写明要先配置并给去设置的链接，不能发送", async ({page}) => {
    await rm(configFile);
    try {
        await page.goto(`${server.base}/book/fox/qa`);
        await expect(page.getByText("还没有配置问答用的模型")).toBeVisible();
        await expect(page.getByRole("link", {name: "去设置"})).toHaveAttribute("href", "/settings");
        await expect(page.getByRole("button", {name: "发送"})).toBeDisabled();
    } finally {
        await writeFile(configFile, JSON.stringify(baseConfig()));
    }
});

test("手机宽度：对话列表收进顶栏的下拉，选中后下拉关上", async ({page}) => {
    await page.setViewportSize({width: 390, height: 844});
    // 自己先建一个对话，不靠别的用例留下的。
    await endpoint.script([{kind: "text", text: "手机上的回答"}]);
    await page.goto(`${server.base}/book/fox/qa`);
    await ask(page, "手机上问的");
    await expect(page.getByText("手机上的回答")).toBeVisible();
    // 回到新对话，再从下拉里选回刚才那个。
    await page.locator("[data-qa-page] header").getByRole("button", {name: "新对话"}).click();
    await expect(page.getByText("手机上的回答")).toHaveCount(0);
    await page.locator("[data-qa-switch]").click();
    const first = page.getByRole("dialog").getByRole("button", {name: /手机上问的/u}).first();
    await expect(first).toBeVisible();
    await first.click();
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(page.getByText("手机上的回答")).toBeVisible();
});

test.describe("输入框与模型", () => {
    /** 两个候选，作答方式 Markdown。gpt-5.6-sol 是 OMP 目录认得的模型名：上下文与推理档按它补。 */
    const twoModels = () => ({
        providers: {custom: {api: "openai-completions", baseUrl: endpoint.url, apiKeyEnv: KEY_ENV, models: [{id: "qa-model"}, {id: "gpt-5.6-sol"}]}},
        models: ["custom/qa-model", "custom/gpt-5.6-sol"],
        model: {use: "custom/qa-model"},
    });
    test.beforeEach(async () => {
        await writeFile(configFile, JSON.stringify(twoModels()));
    });
    test.afterEach(async () => {
        await writeFile(configFile, JSON.stringify(baseConfig()));
    });

    test("第一次切换读书方式先弹说明（t26）：确认键倒计时 3 秒后才能点；先不切换不记住、下次还弹；确认后切换，之后不再弹", async ({page}) => {
        await page.goto(`${server.base}/book/fox/qa?at=38.57`);
        await page.getByRole("button", {name: "新对话"}).first().click();
        const mode = page.locator("[data-composer-action='mode']");
        await expect(mode).toContainText("图当目录");
        await mode.click();
        const notice = page.getByTestId("mode-notice");
        await expect(notice).toBeVisible();
        await expect(notice).toContainText("图当目录（默认）");
        await expect(notice).toContainText("慢、贵");
        // 倒计时没结束，确认键是停用的，按钮上写着剩余秒数。
        const confirm = notice.getByRole("button", {name: /知道了，切换（\d）/u});
        await expect(confirm).toBeDisabled();
        // 标题栏有关闭按钮（Spec 输出 51）。
        await expect(notice.getByRole("button", {name: /关闭/u})).toBeVisible();
        // 先不切换随时能点（倒计时只拦确认键）：模式不变，窗口关上。
        await expect(notice.getByRole("button", {name: "先不切换"})).toBeEnabled();
        await notice.getByRole("button", {name: "先不切换"}).click();
        await expect(notice).toHaveCount(0);
        await expect(mode).toContainText("图当目录");
        // 没记住：再点还弹；等倒计时结束后确认，才切换。
        await mode.click();
        await expect(notice).toBeVisible();
        await expect(notice.getByRole("button", {name: /^知道了，切换$/u})).toBeEnabled({timeout: 6000});
        await notice.getByRole("button", {name: /^知道了，切换$/u}).click();
        await expect(notice).toHaveCount(0);
        await expect(mode).toContainText("全读");
        // 记住了：再切换不弹，立即生效。
        await mode.click();
        await expect(notice).toHaveCount(0);
        await expect(mode).toContainText("图当目录");
        await page.reload();
        await page.getByRole("button", {name: "新对话"}).first().click();
        await page.locator("[data-composer-action='mode']").click();
        await expect(page.getByTestId("mode-notice")).toHaveCount(0);
    });

    test("一行的输入框：切全读、换模型与推理档后发问，请求里是新模型；+ 插 @ 打开引用菜单；Markdown 回复的出处复查是过程里的一行；上下文大小", async ({page}) => {
        await page.goto(`${server.base}/book/fox/qa?at=38.57`);
        await page.getByRole("button", {name: "新对话"}).first().click();
        await expect(page.locator("[data-composer-layout='inline']")).toBeVisible();

        // 模式按钮点得动（t16 之前 canChangeRuntime 没给，一直禁用）。
        const mode = page.locator("[data-composer-action='mode']");
        await expect(mode).toBeEnabled();
        await mode.click();
        // 第一次切换要先过说明窗口（t26）：等倒计时结束再确认。
        await page.getByTestId("mode-notice").getByRole("button", {name: /^知道了，切换$/u}).click();
        await expect(mode).toContainText("全读");
        await mode.click();
        await expect(mode).toContainText("图当目录");

        // + 在中文后面补空格再插 @，菜单打开。
        const input = page.getByRole("textbox", {name: "消息输入框"});
        await input.click();
        await page.keyboard.type("介绍一下");
        await page.locator("[data-composer-toolbar='nb-story.insert-ref']").click();
        await expect(page.locator("[role='option']").first()).toBeVisible();
        await expect(input).toHaveText("介绍一下 @");
        await page.keyboard.press("Escape");
        await input.fill("");

        // 换到 gpt-5.6-sol、推理档“高”。
        await page.locator("[data-model-picker]").click();
        await page.getByRole("menuitemradio", {name: /gpt-5\.6-sol/u}).click();
        await page.locator("[data-model-picker]").click();
        await page.getByRole("menuitem", {name: /思考/u}).hover();
        await page.getByRole("menuitemradio", {name: "高", exact: true}).click();
        await expect(page.locator("[data-model-picker]")).toContainText("gpt-5.6-sol");
        await expect(page.locator("[data-model-picker]")).toContainText("高");

        await endpoint.script([
            {kind: "text", text: "她是地狱猫（37.8）。"},
            {kind: "tools", calls: [{name: "read", args: {from: {chapter: 37, paragraph: 8}, to: {chapter: 37, paragraph: 8}}}]},
            {kind: "text", text: "核对过了：她是地狱猫（37.8）。"},
        ]);
        const before = (await endpoint.bodies()).length;
        await ask(page, "地狱猫是谁？");
        await expect(page.getByText("核对过了：她是地狱猫（37.8）。")).toBeVisible();
        const bodies = (await endpoint.bodies()).slice(before);
        expect(bodies.map(body => body.model)).toEqual(["gpt-5.6-sol", "gpt-5.6-sol", "gpt-5.6-sol"]);
        expect(bodies[0]!.reasoning_effort).toBe("high");
        // 一轮只有一个提问；复查是过程里的一行。
        await expect(page.locator(".qa-view").getByText("地狱猫是谁？")).toHaveCount(1);
        await expect(page.getByText(/回答里这些出处不是/u)).toHaveCount(0);
        await page.getByText(/^过程 · /u).first().click();
        await expect(page.getByText("37.8 没读过，已让模型重写")).toBeVisible();
        await expect(page.locator("[data-context-meter]")).toBeVisible();

        // 会话状态条与上下文检查器（t24）：这一轮发了 3 次请求，端点每次回输入 100、输出 10；没有配单价，不显示费用。
        const status = page.getByTestId("qa-status");
        await expect(status).toBeVisible();
        await expect(status.locator("[data-stat=input]")).toContainText("300");
        await expect(status.locator("[data-stat=output]")).toContainText("30");
        await expect(status.locator("[data-stat=cost]")).toHaveCount(0);
        await status.click();
        const inspector = page.getByTestId("qa-inspector");
        await expect(inspector).toBeVisible();
        await expect(inspector.getByTestId("qa-request")).toHaveCount(3);
        await expect(inspector).toContainText("3 次");
        await page.keyboard.press("Escape");
        await expect(inspector).toHaveCount(0);
    });

    test("对话里改阅读位置（t25）：问完一轮后改到第 30 章，对话里出现可展开的系统提醒、页头写新位置，刷新后仍在；再问时请求里提醒与问题在同一条用户消息里", async ({page}) => {
        await endpoint.script([{kind: "text", text: "第一轮"}, {kind: "text", text: "第二轮"}]);
        await page.goto(`${server.base}/book/fox/qa?at=38.57`);
        await page.getByRole("button", {name: "新对话"}).first().click();
        await ask(page, "第一问");
        await expect(page.getByText("第一轮", {exact: true})).toBeVisible();
        const position = page.getByTestId("qa-position");
        await expect(position).toContainText("38.57");
        await expect(position).toBeEnabled();
        await position.click();
        await page.getByTestId("qa-position-chapter").click();
        await page.getByRole("option", {name: "第 30 章"}).click();
        await page.getByTestId("qa-position-confirm").click();
        // 位置立刻写进会话：对话里出现系统提醒，页头写新位置。
        await expect(page.locator(".acv-notice__text")).toContainText("阅读位置从");
        await expect(page.locator(".acv-notice__text")).toContainText("第 30 章");
        await expect(position).toContainText("第 30 章");
        await page.reload();
        await expect(page.locator(".acv-notice__text")).toContainText("第 30 章");
        await expect(page.getByTestId("qa-position")).toContainText("第 30 章");

        const before = (await endpoint.bodies()).length;
        await ask(page, "第二问");
        await expect(page.getByText("第二轮", {exact: true})).toBeVisible();
        const body = (await endpoint.bodies()).slice(before)[0]!;
        const users = (body.messages as {role: string; content: unknown}[]).filter(message => message.role === "user");
        const last = users.at(-1)!;
        const text = typeof last.content === "string" ? last.content : (last.content as {text?: string}[]).map(block => block.text ?? "").join("");
        // 提醒与问题合成了同一条用户消息（有的端点不收连续的 user）。
        expect(text).toContain("<system-reminder>");
        expect(text).toContain("第 30 章");
        expect(text.endsWith("第二问")).toBe(true);
    });

    test("管理模型…去设置页，回来草稿还在；选过的模型在设置里被去掉后回到默认模型，发问用默认模型", async ({page}) => {
        await page.goto(`${server.base}/book/fox/qa?at=38.57`);
        await page.getByRole("button", {name: "新对话"}).first().click();
        const input = page.getByRole("textbox", {name: "消息输入框"});
        await input.click();
        await page.keyboard.type("没发出去的草稿");
        await page.locator("[data-model-picker]").click();
        await page.getByRole("menuitemradio", {name: /gpt-5\.6-sol/u}).click();
        await page.locator("[data-model-picker]").click();
        await page.getByRole("menuitem", {name: "管理模型…"}).click();
        await expect(page).toHaveURL(/\/settings$/u);
        await page.locator("[data-settings-candidate='custom/gpt-5.6-sol'] [data-settings-remove-candidate]").click();
        await page.getByTestId("settings-save").click();
        await expect(page.getByTestId("settings-notice")).toContainText("已保存");
        await page.goBack();
        await expect(page.getByRole("textbox", {name: "消息输入框"})).toHaveText("没发出去的草稿");
        await expect(page.locator("[data-model-picker]")).toContainText("qa-model");

        await endpoint.script([{kind: "text", text: "好的。"}]);
        const before = (await endpoint.bodies()).length;
        await ask(page, "介绍一下");
        await expect(page.getByText("好的。")).toBeVisible();
        expect((await endpoint.bodies()).slice(before).map(body => body.model)).toEqual(["qa-model"]);
    });
});

test("没抽完的书（t30）：位置控件能选到未抽取的章并提示图只到抽取进度，提问时模型收到的位置是尾部章", async ({page}) => {
    const partial = await makePartialLibrary("qa-tail", 20, 25);
    const configHome = join(root, "xdg-tail");
    await mkdir(join(configHome, "nbstory"), {recursive: true});
    await writeFile(join(configHome, "nbstory", "config.json"), JSON.stringify(baseConfig()));
    const own = await startServe(partial.library, {XDG_CONFIG_HOME: configHome, [KEY_ENV]: "fake-e2e-qa-credential"});
    try {
        await login(page.context(), own);
        await endpoint.script([{kind: "text", text: "尾部的回答"}]);
        await page.goto(`${own.base}/book/fox/qa?at=20`);
        await page.getByRole("button", {name: "新对话"}).first().click();
        await expect(page.locator("[data-qa-beyond-graph]")).toHaveCount(0);
        await page.getByTestId("qa-position").click();
        await page.getByTestId("qa-position-chapter").click();
        await page.getByRole("option", {name: "第 25 章"}).click();
        await page.getByTestId("qa-position-confirm").click();
        await expect(page.getByTestId("qa-position")).toContainText("第 25 章");
        await expect(page.locator("[data-qa-beyond-graph]")).toContainText("图只抽到第 20 章");
        await expect(page.getByRole("option", {name: "第 26 章"})).toHaveCount(0);
        const before = (await endpoint.bodies()).length;
        await ask(page, "尾部发生了什么？");
        await expect(page.getByText("尾部的回答", {exact: true})).toBeVisible();
        const body = (await endpoint.bodies()).slice(before)[0]!;
        expect(JSON.stringify(body.messages)).toContain("读到了第 25 章");
    } finally {
        await own.stop();
        await partial.cleanup();
    }
});

test.describe("设置页", () => {
    test.afterEach(async () => {
        await writeFile(configFile, JSON.stringify(baseConfig()));
    });
    const dialog = (page: Page) => page.locator("[data-provider-dialog]");

    test("从书架进入；第 1 版显示成第 2 版；给服务商手动加模型、经模型目录加进候选并设为默认，保存后文件是第 2 版；有没保存的改动时不能测试连接", async ({page}) => {
        // 打开 `/` 会回到上次读的书，从书里点“回到书架”进书架。
        await page.goto(`${server.base}/book/fox/overview`);
        await page.getByTestId("go-shelf").click();
        await page.getByTestId("go-settings").click();
        await expect(page).toHaveURL(/\/settings$/u);
        await expect(page.getByTestId("settings-page")).toContainText("config.json");
        await expect(page.locator("[data-settings-candidate='custom/qa-model']")).toContainText("默认");
        await expect(page.locator("[data-settings-provider='custom']")).toContainText(endpoint.url);

        await endpoint.script([{kind: "text", text: "好"}]);
        await page.getByTestId("settings-test").click();
        await expect(page.getByTestId("settings-tested")).toContainText("通过：custom/qa-model");

        await page.locator("[data-settings-provider='custom'] [data-settings-edit-provider]").click();
        await dialog(page).getByRole("button", {name: "手动添加"}).click();
        // gpt-5.6-sol 是 OMP 目录认得的模型名：推理留“自动”，保存后服务端按目录补上推理档。
        await dialog(page).locator("[data-provider-model-row]").last().getByPlaceholder("模型名").fill("gpt-5.6-sol");
        await page.locator("[data-provider-save]").click();
        await page.locator("[data-settings-add-model]").click();
        await page.locator("[data-catalog-search] input").fill("gpt-5.6-sol");
        await page.locator("[data-catalog-model='custom/gpt-5.6-sol']").click();
        await page.locator("[data-catalog-confirm]").click();
        const added = page.locator("[data-settings-candidate='custom/gpt-5.6-sol']");
        await added.locator("[data-settings-default]").click();
        await expect(added).toContainText("推理档保存后才知道");
        await expect(page.getByTestId("settings-test")).toBeDisabled();
        await page.getByTestId("settings-save").click();
        await expect(page.getByTestId("settings-notice")).toContainText("已保存");
        let written = JSON.parse(await readFile(configFile, "utf8"));
        expect(written).toMatchObject({providers: {custom: {models: [{id: "qa-model"}, {id: "gpt-5.6-sol"}]}}, models: ["custom/qa-model", "custom/gpt-5.6-sol"], model: {use: "custom/gpt-5.6-sol"}, qa: {answer: "structured"}});
        expect(written).not.toHaveProperty("model.baseUrl");
        await expect(page.getByTestId("settings-test")).toBeEnabled();

        // 保存后目录补上了推理档：改档再保存。
        await expect(page.locator("[data-settings-thinking]"), "OMP 目录里的 gpt-5.6-sol 应该会推理（目录升级改了？）").toBeVisible();
        await page.locator("[data-settings-thinking]").click();
        await page.getByRole("option", {name: "推理档：高"}).click();
        await page.getByTestId("settings-save").click();
        await expect(page.getByTestId("settings-notice")).toContainText("已保存");
        written = JSON.parse(await readFile(configFile, "utf8"));
        expect(written.model).toEqual({use: "custom/gpt-5.6-sol", thinking: "high"});
    });

    test("别处改过再保存：报冲突，重新载入后是别处写的内容；服务商表单里误贴的密钥不收、文件不变", async ({page}) => {
        await page.goto(`${server.base}/settings`);
        await expect(page.locator("[data-settings-candidate='custom/qa-model']")).toBeVisible();
        await writeFile(configFile, JSON.stringify({model: {...baseConfig().model, id: "changed-by-cli"}}));
        await page.locator("[data-settings-candidate='custom/qa-model'] [data-settings-remove-candidate]").click();
        await expect(page.getByTestId("settings-notice")).toContainText("去掉了默认模型");
        await page.locator("[data-settings-add-model]").click();
        await page.locator("[data-catalog-search] input").fill("deepseek-flash");
        await expect(page.locator("[data-catalog-model='deepseek/deepseek-flash']"), "OMP 目录里没有 deepseek/deepseek-flash（目录升级改了名？）").toBeVisible();
        await page.locator("[data-catalog-model='deepseek/deepseek-flash']").click();
        await page.locator("[data-catalog-confirm]").click();
        await page.getByTestId("settings-save").click();
        await expect(page.getByTestId("settings-notice")).toContainText("别处");
        await page.getByRole("button", {name: "重新载入"}).click();
        await expect(page.locator("[data-settings-candidate='custom/changed-by-cli']")).toBeVisible();

        const before = await readFile(configFile, "utf8");
        const pasted = "sk-pasted-in-settings-e2e-0042";
        await page.locator("[data-settings-provider='custom'] [data-settings-edit-provider]").click();
        await dialog(page).getByLabel("密钥环境变量").fill(pasted);
        await page.locator("[data-provider-save]").click();
        await expect(page.locator("[data-provider-error]")).toContainText("不是密钥本身");
        await expect(page.locator("[data-provider-error]")).not.toContainText(pasted);
        expect(await readFile(configFile, "utf8")).toBe(before);
    });

    test("还没有配置文件：书里的菜单进入，经模型目录选一个目录里的模型，保存后新建", async ({page}) => {
        await rm(configFile);
        await page.goto(`${server.base}/book/fox/overview`);
        await page.getByRole("button", {name: "转生反派萝莉，找茬魔法少女"}).click();
        await page.getByRole("menuitem", {name: "设置"}).click();
        await expect(page.getByTestId("settings-absent")).toBeVisible();
        await page.locator("[data-settings-add-model]").click();
        await page.locator("[data-catalog-search] input").fill("deepseek-flash");
        await expect(page.locator("[data-catalog-model='deepseek/deepseek-flash']"), "OMP 目录里没有 deepseek/deepseek-flash（目录升级改了名？）").toBeVisible();
        await page.locator("[data-catalog-model='deepseek/deepseek-flash']").click();
        await page.locator("[data-catalog-confirm]").click();
        await expect(page.getByTestId("settings-ingest-note")).toContainText("抽取要单独写模型");
        await page.getByTestId("settings-save").click();
        await expect(page.getByTestId("settings-notice")).toContainText("已保存");
        expect(JSON.parse(await readFile(configFile, "utf8"))).toEqual({models: ["deepseek/deepseek-flash"], model: {use: "deepseek/deepseek-flash"}});
    });

    test("添加自定义服务商：从服务读到两个模型、勾一个加进来，经模型目录加进候选；去掉默认候选后默认改成剩下的那个；删掉还被用着的服务商要确认", async ({page}) => {
        await endpoint.models({kind: "models", ids: ["m-a", "m-b"]});
        await page.goto(`${server.base}/settings`);
        await page.locator("[data-settings-add-provider]").click();
        await dialog(page).getByLabel("名称").fill("jiji");
        await dialog(page).getByLabel("服务地址").fill(endpoint.url);
        await dialog(page).getByLabel("密钥环境变量").fill(KEY_ENV);
        await page.locator("[data-provider-discover]").click();
        await expect(page.locator("[data-provider-discovery]")).toContainText("读到 2 个模型");
        await page.locator("[data-provider-found]").getByText("m-a").click();
        await page.locator("[data-provider-add-found]").click();
        await page.locator("[data-provider-save]").click();
        await expect(page.locator("[data-settings-provider='jiji']")).toBeVisible();

        await page.locator("[data-settings-add-model]").click();
        await page.locator("[data-catalog-model='jiji/m-a']").click();
        await page.locator("[data-catalog-confirm]").click();
        await page.locator("[data-settings-candidate='custom/qa-model'] [data-settings-remove-candidate]").click();
        await expect(page.locator("[data-settings-candidate='jiji/m-a']")).toContainText("默认");

        await page.locator("[data-settings-provider='custom'] [data-settings-remove-provider]").click();
        await page.getByRole("alertdialog").getByRole("button", {name: "删除"}).click();
        await expect(page.locator("[data-settings-provider='custom']")).toHaveCount(0);
        await page.getByTestId("settings-save").click();
        await expect(page.getByTestId("settings-notice")).toContainText("已保存");
        expect(JSON.parse(await readFile(configFile, "utf8"))).toMatchObject({providers: {jiji: {api: "openai-completions", baseUrl: endpoint.url, apiKeyEnv: KEY_ENV, models: [{id: "m-a"}]}}, models: ["jiji/m-a"], model: {use: "jiji/m-a"}});
    });
});
