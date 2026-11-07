/**
 * Profile 设置页在真实 Chrome 里的验收（docs/specs/agent/profile-settings.md“验收与 Smoke”）：生产构建的后端与前端，设置与用户级 Profile 的文件都是真的，模型是
 * Bun 子进程里的本机端点。等页面上可观察的变化，不按时长等待。
 */

import {spawn} from "node:child_process";
import {randomUUID} from "node:crypto";
import {mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {expect, test} from "@playwright/test";
import type {Page} from "@playwright/test";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";
import {parse as parseJsonc} from "jsonc-parser";

import {localModelSettings} from "nbook/plugins/agent/testing/endpoint";

import {PACKAGE_ROOT, startProductServer, track} from "./fixtures";
import type {ProcessHandle, ProductServer} from "./fixtures";

let tmp = "";
let stateRoot = "";
let server: ProductServer;
let endpoint: ProcessHandle & {control: string; child: ReturnType<typeof spawn>};

async function control(path: string, body?: unknown): Promise<unknown> {
    const response = await fetch(`${endpoint.control}${path}`, body === undefined ? {} : {method: "POST", body: JSON.stringify(body)});
    return response.json();
}
const requests = async () => await control("/requests") as {messages: unknown[]; tools: string[]}[];

test.beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-e2e", "agent-profiles");
    const projectDir = join(tmp, "Book");
    stateRoot = join(tmp, "state");
    const id = randomUUID();
    await mkdir(join(projectDir, ".nbook"), {recursive: true});
    await writeFile(join(projectDir, ".nbook/project.json"), JSON.stringify({schema: 1, id}));
    await writeFile(join(projectDir, "说明.md"), "一本书。\n");
    await mkdir(join(stateRoot, "user"), {recursive: true});
    await writeFile(join(stateRoot, "projects.json"), JSON.stringify({schema: 1, projects: [{id, name: "book", path: projectDir}]}));
    const child = spawn("bun", [join("e2e", "support", "agent-endpoint.ts")], {cwd: PACKAGE_ROOT, stdio: ["pipe", "pipe", "pipe"]});
    const handle = track(child);
    const [, baseUrl, controlUrl] = await handle.waitFor(/READY (\S+) (\S+)/u);
    endpoint = {...handle, control: controlUrl!, child};
    await writeFile(join(stateRoot, "settings.json"), JSON.stringify(localModelSettings(baseUrl!, {compactionRole: true})));
    server = await startProductServer(stateRoot);
});

