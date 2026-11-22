/**
 * 模型服务的设置页（docs/specs/models/settings-pages.md 的“验收与 Smoke”）：生产构建的服务端、真实浏览器、本机的 OpenAI 兼容
 * 假端点。验收 1 走完一家空白模板服务商的一生；验收 2 两个窗口同开；验收 3 窄窗口、本作品标签与写失败；验收 4 模板服务商的
 * 多份、改名、复制、图标与模型清单；验收 5 检测协议与检测全部。
 */

import {randomUUID} from "node:crypto";
import {chmod, mkdir, rm, writeFile} from "node:fs/promises";
import {createServer} from "node:http";
import {deflateSync} from "node:zlib";
import type {AddressInfo} from "node:net";
import {join} from "node:path";

import {expect, test} from "@playwright/test";
import type {Page} from "@playwright/test";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {startProductServer} from "./fixtures";
import type {ProductServer} from "./fixtures";

/**
 * 本机假端点：`/models` 给目录里没有的三个模型（两个类型不明的对话模型，一个 id 像向量模型、不自动加入），`listed` 数收到几次列表请求；
 * `bigList` 时改给 24 个带上下文窗口的（自动加入并启用）。只会说 OpenAI Chat Completions：别的协议的路径回 404。`posts` 记下列表之外
 * 每个请求的路径；`failNext` 时下一次补全以 401 失败。
 */
let failNext = false;
let listed = 0;
let bigList = false;
const posts: string[] = [];
const endpoint = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk: Buffer) => {
        body += chunk.toString("utf8");
    });
    request.on("end", () => {
        if (request.url?.endsWith("/models") === true) {
            listed += 1;
            response.writeHead(200, {"content-type": "application/json"});
            const data = bigList
                ? Array.from({length: 24}, (_, index) => ({id: `relay-${String(index + 1).padStart(2, "0")}`, object: "model", context_length: 32_000}))
                : [{id: "story-model-a", object: "model"}, {id: "story-model-b", object: "model"}, {id: "story-embedding", object: "model"}];
            response.end(JSON.stringify({object: "list", data}));
            return;
        }
        posts.push(new URL(request.url ?? "/", "http://localhost").pathname);
        if (request.url?.endsWith("/chat/completions") !== true) {
            response.writeHead(404, {"content-type": "application/json"});
            response.end(JSON.stringify({error: {message: `no route ${request.url ?? ""}`}}));
            return;
        }
        if (failNext) {
            failNext = false;
            response.writeHead(401, {"content-type": "application/json"});
            response.end(JSON.stringify({error: {message: "invalid api key"}}));
            return;
        }
        const chunk = (payload: object) => `data: ${JSON.stringify({id: "c", object: "chat.completion.chunk", created: 0, model: "m", ...payload})}\n\n`;
        response.writeHead(200, {"content-type": "text/event-stream"});
        response.end(chunk({choices: [{index: 0, delta: {role: "assistant", content: "好"}, finish_reason: null}]}) + chunk({choices: [{index: 0, delta: {}, finish_reason: "stop"}]}) + "data: [DONE]\n\n");
    });
});

let tmp = "";
let base = "";
let sequence = 0;
/** 本条用例的状态根与服务端：每条用例各起一套，前一条失败留下的服务商不影响后一条。 */
let stateRoot = "";
let server: ProductServer;

