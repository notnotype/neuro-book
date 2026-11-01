/**
 * 模型服务的设置页（docs/specs/models/settings-pages.md 的“验收与 Smoke”）：生产构建的服务端、真实浏览器、本机的 OpenAI 兼容
 * 假端点。验收 1 走完一家自定义服务商的一生；验收 2 两个窗口同开；验收 3 窄窗口、本作品标签与写失败。
 */

import {randomUUID} from "node:crypto";
import {chmod, mkdir, rm, writeFile} from "node:fs/promises";
import {createServer} from "node:http";
import type {AddressInfo} from "node:net";
import {join} from "node:path";

import {expect, test} from "@playwright/test";
import type {Page} from "@playwright/test";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {startProductServer} from "./fixtures";
import type {ProductServer} from "./fixtures";

/** 本机假端点：`/models` 给两个目录里没有的模型；`failNext` 时下一次补全以 401 失败。 */
let failNext = false;
const endpoint = createServer((request, response) => {
    let body = "";
    request.on("data", (chunk: Buffer) => {
        body += chunk.toString("utf8");
    });
    request.on("end", () => {
        if (request.url?.endsWith("/models") === true) {
            response.writeHead(200, {"content-type": "application/json"});
            response.end(JSON.stringify({object: "list", data: [{id: "story-model-a", object: "model"}, {id: "story-model-b", object: "model"}]}));
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
    await add.locator("[data-add-provider='custom']").click();
    // 进到表单焦点就在名称框里，回车提交。
    await expect(add.locator("input[data-field='name'], [data-field='name'] input").first()).toBeFocused();
    await page.keyboard.type(name);
    await add.locator("input[data-field='baseUrl'], [data-field='baseUrl'] input").first().fill(base);
    await page.keyboard.press("Enter");
    await expect(add).toHaveCount(0);
}
const model = (page: Page, id: string) => page.locator(`[data-model-row="${id}"]`);

test("验收 1：添加自定义服务商、填密钥与 env:、拉取并加入模型、补字段后启用、检测失败看原因、绑主力、停用先确认、删除后焦点与角色", async ({page}) => {
    await openProviders(page);
    // 开箱：引导与“添加服务商”。
    await expect(page.getByText("还没有服务商")).toBeVisible();
    await page.locator("[data-provider-add]:visible").click();
    const add = page.locator("[data-add-provider-dialog]");
    await add.locator("[data-add-provider='custom']").click();
    await add.locator("[data-field='name'] input, input[data-field='name']").first().fill("本地端点");
    await add.locator("[data-field='baseUrl'] input, input[data-field='baseUrl']").first().fill(base);
    await add.getByRole("button", {name: "添加"}).click();
    await expect(add).toHaveCount(0);
    await expect(page.locator(".providers-page__heading")).toHaveText("本地端点");

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

    // 管理模型：拉取 /models，两个都加入；拉取的结果不报上下文窗口，加入后停用、标“缺上下文窗口”。
    await detail(page).locator("[data-models-manage]").click();
    const manage = page.locator("[data-manage-models-dialog]");
    await expect(manage.locator("[data-manage-item='story-model-a']")).toBeVisible();
    await manage.getByRole("button", {name: "加入 story-model-a"}).click();
    await manage.getByRole("button", {name: "加入 story-model-b"}).click();
    await manage.getByRole("button", {name: "完成"}).click();
    await expect(manage).toHaveCount(0);
    await expect(model(page, "story-model-a")).toContainText("缺上下文窗口");
    await expect(model(page, "story-model-a").getByRole("switch")).toBeDisabled();

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
    await main.getByRole("combobox").click();
    await main.getByRole("combobox").fill("story-model-a");
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

    // 删除服务商：确认框写明受影响的角色；删除后焦点到“添加服务商”，主力变成未绑定。
    await page.locator("[data-provider-remove]").click();
    const alert = page.getByRole("alertdialog");
    await expect(alert).toContainText("主力");
    await alert.getByRole("button", {name: "删除"}).click();
    await expect(page.locator("[data-provider-add]:visible")).toBeFocused();
    await page.locator("[data-settings-nav='nbook.models.roles']").click();
    await expect(page.locator("[data-role-row='main'] [data-role-unbound]")).toBeVisible();
});

test("验收 2：两个窗口同开“服务商与模型”，一处添加、改地址，另一处即时跟上", async ({browser}) => {
    const a = await browser.newPage();
    const b = await browser.newPage();
    try {
        await openProviders(a);
        await openProviders(b);
        await a.locator("[data-provider-add]").first().click();
        const add = a.locator("[data-add-provider-dialog]");
        await add.locator("[data-add-provider='custom']").click();
        await add.locator("input[data-field='name'], [data-field='name'] input").first().fill("同步测试");
        await add.locator("input[data-field='baseUrl'], [data-field='baseUrl'] input").first().fill(base);
        await add.getByRole("button", {name: "添加"}).click();
        await expect(b.locator("[data-provider-rail-item='custom']")).toBeVisible();

        const url = a.locator("[data-url-input]");
        await url.fill("http://127.0.0.1:1/v1");
        await url.press("Enter");
        await b.locator("[data-provider-rail-item='custom']").click();
        await expect(b.locator("[data-url-input]")).toHaveValue("http://127.0.0.1:1/v1");

        await a.locator("[data-provider-remove]").click();
        await a.getByRole("alertdialog").getByRole("button", {name: "删除"}).click();
        await expect(b.locator("[data-provider-rail-item='custom']")).toHaveCount(0);
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
    await add.locator("[data-add-provider='custom']").click();
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
    await page.locator("[data-provider-remove]").click();
    await page.getByRole("alertdialog").getByRole("button", {name: "删除"}).click();

    // 绑定作品的窗口：本作品标签下两页停用。
    await page.setViewportSize({width: 1280, height: 800});
    await openProviders(page, "/?project=book");
    await page.locator("[data-settings-tabs]").getByRole("radio", {name: "本作品"}).click();
    await expect(page.locator("[data-settings-nav='nbook.models.roles']")).toHaveAttribute("aria-disabled", "true");
});

test("删除的焦点：取消后回到“删除”按钮；三家里删中间一家，选中与焦点到下一家", async ({page}) => {
    await openProviders(page);
    await addCustom(page, "甲");
    await addCustom(page, "乙");
    await addCustom(page, "丙");
    await page.locator("[data-provider-rail-item='custom-2']").click();

    await page.locator("[data-provider-remove]").click();
    await page.getByRole("alertdialog").getByRole("button", {name: "取消"}).click();
    await expect(page.locator("[data-provider-remove]")).toBeFocused();

    await page.locator("[data-provider-remove]").click();
    await page.getByRole("alertdialog").getByRole("button", {name: "删除"}).click();
    await expect(page.locator("[data-provider-rail-item='custom-3']")).toBeFocused();
    await expect(page.locator("[data-provider-rail-item='custom-3']")).toHaveAttribute("aria-current", "page");
    await expect(page.locator("[data-provider-rail-item='custom-2']")).toHaveCount(0);
});