test.afterAll(async () => {
    expect(await server.stop()).toBe(0);
    endpoint.child.stdin?.end();
    await endpoint.exit;
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

const settingsFile = async () => parseJsonc(await readFile(join(stateRoot, "settings.json"), "utf8")) as Record<string, Record<string, {added?: string[]; removed?: string[]; model?: string}> | undefined>;
const profileFile = (name: string) => join(stateRoot, "user", "profiles", `${name}.profile.tsx`);

/** 打开作品和设置窗口的 Profile 分区。 */
async function openProfiles(page: Page): Promise<void> {
    await page.goto(new URL("/?project=book", server.url).href);
    await expect(page.locator("[data-explorer-row]").first()).toBeVisible();
    await expect(async () => {
        await page.keyboard.press("Control+,");
        await expect(page.locator("[data-settings-nav-current]")).toBeFocused({timeout: 500});
    }).toPass();
    await page.locator("[data-settings-window]").getByRole("button", {name: "Profile", exact: true}).click();
    await expect(page.locator("[data-profile-rail-item='nbook.agent.main']")).toBeVisible();
}

const topOf = async (page: Page, selector: string): Promise<number> => (await page.locator(selector).boundingBox())!.y;

test("验收：新建、去掉工具、绑模型；改坏时标有错误、位置不动，修好恢复；删除后回到第一项", async ({page}) => {
    await openProfiles(page);

    // 新建：文件打开在编辑器里，选中新的。
    await page.locator("[data-profile-create]").click();
    await page.locator("[data-profile-new] input").fill("lore-check");
    await page.getByRole("button", {name: "新建并打开"}).click();
    await expect(page.locator("[data-profile-detail='user.lore-check']")).toBeVisible();
    expect(await readFile(profileFile("lore-check"), "utf8")).toContain("defineProfile");
    await expect(page.getByRole("tab", {name: /lore-check\.profile\.tsx/u})).toBeVisible();
    await expect(page.locator("[data-profile-notice]")).toHaveCount(0);

    // 去掉一个工具：写进绑定，页面不再列。
    await page.locator("[data-profile-tool='nbook.agent.grep'] [data-profile-tool-remove]").click();
    await expect(page.locator("[data-profile-tool='nbook.agent.grep']")).toHaveCount(0);
    await expect.poll(async () => (await settingsFile())["nbook.agent/toolBindings"]?.["user.lore-check"]?.removed).toEqual(["nbook.agent.grep"]);

    // 选一个模型：写进 Profile 设置。
    await page.locator("[data-profile-model] input").click();
    await page.getByRole("option", {name: /本机/u}).first().click();
    await expect.poll(async () => (await settingsFile())["nbook.agent/profileSettings"]?.["user.lore-check"]?.model).toBeTruthy();

    // 改坏：头部标错误，下面的内容位置不动。
    const before = await topOf(page, "[data-profile-model]");
    const source = await readFile(profileFile("lore-check"), "utf8");
    await writeFile(profileFile("lore-check"), `${source}\nconst = ;\n`);
    await expect(page.locator("[data-profile-notice]")).toBeVisible();
    await expect(page.locator("[data-profile-rail-item='user.lore-check']")).toContainText("有错误");
    expect(await topOf(page, "[data-profile-model]")).toBe(before);
    // 上一次成功的还在用：工具一节还在。
    await expect(page.locator("[data-profile-tool='nbook.agent.read']")).toBeVisible();

    // 修好恢复。
    await writeFile(profileFile("lore-check"), source);
    await expect(page.locator("[data-profile-notice]")).toHaveCount(0);

    // 删除：确认后回到第一项，焦点落在它上面，文件没了。
    await page.locator("[data-profile-delete]").click();
    await expect(page.getByRole("alertdialog")).toContainText("不能恢复");
    await page.getByRole("alertdialog").getByRole("button", {name: "删除"}).click();
    await expect(page.locator("[data-profile-detail='nbook.agent.main']")).toBeVisible();
    await expect(page.locator("[data-profile-rail-item='nbook.agent.main']")).toBeFocused();
    await expect.poll(async () => readFile(profileFile("lore-check"), "utf8").then(() => true, () => false)).toBe(false);
});

test("验收：新建的 Profile 给新会话用，去掉的工具不在请求里", async ({page}) => {
    await openProfiles(page);
    await page.locator("[data-profile-create]").click();
    await page.locator("[data-profile-new] input").fill("for-session");
    await page.getByRole("button", {name: "新建并打开"}).click();
    await expect(page.locator("[data-profile-detail='user.for-session']")).toBeVisible();
    await page.locator("[data-profile-tool='nbook.agent.glob'] [data-profile-tool-remove]").click();
    await expect.poll(async () => (await settingsFile())["nbook.agent/toolBindings"]?.["user.for-session"]?.removed).toEqual(["nbook.agent.glob"]);
    await page.locator("[data-dialog-surface]:has([data-settings-window])").getByRole("button", {name: "关闭"}).click();
    await expect(page.locator("[data-settings-window]")).toHaveCount(0);

    await control("/script", ["好的。"]);
    await page.keyboard.press("Control+Shift+P");
    await page.keyboard.type("新建 Agent 会话");
    await page.keyboard.press("Enter");
    await page.getByRole("option", {name: /for-session/u}).click();
    const input = page.getByRole("textbox", {name: "消息输入框"});
    await input.click();
    const sent = (await requests()).length;
    await page.keyboard.type("你好");
    await page.keyboard.press("Enter");
    await expect(page.getByText("好的。")).toBeVisible();
    const request = (await requests())[sent]!;
    expect(request.tools).toContain("read");
    expect(request.tools).not.toContain("glob");
});

test("验收：两个窗口同时改不同 Profile、同一 Profile 的不同字段，都不丢", async ({browser}) => {
    const first = await (await browser.newContext()).newPage();
    const second = await (await browser.newContext()).newPage();
    await openProfiles(first);
    await openProfiles(second);
    const approval = async (page: Page, label: string) => {
        await page.locator("[data-profile-approval] [role='combobox']").click();
        await page.getByRole("option", {name: label, exact: true}).click();
    };
    await Promise.all([
        approval(first, "自动判断"),
        (async () => {
            await second.locator("[data-profile-model] input").click();
            await second.getByRole("option", {name: /本机/u}).first().click();
        })(),
    ]);
    await expect.poll(async () => (await settingsFile())["nbook.agent/profileSettings"]?.["nbook.agent.main"]).toMatchObject({approvalMode: "auto", model: expect.any(String)});
    await second.locator("[data-profile-rail-item='nbook.agent.session-title']").click();
    await second.locator("[data-profile-model] input").click();
    await second.getByRole("option", {name: /本机/u}).first().click();
    await expect.poll(async () => (await settingsFile())["nbook.agent/profileSettings"]?.["nbook.agent.session-title"]?.model).toBeTruthy();
    await expect.poll(async () => (await settingsFile())["nbook.agent/profileSettings"]?.["nbook.agent.main"]).toMatchObject({approvalMode: "auto"});
});
