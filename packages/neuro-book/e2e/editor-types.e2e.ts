/**
 * 按文件类型选编辑器在真实 Chrome 中的验收（docs/specs/workbench/editor.md 场景 22–26，workbench/image-viewer.md、
 * workbench/html-preview.md 的验收）：生产构建的后端与前端，项目 `book` 先登记好，文件在真实目录里。预览页在真实的沙箱
 * iframe 里运行，外网地址由 Playwright 的路由接住，不真的出网。等页面上可观察的变化，不按时长等待。
 */

import {randomUUID} from "node:crypto";
import {mkdir, readFile, rm, writeFile} from "node:fs/promises";
import {createRequire} from "node:module";
import {dirname, join} from "node:path";
import {DatabaseSync} from "node:sqlite";

import {expect, test} from "@playwright/test";
import type {Frame, Page} from "@playwright/test";
import {createTestTmpRoot} from "@notnotype/neuro-book-test-support/tmp";

import {CLIENT_IDENTITY_KEY} from "nbook/web/host/client-identity";

import {startProductServer} from "./fixtures";
import type {ProductServer} from "./fixtures";

/** 3×2 的红色 PNG 与 5×4 的半透明蓝色 PNG。 */
const PNG_3X2 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAYAAACddGYaAAAAEUlEQVR4nGP4z8DwH4YZkDkAm34L9XKwuTwAAAAASUVORK5CYII=", "base64");
const PNG_5X4 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAUAAAAECAYAAABGM/VAAAAAEUlEQVR4nGNgaPjfgIEpEwQAeXAn7UGteVgAAAAASUVORK5CYII=", "base64");

const SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><circle cx="10" cy="10" r="8" fill="red"/></svg>`;

/**
 * 预览页：相对引用的样式、图片、字体、模块脚本与 `fetch`，页内锚点，以及几条越界的尝试，结果都记在 `<body>` 的 data 属性上。
 * `__RPC__`、`__ORIGIN__` 在服务端起来之后换成真实的端口与应用源。
 */
const PAGE = `<!doctype html><html><head><meta charset="utf-8"><link rel="stylesheet" href="style.css"></head><body>
<h1 id="title">预览标题</h1>
<img id="img" src="img/a.png" alt="">
<p><a id="jump" href="#end">跳到末尾</a> <a id="other" href="other.html">另一页</a></p>
<div style="height:3000px"></div><p id="end">末尾</p>
<script type="module" src="./m.js"></script>
<script>
var mark = function (key, value) { document.body.dataset[key] = value; };
document.fonts.load("16px Probe").then(function (faces) { mark("font", faces.length > 0 ? "ok" : "none"); }, function () { mark("font", "fail"); });
fetch("data.json").then(function (r) { return r.json(); }).then(function (d) { mark("fetch", d.ok ? "ok" : "bad"); }, function () { mark("fetch", "fail"); });
try { void parent.document.title; mark("parent", "open"); } catch (e) { mark("parent", "denied"); }
document.addEventListener("securitypolicyviolation", function (e) { if (e.blockedURI.indexOf("net.example") >= 0) mark("net", "blocked"); });
fetch("https://net.example/x").then(function () { mark("net", "ok"); }, function () { if (!document.body.dataset.net) mark("net", "failed"); });
fetch("__ORIGIN__/api/runtime/health", {method: "POST", mode: "no-cors"}).then(function () { mark("post", "sent"); }, function () { mark("post", "blocked"); });
try { var ws = new WebSocket("ws://127.0.0.1:__RPC__/"); ws.onopen = function () { mark("rpc", "open"); }; ws.onerror = function () { mark("rpc", "refused"); }; } catch (e) { mark("rpc", "refused"); }
</script></body></html>
`;

let tmp = "";
let projectDir = "";
let stateRoot = "";
let server: ProductServer;

test.beforeAll(async () => {
    tmp = await createTestTmpRoot("neuro-book-e2e", "editor-types");
    projectDir = join(tmp, "Book");
    stateRoot = join(tmp, "state");
    const id = randomUUID();
    const files: Record<string, string | Uint8Array> = {
        ".nbook/project.json": JSON.stringify({schema: 1, id}),
        "img/a.png": PNG_3X2,
        "img/b.svg": SVG,
        // 2 MB 的 PDF：超过正文上限，按扩展名就知道是二进制，不读。
        "docs/manual.pdf": new Uint8Array(2 * 1024 * 1024).fill(0x25),
        // GBK 编码的“你好”：不是 UTF-8。
        "notes/gbk.txt": new Uint8Array([0xc4, 0xe3, 0xba, 0xc3]),
        // 字体经样式表里的相对地址加载：与模块脚本一样是跨源的 CORS 读取。字体文件借 Monaco 自带的 codicon。
        "site/style.css": "@font-face { font-family: Probe; src: url(fonts/f.ttf); }\n#title { color: rgb(1, 2, 3); }\n",
        "site/fonts/f.ttf": await readFile(createRequire(import.meta.url).resolve("monaco-editor/esm/vs/base/browser/ui/codicons/codicon/codicon.ttf")),
        "site/m.js": "document.body.dataset.module = \"ok\";\n",
        "site/data.json": "{\"ok\": true}\n",
        // 从预览页导航过去的另一页：加载的是预览路由给的原文，没有注入的 meta，网络限制要靠响应头。
        "site/other.html": "<!doctype html><html><body><script>document.addEventListener(\"securitypolicyviolation\", function (e) { if (e.blockedURI.indexOf(\"net.example\") >= 0) document.body.dataset.net = \"blocked\"; }); fetch(\"https://net.example/y\").then(function () { document.body.dataset.net = \"ok\"; }, function () { if (!document.body.dataset.net) document.body.dataset.net = \"failed\"; });</script></body></html>\n",
        "site/img/a.png": PNG_3X2,
        "code/a.py": "def hello():\n    return 1\n",
        "code/a.html": "<p>x</p>\n<script>\nconst answer = 42;\n</script>\n",
        "code/b.md": "# 标题\n\n```ts\nconst n: number = 1;\n```\n",
    };
    for (const [path, content] of Object.entries(files)) {
        await mkdir(dirname(join(projectDir, path)), {recursive: true});
        await writeFile(join(projectDir, path), content);
    }
    await mkdir(join(stateRoot, "user"), {recursive: true});
    await writeFile(join(stateRoot, "projects.json"), JSON.stringify({schema: 1, projects: [{id, name: "book", path: projectDir}]}));
    server = await startProductServer(stateRoot);
    const bootstrap = await (await fetch(new URL("/api/runtime/browser-bootstrap", server.url))).json() as {rpc: {port: number}};
    await writeFile(join(projectDir, "site/index.html"), PAGE.replace("__RPC__", String(bootstrap.rpc.port)).replace("__ORIGIN__", new URL(server.url).origin));
});

test.afterAll(async () => {
    expect(await server.stop()).toBe(0);
    if (tmp !== "") await rm(tmp, {recursive: true, force: true});
});

const item = (page: Page, address: string) => page.locator(`[data-explorer-row="${address}"]`);
const labels = (page: Page) => page.locator("[data-editor-group-head-active] [data-editor-tab-label]");
const status = (page: Page, id: string) => page.locator(`[data-workbench-status-bar] [data-workbench-item="${id}"]`);
const activeGroup = (page: Page) => page.locator("[data-editor-group-active]");
/** 活动组的头（标签条与标题动作）：在工作台的外框里，不在 `[data-editor-group]` 里面。 */
const activeHead = (page: Page) => page.locator("[data-editor-group-head-active]");

async function open(page: Page): Promise<void> {
    await page.goto(new URL("/?project=book", server.url).href);
    await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-rpc-state", "online");
    await expect(page.locator("[data-editor-group]").first()).toBeVisible();
}

/** 在资源管理器里展开一个顶层目录。 */
async function expand(page: Page, address: string): Promise<void> {
    if (await item(page, address).getAttribute("aria-expanded") !== "true") await item(page, address).click();
}

async function runCommand(page: Page, title: string): Promise<void> {
    const combobox = page.getByRole("combobox", {name: "输入命令，或输入 : 跳到某一行"});
    await expect(async () => {
        await page.keyboard.press("Control+Shift+P");
        await expect(combobox).toBeFocused({timeout: 500});
    }).toPass();
    await combobox.fill(title);
    await page.getByRole("option", {name: new RegExp(title, "u")}).first().click();
}

/** 源码编辑器里文字正好匹配 `text`（正则源码）的第一个 token：Monaco 按 token 种类给类名 `mtkN`，没有着色的文字是 `mtk1`。 */
const token = (page: Page, text: string) => activeGroup(page).locator(".view-lines span > span").filter({hasText: new RegExp(`^${text}$`, "u")}).first();

/** 本窗口的编辑器标签记录（Storage 的 project 场地）。 */
async function editorTabs(page: Page): Promise<{tabs: Record<string, {address?: string; language?: string}>} | null> {
    const client = await page.evaluate((identity) => localStorage.getItem(identity), CLIENT_IDENTITY_KEY);
    const db = new DatabaseSync(join(projectDir, ".nbook", "storage.sqlite"));
    try {
        const row = db.prepare("SELECT value FROM records WHERE owner = 'nbook.editor' AND key = 'editor.tabs' AND client = ?").get(client) as {value: string} | undefined;
        return row === undefined ? null : JSON.parse(row.value) as {tabs: Record<string, {address?: string; language?: string}>};
    } finally {
        db.close();
    }
}

/** 预览 iframe 的框架：从当前挂着的那个元素取（换令牌、重建时是新的框架）。 */
async function previewFrame(page: Page, nth = 0): Promise<Frame> {
    const element = page.locator("[data-html-preview-frame]").nth(nth);
    await expect(element).toBeVisible();
    const frame = await (await element.elementHandle())?.contentFrame();
    if (frame === null || frame === undefined) throw new Error("预览 iframe 没有框架");
    return frame;
}

test("图片：png 与 svg 以图片查看器显示，状态栏有尺寸与大小；外部改写后显示新图；svg 可用源码编辑器重新打开；2 MB 的 pdf 与 GBK 文本说明不能打开", async ({page}) => {
    await open(page);
    await expand(page, "project://img");
    await item(page, "project://img/a.png").dblclick();
    const viewer = activeGroup(page).locator("[data-image-viewer]");
    await expect(viewer).toHaveAttribute("data-image-viewer-phase", "shown");
    await expect(status(page, "nbook.editor.editor-status")).toContainText("3 × 2");
    await expect(status(page, "nbook.editor.word-count")).toHaveCount(0);

    await writeFile(join(projectDir, "img/a.png"), PNG_5X4);
    await expect(status(page, "nbook.editor.editor-status")).toContainText("5 × 4");

    // 单击图片在适应与 100% 之间切换：小图适应时也是 100%，放大一次后再看比例。
    await viewer.focus();
    await page.keyboard.press("=");
    await expect(status(page, "nbook.editor.editor-status")).toContainText("125%");
    await page.keyboard.press("0");
    await expect(status(page, "nbook.editor.editor-status")).toContainText("100%");

    await item(page, "project://img/b.svg").dblclick();
    await expect(activeGroup(page).locator("[data-image-viewer]")).toHaveAttribute("data-image-viewer-phase", "shown");
    await expect(status(page, "nbook.editor.editor-status")).toContainText("40 × 20");
    await runCommand(page, "用其它编辑器重新打开");
    await expect(page.getByRole("option", {name: /图片查看器/u})).toBeVisible();
    await page.getByRole("option", {name: /源码编辑器/u}).click();
    await expect(activeGroup(page).locator("[data-editor-kind=\"nbook.editor.code\"] .view-lines")).toContainText("<svg");

    await expand(page, "project://docs");
    await item(page, "project://docs/manual.pdf").dblclick();
    await expect(activeGroup(page).locator("[data-editor-unavailable=\"binary\"]")).toContainText("不能在这里打开");

    await expand(page, "project://notes");
    await item(page, "project://notes/gbk.txt").dblclick();
    await expect(activeGroup(page).locator("[data-editor-failure]")).toContainText("不是 UTF-8 文本");
    await expect(activeGroup(page).locator("[data-editor-failure]").getByRole("button")).toHaveCount(0);

    // 图片标签上关闭照常可用（活动的编辑器不要求文本文档）。
    await item(page, "project://img/a.png").click();
    await expect(labels(page).filter({hasText: "a.png"})).toHaveCount(1);
    await activeGroup(page).locator("[data-image-viewer]").focus();
    await page.keyboard.press("Control+w");
    await expect(labels(page).filter({hasText: "a.png"})).toHaveCount(0);
});

test("HTML 预览：标题栏打开预览；相对引用的样式、图片、字体、模块脚本与 fetch 都生效，锚点页内滚动；沙箱拿不到应用；默认联网，关掉开关后不能；侧边预览随未保存的正文更新；切走、刷新、关掉后令牌作废", async ({page}) => {
    const blockedPosts: number[] = [];
    page.on("response", (response) => {
        if (response.url().endsWith("/api/runtime/health") && response.request().method() === "POST") blockedPosts.push(response.status());
    });
    await page.route("https://net.example/**", (route) => route.fulfill({status: 200, body: "ok", headers: {"Access-Control-Allow-Origin": "*"}}));
    await open(page);
    await expand(page, "project://site");
    await item(page, "project://site/index.html").dblclick();
    await expect(activeGroup(page).locator("[data-editor-kind=\"nbook.editor.code\"] .view-lines")).toContainText("预览标题");

    await activeHead(page).getByRole("button", {name: "打开预览"}).click();
    // 新窗口第一次打开作品时还有欢迎页：只看这个文件的两个标签。
    await expect(labels(page).filter({hasText: "index.html"})).toHaveText(["index.html", "预览 index.html"]);
    let frame = await previewFrame(page);
    await expect(frame.locator("#title")).toHaveCSS("color", "rgb(1, 2, 3)");
    await expect.poll(() => frame.locator("#img").evaluate((element) => (element as HTMLImageElement).naturalWidth)).toBe(3);
    const body = frame.locator("body");
    await expect(body).toHaveAttribute("data-module", "ok");
    await expect(body).toHaveAttribute("data-fetch", "ok");
    await expect(body).toHaveAttribute("data-font", "ok");
    await expect(body).toHaveAttribute("data-parent", "denied");
    // 默认联网：外网请求放行；向应用端口的写请求得到 403；连 RPC 被拒。Chrome 把沙箱 iframe 放进单独的进程，
    // Playwright 接上它之前页面自己发的请求不经 `page.route`、也不报响应：外网与写请求在接上之后从框架里再发一次。
    await expect(body).not.toHaveAttribute("data-net", "blocked");
    await expect(body).toHaveAttribute("data-post", "sent");
    await expect(body).toHaveAttribute("data-rpc", "refused");
    expect(await frame.evaluate(() => fetch("https://net.example/z").then(() => "ok", () => "failed"))).toBe("ok");
    await frame.evaluate((origin) => fetch(`${origin}/api/runtime/health`, {method: "POST", mode: "no-cors"}).then(() => null, () => null), new URL(server.url).origin);
    await expect.poll(() => blockedPosts).toContain(403);
    await frame.locator("#jump").click();
    await expect.poll(() => frame.evaluate(() => [location.href, window.scrollY > 0])).toEqual(["about:srcdoc", true]);

    // 关掉联网：重载后外网请求与写请求都被 CSP 拦下。
    const posts = blockedPosts.length;
    await activeHead(page).getByRole("button", {name: "允许联网"}).click();
    frame = await previewFrame(page);
    await expect(frame.locator("body")).toHaveAttribute("data-net", "blocked");
    await expect(frame.locator("body")).toHaveAttribute("data-post", "blocked");
    expect(blockedPosts).toHaveLength(posts);

    // 在预览里导航到作品里的另一页：仍在沙箱里、仍不能联网。
    await frame.locator("#other").click();
    await expect.poll(async () => (await previewFrame(page)).url()).toContain("/site/other.html");
    frame = await previewFrame(page);
    await expect(frame.locator("body")).toHaveAttribute("data-net", "blocked");
    expect(await frame.evaluate(() => {
        try {
            return String(parent.document.title);
        } catch {
            return "denied";
        }
    })).toBe("denied");
    const base = await frame.evaluate(() => document.baseURI);
    expect((await fetch(new URL("data.json", base))).status).toBe(200);

    // 切到源码标签：预览的 iframe 被移除，它的令牌作废。
    await labels(page).filter({hasText: /^index\.html$/u}).click();
    await expect(page.locator("[data-html-preview-frame]")).toHaveCount(0);
    await expect.poll(async () => (await fetch(new URL("data.json", base))).status).toBe(404);

    // 在侧边打开预览：在源码里输入、不保存，停手后右侧的预览更新。
    await activeHead(page).getByRole("button", {name: "更多操作"}).click();
    await page.getByRole("menuitem", {name: "在侧边打开预览"}).click();
    await expect(page.locator("[data-editor-group]")).toHaveCount(2);
    await page.locator("[data-editor-group-head]").first().locator("[data-editor-tab-label]").filter({hasText: /^index\.html$/u}).click();
    const code = page.locator("[data-editor-group-active] [data-editor-kind=\"nbook.editor.code\"] .monaco-editor");
    await code.click();
    await page.keyboard.press("Control+End");
    await page.keyboard.insertText("<p id=\"added\">新段</p>");
    frame = await previewFrame(page);
    await expect(frame.locator("#added")).toHaveText("新段");
    const sideBase = await frame.evaluate(() => document.baseURI);
    expect((await fetch(new URL("data.json", sideBase))).status).toBe(200);

    // 刷新：旧窗口断开，它申请的令牌作废；恢复出的预览视图重新申请。
    await page.reload();
    await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-rpc-state", "online");
    await expect.poll(async () => (await fetch(new URL("data.json", sideBase))).status).toBe(404);
    frame = await previewFrame(page);
    const restoredBase = await frame.evaluate(() => document.baseURI);
    expect(restoredBase).not.toBe(sideBase);
    expect((await fetch(new URL("data.json", restoredBase))).status).toBe(200);

    // 关掉预览标签：令牌作废。组空了随之关闭，所以每次重新找。
    const previews = page.locator("[data-editor-tab]").filter({hasText: "预览 index.html"});
    for (let guard = 0; guard < 4 && await previews.count() > 0; guard += 1) {
        // 关闭按钮与标签是兄弟元素，按标签 id 找。
        const id = await previews.first().getAttribute("data-editor-tab");
        await page.locator(`[data-editor-tab-close="${id ?? ""}"]`).click();
    }
    await expect(page.locator("[data-html-preview-frame]")).toHaveCount(0);
    await expect.poll(async () => (await fetch(new URL("data.json", restoredBase))).status).toBe(404);
});

test("语言：py、html 里的 script、Markdown 的 ts 代码块都有着色，状态栏显示语言名；换成纯文本后着色消失，刷新后仍是纯文本", async ({page}) => {
    await open(page);
    await expand(page, "project://code");
    await item(page, "project://code/a.py").dblclick();
    await expect(token(page, "def")).toBeVisible();
    await expect(token(page, "def")).not.toHaveClass(/\bmtk1\b/u);
    await expect(status(page, "nbook.editor.language")).toHaveText("Python");

    // 嵌入的语言：HTML 按 mimetype（text/javascript），Markdown 代码块按名字（ts）找到。
    await item(page, "project://code/a.html").dblclick();
    await expect(status(page, "nbook.editor.language")).toHaveText("HTML");
    await expect(token(page, "const")).not.toHaveClass(/\bmtk1\b/u);
    await item(page, "project://code/b.md").dblclick();
    await expect(status(page, "nbook.editor.language")).toHaveCount(0);
    await runCommand(page, "用其它编辑器重新打开");
    await page.getByRole("option", {name: /源码编辑器/u}).click();
    await expect(status(page, "nbook.editor.language")).toHaveText("Markdown");
    await expect(token(page, "const")).not.toHaveClass(/\bmtk1\b/u);

    await item(page, "project://code/a.py").click();
    await expect(status(page, "nbook.editor.language")).toHaveText("Python");
    await status(page, "nbook.editor.language").click();
    await page.getByRole("option", {name: /纯文本/u}).click();
    await expect(status(page, "nbook.editor.language")).toHaveText("纯文本");
    // 纯文本不分 token：整行是一个没有着色的 token。
    await expect(token(page, "def\\shello\\(\\):")).toHaveClass(/\bmtk1\b/u);
    await expect.poll(async () => Object.values((await editorTabs(page))?.tabs ?? {}).find((tab) => tab.address === "project://code/a.py")?.language).toBe("plaintext");

    await page.reload();
    await expect(page.locator("[data-workbench-root]")).toHaveAttribute("data-rpc-state", "online");
    await expect(status(page, "nbook.editor.language")).toHaveText("纯文本");
    await expect(token(page, "def\\shello\\(\\):")).toHaveClass(/\bmtk1\b/u);

    // 拆分：新组的源码编辑器为同一文件建自己的模型，两组都显示正文（模型的 URI 整页不重复）。
    await runCommand(page, "向右拆分编辑器");
    await expect(page.locator("[data-editor-group]")).toHaveCount(2);
    for (const group of await page.locator("[data-editor-group]").all()) await expect(group.locator(".view-lines")).toContainText("def");
});
