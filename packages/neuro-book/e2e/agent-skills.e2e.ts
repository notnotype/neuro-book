/**
 * Skill 在真实 Chrome 里的验收（docs/specs/agent/skills.md 场景 2、3、4）：生产构建的后端与前端，Skill 放在状态根的 `user/skills/`，
 * 模型是 Bun 子进程里的本机端点。初始化真跑应用自带的 Bun，依赖是本地的 `file:` 包，不联网。等页面上可观察的变化，不按时长等待。
 */

import {spawn} from "node:child_process";
import {randomUUID} from "node:crypto";
import {access, mkdir, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

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

async function control(path: string, body?: unknown): Promise<unknown> {
    const response = await fetch(`${endpoint.control}${path}`, body === undefined ? {} : {method: "POST", body: JSON.stringify(body)});
    return response.json();
}
const script = (...replies: unknown[]) => control("/script", replies);
const lastRequest = async () => JSON.stringify((await control("/requests") as {messages: unknown[]}[]).at(-1)!.messages);

const STYLE_BODY = "改写时用第一人称、过去时，对白另起一行。";

async function writeSkill(name: string, body: string, extra: Readonly<Record<string, string>> = {}): Promise<string> {
    const directory = join(stateRoot, "user", "skills", name);
    await mkdir(directory, {recursive: true});
    await writeFile(join(directory, "SKILL.md"), `---\nname: ${name}\ndescription: ${name} 的说明\n---\n\n${body}\n`);
    for (const [file, content] of Object.entries(extra)) await writeFile(join(directory, file), content);
    return directory;
}

test.beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-e2e", "agent-skills");
    const projectDir = join(tmp, "Book");
    stateRoot = join(tmp, "state");
    const id = randomUUID();
    await mkdir(join(projectDir, ".nbook"), {recursive: true});
    await mkdir(join(projectDir, "正文"), {recursive: true});
    await writeFile(join(projectDir, ".nbook/project.json"), JSON.stringify({schema: 1, id}));
    await writeFile(join(projectDir, "正文/第三章.md"), "雨越下越大。\n");
    await mkdir(join(stateRoot, "user"), {recursive: true});
    await writeFile(join(stateRoot, "projects.json"), JSON.stringify({schema: 1, projects: [{id, name: "book", path: projectDir}]}));

    // 带依赖的 Skill 只依赖一个本地包：初始化真跑 `bun install`，但不联网。没有 bun.lock，确认后按 resolve 生成。
    const dep = join(tmp, "local-dep");
    await mkdir(dep, {recursive: true});
    await writeFile(join(dep, "package.json"), JSON.stringify({name: "local-dep", version: "1.0.0", main: "index.js"}));
    await writeFile(join(dep, "index.js"), "module.exports = {answer: 42};\n");
    await writeSkill("style-guide", STYLE_BODY);
    await writeSkill("epub-export", "把章节导成 EPUB。", {"package.json": JSON.stringify({name: "epub-export", private: true, dependencies: {"local-dep": `file:${dep}`}})});

    const child = spawn("bun", [join("e2e", "support", "agent-endpoint.ts")], {cwd: PACKAGE_ROOT, stdio: ["pipe", "pipe", "pipe"]});
    const handle = track(child);
    const [, baseUrl, controlUrl] = await handle.waitFor(/READY (\S+) (\S+)/u);
    endpoint = {...handle, control: controlUrl!, child};
    await writeFile(join(stateRoot, "settings.json"), JSON.stringify(localModelSettings(baseUrl!)));
    server = await startProductServer(stateRoot);
});

