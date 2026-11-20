/**
 * 应用 npm 包的安装验收（docs/specs/runtime/cli.md 场景 1、7，ADR 0033）：用 `scripts/pack-app.ts` 把这次的生产构建打成
 * tarball，`bun add -g` 装进临时的 `BUN_INSTALL`，之后只用装出来的 `nbook`：在真实 Chrome 里打开绑定作品的工作台（项目子进程
 * 是包里的 `project.js`），`nbook plugin install` 一个声明式插件，重启服务后它的配置项出现在设置窗口。包里没有依赖：它在
 * 仓库的 `node_modules` 之外运行。
 */

import {execFileSync, spawn} from "node:child_process";
import {randomUUID} from "node:crypto";
import {mkdir, rm, writeFile} from "node:fs/promises";
import {join} from "node:path";

import {expect, test} from "@playwright/test";
import type {Page} from "@playwright/test";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {PACKAGE_ROOT, track} from "./fixtures";
import type {ProcessHandle} from "./fixtures";

const PLUGIN = join(PACKAGE_ROOT, "plugin-sdk", "examples", "external", "declarative");
const SETTING = "example.hello/greeting";

let tmp = "";
let nbook = "";
/** 起过的 nbook：用例失败时 afterAll 结束还活着的。 */
const started = new Set<Started>();
let stateRoot = "";
let projectDir = "";

test.beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-e2e", "app-package");
    const packed = execFileSync("bun", ["scripts/pack-app.ts", join(tmp, "package", "neuro-book")], {cwd: PACKAGE_ROOT, encoding: "utf8"});
    const tarball = packed.trim().split("\n").at(-1)!;
    const bunInstall = join(tmp, "bun");
    // 在临时目录里装：不让仓库的 node_modules 与 bunfig 影响解析。
    await mkdir(join(tmp, "elsewhere"), {recursive: true});
    execFileSync("bun", ["add", "-g", tarball], {cwd: join(tmp, "elsewhere"), env: {...process.env, BUN_INSTALL: bunInstall}, stdio: "pipe"});
    nbook = join(bunInstall, "bin", "nbook");

    stateRoot = join(tmp, "state");
    projectDir = join(tmp, "Book");
    const id = randomUUID();
    await mkdir(join(projectDir, ".nbook"), {recursive: true});
    await mkdir(stateRoot, {recursive: true});
    await writeFile(join(projectDir, ".nbook", "project.json"), JSON.stringify({schema: 1, id}));
    await writeFile(join(stateRoot, "projects.json"), JSON.stringify({schema: 1, projects: [{id, name: "book", path: projectDir}]}));
});

test.afterAll(async () => {
    for (const server of started) {
        if (server.child.exitCode === null && server.child.signalCode === null) server.child.kill("SIGKILL");
        await server.exit;
    }
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

interface Started extends ProcessHandle {
    readonly url: string;
}

/** 装出来的 `nbook start`：前台运行，读它的结果对象。 */
async function start(): Promise<Started> {
    const child = spawn(nbook, ["start", "--state-root", stateRoot, "--port", "0", "--no-open", "--json"], {cwd: join(tmp, "elsewhere"), env: {...process.env, HOME: tmp}});
    const handle = track(child);
    const pending: Started = {...handle, url: ""};
    started.add(pending);
    const line = (await handle.waitFor(/^\{.*"ok":true.*\}$/mu))[0];
    const result = JSON.parse(line) as {url: string; started: boolean};
    expect(result.started).toBe(true);
    return {...handle, url: result.url};
}

async function stop(page: Page, server: Started): Promise<void> {
    // 先让页面离开：页面开着时停服务端，配置层断开会记一条警告，那是重启本身的结果。
    await page.goto("about:blank");
    server.child.kill("SIGINT");
    expect(await server.exit).toBe(0);
}

function nbookJson(args: readonly string[]): Record<string, unknown> {
    // 提示写标准错误，结果对象写标准输出：只读后者。
    const out = execFileSync(nbook, [...args, "--state-root", stateRoot, "--json"], {cwd: join(tmp, "elsewhere"), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]});
    return JSON.parse(out) as Record<string, unknown>;
}

test("从 npm 包装上的 nbook：打开作品（项目子进程）、装插件、重启后生效", async ({page}) => {
    const problems: string[] = [];
    page.on("console", (message) => {
        if (message.type() === "error" || message.type() === "warning") problems.push(`${message.type()}: ${message.text()}`);
    });
    page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));

    let server = await start();
    await page.goto(new URL("/?project=book", server.url).href);
    const root = page.locator("[data-workbench-root]");
    await expect(root).toHaveAttribute("data-rpc-state", "online");
    // 绑定作品成功：项目子进程（包里的 project.js）起来了。
    await expect(page.locator("[data-workbench-project]")).toHaveAttribute("data-workbench-project", "book");
    // 内置表情包（docs/specs/agent/stickers.md 的内置来源）：装好的包里服务端按 `<包>/stickers/` 找到它，取图路由给出图片。
    expect(await page.evaluate(async () => {
        const response = await fetch("/api/nbook.stickers/image/builtin.lyra/kaixin.webp");
        return [response.status, response.headers.get("content-type")];
    })).toEqual([200, "image/webp"]);

    expect(nbookJson(["plugin", "install", PLUGIN])).toMatchObject({ok: true, preview: {id: "example.hello", relation: "install"}, restartRequired: true});
    expect(nbookJson(["plugin", "list"])).toMatchObject({running: {url: server.url}});

    await stop(page, server);
    server = await start();
    await page.goto(new URL("/?project=book", server.url).href);
    await expect(root).toHaveAttribute("data-window-state", "ready");
    await page.locator("[data-activity-item='nbook.settings']").click();
    await page.locator("[data-settings-nav='other']").click();
    await expect(page.locator(`[data-settings-row="${SETTING}"]`)).toBeVisible();
    await stop(page, server);
    expect(problems).toEqual([]);
});