test.beforeAll(async () => {
    await new Promise<void>((resolve) => endpoint.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${String((endpoint.address() as AddressInfo).port)}/v1`;
    tmp = await createTestTmpRoot("neuro-book-e2e", "models");
});

test.beforeEach(async () => {
    sequence += 1;
    const root = join(tmp, `case-${String(sequence)}`);
    stateRoot = join(root, "state");
    const projectDir = join(root, "Book");
    const id = randomUUID();
    await mkdir(join(projectDir, ".nbook"), {recursive: true});
    await mkdir(stateRoot, {recursive: true});
    await writeFile(join(projectDir, ".nbook", "project.json"), JSON.stringify({schema: 1, id}));
    await writeFile(join(stateRoot, "projects.json"), JSON.stringify({schema: 1, projects: [{id, name: "book", path: projectDir}]}));
    await writeFile(join(stateRoot, "settings.json"), "{}\n");
    server = await startProductServer(stateRoot);
});

test.afterEach(async () => {
    expect(await server.stop()).toBe(0);
});

test.afterAll(async () => {
    await new Promise<void>((resolve) => endpoint.close(() => resolve()));
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

async function openProviders(page: Page, path = "/workbench"): Promise<void> {
    await page.goto(new URL(path, server.url).href);
    await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-window-state", "ready");
    await page.locator("[data-activity-item='nbook.settings']").click();
    await page.locator("[data-settings-nav='nbook.models.providers']").click();
    await expect(page.locator("[data-models-providers-page]")).toBeVisible();
}

const detail = (page: Page) => page.locator("[data-provider-detail]");

/** 经“添加服务商”加一家指向本机假端点的自定义服务商。 */
async function addCustom(page: Page, name: string): Promise<void> {
    await page.locator("[data-provider-add]:visible").first().click();
    const add = page.locator("[data-add-provider-dialog]");
    await add.locator("[data-add-provider='blank-openai']").click();
    // 进到表单焦点就在名称框里，回车提交。
    await expect(add.locator("input[data-field='name'], [data-field='name'] input").first()).toBeFocused();
    await page.keyboard.type(name);
    await add.locator("input[data-field='baseUrl'], [data-field='baseUrl'] input").first().fill(base);
    await page.keyboard.press("Enter");
    await expect(add).toHaveCount(0);
}
const model = (page: Page, id: string) => page.locator(`[data-model-row="${id}"]`);

test("验收 1：添加自定义服务商、填密钥与 env:、拉到服务商的列表、重新拉取、补字段后启用、检测失败看原因、绑主力、停用先确认、删除后焦点与角色", async ({page}) => {
    await openProviders(page);
    // 开箱：引导与“添加服务商”。
    await expect(page.getByText("还没有服务商")).toBeVisible();
    await page.locator("[data-provider-add]:visible").click();
    const add = page.locator("[data-add-provider-dialog]");
    await add.locator("[data-add-provider='blank-openai']").click();
    await add.locator("[data-field='name'] input, input[data-field='name']").first().fill("本地端点");
    await add.locator("[data-field='baseUrl'] input, input[data-field='baseUrl']").first().fill(base);
    await add.getByRole("button", {name: "添加"}).click();
    await expect(add).toHaveCount(0);
    await expect(page.locator("[data-provider-name]")).toHaveText("本地端点");

    // 密钥：env: 引用的变量不在启动环境里时标出；原文写进凭据库，框里清空，出现“清除”。
    const key = detail(page).locator("[data-key-input]");
    await key.fill("env:NBOOK_E2E_NO_SUCH_KEY");
    await key.press("Enter");
    await expect(detail(page).locator("[data-key-problem]")).toContainText("NBOOK_E2E_NO_SUCH_KEY");
    await key.fill("sk-e2e-not-real-0001");
    await key.press("Enter");
    await expect(detail(page).locator("[data-key-problem]")).toHaveCount(0);
    await expect(detail(page).locator("[data-key-clear]")).toBeVisible();
    await expect(key).toHaveValue("");

    // 设了密钥就拉服务商的列表：空白模板里类型不明的两个模型都列出来；列表不报上下文窗口，标“缺上下文窗口”、不启用。
    const source = detail(page).locator("[data-source-status]");
    await expect(source).toContainText("更新于");
    await expect(model(page, "story-model-a")).toContainText("缺上下文窗口");
    await expect(model(page, "story-model-b")).toBeVisible();
    await expect(model(page, "story-model-a").getByRole("switch")).toBeDisabled();
    // 重新拉取：端点再收到一次列表请求，完成后照样是这两个。
    const before = listed;
    const refresh = detail(page).locator("[data-source-refresh]");
    await refresh.click();
    await expect.poll(() => listed).toBe(before + 1);
    await expect(source).toContainText("更新于");
    await expect(page.locator("[data-model-row]")).toHaveCount(2);

    // 管理模型：像向量模型的不自动加入，在“类型不明”一组里；加入后进列表，缺上下文窗口、不启用。
    await detail(page).locator("[data-models-manage]").click();
    const manage = page.locator("[data-manage-models-dialog]");
    const unknown = manage.locator("[data-manage-group='unknown']");
    await expect(unknown).toContainText("类型不明");
    await unknown.getByRole("button", {name: "加入 story-embedding"}).click();
    await manage.getByRole("button", {name: "完成"}).click();
    await expect(manage).toHaveCount(0);
    await expect(model(page, "story-embedding")).toContainText("缺上下文窗口");
    await expect(model(page, "story-embedding").getByRole("switch")).toBeDisabled();

    // 补上下文窗口后能启用。
    await model(page, "story-model-a").getByRole("button", {name: "编辑 story-model-a"}).click();
    const edit = page.locator("[data-model-edit-dialog]");
    await edit.locator("[data-field='contextWindow'] input, input[data-field='contextWindow']").first().fill("32000");
    await edit.getByRole("button", {name: "保存"}).click();
    await expect(edit).toHaveCount(0);
    await model(page, "story-model-a").getByRole("switch").click();
    await expect(model(page, "story-model-a").getByRole("switch")).toHaveAttribute("aria-checked", "true");

    // 检测失败：红色图标点开看归类的原因与原文，重新检测通过。
    failNext = true;
    await model(page, "story-model-a").getByRole("button", {name: "检测 story-model-a"}).click();
    await model(page, "story-model-a").locator("[data-check-failed]").click();
    const failure = page.locator("[data-check-detail]");
    await expect(failure).toContainText("鉴权失败");
    await expect(failure).not.toContainText("sk-e2e-not-real-0001");
    await failure.getByRole("button", {name: "重新检测"}).click();
    await expect(model(page, "story-model-a").locator("[data-check-ok]")).toBeVisible();

    // 角色页：给主力绑这个模型。
    await page.locator("[data-settings-nav='nbook.models.roles']").click();
    const main = page.locator("[data-role-row='main']");
    const mainModel = main.locator("[data-role-model]").getByRole("combobox");
    await mainModel.click();
    await mainModel.fill("story-model-a");
    await page.getByRole("option", {name: /story-model-a/u}).click();
    await expect(main.locator("[data-role-unbound]")).toHaveCount(0);

    // 停用被主力用着的模型：先在行内确认。
    await page.locator("[data-settings-nav='nbook.models.providers']").click();
    await expect(model(page, "story-model-a")).toContainText("主力");
    await model(page, "story-model-a").getByRole("switch").click();
    const confirm = model(page, "story-model-a").locator("[data-model-confirm]");
    await expect(confirm).toContainText("主力");
    await confirm.getByRole("button", {name: "取消"}).click();
    await expect(model(page, "story-model-a").getByRole("switch")).toHaveAttribute("aria-checked", "true");

    // 删除服务商（条目上悬停出的删除图标）：确认框写明受影响的角色；删除后焦点到“添加服务商”，主力变成未绑定。
    await page.locator("[data-provider-rail-item='provider']").hover();
    await page.locator("[data-provider-remove='provider']").click();
    const alert = page.getByRole("alertdialog");
    await expect(alert).toContainText("主力");
    await alert.getByRole("button", {name: "删除"}).click();
    await expect(page.locator("[data-provider-add]:visible")).toBeFocused();
    await page.locator("[data-settings-nav='nbook.models.roles']").click();
    await expect(page.locator("[data-role-row='main'] [data-role-unbound]")).toBeVisible();
});

test("验收 5：检测协议（没有可用的模型时填一个、每种协议恰好一次请求、换了密钥后结果置灰）；检测全部超过 20 个先确认，取消什么都不发，确认后逐个检完", async ({page}) => {
    await openProviders(page);
    await addCustom(page, "中转站");
    const key = detail(page).locator("[data-key-input]");
    await key.fill("sk-e2e-not-real-0002");
    await key.press("Enter");
    await expect(detail(page).locator("[data-source-status]")).toContainText("更新于");

    // 列表里的都类型不明、没有窗口：没有能用来检测的模型，填一个再检测。
    await detail(page).locator("[data-api-detect-start]").click();
    const modelInput = detail(page).locator("[data-api-detect-model] input, input[data-api-detect-model]").first();
    await expect(modelInput).toBeVisible();
    posts.length = 0;
    await modelInput.fill("story-model-a");
    await modelInput.press("Enter");
    const rows = detail(page).locator("[data-api-detect-row]");
    await expect(rows).toHaveCount(4);
    await expect(detail(page).locator("[data-api-detect-row='openai-completions'] [data-api-detect-using]")).toBeVisible();
    await expect(detail(page).locator("[data-api-detect-row='openai-completions']")).toHaveAttribute("data-ok", "");
    for (const api of ["openai-responses", "anthropic-messages", "google-generative-ai"]) await expect(detail(page).locator(`[data-api-detect-row='${api}']`)).toContainText("HTTP 404");
    // 每种协议恰好一次（OMP 对 Responses 与 Anthropic 的失败会在内层重发）。
    expect(posts).toHaveLength(4);
    expect(new Set(posts.map((path) => (path.endsWith("/chat/completions") ? "completions" : path.endsWith("/responses") ? "responses" : path.endsWith("/messages") ? "anthropic" : path.includes(":streamGenerateContent") ? "gemini" : path)))).toEqual(new Set(["completions", "responses", "anthropic", "gemini"]));
    // 换了密钥：结果对不上现在的配置，整块置灰。
    await key.fill("sk-e2e-not-real-0003");
    await key.press("Enter");
    await expect(detail(page).locator("[data-api-detect-stale]")).toBeVisible();

    // 检测全部：列表换成 24 个带窗口的（自动加入并启用），超过 20 个先确认。
    bigList = true;
    try {
        await detail(page).locator("[data-source-refresh]").click();
        await expect(page.locator("[data-model-row]")).toHaveCount(24);
        posts.length = 0;
        const checkAll = detail(page).locator("[data-models-check-all]");
        await checkAll.click();
        const alert = page.getByRole("alertdialog");
        await expect(alert).toContainText("检测 24 个模型？");
        await alert.getByRole("button", {name: "取消"}).click();
        await expect(alert).toHaveCount(0);
        await expect(checkAll).toBeFocused();
        expect(posts).toHaveLength(0);
        await checkAll.click();
        await page.getByRole("alertdialog").getByRole("button", {name: "检测"}).click();
        await expect(page.locator("[data-model-row] [data-check-ok]")).toHaveCount(24);
        expect(posts).toHaveLength(24);
    } finally {
        bigList = false;
    }
});

test("验收 2：两个窗口同开“服务商与模型”，一处添加、改地址，另一处即时跟上", async ({browser}) => {
    const a = await browser.newPage();
    const b = await browser.newPage();
    try {
        await openProviders(a);
        await openProviders(b);
        await a.locator("[data-provider-add]").first().click();
        const add = a.locator("[data-add-provider-dialog]");
        await add.locator("[data-add-provider='blank-openai']").click();
        await add.locator("input[data-field='name'], [data-field='name'] input").first().fill("同步测试");
        await add.locator("input[data-field='baseUrl'], [data-field='baseUrl'] input").first().fill(base);
        await add.getByRole("button", {name: "添加"}).click();
        await expect(b.locator("[data-provider-rail-item='provider']")).toBeVisible();

        const url = a.locator("[data-url-input]");
        await url.fill("http://127.0.0.1:1/v1");
        await url.press("Enter");
        await b.locator("[data-provider-rail-item='provider']").click();
        await expect(b.locator("[data-url-input]")).toHaveValue("http://127.0.0.1:1/v1");

        await a.locator("[data-provider-rail-item='provider']").hover();
        await a.locator("[data-provider-remove='provider']").click();
        await a.getByRole("alertdialog").getByRole("button", {name: "删除"}).click();
        await expect(b.locator("[data-provider-rail-item='provider']")).toHaveCount(0);
    } finally {
        await a.close();
        await b.close();
    }
});

test("验收 3：窄窗口里服务商列表收成下拉；页面里的写不进去时窗口发通知、控件回到实际值；本作品标签下两页停用", async ({page}) => {
    await page.setViewportSize({width: 700, height: 700});
    await openProviders(page);
    await page.locator("[data-provider-add]").first().click();
    const add = page.locator("[data-add-provider-dialog]");
    await add.locator("[data-add-provider='blank-openai']").click();
    await add.locator("input[data-field='name'], [data-field='name'] input").first().fill("窄窗口");
    await add.locator("input[data-field='baseUrl'], [data-field='baseUrl'] input").first().fill(base);
    await add.getByRole("button", {name: "添加"}).click();
    await expect(add).toHaveCount(0);
    await expect(page.locator(".providers-page__picker")).toBeVisible();
    await expect(page.locator(".providers-page__rail")).toBeHidden();

    // 设置文件只读：改地址写不进去，窗口发通知，地址框回到实际值。
    await chmod(join(stateRoot, "settings.json"), 0o444);
    try {
        const url = page.locator("[data-url-input]");
        await url.fill("http://127.0.0.1:2/v1");
        await url.press("Enter");
        await expect(page.locator("[data-notification-stack]")).toContainText("设置没有保存");
        await expect(url).toHaveValue(base);
    } finally {
        await chmod(join(stateRoot, "settings.json"), 0o644);
    }
    // 窄时删除在下拉旁边：取消后焦点回到它；删掉唯一的一家后焦点落到“添加服务商”。
    const removeCurrent = page.locator("[data-provider-remove-current]");
    await removeCurrent.click();
    await page.getByRole("alertdialog").getByRole("button", {name: "取消"}).click();
    await expect(removeCurrent).toBeFocused();
    await removeCurrent.click();
    await page.getByRole("alertdialog").getByRole("button", {name: "删除"}).click();
    await expect(page.locator("[data-provider-add]:visible").first()).toBeFocused();

    // 绑定作品的窗口：本作品标签下两页停用。
    await page.setViewportSize({width: 1280, height: 800});
    await openProviders(page, "/?project=book");
    await page.locator("[data-settings-tabs]").getByRole("radio", {name: "本作品"}).click();
    await expect(page.locator("[data-settings-nav='nbook.models.roles']")).toHaveAttribute("aria-disabled", "true");
});

test("删除的三条路与焦点：取消后回到那家的条目；Delete 键删选中的中间一家，选中与焦点到下一家；右键删没选中的一家，选中不变", async ({page}) => {
    await openProviders(page);
    await addCustom(page, "甲");
    await addCustom(page, "乙");
    await addCustom(page, "丙");
    const item = (id: string) => page.locator(`[data-provider-rail-item='${id}']`);
    // 条目的名称只有服务商名，行尾一格的原因是描述。
    await expect(item("provider-2")).toHaveAccessibleName("乙");
    await expect(item("provider-2")).toHaveAccessibleDescription(/./u);
    await item("provider-2").click();

    await item("provider-2").hover();
    await page.locator("[data-provider-remove='provider-2']").click();
    await page.getByRole("alertdialog").getByRole("button", {name: "取消"}).click();
    await expect(item("provider-2")).toBeFocused();

    await item("provider-2").press("Delete");
    await page.getByRole("alertdialog").getByRole("button", {name: "删除"}).click();
    await expect(item("provider-3")).toBeFocused();
    await expect(item("provider-3")).toHaveAttribute("aria-current", "page");
    await expect(item("provider-2")).toHaveCount(0);

    await item("provider").click({button: "right"});
    await page.getByRole("menuitem", {name: "删除服务商…"}).click();
    await page.getByRole("alertdialog").getByRole("button", {name: "删除"}).click();
    await expect(item("provider")).toHaveCount(0);
    await expect(item("provider-3")).toHaveAttribute("aria-current", "page");
    await expect(item("provider-3")).toBeFocused();
});

/** 一张纯色的真 PNG（边长 300，大于上传前缩图的 128），用来走一遍浏览器里真实的解码、缩图与服务端校验。 */
function solidPng(side: number): Buffer {
    const crcTable = Array.from({length: 256}, (_, n) => {
        let c = n;
        for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
        return c >>> 0;
    });
    const crc = (bytes: Buffer): number => {
        let c = 0xffffffff;
        for (const byte of bytes) c = crcTable[(c ^ byte) & 0xff]! ^ (c >>> 8);
        return (c ^ 0xffffffff) >>> 0;
    };
    const chunk = (type: string, data: Buffer): Buffer => {
        const head = Buffer.alloc(4);
        head.writeUInt32BE(data.length);
        const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
        const tail = Buffer.alloc(4);
        tail.writeUInt32BE(crc(body));
        return Buffer.concat([head, body, tail]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(side, 0);
    ihdr.writeUInt32BE(side, 4);
    ihdr.set([8, 2, 0, 0, 0], 8);
    const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(side * 3, 0x3a)]);
    const raw = Buffer.concat(Array.from({length: side}, () => row));
    return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

test("验收 4：同一模板添加两份、改名、复制一份、上传图标；模型区搜索与系列收起；移出一个来源模型再从管理模型加回来；390 宽没有横向溢出", async ({page}) => {
    await openProviders(page);
    const rail = (id: string) => page.locator(`[data-provider-rail-item="${id}"]`);
    const addTemplate = async (template: string): Promise<void> => {
        await page.locator("[data-provider-add]:visible").first().click();
        const add = page.locator("[data-add-provider-dialog]");
        await add.locator(`[data-add-provider="${template}"]`).click();
        await expect(add).toHaveCount(0);
    };
    // 同一模板两份：名称自动加“ 2”，添加后焦点在密钥框。
    await addTemplate("deepseek");
    await expect(page.locator("[data-key-input] input, input[data-key-input]").first()).toBeFocused();
    await addTemplate("deepseek");
    await expect(rail("deepseek")).toBeVisible();
    await expect(rail("deepseek-2")).toContainText("DeepSeek 2");

    // 改名：点铅笔、回车提交；左栏跟着变。
    await page.locator("[data-provider-rename]").click();
    const nameInput = page.locator("[data-provider-name-input] input, input[data-provider-name-input]").first();
    await nameInput.fill("备用 DeepSeek");
    await nameInput.press("Enter");
    await expect(page.locator("[data-provider-name]")).toHaveText("备用 DeepSeek");
    await expect(rail("deepseek-2")).toContainText("备用 DeepSeek");

    // 复制一份：选中副本，焦点到名称。
    await page.locator("[data-provider-duplicate]").click();
    await expect(page.locator("[data-provider-rail-item]:not([data-provider-rail-item='all'])")).toHaveCount(3);
    await expect(page.locator("[data-provider-name]")).toBeFocused();

    // 上传图标：浏览器里缩图、服务端校验后存成文件，标题区与左栏换成读取路由的图。
    await page.locator("[data-provider-icon-button]").click();
    const panel = page.locator("[data-provider-icon-panel]");
    await panel.getByRole("radio", {name: "上传"}).click();
    await panel.locator("[data-icon-file]").setInputFiles({name: "logo.png", mimeType: "image/png", buffer: solidPng(300)});
    const headerImage = page.locator("[data-provider-icon-button] img");
    await expect(headerImage).toHaveAttribute("src", /\/api\/nbook\.models\/icons\/[a-f0-9]{64}\.png$/u);
    const iconUrl = new URL((await headerImage.getAttribute("src"))!, server.url).href;
    const served = await page.request.get(iconUrl);
    expect(served.status()).toBe(200);
    expect(served.headers()["content-type"]).toContain("image/png");
    expect(served.headers()["x-content-type-options"]).toBe("nosniff");

    // 第一份：移出一个来源模型，它不在模型区了；在管理模型里加回来。
    await rail("deepseek").click();
    const rows = detail(page).locator("[data-model-row]");
    await expect(rows.first()).toBeVisible();
    const before = await rows.count();
    const victim = (await rows.first().getAttribute("data-model-row"))!;
    await detail(page).locator("[data-models-manage]").click();
    const manage = page.locator("[data-manage-models-dialog]");
    await manage.locator(`[data-manage-item="${victim}"] [data-manage-toggle]`).click();
    await manage.getByRole("button", {name: "完成"}).click();
    await expect(manage).toHaveCount(0);
    await expect(model(page, victim)).toHaveCount(0);
    await expect(rows).toHaveCount(before - 1);
    await detail(page).locator("[data-models-manage]").click();
    await manage.locator(`[data-manage-item="${victim}"] [data-manage-toggle]`).click();
    await manage.getByRole("button", {name: "完成"}).click();
    await expect(model(page, victim)).toBeVisible();

    // 几百个模型的模板：系列默认收起、不渲染行；搜索展开命中的组。
    await addTemplate("openrouter");
    const series = detail(page).locator(".provider-detail__series");
    await expect(series.first()).toBeVisible();
    await expect(detail(page).locator("[data-model-row]")).toHaveCount(0);
    await detail(page).locator("[data-models-search] input, input[data-models-search]").first().fill("claude");
    await expect(detail(page).locator("[data-model-row]").first()).toBeVisible();
    for (const id of await detail(page).locator("[data-model-row]").evaluateAll((items) => items.map((item) => item.getAttribute("data-model-row") ?? ""))) expect(id.toLowerCase()).toContain("claude");

    // 390 宽：页面与详情都没有横向溢出。
    await page.setViewportSize({width: 390, height: 800});
    await expect(page.locator(".providers-page__picker")).toBeVisible();
    const overflow = await page.evaluate(() => [document.documentElement, document.querySelector("[data-models-providers-page]")].map((element) => (element === null ? -1 : element.scrollWidth - element.clientWidth)));
    expect(overflow).toEqual([0, 0]);
});
