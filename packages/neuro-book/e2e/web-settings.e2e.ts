/**
 * “搜索与网页”设置页（docs/specs/web/settings-page.md 的“验收与 Smoke”）：生产构建的服务端、真实浏览器、本机的假 DeepSeek 接口
 * （`nbook.web-tools/deepseekBaseUrl` 指向它）。这里的密钥是假的，只发往本机。
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

/** 本机假 DeepSeek 接口：搜索回一条结果，记下每次请求带的密钥。 */
const seen: string[] = [];
const endpoint = createServer((request, response) => {
    request.resume();
    request.on("end", () => {
        seen.push(request.headers.authorization ?? "");
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
    const root = join(tmp, randomUUID());
    stateRoot = join(root, "state");
    const projectDir = join(root, "Book");
    const id = randomUUID();
    await mkdir(join(projectDir, ".nbook"), {recursive: true});
    await mkdir(stateRoot, {recursive: true});
    await writeFile(join(projectDir, ".nbook", "project.json"), JSON.stringify({schema: 1, id}));
    await writeFile(join(stateRoot, "projects.json"), JSON.stringify({schema: 1, projects: [{id, name: "book", path: projectDir}]}));
    await writeFile(join(stateRoot, "settings.json"), `${JSON.stringify({"nbook.web-tools/deepseekBaseUrl": base})}\n`);
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
    await page.locator("[data-settings-nav='nbook.web-tools.search']").click();
    await expect(page.locator("[data-search-settings]")).toBeVisible();
}

test("验收 1、2：第一次填完直接点检测，用到刚填的密钥；已设置时框为空；回车换一把后检测用新的；清除后检测停用", async ({page}) => {
    await openSearchPage(page);
    const key = page.locator("[data-search-settings] [data-key-input]");
    const check = page.locator("[data-search-check]");
    const result = page.locator("[data-search-check-result]");
    const keysFile = async (): Promise<unknown> => JSON.parse(await readFile(join(stateRoot, "web", "keys.json"), "utf8"));
    await expect(key).toHaveAttribute("placeholder", "还没有填写");
    await expect(check).toBeDisabled();

    // 验收 2：还没有密钥，只填不按回车，直接点“检测”：框里有输入时按钮可点，按下时框先失焦写入，检测等写入结束再发。
    await key.fill(FIRST);
    await check.click();
    await expect(result).toContainText("检测通过");
    expect(seen).toEqual([`Bearer ${FIRST}`]);
    await expect(page.locator("[data-search-settings] [data-key-clear]")).toBeVisible();
    await expect(key).toHaveValue("");
    await expect(key).toHaveAttribute("placeholder", "已设置");
    expect(await page.content()).not.toContain(FIRST);
    expect(await keysFile()).toEqual({version: 1, keys: {deepseek: FIRST}});

    // 验收 1：回车写入；写入成功后旧的检测结果清掉，再检测用到新的。
    await key.fill(SECOND);
    await key.press("Enter");
    await expect(result).toHaveText("");
    await expect.poll(keysFile).toEqual({version: 1, keys: {deepseek: SECOND}});
    await check.click();
    await expect.poll(() => seen.length).toBe(2);
    expect(seen.at(-1)).toBe(`Bearer ${SECOND}`);
    await expect(result).toContainText("检测通过");

    await page.locator("[data-search-settings] [data-key-clear]").click();
    await expect(key).toHaveAttribute("placeholder", "还没有填写");
    await expect(check).toBeDisabled();
    await expect(result).toHaveText("");
});
