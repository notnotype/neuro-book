/**
 * 模型请求记录在真实 Chrome 里的验收（docs/specs/agent/request-trace.md 验收 1、4、6）：生产构建的后端与前端，项目与设置都是真的，
 * 模型是 Bun 子进程里的本机端点（能看图）。等页面上可观察的变化，不按时长等待。
 *
 * 验收 2（429 后成功的两次尝试、请求头的遮盖）由 nb-harness 的 `tests/models.test.ts`（真实 HTTP）与 `kit/requests/recorder.test.ts`
 * 覆盖；验收 3（进程中途退出）由 `recorder.test.ts` 的子进程用例覆盖；验收 5（拖窄拖宽）在 Lab 的真实浏览器里看。
 */

import {spawn} from "node:child_process";
import {randomUUID} from "node:crypto";
import {mkdir, readdir, readFile, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";
import {gunzipSync} from "node:zlib";

import {expect, test} from "@playwright/test";
import type {Page} from "@playwright/test";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {localModelSettings} from "nbook/plugins/agent/testing/endpoint";

import {PACKAGE_ROOT, startProductServer, track} from "./fixtures";
import type {ProcessHandle, ProductServer} from "./fixtures";

let tmp = "";
let stateRoot = "";
let server: ProductServer;
let endpoint: ProcessHandle & {control: string; child: ReturnType<typeof spawn>};

const script = async (...replies: unknown[]) => (await fetch(`${endpoint.control}/script`, {method: "POST", body: JSON.stringify(replies)})).json();

/** 一像素的 PNG：验收 6 查它的 base64 有没有进记录目录。 */
const PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

test.beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-e2e", "agent-request-trace");
    const projectDir = join(tmp, "Book");
    stateRoot = join(tmp, "state");
    const id = randomUUID();
    await mkdir(join(projectDir, ".nbook"), {recursive: true});
    await mkdir(join(projectDir, "正文"), {recursive: true});
    await writeFile(join(projectDir, ".nbook/project.json"), JSON.stringify({schema: 1, id}));
    await writeFile(join(projectDir, "正文/第三章.md"), "雨越下越大。\n他没有回头。\n巷口的灯灭了。\n");
    await mkdir(join(stateRoot, "user"), {recursive: true});
    await writeFile(join(stateRoot, "projects.json"), JSON.stringify({schema: 1, projects: [{id, name: "book", path: projectDir}]}));

    const child = spawn("bun", [join("e2e", "support", "agent-endpoint.ts")], {cwd: PACKAGE_ROOT, stdio: ["pipe", "pipe", "pipe"]});
    const handle = track(child);
    const [, baseUrl, controlUrl] = await handle.waitFor(/READY (\S+) (\S+)/u);
    endpoint = {...handle, control: controlUrl!, child};
    // 本机模型标成能看图：验收 6 的图片要真的进请求，记录器才有图可换。
    const settings = localModelSettings(baseUrl!) as {"nbook.models/providers": {models: Record<string, unknown>[]}[]};
    settings["nbook.models/providers"][0]!.models[0]!.vision = true;
    await writeFile(join(stateRoot, "settings.json"), JSON.stringify(settings));
    server = await startProductServer(stateRoot);
});

test.afterAll(async () => {
    expect(await server.stop()).toBe(0);
    endpoint.child.stdin?.end();
    await endpoint.exit;
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

const input = (page: Page) => page.getByRole("textbox", {name: "消息输入框"});
const trace = (page: Page) => page.locator(".art");

async function openConversation(page: Page): Promise<void> {
    await page.goto(new URL("/?project=book", server.url).href);
    await expect(page.locator("[data-explorer-row]").first()).toBeVisible();
    await page.keyboard.press("Control+Shift+P");
    await page.keyboard.type("打开对话");
    await page.keyboard.press("Enter");
    await expect(input(page)).toBeVisible();
}

async function send(page: Page, text: string): Promise<void> {
    await input(page).click();
    await page.keyboard.type(text);
    await page.keyboard.press("Enter");
}

/** 记录目录里全部文件的文字（请求体解压）。 */
async function recorded(): Promise<string> {
    const parts: string[] = [];
    const walk = async (directory: string): Promise<void> => {
        for (const entry of await readdir(directory, {withFileTypes: true})) {
            const path = join(directory, entry.name);
            if (entry.isDirectory()) await walk(path);
            else {
                const data = await readFile(path);
                parts.push(path.endsWith(".gz") ? gunzipSync(data).toString("utf8") : data.toString("utf8"));
            }
        }
    };
    await walk(join(stateRoot, "agent", "requests"));
    return parts.join("\n");
}

test("验收 1、4：一轮带一次工具调用有两条记录；回复上的“查看这次请求”选中第二条，前缀收起、回复在最后；查找的处数列表与详情一致", async ({page}, testInfo) => {
    await openConversation(page);
    await script({tool: "builtin.read", args: {path: "正文/第三章.md"}}, "读完了：雨夜那段很紧。");
    await send(page, "看看第三章的雨夜");
    await expect(page.getByText("读完了：雨夜那段很紧。")).toBeVisible();

    const assistant = page.locator(".acv-message[data-role='assistant']").last();
    await assistant.hover();
    await assistant.getByRole("button", {name: "查看这次请求"}).click();
    await expect(trace(page).locator("[data-request-row]")).toHaveCount(2);
    await expect(trace(page).locator("[data-request-row][aria-selected='true']")).toContainText("#2");
    await expect(trace(page).locator(".arl__group-head")).toHaveCount(1);
    // 编辑区不够宽时只显示一栏：带着选中打开，显示的是详情。
    await expect(trace(page).locator("[data-request-prefix]")).toBeVisible();
    await expect(trace(page).locator("[data-request-prefix]")).toContainText("第 1 条和 #1 相同");
    await expect(trace(page).locator(".ard__item[data-role='reply']")).toContainText("读完了：雨夜那段很紧。");
    await page.screenshot({path: testInfo.outputPath("trace.png")});

    await trace(page).locator("[data-request-search] input").fill("雨夜");
    await expect(trace(page).locator("[data-request-search-head]")).toContainText("找到 2 次请求");
    // 第二次请求里：用户的话一处、回复一处（回复是消息页的最后一条）。
    const selected = trace(page).locator("[data-request-row][aria-selected='true']");
    await expect(selected).toContainText("另 1 处");
    await expect(trace(page).locator("[data-request-findbar]")).toContainText("第 1 处，共 2 处");
    await expect(trace(page).locator("[data-request-find-page='messages']")).toContainText("2");
    await expect(trace(page).locator("mark[data-hit-current]")).toHaveText("雨夜");
});

test("验收 6：带一张图片附件发一轮，记录目录里搜不到这张图的 base64", async ({page}) => {
    await openConversation(page);
    await script("看到了，一个像素。");
    await page.locator("[data-composer-action='plus']").waitFor();
    await page.locator(".acv-composer__file-input").setInputFiles({name: "封面.png", mimeType: "image/png", buffer: Buffer.from(PNG_BASE64, "base64")});
    await expect(page.getByRole("list", {name: "附件"}).getByRole("listitem")).toHaveCount(1);
    await send(page, "看这张图");
    await expect(page.getByText("看到了，一个像素。")).toBeVisible();
    // 记录在回复交回之后排队写完：等到这次请求的回复进了记录目录。
    await expect.poll(async () => (await recorded()).includes("看到了，一个像素。"), {timeout: 15_000}).toBe(true);
    const text = await recorded();
    expect(text).toContain("image/png");
    expect(text).not.toContain(PNG_BASE64.slice(0, 40));
});
