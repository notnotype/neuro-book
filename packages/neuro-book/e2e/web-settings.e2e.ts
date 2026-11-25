/**
 * “搜索与网页”设置页（docs/specs/web/settings-page.md 的“验收与 Smoke”）：生产构建的服务端、真实浏览器、本机的假接口（
 * `nbook.web/deepseekBaseUrl` 指向它，`nbook.web/tavilyBaseUrl` 指向它的 `/tavily` 下面）。这里的密钥是假的，只发往本机。
 */

import {randomUUID} from "node:crypto";
import {mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {createServer} from "node:http";
import type {AddressInfo} from "node:net";
import {join} from "node:path";

import {expect, test} from "@playwright/test";
import type {Page} from "@playwright/test";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {startProductServer} from "./fixtures";
import type {ProductServer} from "./fixtures";

const FIRST = "sk-e2e-web-not-real-0001";
const SECOND = "sk-e2e-web-not-real-0002";
const TAVILY = "tvly-e2e-web-not-real-0003";

/** 本机假接口：两家的搜索都回一条结果（字段两家都认得出网址与标题），记下每次请求的路径与带的密钥。 */
const seen: string[] = [];
const paths: string[] = [];
const endpoint = createServer((request, response) => {
    request.resume();
    request.on("end", () => {
        seen.push(request.headers.authorization ?? "");
        paths.push(request.url ?? "");
        response.writeHead(200, {"content-type": "application/json"});
        response.end(JSON.stringify({results: [{rerank_score: 1.8, title: "示例", url: "https://example.com/a", snippet: "片段", summary: "摘要", content: "", site_name: null, site_icon: null, date: null, authority: 3}]}));
    });
});

let tmp = "";
let base = "";
let stateRoot = "";
let server: ProductServer;

test.beforeAll(async () => {
    await new Promise<void>((resolve) => endpoint.listen(0, "127.0.0.1", resolve));
    base = `http://127.0.0.1:${String((endpoint.address() as AddressInfo).port)}`;
    tmp = await createTestTmpRoot("neuro-book-e2e", "web-settings");
});

test.beforeEach(async () => {
    seen.length = 0;
    paths.length = 0;
    const root = join(tmp, randomUUID());
    stateRoot = join(root, "state");
    const projectDir = join(root, "Book");
    const id = randomUUID();
    await mkdir(join(projectDir, ".nbook"), {recursive: true});
    await mkdir(stateRoot, {recursive: true});
    await writeFile(join(projectDir, ".nbook", "project.json"), JSON.stringify({schema: 1, id}));
    await writeFile(join(stateRoot, "projects.json"), JSON.stringify({schema: 1, projects: [{id, name: "book", path: projectDir}]}));
    await writeFile(join(stateRoot, "settings.json"), `${JSON.stringify({"nbook.web/deepseekBaseUrl": base, "nbook.web/tavilyBaseUrl": `${base}/tavily`})}\n`);
    server = await startProductServer(stateRoot);
});

test.afterEach(async () => {
    expect(await server.stop()).toBe(0);
});

test.afterAll(async () => {
    await new Promise<void>((resolve) => endpoint.close(() => resolve()));
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

async function openSearchPage(page: Page): Promise<void> {
    await page.goto(new URL("/workbench", server.url).href);
    await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-window-state", "ready");
    await page.locator("[data-activity-item='nbook.settings']").click();
    await page.locator("[data-settings-nav='nbook.web.search']").click();
    await expect(page.locator("[data-search-settings]")).toBeVisible();
}

const detail = (page: Page) => page.locator("[data-search-detail]");
const userSettings = async (): Promise<Record<string, unknown>> => JSON.parse(await readFile(join(stateRoot, "settings.json"), "utf8")) as Record<string, unknown>;

test("验收 1、2：第一次填完直接点检测，用到刚填的密钥；已设置时框为空；回车换一把后检测用新的；清除后检测停用", async ({page}) => {
    await openSearchPage(page);
    // 第一次显示时选中使用中的那家（缺省 DeepSeek）。
    await expect(detail(page)).toHaveAttribute("data-search-detail", "deepseek");
    const key = detail(page).locator("[data-key-input]");
    const check = detail(page).locator("[data-search-check]");
    const result = detail(page).locator("[data-search-check-result]");
    const keysFile = async (): Promise<unknown> => JSON.parse(await readFile(join(stateRoot, "web", "keys.json"), "utf8"));
    await expect(key).toHaveAttribute("placeholder", "还没有填写");
    await expect(check).toBeDisabled();

    // 验收 2：还没有密钥，只填不按回车，直接点“检测”：框里有输入时按钮可点，按下时框先失焦写入，检测等写入结束再发。
    await key.fill(FIRST);
    await check.click();
    await expect(result).toContainText("检测通过");
    expect(seen).toEqual([`Bearer ${FIRST}`]);
    await expect(detail(page).locator("[data-key-clear]")).toBeVisible();
    await expect(key).toHaveValue("");
    await expect(key).toHaveAttribute("placeholder", "已设置");
    expect(await page.content()).not.toContain(FIRST);
    expect(await keysFile()).toEqual({version: 1, keys: {deepseek: FIRST}});

    // 验收 1：回车写入；写入成功后旧的检测结果清掉，再检测用到新的。
    await key.fill(SECOND);
    await key.press("Enter");
    await expect(result).toHaveText("");
    await expect.poll(keysFile).toEqual({version: 1, keys: {deepseek: SECOND}});
    // 结果写在预留的一行里：出现时不推动下面的“高级”（输出 8）。
    const advanced = detail(page).locator("[data-search-advanced]");
    const before = (await advanced.boundingBox())?.y;
    expect(before).toBeDefined();
    await check.click();
    await expect.poll(() => seen.length).toBe(2);
    expect(seen.at(-1)).toBe(`Bearer ${SECOND}`);
    await expect(result).toContainText("检测通过");
    expect((await advanced.boundingBox())?.y).toBe(before);

    await detail(page).locator("[data-key-clear]").click();
    await expect(key).toHaveAttribute("placeholder", "还没有填写");
    await expect(check).toBeDisabled();
    await expect(result).toHaveText("");
});

test("验收 3、4：DeepSeek 有密钥在用时把 Tavily 设为使用中，先不切、焦点进它的密钥框；填好回车后切过去；关掉再开设置窗口仍选中 Tavily，检测走 Tavily", async ({page}) => {
    await openSearchPage(page);
    await detail(page).locator("[data-key-input]").fill(FIRST);
    await detail(page).locator("[data-key-input]").press("Enter");
    await expect(detail(page).locator("[data-key-clear]")).toBeVisible();

    await page.locator("[data-search-rail-item='tavily']").click();
    await expect(detail(page)).toHaveAttribute("data-search-detail", "tavily");
    await detail(page).locator("[data-search-use-action]").click();
    await expect(detail(page).locator("[data-key-notice]")).toHaveText("填写密钥后即可启用");
    await expect(detail(page).locator("[data-key-input]")).toBeFocused();
    expect((await userSettings())["nbook.web/provider"]).toBeUndefined();

    await page.keyboard.type(TAVILY);
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await userSettings())["nbook.web/provider"]).toBe("tavily");
    await expect(page.locator("[data-search-rail-item='tavily'] [data-search-in-use]")).toBeVisible();
    await expect(page.locator("[data-search-rail-item='deepseek'] [data-search-in-use]")).toHaveCount(0);

    // 关掉设置窗口再打开：选中的是使用中的 Tavily。
    await page.locator("[data-activity-item='nbook.settings']").click();
    await expect(page.locator("[data-search-settings]")).toHaveCount(0);
    await page.locator("[data-activity-item='nbook.settings']").click();
    await page.locator("[data-settings-nav='nbook.web.search']").click();
    await expect(detail(page)).toHaveAttribute("data-search-detail", "tavily");
    await expect(detail(page).locator("[data-search-in-use]")).toBeVisible();
    seen.length = 0;
    paths.length = 0;
    await detail(page).locator("[data-search-check]").click();
    await expect(detail(page).locator("[data-search-check-result]")).toContainText("检测通过");
    expect(paths).toEqual(["/tavily/search"]);
    expect(seen).toEqual([`Bearer ${TAVILY}`]);
});

test("验收 5：改默认结果条数、加一个屏蔽网站、改 Tavily 的接口地址与搜索深度，设置文件用户层里是这几个值", async ({page}) => {
    await openSearchPage(page);
    await page.locator("[data-search-rail-item='rules']").click();
    await expect(detail(page)).toHaveAttribute("data-search-detail", "rules");
    const count = detail(page).locator("[data-search-count] input, input[data-search-count]").first();
    await count.fill("7");
    await expect.poll(async () => (await userSettings())["nbook.web/resultCount"]).toBe(7);
    const blocked = detail(page).locator("[data-search-blocked] input, input[data-search-blocked]").first();
    await blocked.fill("https://Blog.CSDN.net/a");
    await blocked.press("Enter");
    await expect.poll(async () => (await userSettings())["nbook.web/blockedSites"]).toEqual(["blog.csdn.net"]);
    await expect(page.locator("[data-search-rail-item='rules']")).toContainText("1");
    // 粘贴几行：单行输入框会去掉换行，页面在粘贴时按行拆开（输出 12）。
    await blocked.evaluate((input) => {
        const data = new DataTransfer();
        data.setData("text/plain", "zhihu.com\nbaidu.com");
        input.dispatchEvent(new ClipboardEvent("paste", {clipboardData: data, bubbles: true, cancelable: true}));
    });
    await expect.poll(async () => (await userSettings())["nbook.web/blockedSites"]).toEqual(["blog.csdn.net", "zhihu.com", "baidu.com"]);

    await page.locator("[data-search-rail-item='tavily']").click();
    // 这里的设置文件改过 Tavily 的接口地址（指向本机假端点）：它的“高级”默认展开（输出 13）。
    await expect(detail(page).locator("[data-search-advanced]")).toHaveAttribute("aria-expanded", "true");
    const url = detail(page).locator("[data-search-base-url] input, input[data-search-base-url]").first();
    await url.fill(`${base}/tavily-relay`);
    await url.press("Enter");
    await expect.poll(async () => (await userSettings())["nbook.web/tavilyBaseUrl"]).toBe(`${base}/tavily-relay`);
    await detail(page).locator("[data-search-depth] [data-value='advanced']").click();
    await expect.poll(async () => (await userSettings())["nbook.web/tavilySearchDepth"]).toBe("advanced");
});