test.afterAll(async () => {
    expect(await server.stop()).toBe(0);
    endpoint.child.stdin?.end();
    await endpoint.exit;
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

const input = (page: Page) => page.getByRole("textbox", {name: "消息输入框"});
const option = (page: Page, name: RegExp) => page.getByRole("option", {name});

async function openConversation(page: Page): Promise<void> {
    await page.goto(new URL("/?project=book", server.url).href);
    await expect(page.locator("[data-explorer-row]").first()).toBeVisible();
    await page.keyboard.press("Control+Shift+P");
    await page.keyboard.type("打开对话");
    await page.keyboard.press("Enter");
    await expect(input(page)).toBeVisible();
}

test("场景 2：$ 菜单列出主创能用的 Skill，未初始化的带状态；选一个发出去，模型收到的这一轮里 Skill 正文在用户的话前面", async ({page}) => {
    await script("改好了");
    await openConversation(page);
    await input(page).click();
    await page.keyboard.type("$");
    await expect(option(page, /style-guide/u)).toBeVisible();
    // 状态的意思读在名称与说明之后：未初始化的那一项的可访问名称里有它。
    await expect(option(page, /epub-export.*未初始化/u)).toBeVisible();
    await expect(option(page, /style-guide.*未初始化/u)).toHaveCount(0);

    await page.keyboard.type("sty");
    await expect(option(page, /style-guide/u)).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Enter");
    await expect(input(page).locator("[data-inline-chip='skill']")).toHaveText(/style-guide/u);
    await page.keyboard.type("改一下第三章");
    await page.keyboard.press("Enter");
    await expect(page.getByText("改好了", {exact: true})).toBeVisible();

    const sent = await lastRequest();
    expect(sent).toContain(STYLE_BODY);
    expect(sent.indexOf(STYLE_BODY)).toBeLessThan(sent.lastIndexOf("改一下第三章"));
});

test("场景 3：不存在的 $x 不带正文，模型看到它没带上的提醒；行内代码里的 $HOME 不算标签", async ({page}) => {
    await script("知道了");
    await openConversation(page);
    await input(page).click();
    // 打到空格时菜单已经关上（查询词不含空白），回车就是发送。
    await page.keyboard.type("用 $nothing 改，别动 `$HOME` 这一行");
    await page.keyboard.press("Enter");
    await expect(page.getByText("知道了", {exact: true})).toBeVisible();

    const sent = await lastRequest();
    expect(sent).toContain("$nothing 没有作为 Skill 带上");
    expect(sent).not.toContain("$HOME 没有作为 Skill 带上");
    expect(sent).not.toContain("<skill ");
});

test("场景 4：选未初始化的 Skill 先问；确认后装好、后台任务报成功，菜单里不再标未初始化；标签照样插进输入框", async ({page}) => {
    await openConversation(page);
    await input(page).click();
    await page.keyboard.type("$epub");
    await expect(option(page, /epub-export/u)).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Enter");

    // 确认框是模态的：开着时输入框对读屏隐藏，标签插没插进去等它关上再看。
    const dialog = page.locator("[data-skill-init]");
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("[data-skill-init-head]")).toHaveText("要装 1 个直接依赖，需要联网。");
    await expect(dialog.locator("[data-skill-init-box]")).toHaveText("local-dep");
    await expect(dialog.locator("[data-skill-init-note]")).toContainText("会按最新版本解析依赖并生成锁文件");
    await dialog.locator("[data-skill-init-confirm]").click();
    await expect(dialog).toBeHidden({timeout: 60_000});
    await expect(input(page).locator("[data-inline-chip='skill']")).toHaveText(/epub-export/u);

    // 应用里开始的初始化是一件后台任务：成功时弹按时消失的通知（skills.md 输出 29，background-tasks.md 输出 14）。
    await expect(page.locator("[data-notification-stack] [role='status']").filter({hasText: "初始化 Skill epub-export"})).toContainText("已可用");
    await access(join(stateRoot, "user", "skills", "epub-export", "bun.lock"));

    await input(page).click();
    await page.keyboard.press("End");
    await page.keyboard.type(" $epub");
    await expect(option(page, /epub-export/u)).toBeVisible();
    await expect(option(page, /epub-export.*未初始化/u)).toHaveCount(0);
});
